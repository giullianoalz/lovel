/**
 * A database row must never outlive the bytes it points at.
 *
 * Both upload paths — marketing photos and chat attachments — used to record
 * the upload regardless of what happened to the file: if Drive refused it, they
 * logged the error and wrote the row anyway, "so the local file record is
 * created". On Render local disk is wiped on every restart, so those rows
 * pointed at nothing the moment the dyno recycled. That is not hypothetical: it
 * destroyed all 35 marketing photos AND all 3 chat attachments in production,
 * every one with a null driveFileId, and the app served 404s in their place.
 *
 * The failure is silent by construction: the sender gets a 201, the file looks
 * delivered, and nothing seems wrong until it stops loading days later. So the
 * guarantee is asserted directly — when nothing durable accepted the file, no
 * row may be written and the caller must be told.
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
const { uploadAttachment } = await import('../src/controllers/chat.controller.js');

const SUBMISSION = { id: 'sub-1', teacherId: 'teacher-1' };

const realMethods = {};
let created;

before(() => {
  realMethods.findUnique = prisma.marketingSubmission.findUnique;
  realMethods.create = prisma.marketingPhoto.create;
  realMethods.participantFindUnique = prisma.chatParticipant.findUnique;
  realMethods.messageCreate = prisma.chatMessage.create;

  prisma.marketingSubmission.findUnique = async () => SUBMISSION;
  prisma.marketingPhoto.create = async ({ data }) => {
    created.push(data);
    return { id: `photo-${created.length}`, ...data };
  };

  prisma.chatParticipant.findUnique = async () => ({
    threadId: 'thread-1', userId: SUBMISSION.teacherId, isBlocked: false, thread: { isBot: false },
  });
  prisma.chatMessage.create = async ({ data }) => {
    created.push(data);
    return { id: 'msg-1', ...data, sentAt: new Date(), sender: { fullName: 'Test Teacher' } };
  };
});

after(async () => {
  prisma.marketingSubmission.findUnique = realMethods.findUnique;
  prisma.marketingPhoto.create = realMethods.create;
  prisma.chatParticipant.findUnique = realMethods.participantFindUnique;
  prisma.chatMessage.create = realMethods.messageCreate;
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

test('a chat attachment that cannot be stored is not sent at all', async () => {
  // The chat copy of the same bug. Worse here than in marketing: the message
  // becomes part of a supervised conversation record, so a dead attachment
  // cannot simply be re-uploaded — it sits in the thread as evidence of a file
  // nobody can open.
  process.env.NODE_ENV = 'production';
  created = [];
  const res = makeRes();

  await uploadAttachment({
    params: { threadId: 'thread-1' },
    user: { id: SUBMISSION.teacherId, role: 'TEACHER', secondaryRoles: [] },
    file: { path: '/nonexistent/tmp/c.pdf', filename: 'c.pdf', originalname: 'c.pdf', mimetype: 'application/pdf' },
    app: { get: () => null },
  }, res, (err) => { throw err; });

  assert.equal(created.length, 0, 'a message was created for a file that was never stored');
  assert.equal(res.statusCode, 502);
  assert.match(res.body.message, /not sent/, 'the sender must know the file did not go through');
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
