/**
 * Create a staff account (front desk, teacher, admin) so it can be invited.
 *
 * There is still no UI for this — the existing staff rows were added by hand —
 * and the invite flow can only mail somebody who already has a row. So this
 * closes exactly that gap and stops there: it creates the account with a
 * placeholder Firebase uid, the same shape the importer writes, which makes it
 * show up in the Directory's bulk-invite modal as "never invited". The admin
 * then sends the invite from there, through the editable preview, and the
 * server mints the real Firebase account at that point.
 *
 * Deliberately does not email anyone. Every invitation is reviewed before it
 * goes out, and a script is the wrong place for that decision.
 *
 * Usage:
 *   node scripts/create-staff-account.js --email a@b.com --name "Ana Ruiz" --role RECEPTIONIST
 *   node scripts/create-staff-account.js --email a@b.com --name "Ana Ruiz" --role RECEPTIONIST --apply
 *
 * Dry run is the default on purpose: DATABASE_URL points at the live Neon
 * database, so the first run should only ever print what it would create.
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const STAFF_ROLES = ['RECEPTIONIST', 'TEACHER', 'ADMIN'];

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const email = arg('email')?.trim().toLowerCase();
  const fullName = arg('name')?.trim();
  const role = arg('role')?.trim().toUpperCase();
  const phone = arg('phone')?.trim() || null;

  if (!email || !fullName || !role) {
    console.error('Usage: node scripts/create-staff-account.js --email <email> --name "<full name>" --role <ROLE> [--phone <phone>] [--apply]');
    process.exit(1);
  }
  if (!STAFF_ROLES.includes(role)) {
    console.error(`--role must be one of: ${STAFF_ROLES.join(', ')}`);
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, fullName: true, role: true, secondaryRoles: true, invitedAt: true },
  });

  if (existing) {
    // Someone already here — a teacher picking up desk shifts, most likely.
    // Adding the hat is right; overwriting their primary role is not, because
    // that decides where they land after signing in.
    if (existing.role === role || existing.secondaryRoles.includes(role)) {
      console.log(`${email} already holds ${role} (primary: ${existing.role}). Nothing to do.`);
      return;
    }
    console.log(`${email} exists as ${existing.role}. Would add ${role} as a secondary role.`);
    if (!apply) return console.log('\nDry run — re-run with --apply to write.');

    await prisma.user.update({
      where: { id: existing.id },
      data: { secondaryRoles: { push: role } },
    });
    console.log(`Added ${role} to ${existing.fullName}.`);
    console.log(existing.invitedAt
      ? 'They can already sign in — the new role applies on their next request.'
      : 'They have never been invited: send it from Directory → Invite.');
    return;
  }

  console.log(`Would create: ${fullName} <${email}> as ${role}${phone ? ` (${phone})` : ''}`);
  if (!apply) return console.log('\nDry run — re-run with --apply to write.');

  const user = await prisma.user.create({
    data: {
      firebaseUid: placeholderUid('import'),
      email,
      fullName,
      role,
      phone,
      status: 'ACTIVE',
    },
    select: { id: true, fullName: true, role: true },
  });

  console.log(`Created ${user.fullName} (${user.role}), id ${user.id}.`);
  console.log('Next: Directory → Invite, find them under "Front Desk", and send the invite.');
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
