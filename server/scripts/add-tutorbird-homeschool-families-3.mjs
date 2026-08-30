/**
 * One-off, round 3: families found in TutorBird under the general
 * "Homeschool Families" tag (broader/older than the "Online Homeschool
 * Families" tag covered in round 2) that are completely missing from the
 * app. Same pattern as add-tutorbird-online-families.mjs / -2.mjs.
 *
 * Kaya Pollycutt and River Rodriguez are special cases: their families
 * already exist in the app (Silvers-Pollycutt Family, Rodriguez Family)
 * with a sibling already present — they're just added as new students in
 * those existing families, no new family/parent created.
 *
 * Usage:
 *   node scripts/add-tutorbird-homeschool-families-3.mjs          (dry run)
 *   node scripts/add-tutorbird-homeschool-families-3.mjs --apply
 */

import 'dotenv/config';
import prisma from '../src/config/database.js';
import { placeholderUid } from '../src/services/invite.service.js';

const apply = process.argv.includes('--apply');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const families = [
  {
    familyName: 'Favreau Family',
    parent: { name: 'Hope Favreau', email: 'hfta2019@outlook.com', phone: '813-323-0286' },
    students: [{ name: 'Cooper Allan-Favreau', email: 'craf1100@outlook.com', age: 18 }],
  },
  {
    familyName: 'Allen Family',
    parent: { name: 'Stacy Allen', email: 'staceghost@gmail.com', phone: '813-404-8722' },
    students: [
      { name: 'Leland Allen', email: null, age: null },
      { name: 'Levon Allen', email: null, age: 11 },
    ],
  },
  {
    familyName: 'Andric Family',
    parent: { name: 'Tatjana Andric', email: 'andrict85@gmail.com', phone: '317-717-5202' },
    students: [{ name: 'Aspen Andric', email: null, age: 13 }],
  },
  {
    familyName: 'Apple Family',
    parent: { name: 'Alyssa Apple', email: 'akathrynapple@gmail.com', phone: '727-301-5628' },
    students: [{ name: 'Kyle Apple', email: null, age: 13 }],
  },
  {
    familyName: 'Beloso Family',
    parent: { name: 'Brooke Beloso', email: 'bmbeloso@gmail.com', phone: '727-432-5258' },
    students: [{ name: 'Luz Beloso', email: null, age: 13 }],
  },
  {
    familyName: 'Bryan Family',
    parent: { name: 'Emma Bryan', email: 'emmacaroline@earthlink.net', phone: '910-342-0539' },
    students: [{ name: 'Charlie Bryan', email: null, age: 13 }],
  },
  {
    familyName: 'Campbell Family',
    parent: { name: 'Kortney Campbell', email: 'mrs.kortney.campbell@gmail.com', phone: '727-612-0322' },
    students: [{ name: 'Judah Campbell', email: null, age: 13 }],
  },
  {
    familyName: 'Duncan-Cordosi Family',
    parent: { name: 'Shelly Duncan', email: 'smarie077@gmail.com', phone: '813-727-1866' },
    students: [{ name: 'Leland Cordosi', email: null, age: 11 }],
  },
  {
    familyName: 'Crispell Family',
    parent: { name: 'Shana Crispell', email: 'shana087@gmail.com', phone: '727-631-8800' },
    students: [{ name: 'Everett Crispell', email: null, age: 9 }],
  },
  {
    familyName: 'Lee-Derry Family',
    parent: { name: 'Angel Lee', email: 'etainbutterfly@yahoo.com', phone: '727-488-6325' },
    students: [{ name: 'Lydia Derry', email: null, age: null }],
  },
  {
    familyName: 'Douglas Family',
    parent: { name: 'Emily Douglas', email: 'edouglas408@gmail.com', phone: '941-350-6737' },
    students: [{ name: 'Wyatt Douglas', email: null, age: 13 }],
  },
  {
    familyName: 'Easterday Family',
    parent: { name: 'Amber Easterday', email: 'ambjohnson@gmail.com', phone: '937-248-4175' },
    students: [{ name: 'Daniel Easterday', email: null, age: 11 }],
  },
  {
    familyName: 'Edwards Family',
    parent: { name: 'Latoya Edwards', email: 'ledwards83@gmail.com', phone: '727-772-3779' },
    students: [{ name: 'Christopher Edwards-Peterson', email: 'christopheredwardspeterson@gmail.com', age: 20 }],
  },
  {
    familyName: 'Valente-Figueroa Family',
    parent: { name: 'Victoria Valente', email: 'victoriaxvalente@gmail.com', phone: '727-330-0646' },
    students: [{ name: 'Grace Figueroa', email: null, age: 13 }],
  },
  {
    familyName: 'Quigley-Regan Family',
    parent: { name: 'Trisha Quigley-Regan', email: 'trishaqregan@gmail.com', phone: '305-394-1136' },
    students: [{ name: 'Regan Finley', email: null, age: null }],
  },
  {
    familyName: 'Greenway Family',
    parent: { name: 'Kate Greenway', email: 'kategreenway12@hotmail.com', phone: '757-870-3658' },
    students: [{ name: 'Jude Greenway', email: null, age: 13 }],
  },
  {
    familyName: 'Hanna Family',
    parent: { name: 'Melissa Hanna', email: 'melissaleehanna@gmail.com', phone: '850-345-7766' },
    students: [{ name: 'Alexis Hanna', email: null, age: 13 }],
  },
  {
    familyName: 'Dicus-Harrison Family',
    parent: { name: 'Lindsay Dicus-Harrison', email: 'Ldhsells@gmail.com', phone: '727-656-1584' },
    students: [{ name: 'Grace Harrison', email: null, age: 15 }],
  },
  {
    familyName: 'Smith-Hartman Family',
    parent: { name: 'Michelle Smith', email: 'michellenhartman@gmail.com', phone: '727-331-3223' },
    students: [{ name: 'Charlie Hartman', email: 'charlieninjadude@gmail.com', age: 15 }],
  },
  {
    familyName: 'Hendaya Family',
    parent: { name: 'Bunny Hendaya', email: 'thebunnybarbie@gmail.com', phone: '310-499-8711' },
    students: [{ name: 'Aden Heydaya', email: null, age: null }],
  },
  {
    familyName: 'Jenkins-Jackson Family',
    parent: { name: 'Yolanda Jenkins-Jackson', email: 'sunshine3396@msn.com', phone: '954-560-0073' },
    students: [{ name: 'Gabriel Jenkins', email: null, age: 15 }],
  },
  {
    familyName: 'Karaoli Family',
    parent: { name: 'Irene Karaoli', email: 'Irene.psych@gmail.com', phone: '727-460-9031' },
    students: [{ name: 'Safia Karaoli', email: null, age: null }],
  },
  {
    familyName: 'Kattan Family',
    parent: { name: 'Sharon Kattan', email: 'Sharon@milkito.net', phone: '818-861-4815' },
    students: [{ name: 'Emmett Kattan', email: null, age: 15 }],
  },
  {
    familyName: 'Kilpatrick Family',
    parent: { name: 'Harold Kilpatrick', email: 'h.clay.kilpatrick@gmail.com', phone: '251-370-8349' },
    students: [{ name: 'Georgia Kilpatrick', email: null, age: 10 }],
  },
  {
    familyName: 'LeVesque Family',
    parent: { name: 'Vanessa LeVesque', email: 'vanessalynndiana@gmail.com', phone: '203-915-0513' },
    students: [
      { name: 'Beverly LeVesque', email: null, age: 8 },
      { name: 'Elliot LeVesque', email: null, age: 12 },
      { name: 'Harrison LeVesque', email: null, age: 9 },
    ],
  },
  {
    familyName: 'Lowthian Family',
    parent: { name: 'Danielle Lowthian', email: 'DrLowthian727@gmail.com', phone: '727-804-9005' },
    students: [
      { name: 'Kaiya Lowthian', email: null, age: 11 },
      { name: 'Keira Lowthian', email: null, age: 9 },
    ],
  },
  {
    familyName: 'Lucindo Family',
    parent: { name: 'Karen Lucindo', email: 'klucindo@hotmail.com', phone: '727-267-5683' },
    students: [{ name: 'Liliana Lucindo', email: null, age: 14 }],
  },
  {
    familyName: 'Manning Family',
    parent: { name: 'Mary Manning', email: 'decipherbookkeeping@gmail.com', phone: '321-684-1081' },
    students: [{ name: 'Max Manning', email: null, age: 17 }],
  },
  {
    familyName: 'Mills Family (Devin)',
    parent: { name: 'Devin Mills', email: 'devin1786@gmail.com', phone: '517-614-4381' },
    students: [{ name: 'Camden Mills', email: null, age: null }],
  },
  {
    familyName: 'Mostardi Family',
    parent: { name: 'Heather Mostardi', email: 'heathermostardi@gmail.com', phone: '610-308-7123' },
    students: [{ name: 'Kira Mostardi', email: null, age: 13 }],
  },
  {
    familyName: 'Owens Family',
    parent: { name: 'Michelle Owens', email: 'Michelleowens.ppc@gmail.com', phone: '727-365-7649' },
    students: [{ name: 'Clarity Owens', email: '123heyits@gmail.com', age: 18 }],
  },
  {
    familyName: 'Perry Family',
    parent: { name: 'Victoria Perry', email: 'perry.victoria@gmail.com', phone: '727-254-3313' },
    students: [{ name: 'Brayden Perry', email: 'lovealwaysbray@gmail.com', age: 15 }],
  },
  {
    familyName: 'Rakic Family',
    parent: { name: 'Stephanie Rakic', email: 'katianna17@gmail.com', phone: '215-407-1293' },
    students: [
      { name: 'Ante Rakic', email: null, age: null },
      { name: 'Arion (Ari) Rakic', email: null, age: 15 },
    ],
  },
  {
    familyName: 'Schmidt Family',
    parent: { name: 'Christina Schmidt', email: 'tinaschmidt5rn@gmail.com', phone: '612-501-3683' },
    students: [{ name: 'Piper Schmidt', email: null, age: null }],
  },
  {
    familyName: 'Scott Family (Jennifer)',
    parent: { name: 'Jennifer Scott', email: 'jensingspraises@aol.com', phone: '813-610-6700' },
    students: [
      { name: 'Elizabeth Scott', email: null, age: 16 },
      { name: 'John Scott', email: null, age: 16 },
    ],
  },
  {
    familyName: 'Persson-Sweeney Family',
    parent: { name: 'Erika Persson', email: 'erika41gen@gmail.com', phone: '727-318-3668' },
    students: [
      { name: 'Julia Sweeney', email: null, age: 14 },
      { name: 'Liam Sweeney', email: null, age: 8 },
      { name: 'Marie Sweeney', email: null, age: 11 },
    ],
  },
  {
    familyName: 'Shamas-Tait Family',
    parent: { name: 'Julie Shamas', email: 'jshamas@me.com', phone: '863-207-4522' },
    students: [{ name: 'Alexandra Tait', email: 'lexiltait@icloud.com', age: 14 }],
  },
  {
    familyName: 'Tedio Family',
    parent: { name: 'Brooke Tedio', email: 'brookeb80@gmail.com', phone: '850-766-0147' },
    students: [
      { name: 'Haley Tedio', email: null, age: 14 },
      { name: 'Lily Tedio', email: null, age: 12 },
      { name: 'Zoey Tedio', email: null, age: 9 },
    ],
  },
  {
    familyName: 'Thomas Family',
    parent: { name: 'Susie Thomas', email: 'sthomasrf@gmail.com', phone: '334-744-0474' },
    students: [{ name: 'Mattie Thomas', email: null, age: 12 }],
  },
  {
    familyName: 'Tuleen Family',
    parent: { name: 'Dominique Tuleen', email: 'Dominiquedolan@yahoo.com', phone: '727-418-5802' },
    students: [{ name: 'Maxwell Tuleen', email: null, age: 12 }],
  },
  {
    familyName: 'Watkins Family',
    parent: { name: 'Beth Watkins', email: 'bethkathrynwatkins@gmail.com', phone: '615-275-5876' },
    students: [{ name: 'Charlotte Watkins', email: 'chmaewatkins@gmail.com', age: 14 }],
  },
];

const existingFamilyAdditions = [
  {
    familyName: 'Silvers-Pollycutt Family',
    students: [{ name: 'Kaya Pollycutt', email: null, age: null }],
  },
  {
    familyName: 'Rodriguez Family',
    students: [{ name: 'River Rodriguez', email: 'riversky118@gmail.com', age: 19 }],
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

  for (const { familyName, students } of existingFamilyAdditions) {
    const family = await prisma.family.findFirst({ where: { name: familyName } });
    if (!family) {
      console.error(`Cannot add to "${familyName}" — family not found.`);
      continue;
    }

    console.log(`\nWould add to existing family: ${familyName} (${family.id})`);
    for (const s of students) {
      console.log(`  Student: ${s.name}${s.email ? ` <${s.email}>` : ' (no email — synthetic import.local address)'}`);
    }

    if (!apply) continue;

    for (const s of students) {
      const email = s.email || `student.${slug(s.name)}.${family.id.slice(0, 6)}@import.local`;
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
