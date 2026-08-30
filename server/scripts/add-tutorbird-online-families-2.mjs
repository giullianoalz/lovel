/**
 * One-off, round 2: more families found in TutorBird under the
 * "Online Homeschool Families" and "Friday 12 pm online Minecraft Social"
 * tags that are completely missing from the app. Same pattern as
 * add-tutorbird-online-families.mjs.
 *
 * Audrey Capel is a special case: her family (Vonn Capel, "Capel Family")
 * already exists in the app with sibling Dean Capel — she's just added as
 * a new student in that existing family, no new family/parent created.
 *
 * Usage:
 *   node scripts/add-tutorbird-online-families-2.mjs          (dry run)
 *   node scripts/add-tutorbird-online-families-2.mjs --apply
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const apply = process.argv.includes('--apply');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const families = [
  {
    familyName: 'Brisita Family',
    parent: { name: 'Susinni Brisita', email: 'susinni.brisita@gmail.com', phone: '718-775-6703' },
    students: [{ name: 'Micah Brisita', email: null, age: 13 }],
  },
  {
    familyName: 'Miller-Culbertson Family',
    parent: { name: 'Klara Miller', email: 'klaramiller@hotmail.com', phone: '727-776-0811' },
    students: [{ name: 'Maya Culbertson', email: null, age: 13 }],
  },
  {
    familyName: 'Donnelly Family',
    parent: { name: 'Jennifer Donnelly', email: 'jdonnelly07@yahoo.com', phone: '205-292-0863' },
    students: [{ name: 'Jacoby Donnelly', email: null, age: 16 }],
  },
  {
    familyName: 'Dougherty Family',
    parent: { name: 'Gina Dougherty', email: 'fawny3@gmail.com', phone: '727-488-7294' },
    students: [{ name: 'Zoe Dougherty', email: null, age: 15 }],
  },
  {
    familyName: 'Green Family',
    parent: { name: 'Anastasia Green', email: 'mommastas13@aol.com', phone: '352-208-9524' },
    students: [{ name: 'Elaina Green', email: null, age: 12 }],
  },
  {
    familyName: 'Haase Family',
    parent: { name: 'Marion Haase', email: 'mzcnatural@gmail.com', phone: '813-317-9500' },
    students: [{ name: 'Emma Haase', email: 'azulishark@gmail.com', age: 14 }],
  },
  {
    familyName: 'Herrick Family',
    parent: { name: 'Katie Herrick', email: 'jrmedic@gmail.com', phone: '603-978-8311' },
    students: [{ name: 'Madison Herrick', email: 'Maddigirl0303@gmail.com', age: 18 }],
  },
  {
    familyName: 'Pitcher-Lebel Family',
    parent: { name: 'Kelley Pitcher', email: 'pitcherpottery@gmail.com', phone: '813-850-2917' },
    students: [{ name: 'Luke Lebel', email: null, age: 16 }],
  },
  {
    familyName: 'Perez Family',
    parent: { name: 'Patty Perez', email: 'pattyandyamil@hotmail.com', phone: '407-312-2750' },
    students: [{ name: 'Troy Miranda-Perez', email: null, age: null }],
  },
  {
    familyName: 'Munger Family',
    parent: { name: 'Morgan Munger', email: 'morganmunger14@gmail.com', phone: '815-979-8246' },
    students: [{ name: 'Amelia Munger', email: null, age: 12 }],
  },
  {
    familyName: 'Ness Family',
    parent: { name: 'Laura Ness', email: 'thewoahd@gmail.com', phone: '727-515-7487' },
    students: [
      { name: 'Dorian Ness', email: null, age: null },
      { name: 'Katelynn Ness', email: null, age: null },
    ],
  },
  {
    familyName: 'Stern-Palmieri Family',
    parent: { name: 'Lauren Stern', email: 'lstern89@gmail.com', phone: '239-264-9332' },
    students: [{ name: 'Ava Palmieri', email: null, age: 8 }],
  },
  {
    familyName: 'Silvers-Pollycutt Family',
    parent: { name: 'Nicole Silvers', email: 'munkee111@yahoo.com', phone: '619-536-9033' },
    students: [{ name: 'Tafari Pollycutt', email: 'pollycat152@gmail.com', age: 15 }],
  },
  {
    familyName: 'Niel-Spencer Family',
    parent: { name: 'Bethany Niel', email: 'xbhsx@hotmail.com', phone: '859-537-8515' },
    students: [{ name: 'Finley Spencer', email: 'finnybob11@outlook.com', age: 15 }],
  },
  {
    familyName: 'Gould-Van Buskirk Family',
    parent: { name: 'Kristen Gould', email: 'kristenkkv@gmail.com', phone: '727-488-0723' },
    students: [{ name: 'Jessie Van Buskirk', email: 'jessievanbuskirk3@gmail.com', phone: '727-509-4917', age: 16 }],
  },
  {
    familyName: 'Kerekes-Wodzisz Family',
    parent: { name: 'Jenn Kerekes', email: 'jennkerekes@gmail.com', phone: '727-776-8812' },
    students: [{ name: 'Leo Wodzisz', email: null, age: 10 }],
  },
  {
    familyName: 'Baez Family',
    parent: { name: 'Lindsay Baez', email: 'Baezfamily4God@gmail.com', phone: '754-244-5373' },
    students: [{ name: 'Emmanuel Baez', email: null, age: 13 }],
  },
];

const existingFamilyAdditions = [
  {
    familyName: 'Capel Family',
    students: [{ name: 'Audrey Capel', email: null, age: null }],
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
          phone: s.phone ?? undefined,
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

  for (const { familyName, students } of existingFamilyAdditions) {
    const family = await prisma.family.findFirst({ where: { name: familyName } });
    if (!family) {
      console.error(`Cannot add to "${familyName}" — family not found.`);
      continue;
    }

    console.log(`\nWould add to existing family: ${familyName} (${family.id})`);
    for (const s of students) {
      console.log(`  Student: ${s.name} (no email — synthetic import.local address)`);
    }

    if (!apply) continue;

    for (const s of students) {
      const email = `student.${slug(s.name)}.${family.id.slice(0, 6)}@import.local`;
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        console.error(`  Skipping ${s.name} — already exists (${existing.id}).`);
        continue;
      }
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
      await prisma.familyMember.create({
        data: { familyId: family.id, userId: studentUser.id, role: 'child', isInvoiceRecipient: false },
      });
      console.log(`  Added student ${studentUser.fullName} (${studentUser.id}) to ${familyName}`);
    }
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
