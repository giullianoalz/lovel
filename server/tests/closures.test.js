/**
 * Days the academy did not open.
 *
 * Pay accrues from the calendar with nobody in the loop, which is the whole
 * point of it and also its one blind spot: on Thanksgiving the meetings sit on
 * the timetable, nobody comes in, and every one of them pays and bills itself.
 * The audit that prompted this found 43 live sessions across six holidays.
 *
 * What is worth testing here is not that a filter exists but that it cannot be
 * bypassed by the shape of the query. The closure has to survive being combined
 * with a date range, with an OR-group, and with the optional filters the
 * charging service builds — because each of those is a place where a naive
 * `date` key would silently replace the one already there and quietly widen the
 * result back out to every day of the year.
 *
 * Run with: npm test --prefix server
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://tests:tests@127.0.0.1:1/unused';

const {
  payableSessionWhere,
  paidSessionsWhere,
  paidShiftsWhere,
  absentSessionsWhere,
  scheduledSessionsWhere,
  scheduledShiftsWhere,
} = await import('../src/services/payroll.service.js');

const { expandRange, isoDay, dayToDate, MAX_RANGE_DAYS } =
  await import('../src/services/closures.service.js');

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const NOON = new Date('2026-11-26T17:00:00.000Z');

const THANKSGIVING = [day('2026-11-26'), day('2026-11-27')];

/** Every `date: { notIn }` anywhere in a where clause, flattened. */
const notInDates = (where) => {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.date?.notIn) found.push(...node.date.notIn);
    Object.values(node).forEach(walk);
  };
  walk(where);
  return found.map(isoDay);
};

// ─── the filter reaches every builder ────────────────────────────────────────

test('every payroll filter excludes the closed days it is given', () => {
  const start = day('2026-11-01');
  const end = day('2026-11-30');
  const builders = {
    payableSessionWhere: payableSessionWhere(NOON, THANKSGIVING),
    paidSessionsWhere: paidSessionsWhere(start, end, NOON, THANKSGIVING),
    paidShiftsWhere: paidShiftsWhere(start, end, NOON, THANKSGIVING),
    absentSessionsWhere: absentSessionsWhere(start, end, NOON, THANKSGIVING),
    scheduledSessionsWhere: scheduledSessionsWhere(start, end, THANKSGIVING),
    scheduledShiftsWhere: scheduledShiftsWhere(start, end, THANKSGIVING),
  };

  for (const [name, where] of Object.entries(builders)) {
    assert.deepEqual(
      notInDates(where),
      ['2026-11-26', '2026-11-27'],
      `${name} does not exclude the closed days`
    );
  }
});

// ─── the date range survives ─────────────────────────────────────────────────

test('excluding closed days does not clobber the range that was asked for', () => {
  // The bug this guards: expressing the closure as a `date` key would replace
  // the gte/lte already set by the caller, turning "November" into "every day
  // that is not Thanksgiving" — a payslip covering all of history.
  const start = day('2026-11-01');
  const end = day('2026-11-30');

  for (const where of [
    paidSessionsWhere(start, end, NOON, THANKSGIVING),
    paidShiftsWhere(start, end, NOON, THANKSGIVING),
    absentSessionsWhere(start, end, NOON, THANKSGIVING),
    scheduledSessionsWhere(start, end, THANKSGIVING),
    scheduledShiftsWhere(start, end, THANKSGIVING),
  ]) {
    assert.equal(where.date.gte, start);
    assert.equal(where.date.lte, end);
  }
});

test('the clock and cancellation tests are still applied alongside a closure', () => {
  // payableSessionWhere ANDs three things together. A closure appended
  // carelessly could replace that array rather than extend it, which would pay
  // next week's classes today.
  const where = payableSessionWhere(NOON, THANKSGIVING);
  assert.equal(where.absentAt, null);
  assert.equal(where.AND.length, 3, 'elapsed, stillWorked and the closure must all survive');
  assert.ok(where.AND.some((c) => c.OR?.some((o) => o.status)), 'the cancellation rule is missing');
});

// ─── no closures declared is the old behaviour, exactly ──────────────────────

test('with nothing declared closed the filters are unchanged', () => {
  // Every existing database has an empty table, so this is the promise that
  // installing the feature moves nobody's pay by a cent.
  const start = day('2026-11-01');
  const end = day('2026-11-30');

  assert.deepEqual(payableSessionWhere(NOON), payableSessionWhere(NOON, []));
  assert.equal(payableSessionWhere(NOON, []).AND.length, 2);

  for (const where of [
    paidSessionsWhere(start, end, NOON),
    paidShiftsWhere(start, end, NOON),
    scheduledSessionsWhere(start, end),
    scheduledShiftsWhere(start, end),
  ]) {
    assert.deepEqual(notInDates(where), [], 'an empty closure list must add no filter');
  }
});

test('an empty closure list adds no key at all, not an empty one', () => {
  // `notIn: []` and `AND: []` are filters the database still has to evaluate,
  // and an empty AND appearing on the forecast filter would break the invariant
  // the projection tests rely on to tell the two filters apart.
  const where = paidShiftsWhere(day('2026-11-01'), day('2026-11-30'), NOON, []);
  assert.equal('AND' in where, false);
  assert.equal(where.date.notIn, undefined);
  assert.equal('AND' in scheduledSessionsWhere(day('2026-11-01'), day('2026-11-30')), false);
});

// ─── ranges expand to days ───────────────────────────────────────────────────

test('a range becomes one day per closed date, inclusive at both ends', () => {
  const { days } = expandRange('2026-11-25', '2026-11-27');
  assert.deepEqual(days, ['2026-11-25', '2026-11-26', '2026-11-27']);
});

test('a single day needs no end date', () => {
  const { days } = expandRange('2026-11-26');
  assert.deepEqual(days, ['2026-11-26']);
});

test('a range crossing a month and a year boundary stays whole', () => {
  // Winter break is the case that spans a year end, and the naive loop that
  // increments a day-of-month rather than a date breaks exactly here.
  const { days } = expandRange('2026-12-30', '2027-01-02');
  assert.deepEqual(days, ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('a backwards range is refused rather than silently returning nothing', () => {
  const { error, days } = expandRange('2026-11-27', '2026-11-25');
  assert.ok(error, 'endDate before startDate must be an error');
  assert.equal(days, undefined);
});

test('a range longer than the cap is refused', () => {
  // A typo in the year turns one request into thousands of rows.
  const { error } = expandRange('2026-01-01', '2027-01-01');
  assert.ok(error);
  assert.match(error, new RegExp(String(MAX_RANGE_DAYS)));
});

test('a range exactly at the cap is allowed', () => {
  const start = day('2026-01-01');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + MAX_RANGE_DAYS - 1);
  const { days, error } = expandRange(isoDay(start), isoDay(end));
  assert.equal(error, undefined);
  assert.equal(days.length, MAX_RANGE_DAYS);
});

// ─── days are days, not instants ─────────────────────────────────────────────

test('a closed day is read off the calendar, not off a clock', () => {
  // The academy runs on US Eastern. A DATE column read as a local instant lands
  // on the previous evening, and the closure would then apply to the wrong day
  // — the failure mode the timezone policy exists to prevent.
  assert.equal(isoDay(dayToDate('2026-11-26')), '2026-11-26');
  assert.equal(dayToDate('2026-11-26').toISOString(), '2026-11-26T00:00:00.000Z');
  assert.equal(isoDay(new Date('2026-11-26T23:59:59.000Z')), '2026-11-26');
});
