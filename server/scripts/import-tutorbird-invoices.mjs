/**
 * One-off importer for the TutorBird "Invoice Details" export.
 *
 * The export is NOT a list of discrete invoices. Every row is a running
 * statement, and the numbers prove it: on the 183 rows that carry the carry
 * forward columns, `Balance Forward - Payments Included + New Charges` equals
 * `Invoice Amount` on 182 of them. So "Invoice Amount" is the whole balance
 * owed at that moment, restating everything still unpaid from before.
 *
 * Reading those 400 rows as 400 charges would put $243,997 of receivables on
 * the books. The real outstanding balance is $43,282.50. That gap is the whole
 * reason this script splits the import in two:
 *
 *   1. HISTORY — every row becomes an Invoice row for the record, marked
 *      PAID/CANCELLED/SENT as the export says, with NO transactions and NO
 *      lines behind it. In this schema the ledger is Transaction; an invoice
 *      with nothing behind it is a document, so history is readable without
 *      moving a single balance.
 *
 *   2. BALANCES — one opening-balance CHARGE per family that still owes,
 *      taken from that family's most recent non-void invoice. That, and only
 *      that, is what the family's balance is built from.
 *
 * Numbered TB-#### rather than the LC-#### the app issues, so migrated history
 * is distinguishable at a glance and `nextLcNumber` (which scans LC- only) is
 * left alone.
 *
 * Safe to re-run: invoices match on family+date+amount+range, and the opening
 * balance is guarded by a marker in its description.
 *
 *   node scripts/import-tutorbird-invoices.mjs <csv-path>            # dry run
 *   node scripts/import-tutorbird-invoices.mjs <csv-path> --commit   # write
 */

import fs from 'fs';
import prisma from '../src/config/database.js';

const COMMIT = process.argv.includes('--commit');
const CSV_PATH = process.argv[2];

if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error('Usage: node scripts/import-tutorbird-invoices.mjs <csv-path> [--commit]');
  process.exit(1);
}

// Stamped into every opening-balance charge. Re-running looks for this before
// creating anything, which is what stops a second run from charging twice.
const OPENING_MARKER = '[tutorbird-opening-balance]';

/* ── CSV parsing ─────────────────────────────────────────────────────────── */

const parseCSV = (text) => {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
};

const clean = (v) => (v == null ? '' : String(v).replace(/[‎‏‪-‮]/g, '').trim());

/** "$1,275.00" -> 1275, "($5.00)" -> -5, "" -> null. */
const money = (v) => {
  const s = clean(v);
  if (!s) return null;
  const negative = s.startsWith('(');
  const n = parseFloat(s.replace(/[()$,]/g, ''));
  return isNaN(n) ? null : (negative ? -n : n);
};

const parseDate = (v) => {
  const m = clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return isNaN(d) ? null : d;
};

/** "Woods EMA, Nicole; Smith, Bob" -> "Woods" (EMA is a scholarship flag, not a name). */
const surnameOf = (list) => {
  const first = clean(list).split(';')[0] || '';
  const surname = first.split(',')[0] || '';
  return surname.replace(/\s*\bEMA\b\s*/gi, ' ').replace(/\s+/g, ' ').trim();
};

/** "Brook, Andrew; Brooks EMA, Chrystal" -> "Andrew" — used to tell households apart. */
const givenNameOf = (list) => {
  const first = clean(list).split(';')[0] || '';
  const given = first.split(',')[1] || '';
  return given.replace(/\s*\bEMA\b\s*/gi, ' ').replace(/["']/g, '').replace(/\s+/g, ' ').trim().split(' ')[0] || '';
};

const normalizeAddress = (v) => clean(v).replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').replace(/,\s*,/g, ',').replace(/,\s*$/, '') || null;

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
  invoiceDate: col('Invoice Date'),
  familyId: col('Family ID'),
  family: col('Family'),
  address: col('Address'),
  students: col('Students'),
  dateRange: col('Date Range'),
  description: col('Description'),
  amount: col('Invoice Amount'),
  paid: col('Paid'),
  void: col('Void'),
  emailed: col('Emailed Date'),
};

const warnings = [];
const invoices = [];      // every usable row
const households = new Map(); // tutorbird family id -> { name, address, rows[] }

for (const [n, r] of dataRows.entries()) {
  const rowNum = n + 2;
  const tbFamilyId = clean(r[IDX.familyId]);
  const date = parseDate(r[IDX.invoiceDate]);
  const amount = money(r[IDX.amount]);

  if (!tbFamilyId) { warnings.push(`Row ${rowNum}: no Family ID — skipped`); continue; }
  if (!date) { warnings.push(`Row ${rowNum}: unparseable Invoice Date "${clean(r[IDX.invoiceDate])}" — skipped`); continue; }
  if (amount === null) { warnings.push(`Row ${rowNum}: unparseable amount "${clean(r[IDX.amount])}" — skipped`); continue; }

  const isVoid = clean(r[IDX.void]).toUpperCase() === 'Y';
  const isPaid = clean(r[IDX.paid]).toUpperCase() === 'Y';

  if (!households.has(tbFamilyId)) {
    households.set(tbFamilyId, {
      tbFamilyId,
      guardians: clean(r[IDX.family]),
      // Prefer the students' surname so the household reads like the rest of
      // the directory ("Woods Family"); fall back to the guardian's when the
      // row lists no students at all.
      name: `${surnameOf(r[IDX.students]) || surnameOf(r[IDX.family]) || 'Unknown'} Family`,
      address: normalizeAddress(r[IDX.address]),
      isEma: /\bEMA\b/i.test(clean(r[IDX.family])),
      rows: [],
    });
  }
  const hh = households.get(tbFamilyId);
  hh.address = hh.address || normalizeAddress(r[IDX.address]);

  const inv = {
    rowNum, tbFamilyId, date, amount, isVoid, isPaid,
    dateRange: clean(r[IDX.dateRange]).slice(0, 100) || null,
    description: clean(r[IDX.description]) || null,
    emailed: parseDate(r[IDX.emailed]),
  };
  invoices.push(inv);
  hh.rows.push(inv);
}

// The balance a family still owes is the amount on its most recent non-void
// statement — earlier ones are already folded into it. A settled (Paid=Y) or
// zeroed latest statement means the family is square.
for (const hh of households.values()) {
  const live = hh.rows.filter(r => !r.isVoid).sort((a, b) => b.date - a.date);
  const latest = live[0] || null;
  hh.latest = latest;
  hh.owes = latest && !latest.isPaid && latest.amount > 0 ? latest.amount : 0;
  if (latest && !latest.isPaid && latest.amount < 0) {
    warnings.push(`${hh.name} (${hh.tbFamilyId}): latest statement is a credit of $${Math.abs(latest.amount).toFixed(2)} — no opening balance raised, review by hand`);
  }
}

/* ── Reconcile against the database ──────────────────────────────────────── */

const tbIds = [...households.keys()];
const existingFams = await withRetry('load families', () => prisma.family.findMany({
  where: { tags: { hasSome: tbIds.map(id => `tutorbird:${id}`) } },
  select: { id: true, name: true, tags: true, address: true },
}));
const famByTbId = new Map();
for (const f of existingFams) {
  const tag = f.tags.find(t => t.startsWith('tutorbird:'));
  if (tag) famByTbId.set(tag.slice('tutorbird:'.length), f);
}

// Surnames repeat across unrelated households — this export holds two
// unrelated Brooks families, one owing $4,090 and one $3,340. Two rows both
// reading "Brooks Family" in the billing list is a way to chase the wrong
// people for money, so a new household that collides with an existing name (or
// with another new one) carries its guardian's first name.
const takenNames = new Set(
  (await withRetry('load family names', () => prisma.family.findMany({ select: { name: true } }))).map(f => f.name.toLowerCase())
);

for (const hh of households.values()) {
  const found = famByTbId.get(hh.tbFamilyId);
  hh.existingFamilyId = found?.id || null;
  hh.existingName = found?.name || null;
  // Households the roster import never created are only worth creating when
  // there is money still to chase; a settled former family is noise in the
  // directory.
  hh.willCreate = !found && hh.owes > 0;
  hh.skipped = !found && hh.owes === 0;

  if (hh.willCreate) {
    if (takenNames.has(hh.name.toLowerCase())) {
      const given = givenNameOf(hh.guardians);
      const disambiguated = given ? `${hh.name.replace(/ Family$/, '')} Family (${given})` : `${hh.name} [${hh.tbFamilyId}]`;
      warnings.push(`"${hh.name}" already exists — new household named "${disambiguated}" instead`);
      hh.name = disambiguated;
    }
    takenNames.add(hh.name.toLowerCase());
  }
}

const importable = invoices.filter(inv => {
  const hh = households.get(inv.tbFamilyId);
  return hh.existingFamilyId || hh.willCreate;
});
const skippedInvoices = invoices.length - importable.length;

// Existing TB- invoices (a previous run) so a re-run neither duplicates nor
// reuses a number.
const priorTb = await withRetry('load prior invoices', () => prisma.invoice.findMany({
  where: { invoiceNumber: { startsWith: 'TB-' } },
  select: { invoiceNumber: true, familyId: true, date: true, totalAmount: true, dateRange: true },
}));
const priorKeys = new Set(priorTb.map(i => [i.familyId, i.date.toISOString().slice(0, 10), Number(i.totalAmount).toFixed(2), i.dateRange || ''].join('|')));
let nextTbNumber = priorTb.reduce((max, i) => Math.max(max, parseInt(i.invoiceNumber.slice(3), 10) || 0), 0) + 1;

const priorOpenings = await withRetry('load opening balances', () => prisma.transaction.findMany({
  where: { description: { contains: OPENING_MARKER } },
  select: { familyId: true, amount: true },
}));
const familiesWithOpening = new Set(priorOpenings.map(t => t.familyId));

/* ── Report ──────────────────────────────────────────────────────────────── */

const toCreate = [...households.values()].filter(h => h.willCreate);
const matched = [...households.values()].filter(h => h.existingFamilyId);
const skippedFams = [...households.values()].filter(h => h.skipped);
const owingAll = [...households.values()].filter(h => h.owes > 0 && (h.existingFamilyId || h.willCreate));
const owingTotal = owingAll.reduce((s, h) => s + h.owes, 0);
const faceValue = importable.reduce((s, i) => s + i.amount, 0);

console.log(`\n${COMMIT ? '=== COMMITTING ===' : '=== DRY RUN (nothing will be written) ==='}`);
console.log(`\nExport: ${dataRows.length} rows -> ${invoices.length} usable, across ${households.size} households\n`);
console.log('Households:');
console.log(`  already in the app        ${matched.length}`);
console.log(`  to create (owe money)     ${toCreate.length}`);
console.log(`  skipped (gone + settled)  ${skippedFams.length}`);
console.log('\nInvoices (history only — no ledger effect):');
console.log(`  to import                 ${importable.length}  (face value $${faceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
console.log(`  belonging to skipped fams ${skippedInvoices}`);
console.log(`  of those, void/cancelled  ${importable.filter(i => i.isVoid).length}`);
console.log(`  of those, already paid    ${importable.filter(i => i.isPaid && !i.isVoid).length}`);
console.log('\nOpening balances (this IS what moves the ledger):');
console.log(`  families owing            ${owingAll.length}`);
console.log(`  total to put on the books $${owingTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`\n  Face value of every row is $${faceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} — the difference is`);
console.log(`  balance restated across statements, which is why it is not charged.`);

console.log('\nWho owes what:');
owingAll.sort((a, b) => b.owes - a.owes).forEach(h => {
  const tag = h.existingFamilyId ? '' : ' (new)';
  console.log(`  ${('$' + h.owes.toLocaleString('en-US', { minimumFractionDigits: 2 })).padStart(12)}  ${h.existingName || h.name}${tag}  — last statement ${h.latest.date.toISOString().slice(0, 10)}`);
});

if (warnings.length) {
  console.log(`\nNeeds review (${warnings.length}):`);
  warnings.slice(0, 20).forEach(w => console.log('  ' + w));
  if (warnings.length > 20) console.log(`  ...and ${warnings.length - 20} more`);
}

if (skippedFams.length) {
  console.log(`\nSkipped households (not in the app, nothing outstanding) — ${skippedFams.length}:`);
  skippedFams.forEach(h => console.log(`  ${h.tbFamilyId}  ${h.guardians}`));
}

/* ── Write ───────────────────────────────────────────────────────────────── */

if (!COMMIT) {
  console.log('\nRe-run with --commit to apply.\n');
  await prisma.$disconnect();
  process.exit(0);
}

const created = { families: 0, invoices: 0, openings: 0, openingTotal: 0, skippedExisting: 0 };

for (const hh of households.values()) {
  if (!hh.existingFamilyId && !hh.willCreate) continue;

  await withRetry(hh.name, async () => {
    let familyId = hh.existingFamilyId;

    if (!familyId) {
      const family = await prisma.family.create({
        data: {
          name: hh.name,
          address: hh.address,
          // `archived` marks a household kept only so its debt has somewhere to
          // live — it has no active students and no contact details in this
          // export. `tutorbird:<id>` is the same match key the roster import
          // uses, so if these families ever come back they reconcile instead of
          // duplicating.
          tags: ['archived', 'tutorbird-legacy', `tutorbird:${hh.tbFamilyId}`, ...(hh.isEma ? ['EMA'] : [])],
        },
      });
      familyId = family.id;
      created.families++;
    }

    for (const inv of hh.rows) {
      const key = [familyId, inv.date.toISOString().slice(0, 10), inv.amount.toFixed(2), inv.dateRange || ''].join('|');
      if (priorKeys.has(key)) { created.skippedExisting++; continue; }
      priorKeys.add(key);

      await prisma.invoice.create({
        data: {
          invoiceNumber: `TB-${String(nextTbNumber++).padStart(4, '0')}`,
          familyId,
          date: inv.date,
          dateRange: inv.dateRange,
          source: 'tutorbird',
          subtotal: inv.amount,
          totalAmount: inv.amount,
          amountPaid: inv.isPaid && !inv.isVoid ? inv.amount : 0,
          status: inv.isVoid ? 'CANCELLED' : (inv.isPaid ? 'PAID' : 'SENT'),
        },
      });
      created.invoices++;
    }

    // The only ledger write in the whole script.
    if (hh.owes > 0 && !familiesWithOpening.has(familyId)) {
      await prisma.transaction.create({
        data: {
          familyId,
          amount: hh.owes,
          type: 'CHARGE',
          date: hh.latest.date,
          description: `Opening balance carried over from TutorBird as of ${hh.latest.date.toISOString().slice(0, 10)} ${OPENING_MARKER}`,
        },
      });
      familiesWithOpening.add(familyId);
      created.openings++;
      created.openingTotal += hh.owes;
    }
  });

  process.stdout.write('.');
}

console.log(`\n\nDone.`);
console.log(`  families created   ${created.families}`);
console.log(`  invoices imported  ${created.invoices}${created.skippedExisting ? ` (${created.skippedExisting} already present, skipped)` : ''}`);
console.log(`  opening balances   ${created.openings}  totalling $${created.openingTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

await prisma.$disconnect();
