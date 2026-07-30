/**
 * One-off importer for the Fall 2026 Google Form backlog.
 *
 * The form was the registration system before this app existed, so its
 * responses sheet holds families the database never learned about. This walks
 * the CSV export and creates the people — families, parents, students — while
 * leaving placement alone: most of the coves and every elective the form offers
 * don't exist as rows yet, so each student's raw choices are parked on an
 * EnrollmentApplication for staff to action from the Applications queue.
 *
 * Safe to re-run: families match on parent email, students on name-within-family,
 * and an existing person is updated in place rather than duplicated.
 *
 *   node scripts/import-form-responses.mjs <csv-path>            # dry run
 *   node scripts/import-form-responses.mjs <csv-path> --commit   # write
 */

import fs from 'fs';
import crypto from 'crypto';
import prisma from '../src/config/database.js';

const COMMIT = process.argv.includes('--commit');
const CSV_PATH = process.argv[2];

if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error('Usage: node scripts/import-form-responses.mjs <csv-path> [--commit]');
  process.exit(1);
}

/* ── CSV parsing ─────────────────────────────────────────────────────────── */

/** RFC-4180-ish: handles quoted fields, embedded commas and embedded newlines. */
const parseCSV = (text) => {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
};

/* ── Normalisation ───────────────────────────────────────────────────────── */

const clean = (v) => (v == null ? '' : String(v).trim());

/** Title-cases a name so "KRISTEN BERRY" and "bethany martin" agree. */
const normalizeName = (v) => clean(v)
  .replace(/\s+/g, ' ')
  .split(' ')
  .map(w => (w.length > 2 && w === w.toUpperCase() && /^[A-Z]+$/.test(w))
    ? w[0] + w.slice(1).toLowerCase()
    : w)
  .join(' ');

/** The sheet carries 727-555-1234, 727.555.1234 and 7275551234 for the same shape. */
const normalizePhone = (v) => {
  const digits = clean(v).replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') {
    const d = digits.slice(1);
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return clean(v) || null;
};

/**
 * Form dates arrive as M/D/YYYY. Anything that isn't a plausible school-age
 * birth date is refused rather than guessed — the sheet holds at least one
 * newborn and one adult where a student's birthday belongs.
 */
const parseBirthday = (v) => {
  const s = clean(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { date: null, warning: s ? `unparseable birthday "${s}"` : null };

  const [, mm, dd, yyyy] = m;
  const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  if (isNaN(date)) return { date: null, warning: `invalid birthday "${s}"` };

  const age = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 3 || age > 22) {
    return { date: null, warning: `implausible birthday "${s}" (age ${age.toFixed(0)}) — left blank for review` };
  }
  return { date, warning: null };
};

const importUid = () => `import_${crypto.randomUUID()}`;
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 40);

/**
 * Neon's free tier suspends its compute when idle and takes tens of seconds to
 * wake, so any query here can fail simply because the database was asleep.
 * Every read and write goes through this so a nap doesn't end the run.
 */
const withRetry = async (label, fn, attempts = 6) => {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (error) {
      const transient = error.constructor.name === 'PrismaClientInitializationError'
        || ['P1001', 'P1017', 'P2024', 'P2028'].includes(error.code);
      if (!transient || i === attempts) throw error;
      const wait = 5000 * i;
      console.log(`\n  ${label}: ${error.code || 'connection lost'} — waiting ${wait / 1000}s (${i}/${attempts})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
};

/* ── Read the sheet ──────────────────────────────────────────────────────── */

const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
const header = rows[0];
const dataRows = rows.slice(1);

// Column positions are stable in the export; names are matched loosely because
// the headers embed the whole multi-paragraph question text.
const col = (needle) => header.findIndex(h => h.toLowerCase().includes(needle.toLowerCase()));
const IDX = {
  email: col('Email Address'),
  parentName: col('Parent first and last name'),
  parentPhone: col('Parent phone number'),
  address: col('Residential Address'),
  studentName: col('Student first and last name'),
  birthday: col('Student birthday'),
  learningGroup: col('Learning Group'),
  coves: col('Cove Selections'),
  ixl: col('Just IXL Access'),
  highSchool: col('High School Core Classes'),
  eighthGrade: header.findIndex(h => h.trim().startsWith('8th Grade Program') && !h.includes('Elective')),
  tutoring: col('Private/Small Group Tutoring'),
  online: col('Online Interest'),
  comments: col('Please put any questions'),
};

const ELECTIVE_COLS = header
  .map((h, i) => ({ h: h.trim(), i }))
  .filter(({ h }) => /Electives?( \d|:)?/i.test(h) && /Monday|Tuesday|Wednesday|Thursday|Friday|Elective Selection/i.test(h));

/* ── Build the plan ──────────────────────────────────────────────────────── */

const warnings = [];
const families = new Map(); // parentEmail -> { parentName, phone, address, students[] }

for (const [n, r] of dataRows.entries()) {
  const rowNum = n + 2; // 1-indexed + header
  const email = clean(r[IDX.email]).toLowerCase();
  const studentName = normalizeName(r[IDX.studentName]);

  if (!email || !studentName) {
    warnings.push(`Row ${rowNum}: missing email or student name — skipped`);
    continue;
  }

  const { date: birthday, warning } = parseBirthday(r[IDX.birthday]);
  if (warning) warnings.push(`Row ${rowNum} (${studentName}): ${warning}`);

  if (!families.has(email)) {
    families.set(email, {
      parentName: normalizeName(r[IDX.parentName]),
      phone: normalizePhone(r[IDX.parentPhone]),
      address: clean(r[IDX.address]) || null,
      students: [],
    });
  }

  // Everything the form asked that has nowhere structured to live yet. Kept
  // verbatim so staff place from the parent's own words, not our guess.
  const choices = [
    ['Learning Group', clean(r[IDX.learningGroup])],
    ['Coves', clean(r[IDX.coves])],
    ...ELECTIVE_COLS.map(({ h, i }) => [h.split('\n')[0], clean(r[i])]),
    ['IXL', clean(r[IDX.ixl])],
    ['High School Core', clean(r[IDX.highSchool])],
    ['8th Grade Program', clean(r[IDX.eighthGrade])],
    ['Tutoring needs', clean(r[IDX.tutoring])],
    ['Online interest', clean(r[IDX.online])],
    ['Parent comments', clean(r[IDX.comments])],
  ].filter(([, v]) => v);

  families.get(email).students.push({
    name: studentName,
    birthday,
    rowNum,
    notes: choices.map(([k, v]) => `${k}: ${v}`).join('\n'),
    ixlRaw: clean(r[IDX.ixl]),
  });
}

/* ── Reconcile against the database ──────────────────────────────────────── */

const emails = [...families.keys()];
const existingParents = await withRetry('load parents', () => prisma.user.findMany({
  where: { email: { in: emails } },
  select: { id: true, email: true, fullName: true, role: true },
}));
const parentByEmail = new Map(existingParents.map(u => [u.email, u]));

const allStudentNames = [...families.values()].flatMap(f => f.students.map(s => s.name));
const existingStudents = await withRetry('load students', () => prisma.user.findMany({
  where: { role: 'STUDENT', fullName: { in: allStudentNames } },
  select: { id: true, fullName: true },
}));
const studentByName = new Map(existingStudents.map(u => [u.fullName.toLowerCase(), u]));

const roleConflicts = existingParents.filter(u => u.role !== 'PARENT');

/* ── Report ──────────────────────────────────────────────────────────────── */

const plan = { familiesNew: 0, familiesExisting: 0, parentsNew: 0, parentsExisting: 0, studentsNew: 0, studentsExisting: 0, applications: 0 };
for (const [email, fam] of families) {
  const p = parentByEmail.get(email);
  if (p) { plan.parentsExisting++; plan.familiesExisting++; } else { plan.parentsNew++; plan.familiesNew++; }
  for (const s of fam.students) {
    if (studentByName.has(s.name.toLowerCase())) plan.studentsExisting++; else plan.studentsNew++;
    plan.applications++;
  }
}

console.log(`\n${COMMIT ? '=== COMMITTING ===' : '=== DRY RUN (nothing will be written) ==='}`);
console.log(`\nSheet: ${dataRows.length} response rows -> ${families.size} families, ${plan.applications} students\n`);
console.log('Would create:');
console.log(`  families            ${plan.familiesNew} new / ${plan.familiesExisting} matched to an existing parent`);
console.log(`  parent accounts     ${plan.parentsNew} new / ${plan.parentsExisting} already exist (left untouched)`);
console.log(`  student accounts    ${plan.studentsNew} new / ${plan.studentsExisting} already exist (updated, not duplicated)`);
console.log(`  applications        ${plan.applications} (one per student, carrying their form choices)`);

if (roleConflicts.length) {
  console.log(`\nRole conflicts — these emails already sign in as something other than a parent.`);
  console.log(`Their family and children WILL be created and linked, but the account's role is left as-is:`);
  roleConflicts.forEach(u => console.log(`  ${u.fullName} <${u.email}> is currently ${u.role}`));
}

if (warnings.length) {
  console.log(`\nNeeds review (${warnings.length}):`);
  warnings.forEach(w => console.log('  ' + w));
}

/* ── Write ───────────────────────────────────────────────────────────────── */

if (!COMMIT) {
  console.log('\nRe-run with --commit to apply.\n');
  await prisma.$disconnect();
  process.exit(0);
}

let created = { families: 0, parents: 0, students: 0, applications: 0 };

// Writes are sequential and unwrapped rather than one transaction per family:
// an interactive transaction can't survive Neon's per-query latency, and every
// step below is an upsert or a guarded create, so a run that dies halfway is
// resumed by simply running it again.
for (const [email, fam] of families) {
  await withRetry(email, async () => {
    const tx = prisma;
    // --- Parent ---
    let parent = parentByEmail.get(email);
    if (!parent) {
      parent = await tx.user.create({
        data: {
          firebaseUid: importUid(),
          email,
          fullName: fam.parentName || email,
          role: 'PARENT',
          phone: fam.phone,
          status: 'ACTIVE',
        },
      });
      created.parents++;
    } else if (fam.phone) {
      // Fill a blank phone from the form, but never overwrite one already set.
      await tx.user.updateMany({ where: { id: parent.id, phone: null }, data: { phone: fam.phone } });
    }

    // --- Family ---
    const familyName = `${(fam.parentName || 'Family').split(' ').slice(-1)[0]} Family`;
    const membership = await tx.familyMember.findFirst({ where: { userId: parent.id }, include: { family: true } });
    let family = membership?.family;
    if (!family) {
      family = await tx.family.create({ data: { name: familyName, address: fam.address } });
      created.families++;
    } else if (fam.address && !family.address) {
      await tx.family.update({ where: { id: family.id }, data: { address: fam.address } });
    }

    await tx.familyMember.upsert({
      where: { familyId_userId: { familyId: family.id, userId: parent.id } },
      update: { isInvoiceRecipient: true, role: 'parent' },
      create: { familyId: family.id, userId: parent.id, role: 'parent', isInvoiceRecipient: true },
    });

    // --- Students ---
    for (const s of fam.students) {
      let student = studentByName.get(s.name.toLowerCase());
      if (student) {
        if (s.birthday) {
          await tx.user.updateMany({ where: { id: student.id, birthday: null }, data: { birthday: s.birthday } });
        }
      } else {
        student = await tx.user.create({
          data: {
            firebaseUid: importUid(),
            email: `student.${slug(s.name)}.${family.id.slice(0, 6)}@import.local`,
            fullName: s.name,
            role: 'STUDENT',
            birthday: s.birthday,
            status: 'ACTIVE',
          },
        });
        studentByName.set(s.name.toLowerCase(), student);
        created.students++;
      }

      await tx.familyMember.upsert({
        where: { familyId_userId: { familyId: family.id, userId: student.id } },
        update: { role: 'child' },
        create: { familyId: family.id, userId: student.id, role: 'child', isInvoiceRecipient: false },
      });

      // One application per student, unless this import already made one.
      const already = await tx.enrollmentApplication.findFirst({
        where: { studentId: student.id, familyId: family.id },
      });
      if (!already) {
        const ixl = /spanish/i.test(s.ixlRaw) ? 'CORE_SPANISH' : (s.ixlRaw ? 'CORE' : 'NONE');
        await tx.enrollmentApplication.create({
          data: {
            familyId: family.id,
            studentId: student.id,
            submittedById: parent.id,
            status: 'PENDING',
            ixlPlan: ixl,
            parentNotes: s.notes,
          },
        });
        created.applications++;
      }
    }
  });

  process.stdout.write('.');
}

console.log(`\n\nDone. Created ${created.families} families, ${created.parents} parents, ${created.students} students, ${created.applications} applications.\n`);
await prisma.$disconnect();
