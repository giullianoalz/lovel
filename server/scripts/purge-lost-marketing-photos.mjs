/**
 * Removes MarketingPhoto rows whose bytes no longer exist anywhere.
 *
 *   node scripts/purge-lost-marketing-photos.mjs            # dry run
 *   node scripts/purge-lost-marketing-photos.mjs --confirm  # actually delete
 *
 * Background: uploads used to be recorded even when the Drive upload failed,
 * leaving rows that pointed only at Render's local disk — which is wiped on
 * every restart. Those rows render as broken images and can never be repaired,
 * because the bytes are gone.
 *
 * A row is only ever deleted when BOTH are true:
 *   - it has no driveFileId (nothing durable was stored), and
 *   - no file exists at its local path (so a dev machine that still holds the
 *     original is never quietly purged).
 *
 * Every row it deletes is written to a JSON backup first.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes('--confirm');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'marketing');

const candidates = await prisma.marketingPhoto.findMany({
  where: { driveFileId: null },
  include: { submission: { select: { id: true, title: true, weekOf: true, teacherId: true } } },
});

const lost = [];
const stillOnDisk = [];
for (const photo of candidates) {
  const localPath = path.join(UPLOAD_DIR, path.basename(photo.fileUrl));
  (fs.existsSync(localPath) ? stillOnDisk : lost).push(photo);
}

console.log(`candidates (no driveFileId): ${candidates.length}`);
console.log(`  still on local disk, keeping: ${stillOnDisk.length}`);
console.log(`  bytes gone, deletable:        ${lost.length}`);

if (lost.length === 0) {
  console.log('\nNothing to purge.');
  await prisma.$disconnect();
  process.exit(0);
}

const bySubmission = new Map();
for (const p of lost) {
  const key = p.submission?.id || 'orphan';
  bySubmission.set(key, (bySubmission.get(key) || 0) + 1);
}
console.log(`\nAffected submissions: ${bySubmission.size}`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --confirm to apply.');
  await prisma.$disconnect();
  process.exit(0);
}

const backupPath = path.join(process.cwd(), `lost-marketing-photos-${Date.now()}.json`);
fs.writeFileSync(backupPath, JSON.stringify(lost, null, 2));
console.log(`\nBackup written: ${backupPath}`);

const result = await prisma.marketingPhoto.deleteMany({
  where: { id: { in: lost.map(p => p.id) } },
});
console.log(`Deleted ${result.count} photo row(s).`);

await prisma.$disconnect();
