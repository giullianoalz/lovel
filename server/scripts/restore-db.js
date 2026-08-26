/**
 * Loads a `db:backup` dump into an empty database.
 *
 *   node scripts/restore-db.js <backup.json> --target-env SUPABASE_DIRECT_URL
 *   node scripts/restore-db.js <backup.json> --target-env SUPABASE_DIRECT_URL \n *     --replace PayCategory --apply
 *   node scripts/restore-db.js <backup.json> --target "postgres://…" --apply
 *
 * This is the half `backup-db.js` said did not exist yet. It is here because
 * moving off Neon means standing a copy of production up somewhere else, and
 * this machine has no pg_dump: the dump is JSON and the schema already lives in
 * `prisma/migrations`, so `prisma migrate deploy` plus this script rebuilds the
 * database without any Postgres client tooling at all.
 *
 * Insert order comes from Prisma's own datamodel — a model holding a foreign
 * key is written after the model it points at — rather than a hand-kept list
 * that would rot the first time somebody added a relation.
 *
 * Guard rails, because the failure mode here is overwriting a live database:
 *   - --target is mandatory. There is no default and nothing is inferred.
 *   - A target matching DATABASE_URL or DIRECT_URL is refused outright.
 *   - A target that already holds any of these rows is refused without --force.
 *   - Without --apply it prints the plan and connects to nothing.
 */
import 'dotenv/config';
import fs from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? null : args[i + 1];
};
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
// --target-env names an environment variable holding the connection string,
// so the password never lands in shell history or a process listing. Both
// forms are accepted; --target stays for a throwaway scratch database.
const targetEnv = flag('target-env');
const target = targetEnv ? process.env[targetEnv] : flag('target');
// Tables a migration seeds on deploy — pay_categories is one — are not empty
// on arrival, and the dump carries its own copy of them with different ids.
// Naming them here deletes the seeded rows first so the dump's versions land
// with the ids every foreign key in the dump already points at.
const replace = new Set((flag('replace') || '').split(',').map((x) => x.trim()).filter(Boolean));
if (targetEnv && !target) {
  console.error('Restore failed: ' + targetEnv + ' is not set in this environment.');
  process.exit(1);
}

const clientKey = (model) => model.charAt(0).toLowerCase() + model.slice(1);

/** Strips the password so a connection string can be printed safely. */
const redact = (url) => url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');

/**
 * Models ordered so every foreign key's target is written before the row that
 * points at it. A field carrying relationFromFields is the side holding the FK.
 */
const insertionOrder = (models) => {
  const deps = new Map(models.map((m) => [m.name, new Set()]));
  for (const m of models) {
    for (const f of m.fields) {
      // Self-references (a user who reports to a user) cannot be ordered away.
      // They rely on the column being nullable, exactly as Postgres does.
      if (f.kind === 'object' && f.relationFromFields?.length && f.type !== m.name) {
        deps.get(m.name).add(f.type);
      }
    }
  }

  const order = [];
  const done = new Set();
  const visiting = new Set();
  const cycles = [];

  const visit = (name, trail) => {
    if (done.has(name)) return;
    if (visiting.has(name)) {
      cycles.push([...trail, name].join(' -> '));
      return;
    }
    visiting.add(name);
    for (const dep of deps.get(name) || []) visit(dep, [...trail, name]);
    visiting.delete(name);
    done.add(name);
    order.push(name);
  };

  for (const m of models) visit(m.name, []);
  return { order, cycles };
};

const run = async () => {
  if (!file) throw new Error('Usage: node scripts/restore-db.js <backup.json> --target "postgres://…" [--apply]');
  if (!target) throw new Error('--target or --target-env is required. This script will not guess which database to write to.');
  if (target === process.env.DATABASE_URL || target === process.env.DIRECT_URL) {
    throw new Error('--target is the database this environment already points at. Refusing: restore into a copy, never onto the live one.');
  }

  const models = Prisma.dmmf?.datamodel?.models;
  if (!models?.length) throw new Error('Could not read the Prisma datamodel — run `npx prisma generate` first.');

  const { order, cycles } = insertionOrder(models);
  if (cycles.length) {
    throw new Error('Foreign keys form a cycle, so no safe insert order exists:\n  ' + cycles.join('\n  '));
  }

  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tables = dump.tables || {};
  console.log('Backup:  ' + file);
  console.log('Taken:   ' + (dump.takenAt || 'unknown'));
  console.log('Target:  ' + redact(target) + '\n');

  const unknown = Object.keys(tables).filter((t) => !order.includes(t));
  if (unknown.length) {
    throw new Error('The dump holds tables this schema no longer has: ' + unknown.join(', ') + '. Restore with the code that produced it.');
  }

  const planned = order.filter((m) => tables[m]?.length);
  const totalRows = planned.reduce((sum, m) => sum + tables[m].length, 0);

  // The plan prints before anything connects, so a dry run still says something
  // useful when the target does not exist yet — which is the state you are in
  // while deciding whether to create it.
  if (!APPLY) {
    console.log('Would write ' + totalRows + ' row(s) across ' + planned.length + ' table(s), in this order:\n');
    for (const m of planned) console.log('  ' + String(tables[m].length).padStart(6) + '  ' + m);
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    return;
  }

  const prisma = new PrismaClient({ log: ['error'], datasources: { db: { url: target } } });

  try {
    // An accidental second run must not double every row.
    const unknownReplace = [...replace].filter((m) => !planned.includes(m));
    if (unknownReplace.length) {
      throw new Error('--replace names tables this dump does not carry: ' + unknownReplace.join(', '));
    }

    const occupied = [];
    for (const model of planned) {
      if (replace.has(model)) continue;
      if (await prisma[clientKey(model)].count()) occupied.push(model);
    }

    // Deleted in reverse dependency order, so a child never outlives its parent.
    for (const model of [...planned].reverse().filter((m) => replace.has(m))) {
      const gone = await prisma[clientKey(model)].deleteMany({});
      console.log('  -' + String(gone.count).padStart(5) + '  ' + model + ' (replaced)');
    }
    if (occupied.length && !FORCE) {
      throw new Error('The target already holds rows in: ' + occupied.join(', ') + '. Restore into an empty database, or pass --force if you know it is a scratch copy.');
    }

    let written = 0;
    for (const model of planned) {
      const rows = tables[model];
      // Chunked: one createMany of every session or notification at once blows
      // past Postgres' bind-parameter limit.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma[clientKey(model)].createMany({ data: rows.slice(i, i + CHUNK) });
      }
      written += rows.length;
      console.log('  ' + String(rows.length).padStart(6) + '  ' + model);
    }
    console.log('\nRestored ' + written + ' row(s) into ' + redact(target) + '.');
    console.log('No sequences to reset — every id in this schema is a uuid the row carries itself.');
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error('\nRestore failed:', error.message);
  process.exitCode = 1;
});
