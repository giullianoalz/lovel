/**
 * Full-data backup of the database, as one JSON file per run.
 *
 *   npm run db:backup
 *
 * Reads every table and writes it to `server/backups/backup-<timestamp>.json`.
 * That directory is gitignored on purpose: a dump carries student, medical and
 * family records in the clear, so it must never reach the repo.
 *
 * The schema itself is already versioned in `prisma/migrations`, so this dump
 * plus `prisma migrate deploy` against an empty database holds everything
 * needed to reconstruct the data. There is no restore script yet: reinserting
 * has to follow foreign-key order, which is a different job from dumping and
 * is far more dangerous to get wrong.
 *
 * The table list comes from Prisma's runtime datamodel rather than a hardcoded
 * array, so a model added to schema.prisma later is backed up without anyone
 * remembering to update this file.
 *
 * Read-only: there is no write to the database anywhere in here.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Prisma, PrismaClient } from '@prisma/client';

// Deliberately not the shared client from src/config/database.js: that one logs
// every query when NODE_ENV is development, which buries this script's own
// output under one SELECT per table.
const prisma = new PrismaClient({ log: ['error'] });

const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backups');

/** Prisma exposes models PascalCased; the client property is camelCase. */
const clientKey = (model) => model.charAt(0).toLowerCase() + model.slice(1);

const run = async () => {
  const models = Prisma.dmmf?.datamodel?.models?.map((m) => m.name);
  if (!models?.length) {
    // Better to fail than to write a "backup" that silently covers nothing.
    throw new Error('Could not read the Prisma datamodel — run `npx prisma generate` first.');
  }

  const dump = { takenAt: new Date().toISOString(), tables: {} };
  const counts = {};

  for (const model of models) {
    dump.tables[model] = await prisma[clientKey(model)].findMany();
    counts[model] = dump.tables[model].length;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `backup-${stamp}.json`);

  // Dates and Prisma's Decimal both carry a toJSON, so they land as strings and
  // survive the round trip. BigInt does not, hence the replacer.
  fs.writeFileSync(file, JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2), 'utf8');

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Backup written: ${file}`);
  console.log(`${total} rows across ${models.length} tables — ${(fs.statSync(file).size / 1024).toFixed(1)} KB\n`);
  for (const [model, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${String(n).padStart(5)}  ${model}`);
  }
  if (total === 0) console.log('  (database is empty)');
};

run()
  .catch((error) => {
    console.error('Backup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
