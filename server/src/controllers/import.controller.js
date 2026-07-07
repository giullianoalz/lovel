import crypto from 'crypto';
import prisma from '../config/database.js';

const slug = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 40);
const clean = (v) => (v == null ? '' : String(v).trim());
const importUid = () => `import_${crypto.randomUUID()}`;

const mapStatus = (s) => {
  const v = clean(s).toLowerCase();
  if (['inactive', 'inactivo', 'dropped', 'cancelled', 'canceled'].includes(v)) return 'INACTIVE';
  return 'ACTIVE';
};

/**
 * POST /api/import/students
 * Body: { rows: [{ studentName, studentEmail?, age?, allergies?, status?,
 *                  parentName?, parentEmail?, parentPhone?, familyName?, tags? }] }
 * Idempotent: matches families by name and users by email, so re-running won't duplicate.
 */
export const importStudents = async (req, res, next) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'rows array is required.' });
    }

    const summary = {
      familiesCreated: 0,
      parentsCreated: 0,
      studentsCreated: 0,
      studentsUpdated: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const studentName = clean(row.studentName);
      if (!studentName) {
        summary.errors.push({ row: i + 1, message: 'Falta el nombre del estudiante.' });
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          // --- Family ---
          const parentName = clean(row.parentName);
          const familyName = clean(row.familyName) || (parentName ? `${parentName.split(' ').slice(-1)[0]} Family` : `${studentName.split(' ').slice(-1)[0]} Family`);
          const tags = clean(row.tags) ? clean(row.tags).split(/[;,|]/).map(t => t.trim()).filter(Boolean) : [];

          let family = await tx.family.findFirst({ where: { name: familyName } });
          if (!family) {
            family = await tx.family.create({ data: { name: familyName, tags } });
            summary.familiesCreated++;
          }

          // --- Parent (optional) ---
          if (parentName) {
            const parentEmail = (clean(row.parentEmail) || `parent.${slug(parentName)}.${family.id.slice(0, 6)}@import.local`).toLowerCase();
            let parent = await tx.user.findUnique({ where: { email: parentEmail } });
            if (!parent) {
              parent = await tx.user.create({
                data: {
                  firebaseUid: importUid(),
                  email: parentEmail,
                  fullName: parentName,
                  role: 'PARENT',
                  phone: clean(row.parentPhone) || null,
                  status: 'ACTIVE',
                },
              });
              summary.parentsCreated++;
            }
            await tx.familyMember.upsert({
              where: { familyId_userId: { familyId: family.id, userId: parent.id } },
              update: { isInvoiceRecipient: true, role: 'parent' },
              create: { familyId: family.id, userId: parent.id, role: 'parent', isInvoiceRecipient: true },
            });
          }

          // --- Student ---
          const studentEmail = (clean(row.studentEmail) || `student.${slug(studentName)}.${family.id.slice(0, 6)}@import.local`).toLowerCase();
          const studentData = {
            fullName: studentName,
            role: 'STUDENT',
            status: mapStatus(row.status),
            age: row.age && !isNaN(parseInt(row.age)) ? parseInt(row.age) : null,
            allergies: clean(row.allergies) || null,
          };

          const existing = await tx.user.findUnique({ where: { email: studentEmail } });
          let student;
          if (existing) {
            student = await tx.user.update({ where: { id: existing.id }, data: studentData });
            summary.studentsUpdated++;
          } else {
            student = await tx.user.create({
              data: { ...studentData, firebaseUid: importUid(), email: studentEmail },
            });
            summary.studentsCreated++;
          }

          await tx.familyMember.upsert({
            where: { familyId_userId: { familyId: family.id, userId: student.id } },
            update: { role: 'child' },
            create: { familyId: family.id, userId: student.id, role: 'child', isInvoiceRecipient: false },
          });
        });
      } catch (rowError) {
        summary.errors.push({ row: i + 1, student: studentName, message: rowError.message });
      }
    }

    res.json(summary);
  } catch (error) {
    next(error);
  }
};
