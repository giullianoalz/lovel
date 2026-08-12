/**
 * One-off importer for the TutorBird "Contact List" export.
 *
 * TutorBird is the system this app replaces, so its contact export holds the
 * live roster: every active student, the household they belong to, and up to two
 * guardians each. This walks that CSV and creates the people — families,
 * guardians, students — and nothing else. Lesson history (Duration, Rate, Tutor,
 * Last/Next Lesson) is deliberately ignored: those columns describe bookings,
 * not people, and the classes they refer to don't exist here.
 *
 * Three things this export gets right that a hand-mapped import gets wrong:
 *
 *  - Households come from TutorBird's own Family ID, not from surnames. Three
 *    unrelated Rodriguez families and two unrelated Hernandez families share a
 *    last name in this file; grouping by name would merge them into one
 *    household and cross-wire whose invoices go to whom.
 *  - Both guardians are kept. A third of these households have two.
 *  - Step Up / FES student IDs buried in the free-text Note column are pulled
 *    out into `emaStudentId`, which is what the EMA reconciliation matches on.
 *    Learning them now is the difference between an automatic match and a name
 *    comparison later.
 *
 * Safe to re-run: households match on TutorBird Family ID (recorded as a family
 * tag) then on guardian email, people match on email then on name-within-family,
 * and anything already present is updated in place rather than duplicated.
 * Existing values are never overwritten — this only fills blanks.
 *
 *   node scripts/import-tutorbird-contacts.mjs <csv-path>            # dry run
 *   node scripts/import-tutorbird-contacts.mjs <csv-path> --commit   # write
 */

import fs from 'fs';
import crypto from 'crypto';
import prisma from '../src/config/database.js';

const COMMIT = process.argv.includes('--commit');
const CSV_PATH = process.argv[2];

if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error('Usage: node scripts/import-tutorbird-contacts.mjs <csv-path> [--commit]');
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

// Some phone cells arrive wrapped in Unicode bidi controls (U+202A…U+202E,
// U+200E/F) that TutorBird's UI inserted and that survive the export invisibly.
const clean = (v) => (v == null ? '' : String(v).replace(/[‎‏‪-‮]/g, '').trim());

/** Title-cases a shouted name so "KRISTEN" and "kristen" agree. */
const normalizeName = (v) => clean(v)
  .replace(/\s+/g, ' ')
  .split(' ')
  .map(w => (w.length > 2 && w === w.toUpperCase() && /^[A-Z]+$/.test(w))
    ? w[0] + w.slice(1).toLowerCase()
    : w)
  .join(' ');

/**
 * "Adaline EMA", "Riley, Channing EMA", "White Rodriguez EMA" — staff append EMA
 * to a guardian's name in TutorBird to mark the household as a Step Up / FES
 * scholarship family. It's a flag, not part of anybody's name, so it comes off
 * the name here and becomes a family tag instead.
 */
const stripEmaMarker = (v) => ({
  name: clean(v).replace(/\s*\bEMA\b\s*/gi, ' ').replace(/\s+/g, ' ').trim(),
  isEma: /\bEMA\b/i.test(clean(v)),
});

/**
 * Refuses anything that isn't a real number rather than passing it through: one
 * guardian's mobile cell in this export contains the word "Baker", and a phone
 * column that holds a surname is worse than an empty one — staff would dial it.
 */
const normalizePhone = (v) => {
  const raw = clean(v);
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return { phone: `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`, warning: null };
  if (digits.length === 11 && digits[0] === '1') {
    const d = digits.slice(1);
    return { phone: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, warning: null };
  }
  if (!raw) return { phone: null, warning: null };
  return { phone: null, warning: `dropped unusable phone "${raw}"` };
};

/** Multi-line addresses come through with newlines; the column is one line. */
const normalizeAddress = (v) => clean(v).replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').replace(/,\s*,/g, ',').replace(/,\s*$/, '') || null;

const parseBirthday = (v) => {
  const s = clean(v);
  if (!s) return { date: null, warning: null };
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { date: null, warning: `unparseable birthday "${s}"` };

  const [, mm, dd, yyyy] = m;
  const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  if (isNaN(date)) return { date: null, warning: `invalid birthday "${s}"` };

  const age = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  // The roster runs from a 5-year-old to a 21-year-old adult student, so the
  // band is wider here than on the parent-typed form.
  if (age < 3 || age > 25) {
    return { date: null, warning: `implausible birthday "${s}" (age ${age.toFixed(0)}) — left blank for review` };
  }
  return { date, warning: null };
};

/**
 * The Note column is free text and holds four unrelated kinds of thing: Step Up
 * IDs, scheduling shorthand ("Flex 16", "Indiv 8"), genuine student notes
 * ("IEP"), and — in two rows — a child's school login and password.
 *
 * Only the ID is extracted, and only when a scholarship keyword vouches for it
 * or the whole note is nothing but a number. Invoice and Award numbers are
 * refused explicitly: they sit next to the student ID in the same sentence and
 * are not the same number.
 */
const extractEmaId = (note) => {
  const s = clean(note);
  if (!s) return { id: null, warning: null };

  if (/^\d{6,8}$/.test(s)) return { id: s, warning: null };

  const warnings = [];
  let id = null;
  for (const line of s.split('\n')) {
    if (/invoice|award/i.test(line)) {
      const skipped = line.match(/\d{6,8}/);
      if (skipped) warnings.push(`ignored non-student number in note: "${line.trim()}"`);
      continue;
    }
    const m = line.match(/(?:FES|PEP|Step\s*up)\b[^0-9]{0,20}(\d{6,8})/i)
      || line.match(/\bID\s*(?:number)?\s*[#:]?\s*[#:]?\s*(\d{6,8})/i);
    if (m && !id) id = m[1];
  }
  return { id, warning: warnings.join('; ') || null };
};

/**
 * Notes go onto the student as accommodation notes, minus anything that looks
 * like a credential. Two rows carry a child's school login: one labels it
 * "Password:", the other is a bare portal URL, the student's school email and a
 * loose token underneath — unlabelled, but the same thing. Copying either into a
 * second system isn't a call an import should make quietly, so both are withheld
 * and reported.
 */
const sanitizeNote = (note) => {
  const s = clean(note);
  if (!s) return { text: null, warning: null };
  const labelled = /password|passcode|username/i.test(s);
  const portalDump = /https?:\/\//i.test(s) && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s);
  if (labelled || portalDump) {
    return { text: null, warning: 'note withheld — looks like a login/password; copy it by hand if you want it kept' };
  }
  return { text: s.replace(/\s*\n\s*/g, ' / '), warning: null };
};

const importUid = () => `import_${crypto.randomUUID()}`;
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 40);

/** Neon suspends idle compute and takes tens of seconds to wake. */
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
const header = rows[0].map(h => clean(h));
const dataRows = rows.slice(1);

const col = (name) => {
  const i = header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  if (i === -1) throw new Error(`Column "${name}" not found in the CSV header.`);
  return i;
};

const IDX = {
  lastName: col('Last Name'),
  firstName: col('First Name'),
  familyId: col('TutorBird Family ID'),
  studentId: col('TutorBird Student ID'),
  status: col('Status'),
  studentEmail: col('Email'),
  studentPhone: col('Mobile Phone'),
  address: col('Address'),
  birthday: col('Birthday'),
  age: col('Age'),
  tags: col('Group Tags'),
  note: col('Note'),
};

// The two guardian blocks are laid out identically; read them the same way.
const guardianBlock = (n) => ({
  lastName: col(`Parent Contact ${n} Last Name`),
  firstName: col(`Parent Contact ${n} First Name`),
  email: col(`Parent Contact ${n} Email`),
  address: col(`Parent Contact ${n} Address`),
  homePhone: col(`Parent Contact ${n} Home Phone`),
  mobilePhone: col(`Parent Contact ${n} Mobile Phone`),
});
const GUARDIANS = [guardianBlock(1), guardianBlock(2)];

/* ── Build the plan ──────────────────────────────────────────────────────── */

const warnings = [];
const households = new Map(); // TutorBird family id -> household

for (const [n, r] of dataRows.entries()) {
  const rowNum = n + 2; // 1-indexed + header
  const first = normalizeName(r[IDX.firstName]);
  const last = normalizeName(r[IDX.lastName]);
  const studentName = [first, last].filter(Boolean).join(' ');
  const tbFamilyId = clean(r[IDX.familyId]);

  if (!studentName) { warnings.push(`Row ${rowNum}: no student name — skipped`); continue; }
  if (!tbFamilyId) { warnings.push(`Row ${rowNum} (${studentName}): no TutorBird Family ID — skipped`); continue; }

  if (!households.has(tbFamilyId)) {
    households.set(tbFamilyId, {
      tbFamilyId,
      familyName: `${last || first} Family`,
      address: null,
      tags: new Set(),
      isEma: false,
      guardians: new Map(), // key -> guardian
      students: [],
    });
  }
  const hh = households.get(tbFamilyId);

  // --- Guardians ---
  for (const g of GUARDIANS) {
    const gLast = stripEmaMarker(normalizeName(r[g.lastName]));
    const gFirst = stripEmaMarker(normalizeName(r[g.firstName]));
    const gName = [gFirst.name, gLast.name].filter(Boolean).join(' ');
    if (!gName) continue;
    if (gLast.isEma || gFirst.isEma) hh.isEma = true;

    const gEmail = clean(r[g.email]).toLowerCase() || null;
    const key = gEmail || `name:${gName.toLowerCase()}`;
    const mobile = normalizePhone(r[g.mobilePhone]);
    const home = normalizePhone(r[g.homePhone]);
    for (const w of [mobile.warning, home.warning]) {
      if (w) warnings.push(`Row ${rowNum} (${gName}): ${w}`);
    }
    const phone = mobile.phone || home.phone;
    const existing = hh.guardians.get(key);
    if (existing) {
      existing.phone = existing.phone || phone;
      existing.isPrimary = existing.isPrimary || g === GUARDIANS[0];
    } else {
      hh.guardians.set(key, { name: gName, email: gEmail, phone, isPrimary: g === GUARDIANS[0], rowNum });
    }
    hh.address = hh.address || normalizeAddress(r[g.address]);
  }

  if (hh.guardians.size === 0) warnings.push(`Row ${rowNum} (${studentName}): no guardian on the row — family created with the student alone`);

  // --- Household details ---
  hh.address = hh.address || normalizeAddress(r[IDX.address]);
  for (const t of clean(r[IDX.tags]).split(';').map(t => t.trim()).filter(Boolean)) hh.tags.add(t);

  // --- Student ---
  const { date: birthday, warning: bWarn } = parseBirthday(r[IDX.birthday]);
  if (bWarn) warnings.push(`Row ${rowNum} (${studentName}): ${bWarn}`);

  const { id: emaId, warning: idWarn } = extractEmaId(r[IDX.note]);
  if (idWarn) warnings.push(`Row ${rowNum} (${studentName}): ${idWarn}`);

  const { text: noteText, warning: noteWarn } = sanitizeNote(r[IDX.note]);
  if (noteWarn) warnings.push(`Row ${rowNum} (${studentName}): ${noteWarn}`);

  const ageRaw = parseInt(clean(r[IDX.age]), 10);

  const studentPhone = normalizePhone(r[IDX.studentPhone]);
  if (studentPhone.warning) warnings.push(`Row ${rowNum} (${studentName}): ${studentPhone.warning}`);

  hh.students.push({
    rowNum,
    name: studentName,
    email: clean(r[IDX.studentEmail]).toLowerCase() || null,
    phone: studentPhone.phone,
    birthday,
    age: Number.isInteger(ageRaw) ? ageRaw : null,
    emaId,
    note: noteText,
    status: /^inactive$/i.test(clean(r[IDX.status])) ? 'INACTIVE' : 'ACTIVE',
  });
}

// A Step Up ID belongs to exactly one student; the column is unique in the DB.
const seenEmaIds = new Map();
for (const hh of households.values()) {
  for (const s of hh.students) {
    if (!s.emaId) continue;
    if (seenEmaIds.has(s.emaId)) {
      warnings.push(`${s.name} and ${seenEmaIds.get(s.emaId)} both claim Step Up ID ${s.emaId} — left off both, fix by hand`);
      s.emaIdConflict = true;
      const other = [...households.values()].flatMap(h => h.students).find(x => x.name === seenEmaIds.get(s.emaId));
      if (other) other.emaIdConflict = true;
    } else seenEmaIds.set(s.emaId, s.name);
  }
}

/* ── Reconcile against the database ──────────────────────────────────────── */

const allEmails = [...new Set([...households.values()].flatMap(hh => [
  ...[...hh.guardians.values()].map(g => g.email),
  ...hh.students.map(s => s.email),
]).filter(Boolean))];

const existingByEmail = new Map(
  (await withRetry('load people by email', () => prisma.user.findMany({
    where: { email: { in: allEmails } },
    select: { id: true, email: true, fullName: true, role: true, emaStudentId: true, familyMembers: { select: { familyId: true } } },
  }))).map(u => [u.email, u])
);

const allStudentNames = [...households.values()].flatMap(hh => hh.students.map(s => s.name));
const existingStudents = await withRetry('load students by name', () => prisma.user.findMany({
  where: { role: 'STUDENT', fullName: { in: allStudentNames } },
  select: { id: true, fullName: true, emaStudentId: true, familyMembers: { select: { familyId: true } } },
}));
const studentByName = new Map(existingStudents.map(u => [u.fullName.toLowerCase(), u]));

const existingEmaIds = new Map(
  (await withRetry('load Step Up ids', () => prisma.user.findMany({
    where: { emaStudentId: { in: [...seenEmaIds.keys()] } },
    select: { id: true, fullName: true, emaStudentId: true },
  }))).map(u => [u.emaStudentId, u])
);

// Families already carrying a tutorbird:<id> tag from an earlier run of this
// script are the strongest match; everything else falls back to guardian email.
const taggedFamilies = await withRetry('load families', () => prisma.family.findMany({
  where: { tags: { hasSome: [...households.keys()].map(id => `tutorbird:${id}`) } },
  select: { id: true, name: true, tags: true, address: true },
}));
const familyByTbId = new Map();
for (const f of taggedFamilies) {
  const tag = f.tags.find(t => t.startsWith('tutorbird:'));
  if (tag) familyByTbId.set(tag.slice('tutorbird:'.length), f);
}

/** Where this household already lives in the DB, if anywhere. */
const resolveExistingFamilyId = (hh) => {
  const tagged = familyByTbId.get(hh.tbFamilyId);
  if (tagged) return { familyId: tagged.id, via: `tag tutorbird:${hh.tbFamilyId}` };
  for (const g of hh.guardians.values()) {
    const u = g.email && existingByEmail.get(g.email);
    if (u?.familyMembers?.length) return { familyId: u.familyMembers[0].familyId, via: `guardian ${g.email}` };
  }
  return { familyId: null, via: null };
};

/* ── Report ──────────────────────────────────────────────────────────────── */

const plan = { famNew: 0, famExisting: 0, guardNew: 0, guardExisting: 0, stuNew: 0, stuExisting: 0, emaIds: 0, twoGuardians: 0 };
const emaHouseholds = [];

for (const hh of households.values()) {
  const { familyId, via } = resolveExistingFamilyId(hh);
  hh.existingFamilyId = familyId;
  hh.matchedVia = via;
}

/**
 * Somebody with no email in the export gets a placeholder built from their name
 * and their family's id — which means it can only be looked up once the family
 * is known. Resolve those here, after the households are matched, so the dry run
 * counts a re-run as "already exists" instead of promising creates it won't make.
 */
const placeholderFor = (kind, name, familyId) => `${kind}.${slug(name)}.${familyId.slice(0, 6)}@import.local`;
const placeholderEmails = [];
for (const hh of households.values()) {
  if (!hh.existingFamilyId) continue;
  for (const g of hh.guardians.values()) {
    if (!g.email) placeholderEmails.push(g.placeholder = placeholderFor('parent', g.name, hh.existingFamilyId));
  }
  for (const s of hh.students) {
    if (!s.email) placeholderEmails.push(s.placeholder = placeholderFor('student', s.name, hh.existingFamilyId));
  }
}
if (placeholderEmails.length) {
  const found = await withRetry('load placeholder accounts', () => prisma.user.findMany({
    where: { email: { in: placeholderEmails } },
    select: { id: true, email: true, fullName: true, role: true, emaStudentId: true, familyMembers: { select: { familyId: true } } },
  }));
  for (const u of found) existingByEmail.set(u.email, u);
}

for (const hh of households.values()) {
  const familyId = hh.existingFamilyId;
  if (familyId) plan.famExisting++; else plan.famNew++;
  if (hh.guardians.size > 1) plan.twoGuardians++;
  if (hh.isEma) emaHouseholds.push(hh.familyName);

  for (const g of hh.guardians.values()) {
    const known = (g.email || g.placeholder) && existingByEmail.has(g.email || g.placeholder);
    if (known) plan.guardExisting++; else plan.guardNew++;
  }
  for (const s of hh.students) {
    const found = existingByEmail.get(s.email || s.placeholder || '') || studentByName.get(s.name.toLowerCase());
    if (found) {
      plan.stuExisting++;
      s.existingId = found.id;
      if (found.familyMembers?.length && familyId && found.familyMembers[0].familyId !== familyId) {
        warnings.push(`${s.name} already belongs to a different family in the app — linked to this one too, check for a duplicate`);
      }
    } else plan.stuNew++;

    if (s.emaId && !s.emaIdConflict) {
      const owner = existingEmaIds.get(s.emaId);
      if (owner && owner.id !== s.existingId) {
        warnings.push(`Step Up ID ${s.emaId} already belongs to ${owner.fullName} in the app — not applied to ${s.name}`);
        s.emaIdConflict = true;
      } else plan.emaIds++;
    }
  }
}

console.log(`\n${COMMIT ? '=== COMMITTING ===' : '=== DRY RUN (nothing will be written) ==='}`);
console.log(`\nExport: ${dataRows.length} student rows -> ${households.size} households\n`);
console.log('Plan:');
console.log(`  families            ${plan.famNew} new / ${plan.famExisting} already in the app (reused, not duplicated)`);
console.log(`  guardians           ${plan.guardNew} new / ${plan.guardExisting} already exist (blanks filled, nothing overwritten)`);
console.log(`  students            ${plan.stuNew} new / ${plan.stuExisting} already exist (updated in place)`);
console.log(`  two-guardian homes  ${plan.twoGuardians}`);
console.log(`  Step Up IDs learned ${plan.emaIds}  (backfills emaStudentId for EMA reconciliation)`);
console.log(`  EMA-flagged homes   ${emaHouseholds.length}`);
console.log(`\nNot imported (they describe bookings, not people): Duration, Rate, Lesson Price,`);
console.log(`Tutor, Make-up Credits, Last/Next Lesson, Subject/Level/School.`);

if (plan.famExisting) {
  console.log(`\nMatched to households already in the app:`);
  for (const hh of households.values()) {
    if (hh.existingFamilyId) console.log(`  ${hh.familyName.padEnd(24)} via ${hh.matchedVia}`);
  }
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

const created = { families: 0, guardians: 0, students: 0, emaIds: 0 };

// Sequential and unwrapped rather than one transaction per household: an
// interactive transaction can't survive Neon's per-query latency, and every step
// is an upsert or a guarded create, so a run that dies halfway is resumed by
// running it again.
for (const hh of households.values()) {
  await withRetry(hh.familyName, async () => {
    const tbTag = `tutorbird:${hh.tbFamilyId}`;
    const tags = [...hh.tags, tbTag, ...(hh.isEma ? ['EMA'] : [])];

    // --- Family ---
    let familyId = hh.existingFamilyId;
    if (familyId) {
      const current = await prisma.family.findUnique({ where: { id: familyId }, select: { tags: true, address: true } });
      await prisma.family.update({
        where: { id: familyId },
        data: {
          tags: [...new Set([...(current?.tags || []), ...tags])],
          ...(hh.address && !current?.address ? { address: hh.address } : {}),
        },
      });
    } else {
      const family = await prisma.family.create({ data: { name: hh.familyName, address: hh.address, tags } });
      familyId = family.id;
      created.families++;
    }

    // --- Guardians ---
    for (const g of hh.guardians.values()) {
      const email = g.email || `parent.${slug(g.name)}.${familyId.slice(0, 6)}@import.local`;
      let user = await prisma.user.findUnique({ where: { email }, select: { id: true, phone: true } });
      if (!user) {
        user = await prisma.user.create({
          data: { firebaseUid: importUid(), email, fullName: g.name, role: 'PARENT', phone: g.phone, status: 'ACTIVE' },
        });
        created.guardians++;
      } else if (g.phone) {
        await prisma.user.updateMany({ where: { id: user.id, phone: null }, data: { phone: g.phone } });
      }

      await prisma.familyMember.upsert({
        where: { familyId_userId: { familyId, userId: user.id } },
        update: { role: 'parent', ...(g.isPrimary ? { isInvoiceRecipient: true } : {}) },
        create: { familyId, userId: user.id, role: 'parent', isInvoiceRecipient: g.isPrimary },
      });
    }

    // --- Students ---
    for (const s of hh.students) {
      const email = s.email || `student.${slug(s.name)}.${familyId.slice(0, 6)}@import.local`;
      let user = s.existingId
        ? await prisma.user.findUnique({ where: { id: s.existingId }, select: { id: true } })
        : await prisma.user.findUnique({ where: { email }, select: { id: true } });

      if (!user) {
        user = await prisma.user.create({
          data: {
            firebaseUid: importUid(),
            email,
            fullName: s.name,
            role: 'STUDENT',
            status: s.status,
            phone: s.phone,
            birthday: s.birthday,
            age: s.age,
            accommodationNotes: s.note,
            ...(s.emaId && !s.emaIdConflict ? { emaStudentId: s.emaId } : {}),
          },
        });
        if (s.emaId && !s.emaIdConflict) created.emaIds++;
        created.students++;
      } else {
        // Fill blanks only — a birthday or note typed into the app beats the
        // export, which is a snapshot of the system we're leaving behind.
        const fill = {};
        if (s.birthday) fill.birthday = s.birthday;
        if (s.age != null) fill.age = s.age;
        if (s.phone) fill.phone = s.phone;
        if (s.note) fill.accommodationNotes = s.note;
        for (const [k, v] of Object.entries(fill)) {
          await prisma.user.updateMany({ where: { id: user.id, [k]: null }, data: { [k]: v } });
        }
        if (s.emaId && !s.emaIdConflict) {
          const done = await prisma.user.updateMany({
            where: { id: user.id, emaStudentId: null },
            data: { emaStudentId: s.emaId },
          }).catch(() => ({ count: 0 })); // another student claimed it between the plan and now
          created.emaIds += done.count;
        }
      }

      await prisma.familyMember.upsert({
        where: { familyId_userId: { familyId, userId: user.id } },
        update: { role: 'child' },
        create: { familyId, userId: user.id, role: 'child', isInvoiceRecipient: false },
      });
    }
  });

  process.stdout.write('.');
}

console.log(`\n\nDone. Created ${created.families} families, ${created.guardians} guardians, ${created.students} students; learned ${created.emaIds} Step Up IDs.\n`);
await prisma.$disconnect();
