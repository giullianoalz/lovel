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

const MONEY_LINE = /^(Charge|Payment|Refund|Discount|Credit)\s+\$[\d,]+\.\d{2}$/;
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
// 'Waiting' belongs here with 'Active'/'Inactive': it is an enrolment status
// printed under a student's name, and leaving it out made the Woods block
// import two students called "Waiting".
const NOISE_LINES = new Set(['Family Details', 'Active', 'Inactive', 'Waiting', 'Invoice Recipient', 'Recurring', 'Lesson', '']);
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
    const [, kind, ] = chunk[moneyLineIdx].match(/^(Charge|Payment|Refund|Discount|Credit)\s+\$([\d,]+\.\d{2})$/) || [];
    const amount = parsePlainMoney(chunk[moneyLineIdx].replace(/^(Charge|Payment|Refund|Discount|Credit)\s+/, ''));

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
const reconcile = (rows) => {
  const chrono = [...rows].reverse();
  let running = 0;
  const offsets = [];
  const replay = [];
  for (const r of chrono) {
    running += r.type === 'CHARGE' ? r.amount : -r.amount;
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
    surname: (studentLastFirst[0] || '').split(',')[0].trim(),
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
// when exactly one family carries it (this roster has three "Rodriguez
// Family", so an ambiguous surname must never be guessed at).
const surnames = [...new Set(results.map(r => r.surname).filter(Boolean))];
const famsBySurname = new Map();
for (const name of surnames) {
  const hits = await withRetry(`match ${name}`, () => prisma.family.findMany({
    where: { name: { equals: `${name} Family`, mode: 'insensitive' } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  }));
  famsBySurname.set(name, hits);
}

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
    const hits = famsBySurname.get(r.surname) || [];
    if (hits.length === 1) {
      r.familyId = hits[0].id;
      r.familyName = hits[0].name;
      r.matchedVia = `family name "${hits[0].name}" (no student of theirs is in the app)`;
    } else if (hits.length > 1) {
      r.matchProblem = `no student matched and ${hits.length} families are called "${r.surname} Family" — too ambiguous to guess`;
    } else {
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
const priorKeys = new Set(priorTx.map(t => [t.familyId, t.date.toISOString().slice(0, 10), t.type, Number(t.amount).toFixed(2), t.description].join('|')));

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

const clean_ = results.filter(r => !r.problems.length && !r.mismatches.length && !r.matchProblem);
const bad = results.filter(r => r.problems.length || r.mismatches.length || r.matchProblem);

for (const r of results) {
  const label = r.familyName || r.studentNames.join(', ') || `block ${r.blockIndex}`;
  if (r.problems.length) {
    console.log(`✗ ${label} — ${r.rows.length + r.problems.length} rows, ${r.problems.length} unparseable:`);
    r.problems.forEach(p => console.log(`    ${p}`));
    continue;
  }
  if (r.matchProblem) {
    console.log(`✗ ${label} — ${r.matchProblem}`);
    continue;
  }
  if (r.mismatches.length) {
    console.log(`✗ ${label} — balance drifts (${r.distinctOffsets} different gaps), REFUSED:`);
    r.mismatches.forEach(m => console.log(`    ${m}`));
    continue;
  }
  const newRows = r.rows.filter(row => !priorKeys.has([r.familyId, row.date.toISOString().slice(0, 10), row.type, row.amount.toFixed(2), `${row.description} ${MARKER}`].join('|')));
  console.log(`✓ ${label} — ${r.rows.length} rows reconcile, balance owed: $${r.finalOwed.toFixed(2)} (${newRows.length} new, ${r.rows.length - newRows.length} already imported)`);
  const priorOpening = r.familyId ? priorOpeningByFamily.get(r.familyId) : null;
  if (r.openingBalance) {
    const kind = r.openingBalance > 0 ? 'owed' : 'in credit';
    const signedNew = r.openingBalance;
    const signedPrior = priorOpening ? (priorOpening.type === 'CREDIT' ? -Number(priorOpening.amount) : Number(priorOpening.amount)) : null;
    const change = signedPrior === null ? '' : (Math.abs(signedPrior - signedNew) < 0.005 ? ' (unchanged)' : ` (replaces $${Math.abs(signedPrior).toFixed(2)} ${signedPrior > 0 ? 'owed' : 'in credit'})`);
    console.log(`      + opening balance $${Math.abs(r.openingBalance).toFixed(2)} ${kind}${change} — history before ${r.rows[0].date.toISOString().slice(0, 10)} is not in the paste`);
  } else if (priorOpening) {
    console.log(`      + this paste now covers the family's full history — removes the $${Number(priorOpening.amount).toFixed(2)} opening balance from before`);
  }
  if (r.matchedVia?.startsWith('family name')) console.log(`      matched via ${r.matchedVia}`);
  if (r.notFoundStudents.length) console.log(`      note: not in the app, their rows carry no student — ${r.notFoundStudents.join(', ')}`);
}

console.log(`\n${clean_.length} of ${results.length} families ready to import; ${bad.length} refused.`);
if (bad.length) console.log('Fix or omit the refused blocks and re-run — nothing partial is ever written for a family that fails.');

const totalOwed = clean_.reduce((s, r) => s + Math.max(0, r.finalOwed), 0);
const totalCredit = clean_.reduce((s, r) => s + Math.max(0, -r.finalOwed), 0);
console.log(`\nAcross the ${clean_.length} clean families: $${totalOwed.toFixed(2)} owed, $${totalCredit.toFixed(2)} in credit.`);

/* ── Write ───────────────────────────────────────────────────────────────── */

if (!COMMIT) {
  console.log('\nRe-run with --commit to apply (only the clean families above are written).\n');
  await prisma.$disconnect();
  process.exit(0);
}

const created = { families: 0, transactions: 0, skippedExisting: 0, openingsReplaced: 0 };

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
    }
    if (r.openingBalance) {
      const description = `Opening balance carried into ${r.rows[0].date.toISOString().slice(0, 10)} (earlier history not exported) ${OPENING_MARKER} ${MARKER}`;
      const type = r.openingBalance > 0 ? 'CHARGE' : 'CREDIT';
      const amount = Math.abs(r.openingBalance);
      await prisma.transaction.create({
        data: { familyId: r.familyId, amount, type, date: r.rows[0].date, description },
      });
      created.transactions++;
    }

    for (const row of r.rows) {
      const description = `${row.description} ${MARKER}`;
      const key = [r.familyId, row.date.toISOString().slice(0, 10), row.type, row.amount.toFixed(2), description].join('|');
      if (priorKeys.has(key)) { created.skippedExisting++; continue; }
      priorKeys.add(key);

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
