/**
 * A salaried hour must never end up carrying a frozen rate.
 *
 * Somebody on $63,000/yr is paid for their classes by that salary. Stamping a
 * rate onto those hours makes payroll pay for them a second time, on top of the
 * salary — and the stamp is sticky, so the overpayment survives every later
 * recalculation. It has escaped twice already (commit 594f7e2, then again in
 * migration 20260815091000), and both times the same way: not by anyone
 * changing the rule, which has always been right, but by the *query* feeding it
 * quietly stopping to select `baseSalary`. Without that field a salaried person
 * arrives at `rateContextFor` looking like an ordinary hourly one, and gets the
 * category rate stamped on.
 *
 * That is why these tests stub Prisma with a fake that honours `select` the way
 * a database does: it returns only the fields the query asked for. A test that
 * handed the service a fully-populated teacher would pass just as happily with
 * the broken query, which is exactly how this got through twice. Drop
 * `baseSalary` from either freezer's select and the salaried cases below fail.
 *
 * Run with: npm test --prefix server
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Set before the client is constructed, and unconditionally: server/.env points
// at the production database, and a stub that turns out to be missing must fail
// to connect rather than reach real payroll data. Port 1 is never listening.
process.env.DATABASE_URL = 'postgresql://tests:tests@127.0.0.1:1/unused';

const { default: prisma } = await import('../src/config/database.js');
const { freezeSessionRates, freezeShiftRates, invalidatePayCategories } =
  await import('../src/services/payroll.service.js');
const { invalidateClosures } = await import('../src/services/closures.service.js');

/**
 * Projects a fixture through a Prisma `select`, returning only what was asked
 * for — the whole point of this file. Nested selects recurse, and a to-many
 * relation is projected element by element.
 */
const project = (row, select) => {
  if (row == null) return row;
  const out = {};
  for (const [field, wanted] of Object.entries(select)) {
    if (!wanted) continue;
    const value = row[field];
    if (wanted === true) {
      out[field] = value;
      continue;
    }
    const nested = wanted.select || wanted;
    out[field] = Array.isArray(value)
      ? value.map((item) => project(item, nested))
      : project(value, nested);
  }
  return out;
};

// One category with a default rate, so an hourly person resolves to `category`
// — the same source that was wrongly stamped onto salaried hours in production.
const CATEGORIES = [
  { key: 'IN_PERSON', label: 'In-person class', defaultRate: '50', teaching: true, color: null, active: true, sortOrder: 10 },
];

const salaried = { id: 'p-salaried', hourlyRate: null, flatRateOnly: false, baseSalary: '63000', payRates: [] };
const hourly = { id: 'p-hourly', hourlyRate: null, flatRateOnly: false, baseSalary: null, payRates: [] };
// A salary of zero is the opposite of being salaried: it is somebody saying
// there is no salary here. The academy's owners are on it deliberately, and the
// editor writes it whenever an admin types 0 into the salary box meaning "none"
// — so this fixture is not a curiosity, it is what production holds.
const zeroSalary = { id: 'p-zero', hourlyRate: null, flatRateOnly: false, baseSalary: '0', payRates: [] };

const sessionFor = (teacher) => ({
  id: `s-${teacher.id}`,
  meetingUrl: null,
  payCategoryKey: 'IN_PERSON',
  payRateOverride: null,
  class: { type: 'IN_PERSON', meetingUrl: null, teacher },
});

const shiftFor = (staff) => ({
  id: `w-${staff.id}`,
  payCategoryKey: 'IN_PERSON',
  payRateOverride: null,
  staff,
});

const realMethods = {};
let writes;
let errors;
let realConsoleError;

before(() => {
  for (const [model, method] of [
    ['payCategory', 'findMany'], ['session', 'findMany'], ['session', 'update'],
    ['workShift', 'findMany'], ['workShift', 'update'], ['academyClosure', 'findMany'],
  ]) {
    realMethods[`${model}.${method}`] = prisma[model][method];
  }
  realMethods.$transaction = prisma.$transaction;
  realConsoleError = console.error;
});

after(async () => {
  for (const [key, fn] of Object.entries(realMethods)) {
    if (key === '$transaction') { prisma.$transaction = fn; continue; }
    const [model, method] = key.split('.');
    prisma[model][method] = fn;
  }
  console.error = realConsoleError;
  await prisma.$disconnect();
});

/**
 * Points the service at fixtures instead of a database.
 *
 * `freezeSessionRates` swallows every error it meets — a failed freeze is meant
 * to be survivable — so a stub that throws would look exactly like an hour
 * correctly skipped. Errors are captured and asserted on instead, so a broken
 * test fails loudly rather than passing for the wrong reason.
 */
const stubPrisma = ({ sessions = [], shifts = [], closures = [] }) => {
  writes = [];
  errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  prisma.payCategory.findMany = async () => CATEGORIES;
  // The freezer asks which days the academy was shut before it prices anything.
  // Unstubbed this reaches for a real database, and the failure is swallowed by
  // the freezer's own catch — so the test would pass by doing nothing at all.
  prisma.academyClosure.findMany = async () => closures;
  prisma.session.findMany = async ({ select }) => sessions.map((s) => project(s, select));
  prisma.workShift.findMany = async ({ select }) => shifts.map((s) => project(s, select));
  prisma.session.update = async (args) => { writes.push({ model: 'session', ...args }); return args; };
  prisma.workShift.update = async (args) => { writes.push({ model: 'workShift', ...args }); return args; };
  prisma.$transaction = async (ops) => Promise.all(ops);
};

beforeEach(() => {
  // Both lists are cached in-process with a TTL; without this the second test
  // would read whatever the first one left behind.
  invalidatePayCategories();
  invalidateClosures();
});

test('a salaried teacher never gets a rate frozen onto their session', async () => {
  stubPrisma({ sessions: [sessionFor(salaried)] });

  const frozen = await freezeSessionRates([sessionFor(salaried).id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 0, 'a salaried hour is covered by the salary — nothing to stamp');
  assert.deepEqual(writes, [], 'no rate may be written onto a salaried session');
});

test('an hourly teacher does get a rate frozen onto their session', async () => {
  // The control. Without it the test above would pass just as well against a
  // freezer that had stopped stamping anything at all.
  stubPrisma({ sessions: [sessionFor(hourly)] });

  const frozen = await freezeSessionRates([sessionFor(hourly).id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data, { paidRate: 50, paidRateSource: 'category' });
});

test('a salary of zero is not a salary — those hours are paid by the hour', async () => {
  // The trap this guards: `baseSalary != null` treats an agreed zero as "the
  // salary covers these hours", so a person on $0 works for nothing and the
  // payslip says "Covered by salary" about a salary that does not exist. It was
  // live — one teacher had $0 saved alongside a $20/hr online rate that could
  // never be reached.
  stubPrisma({ sessions: [sessionFor(zeroSalary)] });

  const frozen = await freezeSessionRates([sessionFor(zeroSalary).id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 1, 'nothing covers this hour, so it prices like any other hourly one');
  assert.deepEqual(writes[0].data, { paidRate: 50, paidRateSource: 'category' });
});

test('a salaried person never gets a rate frozen onto their shift', async () => {
  stubPrisma({ shifts: [shiftFor(salaried)] });

  const frozen = await freezeShiftRates([shiftFor(salaried).id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 0, 'a salaried hour is covered by the salary — nothing to stamp');
  assert.deepEqual(writes, [], 'no rate may be written onto a salaried shift');
});

test('an hourly person does get a rate frozen onto their shift', async () => {
  stubPrisma({ shifts: [shiftFor(hourly)] });

  const frozen = await freezeShiftRates([shiftFor(hourly).id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data, { paidRate: 50, paidRateSource: 'category' });
});

test('both freezers ask the database for baseSalary', async () => {
  // Belt and braces on top of the projecting stub above: this one names the
  // field, so a failure points straight at the line to fix instead of leaving
  // someone to work out why a salaried fixture suddenly looks hourly.
  const selects = [];
  stubPrisma({ sessions: [], shifts: [] });
  prisma.session.findMany = async ({ select }) => { selects.push(select.class.select.teacher.select); return []; };
  prisma.workShift.findMany = async ({ select }) => { selects.push(select.staff.select); return []; };

  await freezeSessionRates(['any']);
  await freezeShiftRates(['any']);

  assert.equal(selects.length, 2);
  for (const select of selects) {
    assert.equal(select.baseSalary, true, 'without baseSalary a salaried person is priced as hourly');
  }
});

/**
 * A covered hour belongs to whoever covered it, at their rate.
 *
 * The same failure as the salaried case above, one door over: the freezer used
 * to resolve every session from `class.teacher`, so an hour somebody else stood
 * in for got the class teacher's number stamped on it — permanently, and for a
 * person who was never on that contract. It is the bug `lineItem` already
 * guards co-teachers against, arriving through the substitute picker instead.
 */
// Paid $70 for this kind of work by their own arrangement, so the rate alone
// says which contract the freezer read.
const cover = {
  id: 'p-cover', hourlyRate: null, flatRateOnly: false, baseSalary: null,
  payRates: [{ category: 'IN_PERSON', hourlyRate: '70' }],
};

/** The same session, taught by somebody other than the class's teacher. */
const coveredBy = (substitute, classTeacher = hourly) => ({
  ...sessionFor(classTeacher),
  id: `s-covered-${substitute.id}`,
  teacher: substitute,
});

test('a substitute freezes at their own rate, not the class teacher’s', async () => {
  const session = coveredBy(cover);
  stubPrisma({ sessions: [session] });

  const frozen = await freezeSessionRates([session.id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 1);
  // $70 from the cover's own arrangement — not the $50 the class teacher's
  // category would have produced.
  assert.deepEqual(writes[0].data, { paidRate: 70, paidRateSource: 'teacher' });
});

test('a salaried substitute covering an hourly teacher’s class is stamped with nothing', async () => {
  // The expensive direction. Reading the class teacher here would stamp $50/hr
  // onto an hour already bought by the cover's salary — exactly the double
  // payment the salaried tests above exist to prevent.
  const session = coveredBy(salaried);
  stubPrisma({ sessions: [session] });

  const frozen = await freezeSessionRates([session.id]);

  assert.deepEqual(errors, [], 'the freeze should not have errored');
  assert.equal(frozen, 0);
  assert.deepEqual(writes, []);
});

test('the session freezer asks the database for the substitute, salary and all', async () => {
  // Same belt and braces as the baseSalary check above: the select is the part
  // that has quietly regressed before, and a fixture cannot catch it.
  let select;
  stubPrisma({ sessions: [] });
  prisma.session.findMany = async (args) => { select = args.select; return []; };

  await freezeSessionRates(['any']);

  assert.ok(select.teacher, 'without the session teacher a covered hour prices as the class teacher');
  assert.equal(select.teacher.select.baseSalary, true);
  assert.equal(select.teacher.select.payRates.select.hourlyRate, true);
});

test('an hour on a day the academy was shut is never stamped', async () => {
  // The reason closures exist at all. Freezing is what makes a price permanent,
  // so a holiday that slipped past the filter here would not just pay once — it
  // would pin the payment beyond the reach of the correction.
  //
  // The control is the test above: the same fixture, with nothing declared
  // closed, does get stamped. Only the closure changes between them.
  const closedDay = new Date('2026-11-26T00:00:00.000Z');
  stubPrisma({
    sessions: [sessionFor(hourly)],
    closures: [{ id: 'c1', date: closedDay, label: 'Thanksgiving', notes: null, createdById: null }],
  });

  let where;
  const passthrough = prisma.session.findMany;
  prisma.session.findMany = async (args) => { where = args.where; return passthrough(args); };

  await freezeSessionRates([sessionFor(hourly).id]);

  const excluded = where.AND.flatMap((c) => c.date?.notIn ?? []);
  assert.deepEqual(
    excluded.map((d) => d.toISOString().slice(0, 10)),
    ['2026-11-26'],
    'the freezer must ask the database to skip closed days'
  );
});
