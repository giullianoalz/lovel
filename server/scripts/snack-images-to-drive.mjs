/**
 * Moves snack photos out of Postgres and into Drive.
 *
 *   node scripts/snack-images-to-drive.mjs            # dry run, writes nothing
 *   node scripts/snack-images-to-drive.mjs --apply    # uploads and updates rows
 *   node scripts/snack-images-to-drive.mjs --apply --limit 1   # canary: just one
 *   node scripts/snack-images-to-drive.mjs --apply --manifest <file>
 *
 * `snack_items.image_url` was holding whole photographs as base64 data URIs,
 * straight from the phone camera that took them. Eleven rows came to 62 MB —
 * four fifths of the entire database — and every request for the cabinet
 * dragged all of it across the wire. This uploads those bytes to Drive and
 * leaves `drive_file_id` behind in their place.
 *
 * Rows whose image_url is already an ordinary http(s) URL are left untouched,
 * and so is any row that already has a drive_file_id, so a second run is a
 * no-op rather than a second copy in Drive.
 *
 * The manifest is what makes this safe to rehearse. A run records
 * { snackId: driveFileId } to `backups/snack-image-manifest.json`; a later run
 * given `--manifest` reuses those ids instead of uploading the same photo
 * again. So the rehearsal against a copy of the database does the uploading
 * once, and the real cutover just points rows at files that already exist.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { uploadBufferToDrive, drive, driveAuthMode } from '../src/config/drive.js';

const APPLY = process.argv.includes('--apply');
// --limit N moves only the first N photos. This exists for the canary: move a
// single one, look at it in the real app, and only then move the rest. Whether
// the server can actually reach Drive is not something a config screen can
// tell you — a variable can be present and wrong, which is exactly how chat and
// waivers sat broken for weeks.
const limitFlag = process.argv.indexOf('--limit');
const LIMIT = limitFlag === -1 ? Infinity : parseInt(process.argv[limitFlag + 1], 10);
const manifestFlag = process.argv.indexOf('--manifest');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backups');
const MANIFEST_OUT = path.join(BACKUP_DIR, 'snack-image-manifest.json');

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

const prisma = new PrismaClient({ log: ['error'] });

const run = async () => {
  const manifest = manifestFlag !== -1
    ? JSON.parse(fs.readFileSync(process.argv[manifestFlag + 1], 'utf8'))
    : {};
  if (manifestFlag !== -1) {
    console.log(`Manifest loaded: ${Object.keys(manifest).length} photo(s) already in Drive.\n`);
  }

  // A dry run is meant to work against a database that has not had the
  // migration applied yet — that is the whole point of rehearsing before
  // touching anything — so the column's absence is a fact to read, not a crash.
  const [{ exists: hasColumn }] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'snack_items' AND column_name = 'drive_file_id') AS exists`
  );
  if (!hasColumn) {
    if (APPLY) {
      throw new Error("snack_items.drive_file_id does not exist — run 'npx prisma migrate deploy' against this database first.");
    }
    console.log('Note: drive_file_id does not exist here yet; reporting as if no photo had moved.\n');
  }

  // Raw SQL rather than Prisma so the length of each data URI can be measured
  // without pulling all 62 MB into this process just to count it.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, ${hasColumn ? 'drive_file_id' : 'NULL::text AS drive_file_id'},
            length(image_url) AS len,
            left(coalesce(image_url, ''), 5) AS kind
       FROM snack_items ORDER BY length(image_url) DESC NULLS LAST`
  );

  const allPending = rows.filter(r => r.kind === 'data:' && !r.drive_file_id);
  const pending = Number.isFinite(LIMIT) ? allPending.slice(0, LIMIT) : allPending;
  const already = rows.filter(r => r.drive_file_id);
  const external = rows.filter(r => r.kind && r.kind !== 'data:');

  console.log(`${rows.length} snack(s): ${allPending.length} to move, ${already.length} already in Drive, ${external.length} on an external URL.`);
  if (Number.isFinite(LIMIT)) console.log(`--limit ${LIMIT}: only ${pending.length} of them this run.`);
  const total = pending.reduce((sum, r) => sum + Number(r.len || 0), 0);
  console.log(`Base64 to reclaim: ${mb(total)}\n`);

  if (!pending.length) {
    console.log('Nothing to do.');
    return;
  }

  if (!APPLY) {
    for (const r of pending) console.log(`  would move  ${mb(Number(r.len))}  ${r.name}`);
    console.log('\nDry run — nothing was uploaded or written. Re-run with --apply.');
    return;
  }

  if (!drive) {
    throw new Error(`Drive is not configured (auth mode: ${driveAuthMode}) — refusing to touch any row.`);
  }
  const folderId = process.env.DRIVE_SNACKS_FOLDER_ID || process.env.DRIVE_MARKETING_FOLDER_ID;
  if (!folderId) {
    throw new Error('Neither DRIVE_SNACKS_FOLDER_ID nor DRIVE_MARKETING_FOLDER_ID is set — refusing to scatter photos across My Drive.');
  }

  const written = { ...manifest };
  let moved = 0;
  let reclaimed = 0;

  for (const row of pending) {
    // One row at a time. Holding eleven multi-megabyte data URIs in memory at
    // once is how a script like this gets killed halfway through.
    const [full] = await prisma.$queryRawUnsafe(
      'SELECT image_url FROM snack_items WHERE id = $1::uuid', row.id
    );
    const match = (full?.image_url || '').match(DATA_URI);
    if (!match) {
      console.warn(`  SKIP  ${row.name} — image_url stopped looking like a data URI mid-run.`);
      continue;
    }

    let fileId = written[row.id];
    if (fileId) {
      console.log(`  reuse ${row.name} → ${fileId}`);
    } else {
      const [, mimeType, b64] = match;
      const buffer = Buffer.from(b64, 'base64');
      const ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const safeName = row.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const file = await uploadBufferToDrive(buffer, `snack-${safeName}-${row.id}.${ext}`, mimeType, folderId);
      if (!file?.id) {
        console.error(`  FAIL  ${row.name} — Drive returned no file id; row left alone.`);
        continue;
      }
      fileId = file.id;
      written[row.id] = fileId;
      // Flushed after every upload, not at the end: if this dies on photo nine,
      // the eight already in Drive must not be uploaded a second time.
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.writeFileSync(MANIFEST_OUT, JSON.stringify(written, null, 2));
      console.log(`  up    ${mb(buffer.length)}  ${row.name} → ${fileId}`);
    }

    // Only now is the base64 dropped — the bytes exist in two places until the
    // moment the row can point at the copy that is not going away.
    await prisma.$executeRawUnsafe(
      'UPDATE snack_items SET drive_file_id = $1, image_url = NULL WHERE id = $2::uuid',
      fileId, row.id
    );
    moved += 1;
    reclaimed += Number(row.len || 0);
  }

  console.log(`\nMoved ${moved} photo(s), ${mb(reclaimed)} out of Postgres.`);
  console.log(`Manifest: ${MANIFEST_OUT}`);
  console.log('Postgres does not shrink on its own — run VACUUM FULL snack_items to hand the pages back.');
};

run()
  .catch((e) => { console.error('\nFailed:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
