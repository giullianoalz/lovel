/**
 * One-off: add-tutorbird-online-families.mjs wrote FamilyMember.role as
 * 'student' (copied from add-royter-family.mjs), but the app's own code
 * (formIntake.service.js, import.controller.js) reads/writes 'child' for
 * this relationship. Fixes the 7 rows just created so they're found
 * correctly (e.g. by student lookups keyed on role: 'child').
 */
import 'dotenv/config';
import prisma from '../src/config/database.js';

const familyIds = [
  'd6406751-935e-4a3e-ba01-2b52a8040659',
  'f3375b8f-ffb4-45f9-9637-a5ce24225f00',
  'facd17c7-3e29-4003-8378-4b6af8428bc4',
  'cccbeb1a-4e62-4a97-b4b5-aef4da7c419f',
];

const main = async () => {
  const res = await prisma.familyMember.updateMany({
    where: { role: 'student', familyId: { in: familyIds } },
    data: { role: 'child' },
  });
  console.log('Updated', res.count, 'family_member rows');
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
