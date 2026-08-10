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
 * Freezes the rate onto the entries that were just confirmed as worked.
 *
 * An hour belongs to the contract that was in force when it happened. Without
 * this, raising somebody's rate in March reprices February, because pay is
 * computed from whatever the rates say at the moment you look. Stamping the
 * resolved rate at the moment of confirmation — COMPLETED for a session, worked
 * for a shift — makes a signed-off month permanent.
 *
 * Only fills entries that don't have a frozen rate yet, so re-running it is
 * harmless and re-saving an already-confirmed session never quietly reprices it.
 * Un-confirming clears it (see clearFrozenRates) so the hour prices live again.
 *
 * Deliberately never throws to its caller: a session that fails to freeze is a
 * session that keeps pricing live, which is the old behaviour — worth a loud
 * log, not worth failing the request that marked the class complete.
 */
export const freezeSessionRates = async (sessionIds) => {
  if (!sessionIds?.length) return 0;
  try {
    const [categoryList, sessions] = await Promise.all([
      loadPayCategories(),
      prisma.session.findMany({
        where: { id: { in: sessionIds }, status: 'COMPLETED', paidRate: null },
        select: {
          id: true, meetingUrl: true, payCategoryKey: true, payRateOverride: true,
          class: {
            select: {
              type: true, meetingUrl: true,
              teacher: {
                select: {
                  id: true, hourlyRate: true, flatRateOnly: true,
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
      if (source === 'unset') continue;
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
        where: { id: { in: shiftIds }, status: 'COMPLETED', paidRate: null },
        select: {
          id: true, payCategoryKey: true, payRateOverride: true,
          staff: {
            select: {
              id: true, hourlyRate: true, flatRateOnly: true,
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
      // Same as sessions: no rate is a gap, not a contract. See freezeSessionRates.
      if (source === 'unset') continue;
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
 * Called when something stops being confirmed — a session moved back off
 * COMPLETED, a shift cancelled, or an admin correcting the rate on an entry
 * that was already signed off. Leaving the old stamp in place would pin the
 * hour to a number nobody can now change.
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
 *      "this one is different", which beats everything, including a flat rate;
 *   2. the person's flat rate, if they are paid one number whatever the work;
 *   3. that person's own rate for this category;
 *   4. the category's default rate — the usual answer, and the whole point of
 *      categories: set "front desk = $20" once, not once per person;
 *   5. their base hourly rate;
 *   6. nothing, which is priced at $0 and reported as unpriced hours rather
 *      than quietly swallowed.
 */
export const resolveRate = (categoryKey, context, entryOverride = null) => {
  if (entryOverride != null) return { rate: entryOverride, source: 'event' };
  const { hourlyRate, overrides, flatRateOnly, categories } = context;

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

/** The per-person context the cascade reads, built once per person. */
const rateContextFor = (person, categories) => ({
  hourlyRate: toNumber(person.hourlyRate),
  flatRateOnly: Boolean(person.flatRateOnly),
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
 * Which sessions count as worked.
 *
 * Putting a class on the calendar must not create earnings, and neither should
 * a session nobody attended.
 */
const paidSessionsWhere = (startDate, endDate) => ({
  date: { gte: startDate, lte: endDate },
  status: 'COMPLETED',
  attendance: { some: { status: 'PRESENT' } },
});

/**
 * Which shifts count as worked.
 *
 * Nobody takes attendance at the front desk, so a shift is paid once someone
 * marks it COMPLETED — the same "a human confirmed this happened" that
 * attendance provides for a class.
 */
const paidShiftsWhere = (startDate, endDate) => ({
  date: { gte: startDate, lte: endDate },
  status: 'COMPLETED',
});

/**
 * Turns one worked entry into a payslip line.
 *
 * Sessions and shifts differ in almost everything except the four numbers that
 * matter here — when, how long, at what rate, for how much — so they are
 * flattened into one shape and the screen renders a single list.
 */
const lineItem = ({ id, kind, date, startTime, endTime, title, subtitle, categoryKey, override, paidRate, paidRateSource }, context, categories) => {
  const hours = sessionHours({ startTime, endTime });
  // A frozen rate wins outright: this hour was confirmed under a contract that
  // may since have changed, and re-resolving it would rewrite history.
  const frozen = paidRate != null;
  const { rate, source } = frozen
    ? { rate: paidRate, source: paidRateSource || 'frozen' }
    : resolveRate(categoryKey, context, override);
  return {
    locked: frozen,
    id,
    kind,
    date,
    startTime,
    endTime,
    title,
    subtitle: subtitle || null,
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

  const [categoryList, teacher] = await Promise.all([
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
              select: {
                id: true, date: true, startTime: true, endTime: true, status: true,
                meetingUrl: true, payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
              },
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
              select: {
                id: true, date: true, startTime: true, endTime: true, status: true,
                meetingUrl: true, payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
              },
              orderBy: { date: 'desc' },
            },
          },
        },
        workShifts: {
          where: paidShiftsWhere(startDate, endDate),
          select: {
            id: true, date: true, startTime: true, endTime: true, title: true,
            payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true, notes: true,
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
  ]);

  const categories = categoryMap(categoryList);
  const context = rateContextFor(teacher, categories);

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

  const shiftLines = teacher.workShifts.map((shift) =>
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
export const computePayrollSummary = async (targetMonth, targetYear) => {
  const [startDate, endDate] = monthRange(targetMonth, targetYear);
  const paidSessions = paidSessionsWhere(startDate, endDate);
  const paidShifts = paidShiftsWhere(startDate, endDate);

  const [categoryList, staff] = await Promise.all([
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
              select: {
                id: true, date: true, startTime: true, endTime: true,
                meetingUrl: true, payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
              },
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
              select: {
                id: true, date: true, startTime: true, endTime: true,
                meetingUrl: true, payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
              },
            },
          },
        },
        workShifts: {
          where: paidShifts,
          select: {
            id: true, date: true, startTime: true, endTime: true, title: true,
            payCategoryKey: true, payRateOverride: true, paidRate: true, paidRateSource: true,
          },
        },
      },
    }),
  ]);

  const categories = categoryMap(categoryList);

  const rows = staff.map((person) => {
    const context = rateContextFor(person, categories);

    const lines = [];
    for (const cls of [...person.taughtClasses, ...person.coTaughtClasses]) {
      for (const s of cls.sessions) {
        lines.push(lineItem({
          id: s.id, kind: 'session', date: s.date, startTime: s.startTime, endTime: s.endTime,
          title: cls.name, categoryKey: sessionCategory(s, cls), override: toNumber(s.payRateOverride), paidRate: toNumber(s.paidRate), paidRateSource: s.paidRateSource,
        }, context, categories));
      }
    }
    for (const shift of person.workShifts) {
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
    const baseSalary = monthlySalary(person.baseSalary, person.salaryPeriod);
    const hourlyEarnings = lines.reduce((n, l) => n + l.amount, 0);

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
      // Hours worked at no rate. Carried per row so the screen can point at the
      // person to fix, not just warn that something somewhere is unpriced.
      unratedHours: round2(lines.filter((l) => l.rateSource === 'unset').reduce((n, l) => n + l.hours, 0)),
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
    month: targetMonth,
    year: targetYear,
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
      unratedHours: sum((r) => r.unratedHours),
    },
  };
};
