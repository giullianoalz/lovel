/**
 * Reassigning a class must not rewrite the classes it already ran.
 *
 * The teacher lives on the Class and the roster lives on the Class, so both
 * were live answers to questions about the past: changing the teacher moved
 * every hour already taught onto the new person's payslip, and changing the
 * roster restated who had been in the room. For months already paid, that is
 * money attributed to somebody who did not earn it.
 *
 * The fix is one column on each side — `Session.teacherId` and
 * `ClassEnrollment.endedAt` — both null until the fact stops being true. These
 * tests hold the readers to that: the where clauses payroll selects hours with,
 * and the roster filter the calendar shows a past session's names through.
 *
 * Run with: npm test --prefix server
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://tests:tests@127.0.0.1:1/unused';

const { taughtByWhere, notHandedOverWhere, handedOverToWhere } = await import(
  '../src/services/payroll.service.js'
);
const { rosterOn, teachersOnSession } = await import('../src/controllers/sessions.controller.js');

const ANA = 'ana-id';
const BEN = 'ben-id';

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

// A fixed instant to judge "past" against, so these pass whenever they are run.
const NOW = new Date('2026-09-02T16:00:00.000Z');

// ── Whose hour is it ────────────────────────────────────────────────────────

test('an unstamped session belongs to whoever holds the class', () => {
  assert.deepEqual(
    teachersOnSession({ teacherId: null, class: { teacherId: ANA, coTeachers: [] } }),
    [ANA]
  );
});

test('a stamped session belongs to the teacher named on it, not the class', () => {
  // Ana taught it; Ben has since taken the class over. The hour stays Ana's.
  assert.deepEqual(
    teachersOnSession({ teacherId: ANA, class: { teacherId: BEN, coTeachers: [] } }),
    [ANA]
  );
});

test('co-teachers come from the class whether or not the hour is stamped', () => {
  const withCo = teachersOnSession({
    teacherId: ANA,
    class: { teacherId: BEN, coTeachers: [{ id: 'co-id' }] },
  });
  assert.deepEqual(withCo, [ANA, 'co-id']);
});

// ── What payroll selects ────────────────────────────────────────────────────

test('the flat filter finds an hour by its stamp, by its class, or by co-teaching', () => {
  const { OR } = taughtByWhere(ANA);
  assert.deepEqual(OR, [
    { teacherId: ANA },
    { teacherId: null, class: { teacherId: ANA } },
    { class: { coTeachers: { some: { id: ANA } } } },
  ]);
});

test("a class's own sessions exclude the ones stamped to somebody else", () => {
  const base = { date: { gte: day('2026-08-01') } };
  const where = notHandedOverWhere(base, BEN);
  // The base filter survives intact — the handover test is added to it, never
  // in place of it, or an unelapsed hour would start paying.
  assert.deepEqual(where.AND[0], base);
  assert.deepEqual(where.AND[1], { OR: [{ teacherId: null }, { teacherId: BEN }] });
});

test('the hours a teacher kept through a handover are found on classes that are no longer theirs', () => {
  const base = { date: { gte: day('2026-08-01') } };
  const where = handedOverToWhere(base, ANA);
  assert.deepEqual(where.AND[1], { teacherId: ANA });
  // Without the NOT, an hour stamped to Ana on a class Ana still holds would
  // arrive twice: once through her class list and once through this query.
  assert.deepEqual(where.AND[2], {
    NOT: { class: { OR: [{ teacherId: ANA }, { coTeachers: { some: { id: ANA } } }] } },
  });
});

// ── Who was in the room ─────────────────────────────────────────────────────

const enrolment = (props) => ({ status: 'active', enrolledAt: null, endedAt: null, ...props });

test('a child enrolled after the session is not shown in it', () => {
  const roster = rosterOn(
    [enrolment({ enrolledAt: day('2026-08-20'), student: { id: 'late' } })],
    day('2026-08-05')
  );
  assert.deepEqual(roster, []);
});

test('an enrolment recorded the same day still counts — an import is not an absence', () => {
  // Imported rosters carry the day of the import, not the day the child joined.
  // A row stamped hours after that morning's class must not empty its register.
  const roster = rosterOn(
    [enrolment({ enrolledAt: new Date('2026-08-05T21:00:00.000Z'), student: { id: 'imported' } })],
    day('2026-08-05')
  );
  assert.equal(roster.length, 1);
});

test('a child who has left is still on the register of the classes they sat through', () => {
  const left = enrolment({
    status: 'inactive',
    enrolledAt: day('2026-08-01'),
    endedAt: day('2026-09-01'),
    student: { id: 'gone' },
  });
  assert.equal(rosterOn([left], day('2026-08-15')).length, 1);
  assert.equal(rosterOn([left], day('2026-09-15')).length, 0);
});

test('an old unenrolment with no leaving date reads as "left at some point"', () => {
  // Rows that predate the column cannot say when the child left. Shown on
  // sessions already run — erasing them would delete a child from meetings they
  // demonstrably attended — and hidden from today onwards, because a child who
  // left months ago does not belong on tomorrow's register.
  const legacy = enrolment({ status: 'inactive', student: { id: 'legacy' } });
  assert.equal(rosterOn([legacy], day('2026-08-15'), NOW).length, 1);
  assert.equal(rosterOn([legacy], day('2026-09-20'), NOW).length, 0);
});

test('an active enrolment with no dates at all shows on every session', () => {
  const plain = [enrolment({ student: { id: 'plain' } })];
  assert.equal(rosterOn(plain, day('2026-08-15'), NOW).length, 1);
  assert.equal(rosterOn(plain, day('2026-09-20'), NOW).length, 1);
});
