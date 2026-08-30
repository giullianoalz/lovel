/**
 * One-off: add 4 families found in TutorBird (tag "Fall Online 2025") that
 * are completely missing from the app — Tara has been enrolling new online
 * students directly in TutorBird since the app has no online-class UI yet.
 *
 * Follows the roster-import pattern from add-royter-family.mjs: placeholder
 * Firebase uid, synthetic @import.local email for students without one.
 *
 * Usage:
 *   node scripts/add-tutorbird-online-families.mjs          (dry run)
 *   node scripts/add-tutorbird-online-families.mjs --apply
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const apply = process.argv.includes('--apply');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const families = [
  {
    familyName: 'Bloom-Gabuzda Family',
    parent: { name: 'Cristie Bloom', email: 'cristie.bloom@gmail.com', phone: '412-414-5272' },
    students: [
      { name: 'Eleanor Gabuzda', email: 'Eleanor.Gabuzda@gmail.com', age: 12 },
      { name: 'Elias Gabuzda', email: 'Elias.gabuzda@gmail.com', age: 10 },
      { name: 'Lillian Gabuzda', email: 'lillian.gabuzda@gmail.com', age: 15 },
      { name: 'Miles Gabuzda', email: 'Miles.gabuzda@gmail.com', age: 16 },
    ],
  },
  {
    familyName: 'Fahey Family',
    parent: { name: 'Elizabeth Fahey', email: 'emfahey217@gmail.com', phone: '727-798-8497' },
    students: [
      { name: 'Esabella Fahey', email: null, age: 16 },
    ],
  },
  {
    familyName: 'Makinson-Schnorr Family',
    parent: { name: 'Wendy Makinson', email: 'wendyatvistana@aol.com', phone: '407-749-3447' },
    students: [
      { name: 'Emily Schnorr', email: null, age: 17 },
    ],
  },
  {
    familyName: 'Wedlake Family',
    parent: { name: 'Jenn Wedlake', email: 'Jenn.wedlake@gmail.com', phone: '323-377-1819' },
    students: [
      { name: 'Greyson Wedlake', email: 'greywedlake@gmail.com', age: null },
    ],
  },
];

const main = async () => {
  for (const { familyName, parent, students } of families) {
    const existingFamily = await prisma.family.findFirst({ where: { name: familyName } });
    if (existingFamily) {
      console.error(`Skipping "${familyName}" — a family with this name already exists (${existingFamily.id}).`);
      continue;
    }

    const existingParent = await prisma.user.findUnique({ where: { email: parent.email } });
    if (existingParent) {
      console.error(`Skipping "${familyName}" — a user with email ${parent.email} already exists (${existingParent.id}).`);
      continue;
    }

    console.log(`\nWould create family: ${familyName}`);
    console.log(`  Parent: ${parent.name} <${parent.email}> ${parent.phone}`);
    for (const s of students) {
      console.log(`  Student: ${s.name}${s.email ? ` <${s.email}>` : ' (no email — synthetic import.local address)'}${s.age ? `, age ${s.age}` : ''}`);
    }

    if (!apply) continue;

    const family = await prisma.family.create({ data: { name: familyName } });

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

    const memberData = [
      { familyId: family.id, userId: parentUser.id, role: 'parent', isInvoiceRecipient: true },
    ];

    for (const s of students) {
      const email = s.email || `student.${slug(s.name)}.${family.id.slice(0, 6)}@import.local`;
      const studentUser = await prisma.user.create({
        data: {
          firebaseUid: placeholderUid('import'),
          email,
          fullName: s.name,
          role: 'STUDENT',
          status: 'ACTIVE',
          age: s.age ?? undefined,
        },
      });
      memberData.push({ familyId: family.id, userId: studentUser.id, role: 'child', isInvoiceRecipient: false });
      console.log(`  Created student ${studentUser.fullName} (${studentUser.id})`);
    }

    await prisma.familyMember.createMany({ data: memberData });

    console.log(`Created family ${family.name} (${family.id}) with parent ${parentUser.fullName} (${parentUser.id})`);
  }

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write.');
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
