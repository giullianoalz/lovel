/**
 * Add a second guardian to an existing family — e.g. a spouse who needs their
 * own login rather than sharing the other parent's invite email. There is no
 * UI for this yet (POST /api/families/:id/members exists but only links an
 * already-created userId), so this closes that gap the same way
 * create-staff-account.js does for staff: creates the account with a
 * placeholder Firebase uid, which makes it show up in the Directory's invite
 * flow as "never invited".
 *
 * Deliberately does not email anyone or link a Firebase account — the admin
 * sends the invite from Directory, through the editable preview, same as
 * every other invite.
 *
 * Also relocates a guardian who was filed under the wrong family, which needs
 * --move on top of --apply: moving somebody changes which children and which
 * invoices they can see, so it is not something to do as a side effect of a
 * command that reads like "add".
 *
 * Usage:
 *   node scripts/add-family-guardian.js --family "Celli Family" --email a@b.com --name "Ana Ruiz"
 *   node scripts/add-family-guardian.js --family "Celli Family" --email a@b.com --name "Ana Ruiz" --apply
 *   node scripts/add-family-guardian.js --family "Richardson Family" --email a@b.com --name "Ana Ruiz" --move --apply
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const move = process.argv.includes('--move');
  const familyName = arg('family')?.trim();
  const email = arg('email')?.trim().toLowerCase();
  const fullName = arg('name')?.trim();

  if (!familyName || !email || !fullName) {
    console.error('Usage: node scripts/add-family-guardian.js --family "<family name>" --email <email> --name "<full name>" [--apply]');
    process.exit(1);
  }

  const family = await prisma.family.findFirst({
    where: { name: familyName },
    include: { members: { include: { user: { select: { fullName: true, email: true, role: true } } } } },
  });

  if (!family) {
    console.error(`No family found named "${familyName}".`);
    process.exit(1);
  }

  console.log(`Family: ${family.name} (${family.id})`);
  console.log('Current members:', family.members.map((m) => `${m.user.fullName} <${m.user.email}> (${m.role})`).join(', '));

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.log(`${email} already exists as ${existingUser.fullName} (${existingUser.role}), id ${existingUser.id}.`);
    const alreadyMember = family.members.some((m) => m.userId === existingUser.id);
    if (alreadyMember) {
      console.log('Already a member of this family. Nothing to do.');
      return;
    }

    // Filed under a different family already. Adding a second membership would
    // silently give them both households' children and invoices, so this is a
    // move, and the caller has to say so.
    const elsewhere = await prisma.familyMember.findMany({
      where: { userId: existingUser.id },
      include: { family: { select: { name: true } } },
    });
    if (elsewhere.length > 0) {
      console.log(`Currently in: ${elsewhere.map((m) => m.family.name).join(', ')}.`);
      if (!move) {
        console.log('\nThat is a different family. Re-run with --move (plus --apply) to relocate them,');
        console.log('or drop --family if they genuinely belong to both.');
        return;
      }
      console.log(`Would REMOVE them from ${elsewhere.map((m) => m.family.name).join(', ')} and add them to ${family.name} as a parent.`);
      if (elsewhere.some((m) => m.isInvoiceRecipient)) {
        console.log('⚠ They are the invoice recipient on a family they are leaving — check who bills that family afterwards.');
      }
      if (!apply) return console.log('\nDry run — re-run with --apply to write.');

      const [, member] = await prisma.$transaction([
        prisma.familyMember.deleteMany({ where: { userId: existingUser.id } }),
        prisma.familyMember.create({
          data: { familyId: family.id, userId: existingUser.id, role: 'parent', isInvoiceRecipient: false },
        }),
      ]);
      console.log(`Moved to ${family.name}. family_members id ${member.id}.`);
      return;
    }

    console.log(`Would link this existing user to ${family.name} as a parent.`);
    if (!apply) return console.log('\nDry run — re-run with --apply to write.');

    const member = await prisma.familyMember.create({
      data: { familyId: family.id, userId: existingUser.id, role: 'parent', isInvoiceRecipient: false },
    });
    console.log(`Linked. family_members id ${member.id}.`);
    return;
  }

  console.log(`Would create: ${fullName} <${email}> as PARENT, then link to ${family.name} as a parent.`);
  if (!apply) return console.log('\nDry run — re-run with --apply to write.');

  const user = await prisma.user.create({
    data: {
      firebaseUid: placeholderUid('import'),
      email,
      fullName,
      role: 'PARENT',
      status: 'ACTIVE',
    },
  });

  const member = await prisma.familyMember.create({
    data: { familyId: family.id, userId: user.id, role: 'parent', isInvoiceRecipient: false },
  });

  console.log(`Created ${user.fullName} (${user.id}) and linked to ${family.name} (family_members id ${member.id}).`);
  console.log('Next: Directory → find her under Celli Family → Invite.');
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
