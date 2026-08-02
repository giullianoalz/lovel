/**
 * Google Form intake.
 *
 * The registration form is still the front door: a parent fills it in and the
 * response has to become a family, a student and an application without anyone
 * retyping it. `scripts/import-form-responses.mjs` did that for the backlog as a
 * one-off, reading a CSV export; this is the same reconciliation driven one
 * response at a time by an Apps Script trigger.
 *
 * Placement is deliberately NOT attempted. Most coves and every elective the
 * form offers still have no Class row, and the spots are contested (priority
 * holds, first/second choice), so the parent's raw selections are parked on a
 * PENDING EnrollmentApplication for staff to action. Nothing here may imply a
 * child has a seat.
 */

import crypto from 'crypto';
import prisma from '../config/database.js';

const clean = (v) => (v == null ? '' : String(v).trim());

/** Title-cases a name so "KRISTEN BERRY" and "bethany martin" agree. */
export const normalizeName = (v) => clean(v)
  .replace(/\s+/g, ' ')
  .split(' ')
  .map((w) => (w.length > 2 && w === w.toUpperCase() && /^[A-Z]+$/.test(w))
    ? w[0] + w.slice(1).toLowerCase()
    : w)
  .join(' ');

/** The form carries 727-555-1234, 727.555.1234 and 7275551234 for one shape. */
export const normalizePhone = (v) => {
  const digits = clean(v).replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') {
    const d = digits.slice(1);
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return clean(v) || null;
};

/**
 * Form dates arrive as M/D/YYYY (and occasionally YYYY-MM-DD from a date
 * widget). Anything outside school age is refused rather than guessed — the
 * backlog held a newborn and an adult where a student's birthday belonged.
 */
export const parseBirthday = (v) => {
  const s = clean(v);
  let date = null;

  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (us) date = new Date(Date.UTC(+us[3], +us[1] - 1, +us[2]));
  else if (iso) date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  if (!date || isNaN(date)) {
    return { date: null, warning: s ? `unparseable birthday "${s}"` : null };
  }

  const age = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 3 || age > 22) {
    return { date: null, warning: `implausible birthday "${s}" (age ${age.toFixed(0)}) — left blank for review` };
  }
  return { date, warning: null };
};

const importUid = () => `form_${crypto.randomUUID()}`;
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 40);

/**
 * Everything the parent answered, kept verbatim and in the form's own wording.
 * Staff place from the parent's words, not from our guess at what they meant —
 * and it means a question added to the form later still lands somewhere useful
 * instead of being silently dropped.
 */
const buildNotes = ({ submittedAt, responses }) => {
  const lines = [`Submitted: ${submittedAt || new Date().toISOString()} (Google Form)`, ''];
  for (const [question, answer] of Object.entries(responses || {})) {
    const a = Array.isArray(answer) ? answer.filter(Boolean).join('; ') : clean(answer);
    if (a) lines.push(`${question}: ${a}`);
  }
  return lines.join('\n');
};

/**
 * Reconciles one form response into the database.
 *
 * Idempotent by design, because Apps Script retries a failed trigger and a
 * parent can submit twice: the family matches on the parent's email, the
 * student on name-within-family, and the application on (student, family).
 * A second run reports `duplicate: true` and writes nothing — that flag is what
 * stops the welcome email being sent again.
 */
export const ingestFormResponse = async (payload) => {
  const email = clean(payload.email).toLowerCase();
  const studentName = normalizeName(payload.studentName);

  if (!email || !studentName) {
    return { ok: false, message: 'A parent email and a student name are both required.' };
  }

  const warnings = [];
  const { date: birthday, warning } = parseBirthday(payload.birthday);
  if (warning) warnings.push(warning);

  const parentName = normalizeName(payload.parentName) || email;
  const phone = normalizePhone(payload.parentPhone);
  const address = clean(payload.address) || null;

  const created = { parent: false, family: false, student: false, application: false };

  // --- Parent ---
  let parent = await prisma.user.findUnique({ where: { email } });
  if (!parent) {
    parent = await prisma.user.create({
      data: {
        firebaseUid: importUid(),
        email,
        fullName: parentName,
        role: 'PARENT',
        phone,
        status: 'ACTIVE',
      },
    });
    created.parent = true;
  } else if (phone) {
    // Fill a blank phone from the form, but never overwrite one already set.
    await prisma.user.updateMany({ where: { id: parent.id, phone: null }, data: { phone } });
  }

  // --- Family ---
  const membership = await prisma.familyMember.findFirst({
    where: { userId: parent.id },
    include: { family: true },
  });
  let family = membership?.family;
  if (!family) {
    family = await prisma.family.create({
      data: { name: `${parentName.split(' ').slice(-1)[0]} Family`, address },
    });
    created.family = true;
    await prisma.familyMember.create({
      data: { familyId: family.id, userId: parent.id, role: 'parent', isInvoiceRecipient: true },
    });
  } else if (address && !family.address) {
    await prisma.family.update({ where: { id: family.id }, data: { address } });
  }

  // --- Student ---
  // Matched within the family rather than globally: two unrelated families can
  // each have an Ava Smith, and merging them would be far worse than a
  // duplicate. Siblings arrive as separate responses and land here one by one.
  const siblings = await prisma.familyMember.findMany({
    where: { familyId: family.id, role: 'child' },
    include: { user: { select: { id: true, fullName: true } } },
  });
  let student = siblings.find((m) => m.user.fullName.toLowerCase() === studentName.toLowerCase())?.user;

  if (!student) {
    student = await prisma.user.create({
      data: {
        firebaseUid: importUid(),
        email: `student.${slug(studentName)}.${family.id.slice(0, 6)}@import.local`,
        fullName: studentName,
        role: 'STUDENT',
        birthday,
        status: 'ACTIVE',
      },
    });
    created.student = true;
    await prisma.familyMember.create({
      data: { familyId: family.id, userId: student.id, role: 'child', isInvoiceRecipient: false },
    });
  } else if (birthday) {
    await prisma.user.updateMany({ where: { id: student.id, birthday: null }, data: { birthday } });
  }

  // --- Application ---
  const existingApp = await prisma.enrollmentApplication.findFirst({
    where: { studentId: student.id, familyId: family.id },
  });

  let application = existingApp;
  if (!existingApp) {
    const ixlRaw = clean(payload.ixl);
    application = await prisma.enrollmentApplication.create({
      data: {
        familyId: family.id,
        studentId: student.id,
        submittedById: parent.id,
        status: 'PENDING',
        ixlPlan: /spanish/i.test(ixlRaw) ? 'CORE_SPANISH' : (ixlRaw ? 'CORE' : 'NONE'),
        parentNotes: buildNotes(payload),
      },
    });
    created.application = true;
  }

  return {
    ok: true,
    duplicate: !created.application,
    created,
    warnings,
    parent: { id: parent.id, fullName: parent.fullName, email: parent.email },
    student: { id: student.id, fullName: student.fullName },
    family: { id: family.id, name: family.name },
    application: { id: application.id, status: application.status },
  };
};
