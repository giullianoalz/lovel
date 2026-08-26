/**
 * Runs a command with DATABASE_URL / DIRECT_URL pointed at the Supabase copy.
 *
 *   node scripts/with-supabase.mjs npx prisma migrate deploy
 *   node scripts/with-supabase.mjs --session node scripts/snack-images-to-drive.mjs
 *   node scripts/with-supabase.mjs npm run db:backup
 *
 * The live database is still Neon, and `.env` still says so, because that is
 * what serves the families right now. Rather than editing those two variables
 * back and forth — which is exactly how somebody eventually runs a migration
 * against production at 2am — this swaps them for one child process and leaves
 * the file alone.
 *
 * The connection strings never reach the command line, so they stay out of
 * shell history and out of the process list.
 */
import 'dotenv/config';
import { spawn } from 'child_process';

// A one-off script opens a connection, does its work and exits. The shared
// transaction pooler throttles exactly that churn — eight cold connections in
// a row drew five refusals — while the same connection held open ran 15 of 15
// clean. So scripts take the session pooler and only the app itself gets the
// transaction pooler, which is what each of the two is built for.
const SESSION = process.argv.includes('--session');
const command = process.argv.slice(2).filter((a) => a !== '--session');
if (!command.length) {
  console.error('Usage: node scripts/with-supabase.mjs <command…>');
  process.exit(1);
}

const directUrl = process.env.SUPABASE_DIRECT_URL;
const url = SESSION ? directUrl : process.env.SUPABASE_DATABASE_URL;
if (!url || !directUrl) {
  console.error('SUPABASE_DATABASE_URL and SUPABASE_DIRECT_URL must both be set in .env.');
  process.exit(1);
}
if (url.includes('YOUR-PASSWORD') || directUrl.includes('YOUR-PASSWORD')) {
  console.error('The Supabase URLs still carry the [YOUR-PASSWORD] placeholder.');
  process.exit(1);
}
// A copy that turned out to be the original is the one mistake with no undo.
if (url === process.env.DATABASE_URL || directUrl === process.env.DATABASE_URL) {
  console.error('The Supabase URLs match the live DATABASE_URL. Refusing to run.');
  process.exit(1);
}

const host = directUrl.match(/@([^/]+)/)?.[1] || 'unknown';
console.log(`→ ${command.join(' ')}\n→ against ${host} (${SESSION ? 'session pooler' : 'transaction pooler'})\n`);

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: directUrl },
});
child.on('exit', (code) => process.exit(code ?? 1));
