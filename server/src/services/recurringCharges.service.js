/**
 * Turning standing arrangements into actual charges.
 *
 * A RecurringCharge says "this family owes $5 on the 1st of every month". Once
 * a month this raises the ordinary Transaction that the balance and the
 * invoices are built from. Nothing here invoices anybody: the charge lands on
 * the family's account and an admin decides when it goes out on paper, which
 * is what keeps twelve separate $5 IXL invoices from existing.
 */

import prisma from '../config/database.js';

/** "2026-08" — the month a charge covers, and the key that makes it unique. */
export const periodKeyFor = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * The day this arrangement falls due in a given month.
 *
 * A family billed on the 31st is billed on the 28th of February, not skipped:
 * "the 31st" is how people say "end of month", and dropping the month entirely
 * would quietly under-bill them once a year.
 */
export const dueDayFor = (dayOfMonth, year, monthIndex) => {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(dayOfMonth, daysInMonth);
};

/**
 * Which arrangements owe a charge for `asOf`'s month, and which already have one.
 *
 * Split out from the writing half so the same reasoning can be shown to an
 * admin before anything is billed — money is the one place where "run it and
 * see" is not an acceptable way to find out what a job does.
 */
export const findDueCharges = async (asOf = new Date()) => {
  // Normalised to UTC midnight because `date` columns are stored that way, so
  // both sides of every comparison below are built alike.
  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const periodKey = periodKeyFor(today);

  const arrangements = await prisma.recurringCharge.findMany({
    where: {
      active: true,
      startDate: { lte: today },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
    include: {
      family: { select: { id: true, name: true } },
      student: { select: { id: true, fullName: true } },
      // Only this month's charge matters; the rest of the history is noise here.
      transactions: { where: { periodKey }, select: { id: true } },
    },
  });

  const due = [];
  const notYet = [];
  const alreadyCharged = [];

  for (const arrangement of arrangements) {
    if (arrangement.transactions.length > 0) {
      alreadyCharged.push(arrangement);
      continue;
    }
    const dueDay = dueDayFor(arrangement.dayOfMonth, today.getUTCFullYear(), today.getUTCMonth());
    // Due today or overdue within the month — an arrangement whose day passed
    // while the server was down still gets raised on the next run rather than
    // waiting for next month.
    if (today.getUTCDate() >= dueDay) due.push({ ...arrangement, dueDay });
    else notYet.push({ ...arrangement, dueDay });
  }

  return { periodKey, today, due, notYet, alreadyCharged };
};

/**
 * Raises this month's charges. Safe to run twice, and safe to run late.
 *
 * Each charge is written on its own rather than in one transaction: a family
 * whose row somehow fails must not stop the other twenty from being billed,
 * and the unique index means the failed one can simply be retried.
 */
export const runRecurringCharges = async (asOf = new Date()) => {
  const { periodKey, today, due, alreadyCharged } = await findDueCharges(asOf);

  const created = [];
  const skipped = [];
  const failed = [];

  for (const arrangement of due) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), arrangement.dueDay));
    try {
      const tx = await prisma.transaction.create({
        data: {
          familyId: arrangement.familyId,
          studentId: arrangement.studentId,
          amount: arrangement.amount,
          type: 'CHARGE',
          description: arrangement.description,
          date,
          recurringChargeId: arrangement.id,
          periodKey,
        },
      });
      created.push({ id: tx.id, family: arrangement.family?.name, amount: Number(arrangement.amount), description: arrangement.description });
    } catch (error) {
      // P2002 is the unique index doing its job — another run got there first.
      // That is success, not failure: the family is charged exactly once.
      if (error.code === 'P2002') skipped.push(arrangement.id);
      else failed.push({ id: arrangement.id, family: arrangement.family?.name, message: error.message });
    }
  }

  return {
    periodKey,
    created,
    createdCount: created.length,
    // Already charged before this run, plus any the index caught mid-run.
    skippedCount: alreadyCharged.length + skipped.length,
    failed,
  };
};
