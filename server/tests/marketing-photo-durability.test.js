/**
 * A photo row must never outlive the bytes it points at.
 *
 * `uploadPhotos` used to record every upload regardless of what happened to the
 * file: if the Drive upload failed it logged the error and created the row
 * anyway, "so the local file record is created". On Render local disk is wiped
 * on every restart, so those rows pointed at nothing the moment the dyno
 * recycled. That is not hypothetical — it destroyed all 35 marketing photos in
 * production, every one of them with a null driveFileId, and the gallery served
 * 404s in their place.
 *
 * The failure is silent by construction: the teacher gets a 201, the admin sees
 * a submission, and nothing looks wrong until the images stop loading days
 * later. So the guarantee is asserted directly — when nothing durable accepted
 * the file, no row may be written and the caller must be told.
 *
 * Run with: npm test --prefix server
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

// server/.env points at the production database, so a stub that turns out to be
// missing must fail to connect rather than reach real data. Port 1 is never
// listening. Set before the client is constructed.
process.env.DATABASE_URL = 'postgresql://tests:tests@127.0.0.1:1/unused';

// Blank rather than deleted: dotenv only fills variables that are absent, so
// assigning '' keeps server/.env from supplying real credentials here. With no
// credentials the Drive client is null, which is the "nothing durable accepted
// the file" case this file is about.
process.env.DRIVE_REFRESH_TOKEN = '';
process.env.DRIVE_CLIENT_EMAIL = '';
process.env.DRIVE_PRIVATE_KEY = '';

const { default: prisma } = await import('../src/config/database.js');
const { uploadPhotos } = await import('../src/controllers/marketing.controller.js');

const SUBMISSION = { id: 'sub-1', teacherId: 'teacher-1' };

const realMethods = {};
let created;

before(() => {
  realMethods.findUnique = prisma.marketingSubmission.findUnique;
  realMethods.create = prisma.marketingPhoto.create;

  prisma.marketingSubmission.findUnique = async () => SUBMISSION;
  prisma.marketingPhoto.create = async ({ data }) => {
    created.push(data);
    return { id: `photo-${created.length}`, ...data };
  };
});

after(async () => {
  prisma.marketingSubmission.findUnique = realMethods.findUnique;
  prisma.marketingPhoto.create = realMethods.create;
  await prisma.$disconnect();
});

/** Minimal express doubles: enough to capture what the handler answered. */
const makeReq = () => ({
  params: { id: SUBMISSION.id },
  user: { id: SUBMISSION.teacherId, role: 'TEACHER', secondaryRoles: [] },
  files: [
    // A path that does not exist: the handler unlinks discarded uploads, and
    // that cleanup must not be what decides the outcome.
    { path: '/nonexistent/tmp/a.jpg', filename: 'a.jpg', originalname: 'a.jpg', mimetype: 'image/jpeg' },
    { path: '/nonexistent/tmp/b.jpg', filename: 'b.jpg', originalname: 'b.jpg', mimetype: 'image/jpeg' },
  ],
});

const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const run = async () => {
  created = [];
  const res = makeRes();
  await uploadPhotos(makeReq(), res, (err) => { throw err; });
  return res;
};

test('writes no photo rows when nothing durable stored the file', async () => {
  process.env.NODE_ENV = 'production';
  const res = await run();

  assert.equal(created.length, 0,
    'a row was created for a file that no durable store accepted — this is the bug that lost 35 photos');
  assert.equal(res.statusCode, 502, 'the caller must be told the upload did not survive');
  assert.deepEqual(res.body.failed, ['a.jpg', 'b.jpg']);
  assert.deepEqual(res.body.photos, []);
});

test('reports which files were lost rather than failing anonymously', async () => {
  process.env.NODE_ENV = 'production';
  const res = await run();

  assert.match(res.body.message, /2 of 2/,
    'the teacher needs to know how many of their photos did not make it');
  assert.match(res.body.message, /not configured/,
    'the message must name the cause so the operator can act on it');
});

test('still accepts local-disk-only storage in development', async () => {
  // A dev machine keeps its disk between restarts, so requiring Drive there
  // would make the module impossible to work on offline.
  process.env.NODE_ENV = 'development';
  const res = await run();

  assert.equal(created.length, 2, 'local disk is durable in development');
  assert.equal(res.statusCode, 201);
  assert.equal(created[0].driveFileId, null);
});
