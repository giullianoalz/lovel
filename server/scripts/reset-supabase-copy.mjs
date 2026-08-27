/**
 * Empties the Supabase copy so a fresh restore can land in it.
 *
 * Drops and recreates the public schema. Everything the app owns lives there;
 * Supabase's own machinery (auth, storage, realtime) sits in other schemas and
 * is not touched. The default grants are put back afterwards so the Supabase
 * table editor keeps working.
 *
 * Three guards, because this is the one command in the cutover that cannot be
 * undone if it points at the wrong database:
 *   - the host must be Supabase's pooler
 *   - it must not equal DATABASE_URL or DIRECT_URL (the live Neon database)
 *   - it prints what it is about to do before doing it
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const url = process.env.SUPABASE_DIRECT_URL || '';
const host = (url.match(/@([^/]+)/) || [])[1] || '';

if (!host.includes('pooler.supabase.com')) {
  console.error('ABORT: target is not Supabase →', host || '(empty)');
  process.exit(1);
}
if (url === process.env.DATABASE_URL || url === process.env.DIRECT_URL) {
  console.error('ABORT: target matches the live database. Refusing.');
  process.exit(1);
}

const prisma = new PrismaClient({ log: [], datasources: { db: { url } } });
const retry = async (fn, n = 5) => {
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) { if (i === n - 1) throw e; await new Promise(r => setTimeout(r, 3000)); }
  }
};

const run = async () => {
  console.log('target:', host);
  const before = await retry(() => prisma.$queryRawUnsafe(
    "select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"));
  console.log('tables before:', before[0].n);

  await retry(() => prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE'));
  await retry(() => prisma.$executeRawUnsafe('CREATE SCHEMA public'));

  for (const grant of [
    'GRANT ALL ON SCHEMA public TO postgres',
    'GRANT ALL ON SCHEMA public TO public',
    'GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role',
  ]) {
    await retry(() => prisma.$executeRawUnsafe(grant))
      .catch(e => console.log('  (warning)', grant, '→', e.message.split('\n')[0]));
  }

  const after = await retry(() => prisma.$queryRawUnsafe(
    "select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"));
  console.log('tables after:', after[0].n, '→ schema is empty, ready for migrate deploy');
};

run()
  .catch(e => { console.error('failed:', e.message.split('\n')[0]); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
