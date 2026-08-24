/**
 * The line between what is owed and what is only booked.
 *
 * Payroll prices hours off the calendar, which is what makes a forecast
 * possible at all: the hours next month are already there, already carry a
 * category, and already price themselves. The projection is the earned
 * calculation with one test removed — has the hour finished — so the risk it
 * introduces is not a wrong total but a *mixed* one: a future hour leaking into
 * the payslip screen would pay somebody for work they have not done yet, and
 * the frozen-rate machinery would then make that permanent.
 *
 * So these tests hold the two filters apart, and hold `hasElapsed` to the same
 * answer the database gives — it is the in-memory copy of the `elapsed` where
 * clause, and the earned/upcoming split on every projected line is built on it.
 *
 * Run with: npm test --prefix server
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://tests:tests@127.0.0.1:1/unused';

const {
  hasElapsed,
  payableSessionWhere,
  scheduledSessionsWhere,
  scheduledShiftsWhere,
} = await import('../src/services/payroll.service.js');

/** A TIME column as Prisma returns one: a wall clock on a placeholder day. */
const at = (hh, mm = 0) => new Date(Date.UTC(1970, 0, 1, hh, mm));

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

// Midday on the 15th, academy time. Everything below is placed either side of
// it. The academy runs on a fixed zone, so an explicit instant keeps this test
// from passing or failing depending on when it is run.
const NOON = new Date('2026-08-15T16:00:00.000Z');

test('an hour that has not happened yet is not owed', () => {
  assert.equal(hasElapsed({ date: day('2026-08-20'), endTime: at(10) }, NOON), false);
});

test('an hour on an earlier day is owed whatever time it ended', () => {
  assert.equal(hasElapsed({ date: day('2026-08-14'), endTime: at(23, 59) }, NOON), true);
});

test('today splits on the end time, not the start', () => {
  const today = day('2026-08-15');
  // A class that ran this morning is finished and therefore owed.
  assert.equal(hasElapsed({ date: today, endTime: at(11) }, NOON), true);
  // One that is running right now is not — it is paid when its hour ends, and
  // paying halfway through would pay for time nobody has worked.
  assert.equal(hasElapsed({ date: today, endTime: at(17) }, NOON), false);
});

test('the payslip filter asks about the clock and the forecast does not', () => {
  const start = day('2026-08-01');
  const end = day('2026-08-31');

  const earned = payableSessionWhere(NOON);
  const projected = scheduledSessionsWhere(start, end);

  // `elapsed` is the OR-of-two-halves inside the AND. Its presence is the only
  // difference between the two, and the whole correctness of the split.
  assert.ok(earned.AND.some((clause) => 'OR' in clause && clause.OR.some((c) => 'date' in c)));
  assert.equal('AND' in projected, false);

  // What the two agree on, and must keep agreeing on: an absence is money
  // deliberately taken off a payslip, and a forecast that ignored it would
  // promise somebody hours that have already been struck off.
  assert.equal(earned.absentAt, null);
  assert.equal(projected.absentAt, null);

  // Both keep the late-cancellation bargain: a slot cancelled too late to
  // refill is still owed to the person who held it.
  assert.ok(earned.AND.some((clause) => clause.OR?.some((c) => c.cancellations)));
  assert.ok(projected.OR.some((c) => c.cancellations));
});

test('the forecast is bounded to the window it was asked for', () => {
  const start = day('2026-09-01');
  const end = day('2026-09-30');
  const where = scheduledSessionsWhere(start, end);

  assert.deepEqual(where.date, { gte: start, lte: end });
});

test('a cancelled shift is not forecast, and neither is an absent one', () => {
  const where = scheduledShiftsWhere(day('2026-09-01'), day('2026-09-30'));

  assert.deepEqual(where.status, { not: 'CANCELLED' });
  assert.equal(where.absentAt, null);
  // Shifts have no late-cancellation bargain — nobody holds a front desk slot
  // open for a student — so the forecast must not invent one.
  assert.equal('OR' in where, false);
});
