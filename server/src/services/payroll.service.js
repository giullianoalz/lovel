/**
 * What a member of staff earned, and why.
 *
 * Pay is hourly, and the hour is priced by the kind of work it was: an hour at
 * the front desk, an hour of private tutoring and an hour of in-person class
 * are three different rates. The kind of work is chosen on the calendar entry,
 * so scheduling somebody is the same act as deciding what that hour costs.
 *
 * The output is deliberately a breakdown rather than a number, down to one line
 * per entry: an admin signing off payroll needs to see which hours were counted
 * at which rate and where that rate came from. A single total nobody can
 * reconstruct is a total nobody can defend.
 */

import prisma from '../config/database.js';
import { resolveMeetingUrl } from '../utils/meetingLink.js';
import { academyNowParts } from '../utils/academyTime.js';
import { CANCELLATION_WINDOW_HOURS } from '../constants/cancellationPolicy.js';

/**
 * The categories, if the table is empty or unreachable.
 *
 * These two keys are what the engine used to infer from the presence of a
 * meeting link, and they are seeded into `pay_categories` by the migration.
 * Kept here so a fresh database still prices a session rather than throwing.
 */
export const FALLBACK_CATEGORIES = [
  { key: 'IN_PERSON', label: 'In-person class', defaultRate: null, teaching: true, color: '#6366f1', sortOrder: 10 },
  { key: 'ONLINE', label: 'Online session', defaultRate: null, teaching: true, color: '#0ea5e9', sortOrder: 20 },
];

// The category list changes when an admin edits it, which is rarely, and it is
// read on every payroll query, which is often. Cached in-process with a short
// TTL, and dropped outright whenever the list is written — see
// invalidatePayCategories(), called from the categories controller.
let categoryCache = null;
let categoryCacheAt = 0;
const CATEGORY_TTL_MS = 60_000;

export const invalidatePayCategories = () => {
  categoryCache = null;
  categoryCacheAt = 0;
};

/** Every pay category, active first, as plain objects with numeric rates. */
export const loadPayCategories = async ({ includeInactive = true } = {}) => {
  if (!categoryCache || Date.now() - categoryCacheAt > CATEGORY_TTL_MS) {
    const rows = await prisma.payCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    categoryCache = (rows.length ? rows : FALLBACK_CATEGORIES).map((c) => ({
      key: c.key,
      label: c.label,
      defaultRate: c.defaultRate == null ? null : parseFloat(c.defaultRate),
      teaching: Boolean(c.teaching),
      color: c.color ?? null,
      active: c.active ?? true,
      sortOrder: c.sortOrder ?? 0,
    }));
    categoryCacheAt = Date.now();
  }
  return includeInactive ? categoryCache : categoryCache.filter((c) => c.active);
};

/** Lookup by key, for the rate cascade. */
const categoryMap = (categories) => new Map(categories.map((c) => [c.key, c]));

/**
 * Which category a session falls into.
 *
 * The category chosen on the session wins. Sessions booked before categories
 * existed have none, so they fall back to the old guess — online if there is a
 * meeting link, in person otherwise — and keep paying what they always paid.
 */
export const sessionCategory = (session, cls = session?.class) =>
  session?.payCategoryKey || (resolveMeetingUrl(session, cls) ? 'ONLINE' : 'IN_PERSON');

/** Which category a shift falls into. Unset means unpriced, not free. */
export const shiftCategory = (shift) => shift?.payCategoryKey || null;

/**
 * How many hours an entry ran.
 *
 * start/end are TIME columns, which Prisma returns as Dates on a shared
 * placeholder day, so subtracting them gives the duration directly. Anything
 * non-positive (bad data, an entry saved end-before-start) counts as zero
 * rather than negative — payroll must never silently subtract.
 */
export const sessionHours = (entry) => {
  const start = new Date(entry.startTime).getTime();
  const end = new Date(entry.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const hours = (end - start) / 3_600_000;
  return hours > 0 ? hours : 0;
};

/**
 * Freezes the rate onto the entries whose hour has passed.
 *
 * An hour belongs to the contract that was in force when it happened. Without
 * this, raising somebody's rate in March reprices February, because pay is
 * computed from whatever the rates say at the moment you look. Stamping the
 * resolved rate once the hour is earned makes a past month permanent.
 *
 * The moment that used to trigger this was a human confirming the class. There
 * is no such moment any more, so the clock provides it: the hourly `pay-accrual`
 * cron sweeps the hours that just ended and stamps them (see cron.jobs.js), and
 * the session and shift routes call it too so an edit re-stamps immediately
 * instead of waiting for the next sweep.
 *
 * Only fills entries that don't have a frozen rate yet, so re-running it is
 * harmless and the sweep can pass over the same week forever without repricing
 * anything. Marking somebody absent, or cancelling, clears it (see
 * clearFrozenRates) so the hour prices live again if it comes back.
 *
 * Deliberately never throws to its caller: a session that fails to freeze is a
 * session that keeps pricing live, which is survivable — worth a loud log, not
 * worth failing the request or the sweep that touched it.
 */
export const freezeSessionRates = async (sessionIds) => {
  if (!sessionIds?.length) return 0;
  try {
    const [categoryList, sessions] = await Promise.all([
      loadPayCategories(),
      prisma.session.findMany({
        where: { id: { in: sessionIds }, ...payableSessionWhere(), paidRate: null },
        select: {
          id: true, meetingUrl: true, payCategoryKey: true, payRateOverride: true,
          class: {
            select: {
              type: true, meetingUrl: true,
              teacher: {
                // baseSalary is not optional here, however unused it looks: it
                // is the only thing that tells rateContextFor this person is
                // salaried, and a salaried hour must never be stamped (see the
                // skip below). Left out, every hour a salaried teacher works
                // gets pinned at the category rate and paid on top of the
                // salary that already covers it.
                select: {
                  id: true, hourlyRate: true, flatRateOnly: true, baseSalary: true,
                  payRates: { select: { category: true, hourlyRate: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    if (sessions.length === 0) return 0;

    const categories = categoryMap(categoryList);
    // One context per teacher, not per session: a teacher with thirty sessions
    // this month would otherwise rebuild the same rate map thirty times.
    const contexts = new Map();
    const writes = [];

    for (const session of sessions) {
      const teacher = session.class?.teacher;
      if (!teacher) continue;
      if (!contexts.has(teacher.id)) contexts.set(teacher.id, rateContextFor(teacher, categories));
      const { rate, source } = resolveRate(
        sessionCategory(session, session.class),
        contexts.get(teacher.id),
        toNumber(session.payRateOverride)
      );
      // An hour with no rate at all isn't a contract worth preserving, it's a
      // gap. Freezing it would lock the hour at $0 for good, so the very common
      // "mark the classes complete, then set the rates" order of work would
      // quietly cost somebody their pay. Left unfrozen, it keeps pricing live
      // and fixes itself the moment a rate exists.
      //
      // A salaried hour is skipped for the mirror reason: its $0 isn't a rate
      // anybody agreed, it's a consequence of being on a salary this month.
      // Stamped, it would outlive the salary — move that person onto an hourly
      // arrangement later and their past hours would stay pinned at nothing.
      if (source === 'unset' || source === 'salaried') continue;
      writes.push(prisma.session.update({
        where: { id: session.id },
        data: { paidRate: rate, paidRateSource: source },
      }));
    }

    await prisma.$transaction(writes);
    return writes.length;
  } catch (error) {
    console.error('[Payroll] Could not freeze session rates:', error);
    return 0;
  }
};

/** The same, for shifts. See freezeSessionRates. */
export const freezeShiftRates = async (shiftIds) => {
  if (!shiftIds?.length) return 0;
  try {
    const [categoryList, shifts] = await Promise.all([
      loadPayCategories(),
      prisma.workShift.findMany({
        where: { id: { in: shiftIds }, status: { not: 'CANCELLED' }, absentAt: null, paidRate: null, ...elapsed() },
        select: {
          id: true, payCategoryKey: true, payRateOverride: true,
          staff: {
            // baseSalary for the same reason as freezeSessionRates: without it
            // a salaried person's shifts are stamped and paid twice.
            select: {
              id: true, hourlyRate: true, flatRateOnly: true, baseSalary: true,
              payRates: { select: { category: true, hourlyRate: true } },
            },
          },
        },
      }),
    ]);
    if (shifts.length === 0) return 0;

    const categories = categoryMap(categoryList);
    const contexts = new Map();
    const writes = [];

    for (const shift of shifts) {
      const staff = shift.staff;
      if (!staff) continue;
      if (!contexts.has(staff.id)) contexts.set(staff.id, rateContextFor(staff, categories));
      const { rate, source } = resolveRate(
        shiftCategory(shift),
        contexts.get(staff.id),
        toNumber(shift.payRateOverride)
      );
      // Same as sessions: neither "no rate" nor "covered by salary" is a
      // contract worth stamping. See freezeSessionRates.
      if (source === 'unset' || source === 'salaried') continue;
      writes.push(prisma.workShift.update({
        where: { id: shift.id },
        data: { paidRate: rate, paidRateSource: source },
      }));
    }

    await prisma.$transaction(writes);
    return writes.length;
  } catch (error) {
    console.error('[Payroll] Could not freeze shift rates:', error);
    return 0;
  }
};

/**
 * Drops a frozen rate, so the hour prices live again.
 *
 * Called when something stops being payable — a session cancelled, somebody
 * marked absent, or an admin correcting the rate on an hour that has already
 * been stamped. Leaving the old stamp in place would pin the hour to a number
 * nobody can now change.
 */
export const clearFrozenRates = async ({ sessionIds, shiftIds } = {}) => {
  const writes = [];
  if (sessionIds?.length) {
    writes.push(prisma.session.updateMany({
      where: { id: { in: sessionIds } },
      data: { paidRate: null, paidRateSource: null },
    }));
  }
  if (shiftIds?.length) {
    writes.push(prisma.workShift.updateMany({
      where: { id: { in: shiftIds } },
      data: { paidRate: null, paidRateSource: null },
    }));
  }
  if (writes.length) await prisma.$transaction(writes);
};

/** Human wording for each rate source, shown next to the money. */
export const RATE_SOURCE_LABELS = {
  event: 'Set on this entry',
  flat: 'Flat rate for this person',
  teacher: "This person's rate for this work",
  category: 'Category rate',
  base: 'Base hourly rate',
  salaried: 'Covered by salary',
  unset: 'No rate set',
};

/**
 * The rate that applies to one hour of work, and where it came from.
 *
 * Most specific wins, and `source` is carried all the way to the screen so an
 * admin can see why an hour was paid at $30 rather than $20 without opening
 * three settings pages:
 *
 *   1. a rate typed onto this one calendar entry — somebody deliberately said
 *      "this one is different", which beats everything, including a flat rate
 *      or a salary;
 *   2. nothing, if this person is salaried — a manager on $63,000/yr doesn't
 *      also collect the $50/hr in-person rate for the same classes, because
 *      the salary is what pays for them;
 *   3. the person's flat rate, if they are paid one number whatever the work;
 *   4. that person's own rate for this category;
 *   5. the category's default rate — the usual answer, and the whole point of
 *      categories: set "front desk = $20" once, not once per person;
 *   6. their base hourly rate;
 *   7. nothing, which is priced at $0 and reported as unpriced hours rather
 *      than quietly swallowed.
 */
export const resolveRate = (categoryKey, context, entryOverride = null) => {
  if (entryOverride != null) return { rate: entryOverride, source: 'event' };
  const { hourlyRate, overrides, flatRateOnly, salaried, categories } = context;

  if (salaried) return { rate: 0, source: 'salaried' };

  if (flatRateOnly && hourlyRate != null) return { rate: hourlyRate, source: 'flat' };

  const own = categoryKey == null ? null : overrides.get(categoryKey);
  if (own != null) return { rate: own, source: 'teacher' };

  const category = categoryKey == null ? null : categories?.get(categoryKey);
  if (category?.defaultRate != null) return { rate: category.defaultRate, source: 'category' };

  if (hourlyRate != null) return { rate: hourlyRate, source: 'base' };
  return { rate: 0, source: 'unset' };
};

const round2 = (n) => Math.round(n * 100) / 100;

const toNumber = (value) => (value == null ? null : parseFloat(value));

/** ISO date (YYYY-MM-DD), for labelling a range without a time component. */
const isoDate = (date) => date.toISOString().slice(0, 10);

/**
 * The Monday of the week containing `input` (a Date, an ISO string, or
 * nothing for today), at UTC midnight. Payroll is settled weekly, and every
 * week on the calendar starts on Monday, so this is the one anchor the
 * weekly screen needs — everything else is six days added to it.
 */
const mondayOf = (input) => {
  const d = input ? new Date(input) : new Date();
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
};

/** The per-person context the cascade reads, built once per person. */
const rateContextFor = (person, categories) => ({
  hourlyRate: toNumber(person.hourlyRate),
  flatRateOnly: Boolean(person.flatRateOnly),
  // Anyone on a base salary is paid for their hours through that salary, not a
  // second time per hour worked — see resolveRate.
  //
  // A salary of zero is not that arrangement. `null` means nobody has agreed a
  // salary and `0` means somebody agreed there isn't one — the academy's owners
  // draw nothing — and reading the second as "your salary covers these hours"
  // pays them nothing for work a salary of $0 cannot possibly cover. It is a
  // live trap in the editor too: the salary box saves what you type, so an
  // admin writing 0 to mean "no salary" silently zeroes every hour that person
  // works. Only a positive figure is a salary.
  salaried: toNumber(person.baseSalary) > 0,
  overrides: new Map((person.payRates || []).map((r) => [r.category, parseFloat(r.hourlyRate)])),
  categories,
});

/**
 * What a salary contributes to one month.
 *
 * The stored figure is whatever was agreed with the person — $63,000/yr for
 * salaried staff, a flat monthly amount for a stipend — because that is the
 * number they will look for on the screen. Payroll is monthly, so an annual
 * salary is divided here rather than at the point it was typed in.
 *
 * Twelfths, not by days in the month: salaried people are paid the same in
 * February as in March, and a "fairer" daily proration would make twelve
 * different paycheques out of one agreed number.
 */
export const monthlySalary = (amount, period) => {
  const value = parseFloat(amount || 0);
  if (!Number.isFinite(value)) return 0;
  return round2(period === 'ANNUAL' ? value / 12 : value);
};

/** The month as a [start, end] pair of dates, inclusive. */
const monthRange = (targetMonth, targetYear) => [
  new Date(Date.UTC(targetYear, targetMonth - 1, 1)),
  new Date(Date.UTC(targetYear, targetMonth, 0)),
];

/**
 * Has this hour finished?
 *
 * `date` is a DATE and `endTime` a TIME, and Postgres will not compare the pair
 * of them against an instant — so the question is asked in the same two halves
 * the columns are stored in: an earlier day, or today with an end time already
 * behind us. Both halves come off the academy's wall clock (see
 * academyNowParts), so a class that ends at 5 PM starts earning at 5 PM local
 * and not at whatever hour UTC happens to agree.
 */
const elapsed = (now) => {
  const { date, time } = academyNowParts(now);
  return { OR: [{ date: { lt: date } }, { AND: [{ date }, { endTime: { lte: time } }] }] };
};

/**
 * Still worth paying for, despite being off the timetable.
 *
 * A cancelled session is not worked — except when the cancellation came too
 * late to free the slot. A student who cancels inside the 24-hour window is
 * charged the full session, and the teacher who held that hour is owed it just
 * the same; without this the academy collected on the hour while the person who
 * lost it got nothing. Cancelling with a day's notice is the other side of that
 * bargain: the slot can be refilled, the family is charged half, nobody is paid.
 */
const stillWorked = {
  OR: [
    { status: { not: 'CANCELLED' } },
    { cancellations: { some: { hoursBeforeClass: { lt: CANCELLATION_WINDOW_HOURS } } } },
  ],
};

/**
 * Which sessions count as worked: the ones whose hour has passed.
 *
 * Pay comes off the calendar. Booking somebody for an hour is the act that
 * decides they will be paid for it, and when that hour ends the money is owed —
 * no register to save, no admin to sign it off, nothing anybody has to remember
 * to do. The rule this replaces wanted a human to confirm every single class,
 * and the humans forgot: hours that were genuinely taught sat unpaid behind a
 * warning panel until someone noticed. That is not caution, it is paying people
 * late.
 *
 * So three things decide it, and all three are visible on the calendar entry
 * itself — which is exactly where anyone who wants to change the answer goes:
 *
 *   1. `elapsed` — next Tuesday's class earns nothing today;
 *   2. `stillWorked` — cancelled means unpaid, unless it was cancelled too late;
 *   3. `absentAt` — the teacher did not turn up. The one hand-operated switch
 *      left in the whole rule, set from the calendar, and it beats the rest.
 *
 * `AND`, because two of the three are OR-groups and one object cannot hold two
 * `OR` keys.
 */
export const payableSessionWhere = (now = new Date()) => ({
  absentAt: null,
  AND: [elapsed(now), stillWorked],
});

export const paidSessionsWhere = (startDate, endDate, now = new Date()) => ({
  date: { gte: startDate, lte: endDate },
  ...payableSessionWhere(now),
});

/**
 * Hours that have passed but are deliberately not paid, because somebody said
 * the person was not there.
 *
 * Listed, not silently dropped. An absence is money taken off a payslip, and
 * the person it was taken from is the one least able to see it happen — so the
 * payroll screen shows every one of them, with the reason given and the name of
 * whoever marked it, next to the hours they cost.
 */
export const absentSessionsWhere = (startDate, endDate, now = new Date()) => ({
  date: { gte: startDate, lte: endDate },
  absentAt: { not: null },
  ...elapsed(now),
});

/**
 * Which shifts count as worked. Same rule as a class, for the same reason: the
 * shift was booked, its hour has passed, so it is owed. A cancelled shift is
 * not worked, and neither is one whose person was marked absent.
 *
 * Shifts have no late-cancellation bargain to honour — nobody holds a front
 * desk slot open for a student — so this is the plain version of the rule.
 */
export const paidShiftsWhere = (startDate, endDate, now = new Date()) => ({
  date: { gte: startDate, lte: endDate },
  status: { not: 'CANCELLED' },
  absentAt: null,
  ...elapsed(now),
});

/**
 * The same question `elapsed` asks the database, asked in memory about one
 * entry that has already been fetched.
 *
 * Two callers need it and they need the same answer: the payable/absent split
 * for shifts, and the earned/upcoming split on the projection. Written once
 * here, in the two halves the columns are stored in, so it cannot drift from
 * the `where` clause above.
 */
export const hasElapsed = (entry, now = new Date()) => {
  const { date, time } = academyNowParts(now);
  const entryDate = new Date(entry.date);
  if (entryDate < date) return true;
  return entryDate.getTime() === date.getTime() && new Date(entry.endTime) <= time;
};

/**
 * The same rule as paidShiftsWhere, decided in memory.
 *
 * Both payroll screens fetch every shift in the range — they have to show the
 * absent ones as well as the paid ones — so the split happens here rather than
 * in a second query. Kept next to the `where` it mirrors: if one of the two
 * ever changes, the other is the next thing you read.
 */
export const isShiftPayable = (shift, now = new Date()) => {
  if (shift.status === 'CANCELLED' || shift.absentAt) return false;
  return hasElapsed(shift, now);
};

/**
 * What the academy is committed to, as opposed to what it already owes.
 *
 * The same three tests as `payableSessionWhere` minus the one about the clock:
 * booking somebody for an hour is the act that decides they will be paid for
 * it, so the cost of next month's timetable is knowable today — that is the
 * whole point of pricing from the calendar rather than from a timesheet.
 *
 * A range that straddles today deliberately returns both halves. "What does
 * this month cost" is one question, not two, and answering it as earned-so-far
 * plus still-to-come is what makes the number worth looking at; each line says
 * which half it is in (see `earned` on the line item).
 *
 * A cancelled session drops out exactly as it does today, including the late
 * cancellation that is still owed — a slot nobody can refill is a slot the
 * teacher is still holding, whether it was cancelled yesterday or will be
 * cancelled next week.
 */
export const scheduledSessionsWhere = (startDate, endDate) => ({
  date: { gte: startDate, lte: endDate },
  absentAt: null,
  ...stillWorked,
});

/** The shift half of scheduledSessionsWhere. Same rule, no late-cancellation bargain. */
export const scheduledShiftsWhere = (startDate, endDate) => ({
  date: { gte: startDate, lte: endDate },
  status: { not: 'CANCELLED' },
  absentAt: null,
});

/**
 * The session fields payroll prices an hour from.
 *
 * The last two are counts, not data: whether anybody actually turned up, and
 * whether a late cancellation is what put this session on the payslip. Together
 * they let a line say "paid, nobody came, here is why" instead of leaving an
 * admin to work it out from the class roster.
 */
const PAID_SESSION_SELECT = {
  id: true, date: true, startTime: true, endTime: true, status: true,
  meetingUrl: true, payCategoryKey: true, payRateOverride: true,
  paidRate: true, paidRateSource: true,
  attendance: { where: { status: 'PRESENT' }, select: { id: true } },
  cancellations: {
    where: { hoursBeforeClass: { lt: CANCELLATION_WINDOW_HOURS } },
    select: { id: true },
  },
};

/** True when this session is on the payslip only because it was cancelled too late. */
const wasLateCancelled = (session) =>
  (session.cancellations?.length ?? 0) > 0 && (session.attendance?.length ?? 0) === 0;

/**
 * Turns one worked entry into a payslip line.
 *
 * Sessions and shifts differ in almost everything except the four numbers that
 * matter here — when, how long, at what rate, for how much — so they are
 * flattened into one shape and the screen renders a single list.
 */
const lineItem = ({ id, kind, date, startTime, endTime, title, subtitle, categoryKey, override, paidRate, paidRateSource, lateCancelled, role }, context, categories) => {
  const hours = sessionHours({ startTime, endTime });
  // A frozen rate wins outright: this hour was confirmed under a contract that
  // may since have changed, and re-resolving it would rewrite history.
  const frozen = paidRate != null;
  const { rate, source } = frozen
    ? { rate: paidRate, source: paidRateSource || 'frozen' }
    : resolveRate(categoryKey, context, override);
  return {
    locked: frozen,
    // Already worked, or still only booked. Always answered, because the
    // earned-only screens are simply the case where every line is true — and a
    // projection that cannot tell the two apart is a projection nobody can
    // check against the money that actually went out.
    earned: hasElapsed({ date, endTime }),
    id,
    kind,
    date,
    startTime,
    endTime,
    title,
    subtitle: subtitle || null,
    // Paid because a student cancelled too late to free the slot, not because
    // the class ran. Says so on the payslip so nobody reading it later has to
    // guess why an hour with no attendance was paid.
    lateCancelled: Boolean(lateCancelled),
    // Which chair this person was in. The rate does not depend on it — a
    // co-teacher is paid the same full hour as the teacher whose class it is —
    // but the cost does: every co-taught hour is bought twice, and a screen
    // that cannot say so leaves an admin reading one number for two people.
    // Null on a shift, which nobody co-staffs.
    role: role || null,
    category: categoryKey,
    categoryLabel: categories.get(categoryKey)?.label || (categoryKey ? categoryKey : 'Uncategorised'),
    categoryColor: categories.get(categoryKey)?.color || null,
    hours: round2(hours),
    rate,
    rateSource: source,
    amount: round2(hours * rate),
  };
};

/** Rolls a set of lines up per category, in the order the categories are listed. */
const summariseByCategory = (lines, categories) => {
  const buckets = new Map();
  for (const line of lines) {
    const key = line.category || '__none__';
    const bucket = buckets.get(key) || {
      category: line.category,
      label: line.categoryLabel,
      color: line.categoryColor,
      hours: 0,
      amount: 0,
      entries: 0,
      // A rate override on one entry, or a rate changed mid-month, makes a
      // single "the rate" meaningless. Tracked as a set so the screen can show
      // "$30" when they all agree and "mixed" when they don't, instead of
      // picking one and being wrong.
      rates: new Set(),
      sources: new Set(),
    };
    bucket.hours += line.hours;
    bucket.amount += line.amount;
    bucket.entries += 1;
    bucket.rates.add(line.rate);
    bucket.sources.add(line.rateSource);
    buckets.set(key, bucket);
  }

  const order = [...categories.keys()];
  return [...buckets.values()]
    .map((b) => ({
      category: b.category,
      label: b.label,
      color: b.color,
      hours: round2(b.hours),
      amount: round2(b.amount),
      entries: b.entries,
      rate: b.rates.size === 1 ? [...b.rates][0] : null,
      mixedRates: b.rates.size > 1,
      source: b.sources.size === 1 ? [...b.sources][0] : 'mixed',
    }))
    .sort((a, b) => {
      const ai = order.indexOf(a.category);
      const bi = order.indexOf(b.category);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || b.amount - a.amount;
    });
};

/**
 * Computes one person's pay for one month, line by line.
 *
 * The result is a statement: every class session and every shift that was
 * worked, what it paid and why, then the same hours rolled up per category and
 * finally one total. It is the thing an admin reads before releasing money.
 */
export const computeTeacherPayroll = async (teacherId, targetMonth, targetYear) => {
  const [startDate, endDate] = monthRange(targetMonth, targetYear);
  const paidSessions = paidSessionsWhere(startDate, endDate);

  const [categoryList, teacher, absences] = await Promise.all([
    loadPayCategories(),
    prisma.user.findUniqueOrThrow({
      where: { id: teacherId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        status: true,
        baseSalary: true,
        salaryPeriod: true,
        hourlyRate: true,
        flatRateOnly: true,
        payRates: { select: { category: true, hourlyRate: true } },
        taughtClasses: {
          select: {
            id: true,
            name: true,
            subject: true,
            type: true,
            meetingUrl: true,
            sessions: {
              where: paidSessions,
              select: PAID_SESSION_SELECT,
              orderBy: { date: 'desc' },
            },
          },
        },
        // A co-teacher earns for the same sessions the primary teacher does —
        // covering a class is the work, whichever chair you sit in. Selected
        // identically to `taughtClasses` so both feed the same `lineItem` path.
        coTaughtClasses: {
          select: {
            id: true,
            name: true,
            subject: true,
            type: true,
            meetingUrl: true,
            sessions: {
              where: paidSessions,
              select: PAID_SESSION_SELECT,
              orderBy: { date: 'desc' },
            },
          },
        },
        // Every shift in the range, not only the payable ones: the absent ones
        // have to appear on the statement too, as hours that were dropped and
        // by whom. Split by isShiftPayable below.
        workShifts: {
          where: { date: { gte: startDate, lte: endDate } },
          select: {
            id: true, date: true, startTime: true, endTime: true, title: true, status: true,
            payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true, notes: true,
            absentAt: true, absentReason: true,
            absentBy: { select: { fullName: true } },
          },
          orderBy: { date: 'desc' },
        },
        timeOffRequests: {
          where: {
            status: 'APPROVED',
            date: { gte: new Date(targetYear, 0, 1), lte: new Date(targetYear, 11, 31) },
          },
        },
      },
    }),
    // Their own hours that were dropped because somebody marked them absent.
    // Queried from the session side rather than nested under the class lists,
    // because "this person's hours" spans both the classes they own and the
    // ones they cover.
    prisma.session.findMany({
      where: {
        ...absentSessionsWhere(startDate, endDate),
        class: {
          OR: [{ teacherId }, { coTeachers: { some: { id: teacherId } } }],
        },
      },
      select: {
        id: true, date: true, startTime: true, endTime: true,
        absentAt: true, absentReason: true,
        absentBy: { select: { fullName: true } },
        class: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    }),
  ]);

  const categories = categoryMap(categoryList);
  const context = rateContextFor(teacher, categories);

  const absentEntries = absences.map((s) => ({
    id: s.id,
    kind: 'session',
    date: s.date,
    title: s.class?.name || 'Session',
    hours: round2(sessionHours(s)),
    markedAt: s.absentAt,
    markedBy: s.absentBy?.fullName || null,
    reason: s.absentReason || null,
  }));

  const lines = [];
  const classSummaries = [];

  // Primary and co-taught classes are priced the same way — the rate a session
  // pays doesn't depend on which chair this teacher sat in — so both lists walk
  // through the same loop, tagged only for the summary an admin reads.
  const classesTaught = [
    ...teacher.taughtClasses.map((cls) => ({ cls, role: 'primary' })),
    ...teacher.coTaughtClasses.map((cls) => ({ cls, role: 'co-teacher' })),
  ];

  for (const { cls, role } of classesTaught) {
    if (cls.sessions.length === 0) continue;
    const classLines = cls.sessions.map((s) =>
      lineItem(
        {
          id: s.id,
          kind: 'session',
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          title: cls.name,
          subtitle: cls.subject,
          categoryKey: sessionCategory(s, cls),
          override: toNumber(s.payRateOverride), paidRate: toNumber(s.paidRate), paidRateSource: s.paidRateSource,
          lateCancelled: wasLateCancelled(s),
          role,
        },
        context,
        categories
      )
    );
    lines.push(...classLines);

    classSummaries.push({
      id: cls.id,
      name: cls.name,
      subject: cls.subject,
      type: cls.type,
      role,
      completedSessions: cls.sessions.length,
      hours: round2(classLines.reduce((n, l) => n + l.hours, 0)),
      amount: round2(classLines.reduce((n, l) => n + l.amount, 0)),
      sessions: classLines.map((l) => ({
        id: l.id, date: l.date, hours: l.hours, category: l.category,
        rate: l.rate, amount: l.amount,
      })),
    });
  }

  const paidShifts = teacher.workShifts.filter((s) => isShiftPayable(s));
  for (const shift of teacher.workShifts) {
    if (!shift.absentAt) continue;
    absentEntries.push({
      id: shift.id,
      kind: 'shift',
      date: shift.date,
      title: shift.title || categories.get(shift.payCategoryKey)?.label || 'Shift',
      hours: round2(sessionHours(shift)),
      markedAt: shift.absentAt,
      markedBy: shift.absentBy?.fullName || null,
      reason: shift.absentReason || null,
    });
  }
  absentEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const shiftLines = paidShifts.map((shift) =>
    lineItem(
      {
        id: shift.id,
        kind: 'shift',
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        title: shift.title || categories.get(shift.payCategoryKey)?.label || 'Shift',
        subtitle: shift.notes,
        categoryKey: shiftCategory(shift),
        override: toNumber(shift.payRateOverride), paidRate: toNumber(shift.paidRate), paidRateSource: shift.paidRateSource,
      },
      context,
      categories
    )
  );
  lines.push(...shiftLines);

  lines.sort((a, b) => new Date(b.date) - new Date(a.date) || String(a.startTime).localeCompare(String(b.startTime)));

  const totalHours = lines.reduce((n, l) => n + l.hours, 0);
  const hourlyEarnings = lines.reduce((n, l) => n + l.amount, 0);
  const unratedHours = lines.filter((l) => l.rateSource === 'unset').reduce((n, l) => n + l.hours, 0);

  // `baseSalary` stays the month's share, so every total already built on it
  // keeps meaning the same thing. The agreed figure rides alongside it.
  // Null when nothing has been agreed, 0 when zero was agreed on purpose — the
  // academy's owners draw no salary, and that is a decision on the record, not
  // a field somebody forgot. Collapsing both to 0 made the screen unable to
  // tell them apart, and made saving anything else on the card quietly turn the
  // deliberate zero into "not set".
  const salaryAmount = teacher.baseSalary == null ? null : parseFloat(teacher.baseSalary);
  const baseSalary = monthlySalary(teacher.baseSalary, teacher.salaryPeriod);

  const usedSickDays = teacher.timeOffRequests.filter((r) => r.type === 'SICK').length;
  const usedPTODays = teacher.timeOffRequests.filter((r) => r.type === 'PTO').length;

  return {
    teacher: {
      id: teacher.id,
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone,
      avatarUrl: teacher.avatarUrl,
      status: teacher.status,
    },
    payroll: {
      month: targetMonth,
      year: targetYear,
      baseSalary,
      // The salary as agreed, and which of the two it is. The editor prefills
      // from these — prefilling from `baseSalary` would turn "$63,000 a year"
      // into "$5,250 a year" the first time anyone pressed Save.
      salaryAmount,
      salaryPeriod: teacher.salaryPeriod,
      hourlyRate: context.hourlyRate,
      flatRateOnly: context.flatRateOnly,
      // The one word the editor opens on: 'salaried' | 'hourly' | 'default' |
      // 'unset'. See the same field on the roster row — the editor and the
      // screen that sends you to it have to agree about how somebody is paid.
      rateSetup: context.salaried
        ? 'salaried'
        : (context.hourlyRate != null || context.overrides.size > 0 || context.flatRateOnly)
          ? 'hourly'
          : lines.some((l) => l.rateSource === 'category' || l.rateSource === 'frozen')
            ? 'default'
            : 'unset',
      coTeachingHours: round2(lines.filter((l) => l.role === 'co-teacher').reduce((n, l) => n + l.hours, 0)),
      coTeachingAmount: round2(lines.filter((l) => l.role === 'co-teacher').reduce((n, l) => n + l.amount, 0)),
      categoryRates: categoryList.map((c) => ({
        category: c.key,
        label: c.label,
        color: c.color,
        teaching: c.teaching,
        active: c.active,
        categoryDefault: c.defaultRate,
        rate: context.overrides.has(c.key) ? context.overrides.get(c.key) : null,
        effectiveRate: resolveRate(c.key, context).rate,
        source: resolveRate(c.key, context).source,
      })),
      breakdown: summariseByCategory(lines, categories),
      // The statement itself: one row per hour worked, newest first.
      lineItems: lines,
      totalSessionCount: lines.filter((l) => l.kind === 'session').length,
      totalShiftCount: shiftLines.length,
      shiftHours: round2(shiftLines.reduce((n, l) => n + l.hours, 0)),
      totalHours: round2(totalHours),
      hourlyEarnings: round2(hourlyEarnings),
      totalEarnings: round2(baseSalary + hourlyEarnings),
      // Hours that were worked but priced at nothing because no rate is set.
      // Surfaced rather than buried: a $0 total on a month with real work is
      // almost always a missing rate, not somebody who did nothing.
      unratedHours: round2(unratedHours),
      // Hours that passed and were deliberately not paid, because somebody
      // marked this person absent. Listed with the name of whoever did it and
      // never counted into a total — see absentSessionsWhere.
      absences: absentEntries,
      absenceCount: absentEntries.length,
      absenceHours: round2(absentEntries.reduce((n, s) => n + s.hours, 0)),
      usedSickDays,
      totalSickDays: 8,
      usedPTODays,
      totalPTODays: 12,
    },
    classes: classSummaries,
  };
};

/**
 * Everyone's pay for one month, on one screen.
 *
 * The per-person view answers "what did she earn"; this answers "what does the
 * academy owe this month, and is anything obviously wrong before I pay it".
 * Those are different questions, so this returns a roster with a total rather
 * than the per-entry detail — an admin drills into one person from here.
 *
 * One query for the whole roster, not `computeTeacherPayroll` in a loop: that
 * would be a round trip per person plus a time-off query nobody reads on a
 * summary screen, and it grows with every hire.
 */
/**
 * The shared body of computePayrollSummary and computeWeeklyPayrollSummary:
 * everyone's pay for an arbitrary date range. The two exported functions only
 * differ in how they name and label that range — a calendar month for one, a
 * Monday-Sunday week for the other — so the range itself is computed once and
 * both wrap this.
 */
const computePayrollSummaryRange = async (startDate, endDate, { includeSalary = true, mode = 'earned' } = {}) => {
  // The only difference between "what is owed" and "what this timetable will
  // cost" is whether the clock is one of the tests. Everything below — the
  // roster, the rate cascade, the per-category rollup — is the same work, so
  // the mode swaps the filter and nothing else.
  const scheduled = mode === 'scheduled';
  const paidSessions = scheduled
    ? scheduledSessionsWhere(startDate, endDate)
    : paidSessionsWhere(startDate, endDate);
  const countsAsWorked = scheduled
    ? (shift) => shift.status !== 'CANCELLED' && !shift.absentAt
    : (shift) => isShiftPayable(shift);
  const absentSessions = absentSessionsWhere(startDate, endDate);

  const [categoryList, staff, absences] = await Promise.all([
    loadPayCategories(),
    prisma.user.findMany({
      where: {
        OR: [
          { role: 'TEACHER' },
          { secondaryRoles: { has: 'TEACHER' } },
          // Anyone who actually worked a paid hour this month, whatever their
          // role says. Without this an admin who covers a class, or the person
          // who sat at the front desk on Saturday, is missing from the roster
          // while their hours are still owed — a total that doesn't match the
          // payments is worse than no total.
          { taughtClasses: { some: { sessions: { some: paidSessions } } } },
          { coTaughtClasses: { some: { sessions: { some: paidSessions } } } },
          // Front desk staff are paid by the hour like everyone else. They were
          // missing here, and this screen is also where rates are set — so
          // somebody hired for reception and not yet scheduled could not be
          // given a rate at all: absent from the roster is absent from the only
          // editor there is.
          { role: 'RECEPTIONIST' },
          { secondaryRoles: { has: 'RECEPTIONIST' } },
          // Anyone the academy has already agreed to pay, whatever their role
          // says — an admin on a salary belongs on the payroll they sign off.
          { baseSalary: { not: null } },
          { hourlyRate: { not: null } },
          // Scheduled, not only confirmed: a rota booked for this month should
          // put the person on the screen before anyone gets round to marking it
          // worked, so a missing rate surfaces while it is still cheap to fix.
          { workShifts: { some: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } } } },
          // Somebody whose only hours this month were marked absent. They earn
          // nothing, which is exactly why they have to be on the screen: an
          // absence nobody can see is an absence nobody can dispute.
          { taughtClasses: { some: { sessions: { some: absentSessions } } } },
          { coTaughtClasses: { some: { sessions: { some: absentSessions } } } },
        ],
      },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        status: true,
        // The roster is no longer teachers only, so the screen has to be able
        // to say what each person is — calling the receptionist a teacher on
        // her own pay card is the kind of small wrongness that makes an admin
        // distrust the number next to it.
        role: true,
        secondaryRoles: true,
        baseSalary: true,
        salaryPeriod: true,
        hourlyRate: true,
        flatRateOnly: true,
        payRates: { select: { category: true, hourlyRate: true } },
        taughtClasses: {
          select: {
            id: true,
            name: true,
            // `type` is not decoration: a VIRTUAL class falls back to its own
            // meeting link, so without it an uncategorised session would be
            // priced as in-person.
            type: true,
            meetingUrl: true,
            sessions: {
              where: paidSessions,
              select: PAID_SESSION_SELECT,
            },
          },
        },
        // Same reasoning as computeTeacherPayroll: a co-teacher's hours are
        // owed too, and without this the roster total silently excludes them.
        coTaughtClasses: {
          select: {
            id: true,
            name: true,
            type: true,
            meetingUrl: true,
            sessions: {
              where: paidSessions,
              select: PAID_SESSION_SELECT,
            },
          },
        },
        // Every shift in the range, not only the payable ones: the absent ones
        // belong on the screen as dropped hours. Split by isShiftPayable below.
        workShifts: {
          where: { date: { gte: startDate, lte: endDate } },
          select: {
            id: true, date: true, startTime: true, endTime: true, title: true, status: true,
            payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
            absentAt: true, absentReason: true,
            absentBy: { select: { fullName: true } },
          },
        },
      },
    }),
    // One flat query for the whole roster's absences, grouped in memory below —
    // the same reason the roster itself is one query rather than
    // computeTeacherPayroll in a loop.
    prisma.session.findMany({
      where: absentSessions,
      select: {
        id: true, date: true, startTime: true, endTime: true,
        absentAt: true, absentReason: true,
        absentBy: { select: { fullName: true } },
        class: { select: { name: true, teacherId: true, coTeachers: { select: { id: true } } } },
      },
      orderBy: { date: 'desc' },
    }),
  ]);

  const categories = categoryMap(categoryList);

  // Keyed by person, because one session belongs to its teacher and to every
  // co-teacher on it — each of them lost that hour.
  const absencesByPerson = new Map();
  for (const s of absences) {
    const entry = {
      id: s.id,
      kind: 'session',
      date: s.date,
      title: s.class?.name || 'Session',
      hours: round2(sessionHours(s)),
      markedAt: s.absentAt,
      markedBy: s.absentBy?.fullName || null,
      reason: s.absentReason || null,
    };
    const owners = [s.class?.teacherId, ...(s.class?.coTeachers || []).map((t) => t.id)];
    for (const id of owners) {
      if (!id) continue;
      if (!absencesByPerson.has(id)) absencesByPerson.set(id, []);
      absencesByPerson.get(id).push(entry);
    }
  }

  const rows = staff.map((person) => {
    const context = rateContextFor(person, categories);
    const personAbsences = [...(absencesByPerson.get(person.id) || [])];

    const lines = [];
    // Tagged rather than concatenated: both lists price identically, but the
    // roster has to be able to say how much of somebody's total came from
    // covering somebody else's class.
    const taught = [
      ...person.taughtClasses.map((cls) => ({ cls, role: 'primary' })),
      ...person.coTaughtClasses.map((cls) => ({ cls, role: 'co-teacher' })),
    ];
    for (const { cls, role } of taught) {
      for (const s of cls.sessions) {
        lines.push(lineItem({
          id: s.id, kind: 'session', date: s.date, startTime: s.startTime, endTime: s.endTime,
          title: cls.name, categoryKey: sessionCategory(s, cls), override: toNumber(s.payRateOverride), paidRate: toNumber(s.paidRate), paidRateSource: s.paidRateSource,
          lateCancelled: wasLateCancelled(s),
          role,
        }, context, categories));
      }
    }
    // A shift is paid once its hour has passed, exactly like a class — see
    // isShiftPayable, which this uses rather than repeating.
    const paidShifts = person.workShifts.filter(countsAsWorked);
    for (const shift of person.workShifts) {
      if (!shift.absentAt) continue;
      personAbsences.push({
        id: shift.id,
        kind: 'shift',
        date: shift.date,
        title: shift.title || categories.get(shift.payCategoryKey)?.label || 'Shift',
        hours: round2(sessionHours(shift)),
        markedAt: shift.absentAt,
        markedBy: shift.absentBy?.fullName || null,
        reason: shift.absentReason || null,
      });
    }
    personAbsences.sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const shift of paidShifts) {
      lines.push(lineItem({
        id: shift.id, kind: 'shift', date: shift.date, startTime: shift.startTime, endTime: shift.endTime,
        title: shift.title || categories.get(shift.payCategoryKey)?.label || 'Shift',
        categoryKey: shiftCategory(shift), override: toNumber(shift.payRateOverride), paidRate: toNumber(shift.paidRate), paidRateSource: shift.paidRateSource,
      }, context, categories));
    }

    const hoursByCategory = {};
    for (const line of lines) {
      const key = line.category || '__none__';
      hoursByCategory[key] = round2((hoursByCategory[key] || 0) + line.hours);
    }

    // Null means unset, 0 means an agreed zero. See computeTeacherPayroll.
    const salaryAmount = person.baseSalary == null ? null : parseFloat(person.baseSalary);
    // A salary is a monthly figure, so it only belongs in a total that covers
    // a month. Adding it to a week would bill a month's salary four times over
    // — the weekly view settles hourly work, and says so on screen rather than
    // quietly folding a number that doesn't fit the range into the total.
    const baseSalary = includeSalary ? monthlySalary(person.baseSalary, person.salaryPeriod) : 0;
    const hourlyEarnings = lines.reduce((n, l) => n + l.amount, 0);
    // A projected total that straddles today is part fact and part forecast,
    // and those two are not equally trustworthy: the earned half is money the
    // academy already owes, the upcoming half is a timetable that can still be
    // cancelled or rescheduled. Split so the screen can show both rather than
    // presenting a forecast with the confidence of a payslip.
    const upcoming = lines.filter((l) => !l.earned);
    const earned = lines.filter((l) => l.earned);

    // Hours this person was paid for covering a class that is somebody else's.
    // Separated because it is the one part of the total an admin cannot see
    // coming: a seven-hour homeschool block with a co-teacher on it costs two
    // people's seven hours, and the calendar shows one entry.
    const coTaught = lines.filter((l) => l.role === 'co-teacher');
    // Whether anybody has actually said what this person earns, or whether the
    // money below is the category default answering for them. Both pay, and the
    // screen must not call a default an agreement — see `rateSetup` on the row.
    const hasOwnRate =
      context.hourlyRate != null || context.overrides.size > 0 || context.flatRateOnly;

    return {
      teacher: {
        id: person.id,
        fullName: person.fullName,
        email: person.email,
        avatarUrl: person.avatarUrl,
        status: person.status,
        role: person.role,
        secondaryRoles: person.secondaryRoles,
      },
      salaryAmount,
      salaryPeriod: person.salaryPeriod,
      hourlyRate: context.hourlyRate,
      flatRateOnly: context.flatRateOnly,
      // How this person is paid, as one word, so the screen never has to infer
      // it from a salary field that means three things. 'salaried' — a salary
      // covers their hours; 'hourly' — somebody set a rate for them;
      // 'default' — they are being paid, but only because the category has a
      // rate and nobody has confirmed it is right for them; 'unset' — nothing
      // anywhere, and their hours price at nothing.
      rateSetup: context.salaried
        ? 'salaried'
        : hasOwnRate
          ? 'hourly'
          : lines.some((l) => l.rateSource === 'category' || l.rateSource === 'frozen')
            ? 'default'
            : 'unset',
      coTeachingHours: round2(coTaught.reduce((n, l) => n + l.hours, 0)),
      coTeachingAmount: round2(coTaught.reduce((n, l) => n + l.amount, 0)),
      categoryRates: categoryList.map((c) => ({
        category: c.key,
        label: c.label,
        color: c.color,
        categoryDefault: c.defaultRate,
        rate: context.overrides.has(c.key) ? context.overrides.get(c.key) : null,
        effectiveRate: resolveRate(c.key, context).rate,
        source: resolveRate(c.key, context).source,
      })),
      hoursByCategory,
      breakdown: summariseByCategory(lines, categories),
      sessionCount: lines.filter((l) => l.kind === 'session').length,
      shiftCount: lines.filter((l) => l.kind === 'shift').length,
      totalHours: round2(lines.reduce((n, l) => n + l.hours, 0)),
      baseSalary,
      hourlyEarnings: round2(hourlyEarnings),
      totalEarnings: round2(baseSalary + hourlyEarnings),
      earnedHours: round2(earned.reduce((n, l) => n + l.hours, 0)),
      earnedAmount: round2(earned.reduce((n, l) => n + l.amount, 0)),
      upcomingHours: round2(upcoming.reduce((n, l) => n + l.hours, 0)),
      upcomingAmount: round2(upcoming.reduce((n, l) => n + l.amount, 0)),
      upcomingCount: upcoming.length,
      // The scheduled hours behind the forecast, so an admin can see which
      // classes make up the number instead of trusting a total. Only on the
      // projection: the earned screens already list every line they priced.
      upcomingLines: scheduled
        ? upcoming.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
        : [],
      // Hours worked at no rate. Carried per row so the screen can point at the
      // person to fix, not just warn that something somewhere is unpriced.
      unratedHours: round2(lines.filter((l) => l.rateSource === 'unset').reduce((n, l) => n + l.hours, 0)),
      // Hours of theirs that passed and were struck off, with the name of
      // whoever struck them. Not earnings, and never folded into one.
      absences: personAbsences,
      absenceCount: personAbsences.length,
      absenceHours: round2(personAbsences.reduce((n, s) => n + s.hours, 0)),
    };
  });

  const sum = (pick) => round2(rows.reduce((n, r) => n + pick(r), 0));

  // Hours per category across the roster, so the screen can show one column per
  // kind of work without every row having to agree on which categories exist.
  const hoursByCategory = {};
  for (const row of rows) {
    for (const [key, hours] of Object.entries(row.hoursByCategory)) {
      hoursByCategory[key] = round2((hoursByCategory[key] || 0) + hours);
    }
  }

  return {
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
    // Whether a salary is part of the totals below, so the screen can say
    // "hourly only" rather than leaving an admin to wonder why a salaried
    // person shows $0.
    includesSalary: includeSalary,
    // 'earned' — hours already worked, the payslip. 'scheduled' — the same
    // hours plus everything still on the calendar, the forecast.
    mode,
    categories: categoryList,
    rows,
    totals: {
      teachers: rows.length,
      // Only people who actually have something to be paid this month. The
      // roster length counts everyone listed, including the zero rows.
      paidTeachers: rows.filter((r) => r.totalEarnings > 0).length,
      sessionCount: rows.reduce((n, r) => n + r.sessionCount, 0),
      shiftCount: rows.reduce((n, r) => n + r.shiftCount, 0),
      totalHours: sum((r) => r.totalHours),
      hoursByCategory,
      baseSalary: sum((r) => r.baseSalary),
      hourlyEarnings: sum((r) => r.hourlyEarnings),
      totalEarnings: sum((r) => r.totalEarnings),
      earnedHours: sum((r) => r.earnedHours),
      earnedAmount: sum((r) => r.earnedAmount),
      upcomingHours: sum((r) => r.upcomingHours),
      upcomingAmount: sum((r) => r.upcomingAmount),
      upcomingCount: rows.reduce((n, r) => n + r.upcomingCount, 0),
      unratedHours: sum((r) => r.unratedHours),
      // The part of the bill that is second bodies in rooms that already have a
      // teacher. Worth its own figure: it is the only cost on this screen that
      // grows without a single extra entry appearing on the calendar.
      coTeachingHours: sum((r) => r.coTeachingHours),
      coTeachingAmount: sum((r) => r.coTeachingAmount),
      // People whose rate is the category's, not theirs. They are being paid,
      // so this is not the unpriced-hours warning — it is the list of prices
      // nobody has actually agreed to.
      unconfirmedRates: rows.filter((r) => r.rateSetup === 'default').length,
      // Summed across rows, unlike the session count above: a co-taught class
      // marked absent costs two people an hour each, and the screen is showing
      // what the absences cost, not how many calendar entries they were.
      absenceCount: rows.reduce((n, r) => n + r.absenceCount, 0),
      absenceHours: sum((r) => r.absenceHours),
    },
  };
};

/**
 * Everyone's pay for one calendar month, on one screen. See
 * computePayrollSummaryRange for the shared logic — this just names the
 * range a month and keeps the month/year the screen already asks for.
 */
export const computePayrollSummary = async (targetMonth, targetYear) => {
  const [startDate, endDate] = monthRange(targetMonth, targetYear);
  const range = await computePayrollSummaryRange(startDate, endDate);
  return { month: targetMonth, year: targetYear, ...range };
};

/**
 * Everyone's pay for one Monday-Sunday week — the cadence payroll is
 * actually settled on, as opposed to the monthly screen above, which is what
 * an admin reviews rates and absences against.
 *
 * `weekStart` may be any date in the target week (a Date, ISO string, or
 * omitted for the current week); it's snapped to that week's Monday so
 * passing any day of the week gives the same result.
 */
/**
 * What the timetable already on the calendar will cost, per person.
 *
 * The question this answers is the one an hourly, calendar-priced payroll makes
 * askable and nothing else in the system answered: not "what did we pay last
 * month" but "what have we committed to". Every hour on the calendar is a
 * promise to pay somebody, so the promise is countable before the hour arrives
 * — which is the difference between noticing in September that the autumn
 * timetable outruns the fee income and noticing it in June while classes can
 * still be moved.
 *
 * Salary is included only for a range that is exactly one calendar month, for
 * the same reason the weekly screen leaves it out: a monthly figure dropped
 * into a three-week window is not a smaller number, it is a wrong one. The
 * response says which it did, and the screen captions it.
 */
export const computeProjectedPayroll = async (startDate, endDate) => {
  const wholeMonth =
    startDate.getUTCDate() === 1 &&
    startDate.getUTCMonth() === endDate.getUTCMonth() &&
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    endDate.getUTCDate() === new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 0)).getUTCDate();

  return computePayrollSummaryRange(startDate, endDate, {
    includeSalary: wholeMonth,
    mode: 'scheduled',
  });
};

export const computeWeeklyPayrollSummary = async (weekStart) => {
  const startDate = mondayOf(weekStart);
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);
  endDate.setUTCHours(23, 59, 59, 999);
  return computePayrollSummaryRange(startDate, endDate, { includeSalary: false });
};
