/**
 * One-off: add the Royter family (Marina + student Marco) to the system so
 * an admin can enroll Marco into Lori Celli's 10am and 1pm classes.
 *
 * Follows the same pattern as import-tutorbird-contacts.mjs: placeholder
 * Firebase uid (shows up as "never invited" in Directory), synthetic
 * @import.local email for the student since email is required+unique.
 *
 * Usage:
 *   node scripts/add-royter-family.mjs          (dry run)
 *   node scripts/add-royter-family.mjs --apply
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const apply = process.argv.includes('--apply');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const main = async () => {
  const familyName = 'Royter Family';
  const address = '10237 62nd Terr N, Seminole, FL 33772';
  const parent = { name: 'Marina Royter', email: 'rroyter8@gmail.com', phone: '+13057073218' };
  const student = { name: 'Marco Royter', birthday: new Date('2017-12-26') };

  const existingFamily = await prisma.family.findFirst({ where: { name: familyName } });
  if (existingFamily) {
    console.error(`A family named "${familyName}" already exists (${existingFamily.id}). Aborting — resolve manually.`);
    process.exit(1);
  }

  const existingParent = await prisma.user.findUnique({ where: { email: parent.email } });
  if (existingParent) {
    console.error(`A user with email ${parent.email} already exists (${existingParent.id}). Aborting — resolve manually.`);
    process.exit(1);
  }

  console.log('Would create:');
  console.log(`  Family: ${familyName}, address: ${address}`);
  console.log(`  Parent: ${parent.name} <${parent.email}> ${parent.phone}`);
  console.log(`  Student: ${student.name}, birthday ${student.birthday.toISOString().slice(0, 10)}`);

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write.');
    return;
  }

  const family = await prisma.family.create({ data: { name: familyName, address } });

  const parentUser = await prisma.user.create({
    data: {
      firebaseUid: placeholderUid('import'),
      email: parent.email,
      fullName: parent.name,
      phone: parent.phone,
      role: 'PARENT',
      status: 'ACTIVE',
    },
  });

  const studentEmail = `student.${slug(student.name)}.${family.id.slice(0, 6)}@import.local`;
  const studentUser = await prisma.user.create({
    data: {
      firebaseUid: placeholderUid('import'),
      email: studentEmail,
      fullName: student.name,
      role: 'STUDENT',
      status: 'ACTIVE',
      birthday: student.birthday,
    },
  });

  await prisma.familyMember.createMany({
    data: [
      { familyId: family.id, userId: parentUser.id, role: 'parent', isInvoiceRecipient: true },
      { familyId: family.id, userId: studentUser.id, role: 'student', isInvoiceRecipient: false },
    ],
  });

  console.log(`\nCreated family ${family.name} (${family.id})`);
  console.log(`  Parent ${parentUser.fullName} (${parentUser.id})`);
  console.log(`  Student ${studentUser.fullName} (${studentUser.id})`);
  console.log('\nNext: Directory → Royter Family → invite Marina. Then enroll Marco into Lori\'s two classes from the Class roster screen.');
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
