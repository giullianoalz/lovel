/**
 * Importer for TutorBird's per-family "Transactions" screen.
 *
 * That screen has no bulk export — 3,879 transactions across ~130 families,
 * visible one family at a time and only by opening each one. So this script
 * reads whatever has been pasted (copy-and-pasted straight from the browser)
 * into scripts/data/tutorbird-ledger/families.txt, one or more families
 * concatenated, each block starting at a "Family Details" line.
 *
 * The invoice-history import (import-tutorbird-invoices.mjs) already proved
 * that TutorBird's per-family statements cannot be trusted for balances: a
 * family that pays after its last statement leaves no trace on that screen.
 * This screen is different — every charge and every payment is its own row,
 * newest first, and each row already carries the running balance TutorBird
 * itself computed after that row. That balance is not trusted blindly either.
 * It is recomputed here from the parsed charges and payments, in
 * chronological order, and checked against every single displayed balance in
 * the block. A family whose recomputed balance doesn't match what TutorBird
 * showed — anywhere in its history, not just at the end — is refused entirely
 * and reported, rather than imported with a silently wrong number. Money is
 * not something this script guesses about.
 *
 * A family is matched by the student names under "Students" — precise, unlike
 * matching by guardian surname (this roster has multiple unrelated
 * households sharing a surname; see import-tutorbird-invoices.mjs). A block
 * whose students aren't found, or who don't all belong to the same family
 * already in the app, is refused and reported rather than guessed at.
 *
 * Safe to re-run: each transaction's dedupe key is
 * (familyId, date, type, amount, description) — the same row pasted twice, or
 * a family block re-pasted after more rows were added on top, only imports
 * what's new.
 *
 *   node scripts/import-tutorbird-ledger.mjs [path]            # dry run
 *   node scripts/import-tutorbird-ledger.mjs [path] --commit    # write
 *
 * path defaults to scripts/data/tutorbird-ledger/families.txt
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../src/config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
// Households in the paste that exist nowhere in the app — not as students, not
// as one of the archived shells the invoice import left behind. Off by default:
// creating a family is how a typo in a surname becomes a permanent duplicate,
// so it takes saying so out loud.
const CREATE_MISSING = process.argv.includes('--create-missing');
const TXT_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(__dirname, 'data', 'tutorbird-ledger', 'families.txt');

if (!fs.existsSync(TXT_PATH)) {
  console.error(`No file at ${TXT_PATH}.`);
  console.error('Paste one or more family pages (starting at "Family Details") into it and re-run.');
  process.exit(1);
}

const MARKER = '[tutorbird-ledger]';
// Opening balances carry their own marker so they can be found and replaced on
// their own — see the deleteMany before each family is written.
const OPENING_MARKER = '[tutorbird-opening]';
const clean = (v) => (v == null ? '' : String(v).replace(/[‎‏‪-‮]/g, '').trim());

/* ── Money / date parsing ────────────────────────────────────────────────── */

/** "$207.40" -> 207.40. Amount lines here are never negative themselves. */
const parsePlainMoney = (s) => {
  const m = clean(s).match(/^\$?([\d,]+\.\d{2})$/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
};

/**
 * A balance cell: "$0.00" (settled or in credit) or "($225.00)" (owed).
 * Returns the *amount owed* (positive = owes money, 0 = settled, negative =
 * family is in credit) — the inverse of the accounting-parens sign, so it
 * reads the same direction as everywhere else in this app.
 */
const parseOwed = (s) => {
  const t = clean(s);
  const paren = t.match(/^\(\$?([\d,]+\.\d{2})\)$/);
  if (paren) return parseFloat(paren[1].replace(/,/g, ''));
  const plain = t.match(/^\$([\d,]+\.\d{2})$/);
  if (plain) return -parseFloat(plain[1].replace(/,/g, ''));
  return null;
};

const parseDate = (v) => {
  const m = clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return isNaN(d) ? null : d;
};

// The amount is parenthesized on a Discount or a Refund row — TutorBird's
// "Charges & Discounts" / "Payments & Refunds" columns print a reduction in
// parens regardless of which of the two rows in that pair it is. The parens
// carry no sign information beyond that; the actual effect on the balance
// still comes from AMOUNT_TYPE + INCREASES_OWED below.
const MONEY_LINE = /^(Charge|Payment|Refund|Discount|Credit)\s+\(?\$[\d,]+\.\d{2}\)?$/;
const AMOUNT_TYPE = { Charge: 'CHARGE', Payment: 'PAYMENT', Refund: 'REFUND', Discount: 'CREDIT', Credit: 'CREDIT' };

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

/* ── Split the paste into family blocks ──────────────────────────────────── */

const raw = fs.readFileSync(TXT_PATH, 'utf8').replace(/\r\n/g, '\n');
const allLines = raw.split('\n');
const blockStarts = [];
allLines.forEach((l, i) => { if (clean(l) === 'Family Details') blockStarts.push(i); });

if (blockStarts.length === 0) {
  console.error('No "Family Details" block found in the file — is this the right paste?');
  process.exit(1);
}

const blocks = blockStarts.map((start, i) => allLines.slice(start, blockStarts[i + 1] ?? allLines.length));

/* ── Parse one family block ──────────────────────────────────────────────── */

const SECTION_HEADERS = ['Students', 'Family Contacts', 'Tags'];
// Enrolment status words printed under a student's name in the Students
// section. Each one missing here produces a fake "student" with that word as
// its name — 'Waiting' did exactly that for the Woods block, 'Trial' for
// Owens. Confirmed complete by scanning every status word across a 90-family
// paste; if TutorBird has others, a family will fail to match and the report
// will name the bogus "student" so a new one is easy to spot and add here.
const NOISE_LINES = new Set(['Family Details', 'Active', 'Inactive', 'Waiting', 'Trial', 'Invoice Recipient', 'Recurring', 'Lesson', '']);
const TABLE_HEADER = ['Date', 'Student', 'Description', 'Charges & Discounts', 'Payments & Refunds', 'Sales Tax', 'Balance'];

/**
 * Everything above the transaction table: names under "Students" and
 * "Family Contacts", names under "Tags". Read as flat lists of non-empty
 * lines between one section header and the next, skipping known status words.
 */
const parseHeader = (lines) => {
  const sections = { Students: [], 'Family Contacts': [], Tags: [] };
  let current = null;
  for (const line of lines) {
    const l = clean(line);
    if (l === 'Family Details') continue;
    if (SECTION_HEADERS.includes(l)) { current = l; continue; }
    if (l === TABLE_HEADER[0]) break; // reached the transaction table
    if (!current || !l || NOISE_LINES.has(l)) continue;
    sections[current].push(l);
  }
  return sections;
};

/** "Donahue, Veronica" -> "Veronica Donahue" (matches how names are stored). */
const toGivenSurname = (lastFirst) => {
  const [last, first] = lastFirst.split(',').map(s => clean(s));
  return first ? `${first} ${last}`.trim() : last;
};

/**
 * TutorBird's Step Up/FES marker, same as import-tutorbird-contacts.mjs's
 * stripEmaMarker — but here it can land on a STUDENT's own name column too
 * ("Branca EMA, Arrow"), not only a guardian's, so it has to be stripped
 * before the surname is used to look up a family by name. The existing
 * archived "Branca Family" (created by the invoice import, which does strip
 * this) would otherwise never be found under "Branca EMA Family".
 */
const stripEma = (s) => clean(s).replace(/\s*\bEMA\b\s*/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * The transaction table: a run of chunks, each starting at a date line
 * (M/D/YYYY) and ending just before the next date line or end of block.
 * Within a chunk: the money line ("Charge $X.XX" etc.) and, immediately after
 * it (skipping blank lines), the balance cell. Everything else non-empty
 * between the date and the money line is description text.
 */
const parseTransactions = (lines, studentNames) => {
  const dateIdx = [];
  lines.forEach((l, i) => { if (parseDate(l)) dateIdx.push(i); });

  const rows = [];
  const problems = [];

  for (let k = 0; k < dateIdx.length; k++) {
    const start = dateIdx[k];
    const end = dateIdx[k + 1] ?? lines.length;
    const chunk = lines.slice(start, end).map(clean);
    const date = parseDate(chunk[0]);

    const moneyLineIdx = chunk.findIndex(l => MONEY_LINE.test(l));
    if (moneyLineIdx === -1) { problems.push(`no Charge/Payment/Refund line found near ${chunk[0]}`); continue; }
    const [, kind, ] = chunk[moneyLineIdx].match(/^(Charge|Payment|Refund|Discount|Credit)\s+\(?\$([\d,]+\.\d{2})\)?$/) || [];
    const amount = parsePlainMoney(chunk[moneyLineIdx].replace(/^(Charge|Payment|Refund|Discount|Credit)\s+\(?/, '').replace(/\)$/, ''));

    let owedAfter = null;
    for (let j = moneyLineIdx + 1; j < chunk.length; j++) {
      if (!chunk[j]) continue;
      owedAfter = parseOwed(chunk[j]);
      break;
    }
    if (owedAfter === null) { problems.push(`no balance found after "${chunk[moneyLineIdx]}" on ${chunk[0]}`); continue; }

    const descLines = chunk.slice(1, moneyLineIdx).filter(l => l && !NOISE_LINES.has(l));
    let studentName = null;
    const kept = [];
    for (const l of descLines) {
      const asPerson = studentNames.find(n => n.toLowerCase() === l.toLowerCase());
      if (asPerson) studentName = asPerson;
      else kept.push(l);
    }

    rows.push({
      date, type: AMOUNT_TYPE[kind], amount, owedAfter,
      description: kept.join(' — ') || kind,
      studentName,
    });
  }

  return { rows, problems };
};

/* ── Reconcile one family ─────────────────────────────────────────────────── */

/**
 * Replays the pasted rows oldest-first and compares against the balance
 * TutorBird printed on every one of them.
 *
 * The gap between the two is the tell. TutorBird's screen paginates, so a
 * paste usually starts partway down a family's history — and then the oldest
 * pasted row already carries whatever was owed before it. That shows up as the
 * SAME gap on every row, which is proof the rows themselves are read
 * correctly and only the starting point is missing: the gap is the opening
 * balance, and one entry for it makes the whole block reconcile.
 *
 * A gap that MOVES is the opposite — a row misread, or a row missing from the
 * middle. That is never patched over; the family is refused.
 */
// Must match BALANCE_INCREASING_TYPES / BALANCE_DECREASING_TYPES in
// src/services/billingCredit.service.js — that is what actually computes a
// family's balance in the running app, so this reconciliation is only
// meaningful if it moves the ledger the same way. REFUND belongs with CHARGE,
// not with PAYMENT: it reverses an earlier payment, so it puts money back on
// what the family owes rather than taking it off.
const INCREASES_OWED = new Set(['CHARGE', 'REFUND']);

const reconcile = (rows) => {
  const chrono = [...rows].reverse();
  let running = 0;
  const offsets = [];
  const replay = [];
  for (const r of chrono) {
    running += INCREASES_OWED.has(r.type) ? r.amount : -r.amount;
    offsets.push(Math.round((r.owedAfter - running) * 100) / 100);
    replay.push({ ...r, recomputed: running });
  }

  const distinct = [...new Set(offsets)];
  const openingBalance = distinct.length === 1 ? distinct[0] : null;

  // Only a wandering gap is a real failure.
  const mismatches = openingBalance === null
    ? replay
        .filter((r, i) => offsets[i] !== offsets[0])
        .slice(0, 8)
        .map(r => `${r.date.toISOString().slice(0, 10)} ${r.type} $${r.amount.toFixed(2)} "${r.description.slice(0, 40)}" — recomputed owed $${r.recomputed.toFixed(2)}, TutorBird showed $${r.owedAfter.toFixed(2)}`)
    : [];

  return {
    chrono,
    mismatches,
    openingBalance: openingBalance || 0,
    finalOwed: running + (openingBalance || 0),
    distinctOffsets: distinct.length,
  };
};

/* ── Process every block ─────────────────────────────────────────────────── */

const results = [];
for (const [i, block] of blocks.entries()) {
  const header = parseHeader(block);
  const studentLastFirst = header.Students;
  const studentNames = studentLastFirst.map(toGivenSurname);
  const { rows, problems } = parseTransactions(block, studentNames);
  const { finalOwed, mismatches, chrono, openingBalance } = reconcile(rows);

  results.push({
    blockIndex: i + 1,
    studentNames,
    // Surname of the first student, for the family-name fallback below.
    surname: stripEma((studentLastFirst[0] || '').split(',')[0]),
    contactNames: header['Family Contacts'].map(toGivenSurname),
    tags: header.Tags,
    rows: chrono,
    problems,
    mismatches,
    openingBalance,
    finalOwed,
  });
}

/* ── Match each block to a family already in the app ─────────────────────── */

const allNames = [...new Set(results.flatMap(r => r.studentNames))];
const students = await withRetry('load students', () => prisma.user.findMany({
  where: { role: 'STUDENT', fullName: { in: allNames, mode: 'insensitive' } },
  select: { id: true, fullName: true, familyMembers: { select: { familyId: true, family: { select: { name: true } } } } },
}));
const studentByName = new Map(students.map(s => [s.fullName.toLowerCase(), s]));

// Families the roster import never populated — the archived households created
// to hold legacy debt have a name and no members at all, so no student of
// theirs can ever match. They are reached by family name instead, and only
// when exactly one EMPTY family carries it (this roster has three "Rodriguez
// Family", so an ambiguous surname must never be guessed at).
//
// Restricted to families with zero members on purpose: a name-only guess must
// never land on a family that already has a real student, because a shared
// surname does not mean a shared household. This roster has an unrelated
// Karsen Walker (a real student, matched by name above) and Jeremiah Walker
// (never in the roster) — without this filter, Jeremiah's whole ledger was
// silently merged into Karsen's family on this script's first production run.
// `startsWith` rather than an exact match: when the invoice import created an
// archived household whose surname was already taken, it disambiguated with
// the guardian's first name — "Scott Family (Anna)", "Brooks Family (Andrew)".
// Matching only "<Surname> Family" would miss those and create a second copy
// of a household that already exists to hold that family's debt.
const surnames = [...new Set(results.map(r => r.surname).filter(Boolean))];
const famsBySurname = new Map();
for (const name of surnames) {
  const hits = await withRetry(`match ${name}`, () => prisma.family.findMany({
    where: { name: { startsWith: `${name} Family`, mode: 'insensitive' } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  }));
  famsBySurname.set(name, { empty: hits.filter(h => h._count.members === 0), populated: hits.filter(h => h._count.members > 0) });
}

/** First name of each guardian on the block, for the "(Anna)" style match. */
const guardianGivenNames = (r) => (r.contactNames || []).map(n => clean(n).split(' ')[0]).filter(Boolean);

for (const r of results) {
  const found = r.studentNames.map(n => studentByName.get(n.toLowerCase())).filter(Boolean);
  const notFound = r.studentNames.filter(n => !studentByName.has(n.toLowerCase()));
  const familyIds = new Set(found.flatMap(s => s.familyMembers.map(m => m.familyId)));

  r.matchedStudents = found.length;
  // A sibling missing from the app is not a reason to refuse the household:
  // the ledger is the family's, and these blocks routinely list children who
  // never made it into the active-roster export. Their rows simply carry no
  // studentId. It IS worth saying out loud, so it is reported below.
  r.notFoundStudents = notFound;

  if (familyIds.size > 1) {
    r.matchProblem = `its students belong to ${familyIds.size} different families in the app`;
  } else if (familyIds.size === 1) {
    r.familyId = [...familyIds][0];
    r.familyName = found[0].familyMembers.find(m => m.familyId === r.familyId).family.name;
    r.matchedVia = `student ${found[0].fullName}`;
  } else {
    const { empty, populated } = famsBySurname.get(r.surname) || { empty: [], populated: [] };
    // A guardian's first name in the household name is what tells two archived
    // "<Surname> Family" records apart, so try that before giving up — the
    // invoice import named them exactly this way.
    const byGuardian = empty.filter(f => guardianGivenNames(r).some(g => f.name.toLowerCase().includes(`(${g.toLowerCase()})`)));
    const exact = empty.filter(f => f.name.toLowerCase() === `${r.surname} Family`.toLowerCase());
    const pick = byGuardian.length === 1 ? byGuardian[0] : (exact.length === 1 && empty.length === 1 ? exact[0] : null);

    if (pick) {
      r.familyId = pick.id;
      r.familyName = pick.name;
      r.matchedVia = `family name "${pick.name}" (no student of theirs is in the app)`;
    } else if (empty.length) {
      // An archived legacy household under this surname already exists, but
      // nothing on the block confirms it is this one. Creating another would
      // split one household's debt across two records — the mirror image of
      // the merge above, and just as silent. Refuse and name the candidates
      // so an admin decides, whether there is one of them or several.
      const who = guardianGivenNames(r).join(', ') || 'none listed';
      const which = empty.map(f => f.name).join(', ');
      r.matchProblem = empty.length > 1
        ? `no student matched and ${empty.length} empty "${r.surname} Family" households exist (${which}) — no guardian on this block (${who}) tells them apart`
        : `no student matched and the only empty "${r.surname} Family" household is "${which}" — no guardian on this block (${who}) confirms it is theirs`;
    } else if (populated.length > 0) {
      r.needsFamily = true;
      r.matchProblem = `no student matched, and "${r.surname} Family" already has real members — almost certainly a different, unrelated household with the same surname`;
    } else {
      r.needsFamily = true;
      r.matchProblem = `no student matched and no family called "${r.surname} Family" exists`;
    }
  }
}

/* ── Idempotency: what's already in the ledger for these families ────────── */

const targetFamilyIds = [...new Set(results.map(r => r.familyId).filter(Boolean))];
const priorTx = targetFamilyIds.length
  ? await withRetry('load existing transactions', () => prisma.transaction.findMany({
      where: { familyId: { in: targetFamilyIds }, description: { contains: MARKER } },
      select: { id: true, familyId: true, date: true, type: true, amount: true, description: true },
    }))
  : [];

/**
 * A COUNT per key, not presence/absence — TutorBird families do carry two
 * genuinely separate transactions that are identical in every field this key
 * looks at (same date, type, amount, and a bare "Payment $50.00" line has no
 * further description text to tell them apart). A plain Set idempotency check
 * silently ate the second one on this script's first production run: it
 * looked "already imported" the instant the first one was written, moments
 * earlier in the same pass, and 55 came in short their real balance.
 *
 * The row-key builder below is shared by the report and the write loop so
 * both partition a family's rows into "already there" / "new" the same way —
 * the Nth occurrence of a key in this run corresponds to the Nth existing DB
 * row with that key, and only occurrences beyond that count are new.
 */
const rowKey = (familyId, date, type, amount, description) =>
  [familyId, date.toISOString().slice(0, 10), type, amount.toFixed(2), description].join('|');

const priorCounts = new Map();
for (const t of priorTx) {
  const key = [t.familyId, t.date.toISOString().slice(0, 10), t.type, Number(t.amount).toFixed(2), t.description].join('|');
  priorCounts.set(key, (priorCounts.get(key) || 0) + 1);
}

/** True if this occurrence of `key` is new — call once per row, in order, with a fresh `usedCounts` per pass. */
const claimIsNew = (key, usedCounts) => {
  const used = usedCounts.get(key) || 0;
  usedCounts.set(key, used + 1);
  return used >= (priorCounts.get(key) || 0);
};

// One row per family, kept separate from priorKeys: an opening balance is
// REPLACED wholesale when it changes (see below), never matched key-by-key
// like an ordinary transaction — pasting more history later must change the
// number, not add a second one next to it.
// "Opening balance carried into" catches rows written before OPENING_MARKER
// existed — this import has already run once in production without it.
const priorOpeningByFamily = new Map(
  priorTx.filter(t => t.description.includes(OPENING_MARKER) || t.description.startsWith('Opening balance carried into')).map(t => [t.familyId, t])
);

/* ── Report ───────────────────────────────────────────────────────────────── */

console.log(`\n${COMMIT ? '=== COMMITTING ===' : '=== DRY RUN (nothing will be written) ==='}`);
console.log(`\nFile: ${TXT_PATH}`);
console.log(`Family blocks found: ${results.length}\n`);

// The same family pasted twice — easy to do when collecting 90 households by
// hand, and it happened on the first production run (Carroll, whose balance
// came out at $40 instead of $20). Two blocks resolving to one family with an
// identical set of rows is a re-paste, not two windows of history, so the
// later one is dropped. The per-key counting below cannot catch this on its
// own: with nothing yet in the database both blocks legitimately look new.
const blockSignatures = new Map();
for (const r of results) {
  if (r.problems.length || r.mismatches.length || r.matchProblem) continue;
  const signature = [r.familyId, ...r.rows.map(row => rowKey(r.familyId, row.date, row.type, row.amount, row.description))].join('||');
  const firstSeen = blockSignatures.get(signature);
  if (firstSeen) r.matchProblem = `identical to block ${firstSeen} (same family, same ${r.rows.length} rows) — pasted twice, this copy ignored`;
  else blockSignatures.set(signature, r.blockIndex);
}

/* ── Households with nowhere to live ──────────────────────────────────────── */

// Only blocks that parsed and reconciled cleanly and simply have no family —
// never a parse failure, a drifting balance, or a duplicate paste. Each gets a
// proposed name here so the dry run can show it before anything is written.
const takenNames = new Set(
  (await withRetry('load family names', () => prisma.family.findMany({ select: { name: true } }))).map(f => f.name.toLowerCase())
);
const toCreate = results.filter(r => r.needsFamily && !r.problems.length && !r.mismatches.length);
for (const r of toCreate) {
  const base = `${r.surname} Family`;
  if (!takenNames.has(base.toLowerCase())) {
    r.proposedName = base;
  } else {
    // Same convention the invoice import used, so the two importers can find
    // each other's households instead of each making their own.
    const given = guardianGivenNames(r).find(g => !takenNames.has(`${base} (${g})`.toLowerCase()));
    r.proposedName = given ? `${base} (${given})` : `${base} [block ${r.blockIndex}]`;
  }
  takenNames.add(r.proposedName.toLowerCase());
}

if (CREATE_MISSING && COMMIT) {
  for (const r of toCreate) {
    const family = await withRetry(`create ${r.proposedName}`, () => prisma.family.create({
      data: { name: r.proposedName, tags: ['archived', 'tutorbird-legacy'] },
    }));
    r.familyId = family.id;
    r.familyName = family.name;
    r.matchedVia = `newly created archived household "${family.name}"`;
    r.matchProblem = null;
    r.createdFamily = true;
  }
}

const clean_ = results.filter(r => !r.problems.length && !r.mismatches.length && !r.matchProblem);
const bad = results.filter(r => r.problems.length || r.mismatches.length || r.matchProblem);

// Shared across every block, not reset per family: this roster has families
// reached by more than one pasted block (e.g. one page per student in the
// household), and a key must be claimed against the family's total count
// across ALL of this run's blocks — a fresh counter per block would let two
// blocks each think a shared-looking row is "the new one" and duplicate it.
const reportUsed = new Map();
const previewOpeningByFamily = new Map(priorOpeningByFamily);

for (const r of results) {
  const label = r.familyName || r.studentNames.join(', ') || `block ${r.blockIndex}`;
  if (r.problems.length) {
    console.log(`✗ ${label} — ${r.rows.length + r.problems.length} rows, ${r.problems.length} unparseable:`);
    r.problems.forEach(p => console.log(`    ${p}`));
    continue;
  }
  if (r.matchProblem) {
    // The reconciliation already ran even though there's no family to attach
    // it to — showing the amount here is what turns "not in the app" into a
    // decision instead of a shrug.
    const balNote = r.mismatches.length ? ' — balance also does not reconcile, would need review either way' : ` — would carry $${Math.abs(r.finalOwed).toFixed(2)} ${r.finalOwed >= 0 ? 'owed' : 'in credit'}`;
    console.log(`✗ ${label} — ${r.matchProblem}${balNote}`);
    continue;
  }
  if (r.mismatches.length) {
    console.log(`✗ ${label} — balance drifts (${r.distinctOffsets} different gaps), REFUSED:`);
    r.mismatches.forEach(m => console.log(`    ${m}`));
    continue;
  }
  const newRowCount = r.rows.filter(row => claimIsNew(rowKey(r.familyId, row.date, row.type, row.amount, `${row.description} ${MARKER}`), reportUsed)).length;
  console.log(`✓ ${label} — ${r.rows.length} rows reconcile, balance owed: $${r.finalOwed.toFixed(2)} (${newRowCount} new, ${r.rows.length - newRowCount} already imported)`);
  // A local copy for preview purposes only — mutating the real map here would
  // make the write loop below (which runs after this, sharing the same
  // process in a --commit run) try to delete a transaction id that only ever
  // existed on screen.
  const priorOpening = r.familyId ? previewOpeningByFamily.get(r.familyId) : null;
  if (r.openingBalance) {
    const kind = r.openingBalance > 0 ? 'owed' : 'in credit';
    const signedNew = r.openingBalance;
    const signedPrior = priorOpening ? (priorOpening.type === 'CREDIT' ? -Number(priorOpening.amount) : Number(priorOpening.amount)) : null;
    const change = signedPrior === null ? '' : (Math.abs(signedPrior - signedNew) < 0.005 ? ' (unchanged)' : ` (replaces $${Math.abs(signedPrior).toFixed(2)} ${signedPrior > 0 ? 'owed' : 'in credit'})`);
    console.log(`      + opening balance $${Math.abs(r.openingBalance).toFixed(2)} ${kind}${change} — history before ${r.rows[0].date.toISOString().slice(0, 10)} is not in the paste`);
    if (r.familyId) previewOpeningByFamily.set(r.familyId, { amount: Math.abs(r.openingBalance), type: r.openingBalance > 0 ? 'CHARGE' : 'CREDIT' });
  } else if (priorOpening) {
    console.log(`      + this paste now covers the family's full history — removes the $${Number(priorOpening.amount).toFixed(2)} opening balance from before`);
    if (r.familyId) previewOpeningByFamily.delete(r.familyId);
  }
  if (r.matchedVia?.startsWith('family name')) console.log(`      matched via ${r.matchedVia}`);
  if (r.notFoundStudents.length) console.log(`      note: not in the app, their rows carry no student — ${r.notFoundStudents.join(', ')}`);
}

console.log(`\n${clean_.length} of ${results.length} families ready to import; ${bad.length} refused.`);
if (bad.length) console.log('Fix or omit the refused blocks and re-run — nothing partial is ever written for a family that fails.');

const totalOwed = clean_.reduce((s, r) => s + Math.max(0, r.finalOwed), 0);
const totalCredit = clean_.reduce((s, r) => s + Math.max(0, -r.finalOwed), 0);
console.log(`\nAcross the ${clean_.length} clean families: $${totalOwed.toFixed(2)} owed, $${totalCredit.toFixed(2)} in credit.`);

if (toCreate.length && !(CREATE_MISSING && COMMIT)) {
  console.log(`\n${toCreate.length} households reconcile but exist nowhere in the app.`);
  console.log(`Re-run with --create-missing --commit to create them as archived shells:`);
  for (const r of toCreate) {
    const bal = r.finalOwed >= 0 ? `$${r.finalOwed.toFixed(2)} owed` : `$${Math.abs(r.finalOwed).toFixed(2)} in credit`;
    console.log(`  ${r.proposedName.padEnd(32)} ${String(r.rows.length).padStart(3)} rows, ${bal}`);
  }
}

/* ── Write ───────────────────────────────────────────────────────────────── */

if (!COMMIT) {
  // Post-commit verification needs to check the exact family a block resolved
  // to — this roster has same-named families (e.g. two "Rodriguez Family"),
  // so checking by name after the fact would be ambiguous. Opt-in via env var
  // since it's a verification aid, not part of the normal dry run.
  if (process.env.DUMP_MATCHES) {
    fs.writeFileSync(process.env.DUMP_MATCHES, JSON.stringify(
      clean_.map(r => ({ family: r.familyName, familyId: r.familyId, expected: r.finalOwed })), null, 1
    ));
    console.log(`\nWrote ${clean_.length} matches to ${process.env.DUMP_MATCHES}`);
  }
  console.log('\nRe-run with --commit to apply (only the clean families above are written).\n');
  await prisma.$disconnect();
  process.exit(0);
}

const created = { families: 0, transactions: 0, skippedExisting: 0, openingsReplaced: 0 };
// Shared across every block for the same reason as reportUsed above.
const writeUsed = new Map();

for (const r of clean_) {
  await withRetry(r.familyName, async () => {
    // The balance the family carried into the pasted window — REPLACED
    // wholesale rather than matched key-by-key like an ordinary row below,
    // because pasting more of a family's history later changes this number
    // (possibly to zero, if the new paste now reaches all the way back) and
    // must overwrite the old one, not sit next to it.
    const priorOpening = priorOpeningByFamily.get(r.familyId);
    if (priorOpening) {
      await prisma.transaction.delete({ where: { id: priorOpening.id } });
      created.openingsReplaced++;
      priorOpeningByFamily.delete(r.familyId);
    }
    if (r.openingBalance) {
      const description = `Opening balance carried into ${r.rows[0].date.toISOString().slice(0, 10)} (earlier history not exported) ${OPENING_MARKER} ${MARKER}`;
      const type = r.openingBalance > 0 ? 'CHARGE' : 'CREDIT';
      const amount = Math.abs(r.openingBalance);
      const opening = await prisma.transaction.create({
        data: { familyId: r.familyId, amount, type, date: r.rows[0].date, description },
      });
      created.transactions++;
      // Keeps a second block for the SAME family in this run (a real case —
      // Carroll appears twice) from re-deriving its own opening balance and
      // stacking a second one: the next block sees this one and replaces it.
      // NOTE: this makes the second block's figure win outright rather than
      // combine the two — correct for a literal re-paste of the same page,
      // but not a general answer for two DIFFERENT windows of one family's
      // history landing in one run. That situation hasn't occurred yet; if it
      // does, the dry run's per-block opening-balance lines make it visible
      // before anything is written.
      priorOpeningByFamily.set(r.familyId, opening);
    }

    for (const row of r.rows) {
      const description = `${row.description} ${MARKER}`;
      if (!claimIsNew(rowKey(r.familyId, row.date, row.type, row.amount, description), writeUsed)) { created.skippedExisting++; continue; }

      await prisma.transaction.create({
        data: {
          familyId: r.familyId,
          amount: row.amount,
          type: row.type,
          date: row.date,
          description,
          ...(row.studentName ? { student: { connect: { id: studentByName.get(row.studentName.toLowerCase())?.id } } } : {}),
        },
      });
      created.transactions++;
    }
  });
  process.stdout.write('.');
}

console.log(`\n\nDone.`);
console.log(`  families updated    ${clean_.length}`);
console.log(`  transactions written ${created.transactions}${created.skippedExisting ? ` (${created.skippedExisting} already present, skipped)` : ''}`);
console.log(`  opening balances replaced ${created.openingsReplaced}\n`);

await prisma.$disconnect();
