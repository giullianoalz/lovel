/**
 * What the academy still owes a member of staff.
 *
 * Every other payroll screen answers "what did this period cost". None of them
 * could reach zero, because pay accrues from the calendar and nothing recorded
 * the money going back out — so a total was always a period, never a debt.
 *
 * This is the other half. Earnings stay computed, hour by hour, exactly as they
 * were; payments are the one thing payroll writes down. The balance is the
 * subtraction, and a ledger is that subtraction shown line by line so an admin
 * can see how it got where it is rather than being handed a number.
 *
 * Three kinds of line appear in it:
 *
 *   - an hour worked, priced by the same engine that prices every other payroll
 *     screen (see payroll.service.js). Never stored, so correcting a calendar
 *     entry still corrects the pay it produced, everywhere, retroactively;
 *   - a month of salary, accrued once the month has ended. Salaried people earn
 *     nothing per hour — the salary is what pays for those hours — so without
 *     this their balance would sit at zero while they were owed a wage;
 *   - a payment or an adjustment, which are the rows in `teacher_payments`.
 */

import prisma from '../config/database.js';
import {
  computeTeacherPayroll,
  computeEarnedToDate,
  monthlySalary,
  LEDGER_EPOCH,
} from './payroll.service.js';
import { academyToday } from '../utils/academyTime.js';

const round2 = (n) => Math.round(n * 100) / 100;

const toNumber = (value) => (value == null ? 0 : parseFloat(value));

const isoDate = (date) => new Date(date).toISOString().slice(0, 10);

/** The last day of the month containing `date`, at UTC midnight. */
const endOfMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const PAYOUT_LABELS = {
  CASH: 'Cash',
  CHECK: 'Check',
  ZELLE: 'Zelle',
  VENMO: 'Venmo',
  PAYPAL: 'PayPal',
  DIRECT_DEPOSIT: 'Direct deposit',
  OTHER: 'Other',
};

/**
 * A salaried person's wage, month by month.
 *
 * Their hours price at nothing on purpose — the salary is what pays for them —
 * so a ledger built from hours alone would show somebody on $63,000 a year
 * owed nothing at all. These lines are what they are actually owed.
 *
 * Accrued on the last day of each month, and only for months that have already
 * ended: a salary is earned by finishing the month, and half of September is
 * not half a salary until September is over.
 *
 * It starts at `from` — the month of their first hour on the calendar, chosen
 * by the caller — because nothing on record says when a salary began. That is a
 * guess, and the only one in the ledger: somebody put on salary in June should
 * not be shown a year of back pay. It is a guess an admin can settle in one
 * line, with an ADJUSTMENT, which is what adjustments are for.
 */
export const salaryAccruals = (person, from, asOf) => {
  const monthly = monthlySalary(person.baseSalary, person.salaryPeriod);
  if (!(monthly > 0) || !from) return [];

  const agreed = Number(person.baseSalary);
  const lines = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= asOf) {
    const closes = endOfMonth(cursor);
    // The month has to have finished. `asOf` inside it means the salary is
    // being earned right now, not that it is owed.
    if (closes > asOf) break;
    lines.push({
      id: `salary-${closes.getUTCFullYear()}-${closes.getUTCMonth() + 1}`,
      kind: 'salary',
      date: isoDate(closes),
      time: null,
      description: `Salary — ${MONTH_NAMES[closes.getUTCMonth()]} ${closes.getUTCFullYear()}`,
      detail:
        person.salaryPeriod === 'ANNUAL'
          ? `One twelfth of $${agreed.toLocaleString('en-US')} a year`
          : 'Agreed monthly salary',
      income: monthly,
      payment: 0,
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return lines;
};

/** A stored payment or adjustment, as a ledger line. */
export const paymentLine = (p) => {
  const amount = toNumber(p.amount);
  const adjustment = p.kind === 'ADJUSTMENT';
  return {
    id: p.id,
    kind: adjustment ? 'adjustment' : 'payment',
    date: isoDate(p.paidAt),
    time: null,
    description: adjustment
      ? p.notes || 'Adjustment'
      : `Payment${p.method ? ` — ${PAYOUT_LABELS[p.method] || p.method}` : ''}`,
    detail:
      [
        p.reference,
        adjustment ? null : p.notes,
        p.recordedBy?.fullName ? `recorded by ${p.recordedBy.fullName}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    // An adjustment is signed and a payment is not. A positive adjustment is
    // money owed that no hour accounts for — a bonus, an opening balance — so
    // it lands in the income column; a negative one is the ledger being told it
    // has overstated, and reads as a payment.
    income: adjustment && amount > 0 ? amount : 0,
    payment: adjustment ? (amount < 0 ? -amount : 0) : amount,
    // The only lines an admin can edit. Everything else is a calendar entry,
    // and is corrected on the calendar.
    editable: true,
    method: p.method || null,
    reference: p.reference || null,
    notes: p.notes || null,
    paymentKind: p.kind,
    amount,
  };
};

/**
 * One person's ledger: every hour they have earned, every dollar they have been
 * paid, and the balance after each.
 *
 * Sorted oldest-first to compute the running balance, then handed back
 * newest-first, because the row anybody actually wants is the last thing that
 * happened.
 */
export const computeTeacherLedger = async (teacherId, { asOf = academyToday() } = {}) => {
  const now = new Date();
  const [statement, payments] = await Promise.all([
    // Priced over all of time rather than a month: a balance that starts on the
    // 1st is a balance that forgets last month's unpaid week.
    computeTeacherPayroll(teacherId, now.getMonth() + 1, now.getFullYear(), {
      startDate: LEDGER_EPOCH,
      endDate: asOf,
    }),
    prisma.teacherPayment.findMany({
      where: { teacherId },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      include: { recordedBy: { select: { fullName: true } } },
    }),
  ]);

  const worked = statement.payroll.lineItems.map((l) => ({
    id: l.id,
    kind: l.kind, // 'session' | 'shift'
    date: isoDate(l.date),
    time: l.startTime ? new Date(l.startTime).toISOString().slice(11, 16) : null,
    description: l.title,
    detail: [
      l.categoryLabel,
      `${l.hours} h`,
      l.rate ? `$${l.rate.toFixed(2)}/h` : 'no rate set',
      l.role === 'co-teacher' ? 'co-teacher' : null,
      l.lateCancelled ? 'late cancellation' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    income: l.amount,
    payment: 0,
    hours: l.hours,
    rate: l.rate,
    rateSource: l.rateSource,
    categoryLabel: l.categoryLabel,
    categoryColor: l.categoryColor,
  }));

  // Salary starts accruing from the month of their first hour, which is the
  // closest thing on record to the month they started. See salaryAccruals.
  const firstWorked = worked.length
    ? worked.reduce((min, l) => (l.date < min ? l.date : min), worked[0].date)
    : null;
  const firstPaid = payments.length ? isoDate(payments[0].paidAt) : null;
  const firstDate = [firstWorked, firstPaid].filter(Boolean).sort()[0] || null;

  const salary = salaryAccruals(
    {
      baseSalary: statement.payroll.salaryAmount,
      salaryPeriod: statement.payroll.salaryPeriod,
    },
    firstDate ? new Date(`${firstDate}T00:00:00Z`) : null,
    asOf
  );

  const entries = [...worked, ...salary, ...payments.map(paymentLine)].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.time || '').localeCompare(String(b.time || '')) ||
      // A payment made on the day an hour was worked settles it, so it comes
      // after: the balance should dip to zero, not go negative and back.
      (a.payment ? 1 : 0) - (b.payment ? 1 : 0)
  );

  let balance = 0;
  for (const entry of entries) {
    balance = round2(balance + entry.income - entry.payment);
    entry.balance = balance;
  }

  const earned = round2(entries.reduce((n, e) => n + e.income, 0));
  const paid = round2(entries.reduce((n, e) => n + e.payment, 0));

  return {
    teacher: statement.teacher,
    asOf: isoDate(asOf),
    summary: {
      earned,
      paid,
      balance: round2(earned - paid),
      hourlyEarned: round2(worked.reduce((n, e) => n + e.income, 0)),
      salaryEarned: round2(salary.reduce((n, e) => n + e.income, 0)),
      totalHours: round2(worked.reduce((n, e) => n + (e.hours || 0), 0)),
      entryCount: entries.length,
      paymentCount: payments.length,
      // Hours priced at nothing. They sit in the ledger at $0 and make the
      // balance too low, which on this screen looks like a debt already
      // settled — so it is said out loud rather than left inside a total.
      unratedHours: statement.payroll.unratedHours,
      lastPaidAt: payments.length ? isoDate(payments[payments.length - 1].paidAt) : null,
    },
    // Newest first, the way a statement is read.
    entries: entries.reverse(),
  };
};

/**
 * The whole roster's outstanding balance.
 *
 * The first thing an admin sees on payday: who is owed what, right now, rather
 * than what a particular month happened to cost. One roster-wide pricing pass
 * and one grouped query over payments — not the ledger in a loop, which would
 * be a full statement per person to display a single number each.
 *
 * Salary is left out of these numbers. It accrues month by month inside the
 * ledger, and reproducing that here would mean walking every month of every
 * salaried person's history to fill one column. Salaried staff are marked
 * instead, so the screen can send you to their ledger rather than quietly
 * showing a balance that is missing a wage.
 */
export const computePayrollBalances = async ({ asOf = academyToday() } = {}) => {
  const [summary, paid] = await Promise.all([
    computeEarnedToDate(asOf),
    prisma.teacherPayment.groupBy({
      by: ['teacherId'],
      where: { paidAt: { gte: LEDGER_EPOCH, lte: asOf } },
      _sum: { amount: true },
      _max: { paidAt: true },
      _count: { _all: true },
    }),
  ]);

  const paidBy = new Map(
    paid.map((p) => [
      p.teacherId,
      { paid: round2(toNumber(p._sum.amount)), count: p._count._all, lastPaidAt: p._max.paidAt },
    ])
  );

  const rows = summary.rows.map((row) => {
    const payments = paidBy.get(row.teacher.id) || { paid: 0, count: 0, lastPaidAt: null };
    return {
      teacher: row.teacher,
      rateSetup: row.rateSetup,
      hourlyRate: row.hourlyRate,
      salaryAmount: row.salaryAmount,
      salaryPeriod: row.salaryPeriod,
      // Hourly only, all-time. See the note above about salary.
      earned: row.hourlyEarnings,
      totalHours: row.totalHours,
      unratedHours: row.unratedHours,
      paid: payments.paid,
      paymentCount: payments.count,
      lastPaidAt: payments.lastPaidAt ? isoDate(payments.lastPaidAt) : null,
      balance: round2(row.hourlyEarnings - payments.paid),
      // True when this row's balance is knowably incomplete, so the screen can
      // say so instead of showing a confident wrong number.
      salaried: row.rateSetup === 'salaried',
    };
  });

  // Somebody who has been paid but has no hours on the calendar — every
  // salaried person before their ledger is opened, and anyone who has left.
  // Their payments are real and would otherwise vanish from the totals.
  const known = new Set(rows.map((r) => r.teacher.id));
  const orphans = [...paidBy.keys()].filter((id) => !known.has(id));
  if (orphans.length) {
    const people = await prisma.user.findMany({
      where: { id: { in: orphans } },
      select: { id: true, fullName: true, email: true, avatarUrl: true, status: true, role: true },
    });
    for (const person of people) {
      const payments = paidBy.get(person.id);
      rows.push({
        teacher: person,
        rateSetup: 'unset',
        hourlyRate: null,
        salaryAmount: null,
        salaryPeriod: null,
        earned: 0,
        totalHours: 0,
        unratedHours: 0,
        paid: payments.paid,
        paymentCount: payments.count,
        lastPaidAt: payments.lastPaidAt ? isoDate(payments.lastPaidAt) : null,
        balance: round2(-payments.paid),
        salaried: false,
      });
    }
  }

  rows.sort(
    (a, b) => b.balance - a.balance || a.teacher.fullName.localeCompare(b.teacher.fullName)
  );

  return {
    asOf: isoDate(asOf),
    rows,
    totals: {
      people: rows.length,
      owed: round2(rows.filter((r) => r.balance > 0).reduce((n, r) => n + r.balance, 0)),
      earned: round2(rows.reduce((n, r) => n + r.earned, 0)),
      paid: round2(rows.reduce((n, r) => n + r.paid, 0)),
      // People with money outstanding, which is the count that matters on
      // payday — not how many are on the roster.
      owedPeople: rows.filter((r) => r.balance > 0).length,
      salariedPeople: rows.filter((r) => r.salaried).length,
    },
  };
};

/** Records money going out, or an adjustment to make the ledger tell the truth. */
export const recordTeacherPayment = async (teacherId, input, recordedById) =>
  prisma.teacherPayment.create({
    data: {
      teacherId,
      kind: input.kind === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'PAYMENT',
      amount: input.amount,
      method: input.method || null,
      paidAt: new Date(`${input.paidAt}T00:00:00Z`),
      reference: input.reference || null,
      notes: input.notes || null,
      recordedById,
    },
    include: { recordedBy: { select: { fullName: true } } },
  });

/**
 * Corrects a payment in place.
 *
 * An UPDATE, never a delete and a re-create: the row is the record that money
 * moved, and replacing it with a new one loses when it was first written and
 * who wrote it.
 */
export const updateTeacherPayment = async (paymentId, input) =>
  prisma.teacherPayment.update({
    where: { id: paymentId },
    data: {
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.method !== undefined && { method: input.method || null }),
      ...(input.paidAt !== undefined && { paidAt: new Date(`${input.paidAt}T00:00:00Z`) }),
      ...(input.reference !== undefined && { reference: input.reference || null }),
      ...(input.notes !== undefined && { notes: input.notes || null }),
      ...(input.kind !== undefined && { kind: input.kind }),
    },
    include: { recordedBy: { select: { fullName: true } } },
  });

export const deleteTeacherPayment = async (paymentId) =>
  prisma.teacherPayment.delete({ where: { id: paymentId } });

export const findTeacherPayment = async (paymentId) =>
  prisma.teacherPayment.findUnique({ where: { id: paymentId } });
