/**
 * What a teacher earned, and why.
 *
 * Pay is hourly. A session pays for the hours it actually ran, at the rate for
 * the kind of work it was — so an hour in the building and an hour over Zoom
 * can be worth different amounts, which is how the academy already pays people.
 *
 * The output is deliberately a breakdown rather than a number: an admin
 * signing off payroll needs to see which hours were counted at which rate, and
 * a teacher querying their pay needs the same. A single total nobody can
 * reconstruct is a total nobody can defend.
 */

import prisma from '../config/database.js';
import { resolveMeetingUrl } from '../utils/meetingLink.js';

/**
 * The kinds of work a rate can be set for.
 *
 * Decided per session, never per class: a class that meets in person on Monday
 * and online on Tuesday produces one of each, and reading this off Class.type
 * would pay the wrong rate for half of them.
 */
export const PAY_CATEGORIES = [
  { key: 'ONLINE', label: 'Online session' },
  { key: 'IN_PERSON', label: 'In-person session' },
];

/** Which category a single session falls into. */
export const sessionCategory = (session, cls = session?.class) =>
  resolveMeetingUrl(session, cls) ? 'ONLINE' : 'IN_PERSON';

/**
 * How many hours a session ran.
 *
 * start/end are TIME columns, which Prisma returns as Dates on a shared
 * placeholder day, so subtracting them gives the duration directly. Anything
 * non-positive (bad data, a session saved end-before-start) counts as zero
 * rather than negative — payroll must never silently subtract.
 */
export const sessionHours = (session) => {
  const start = new Date(session.startTime).getTime();
  const end = new Date(session.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const hours = (end - start) / 3_600_000;
  return hours > 0 ? hours : 0;
};

/**
 * The rate that applies to one category, and where it came from.
 *
 * Most specific wins: a category override beats the teacher's base hourly rate.
 * `source` is carried through to the UI so an admin can see why an hour was
 * paid at $24 rather than $20 without opening the settings.
 */
export const resolveRate = (category, { hourlyRate, overrides }) => {
  const override = overrides.get(category);
  if (override != null) return { rate: override, source: 'category' };
  if (hourlyRate != null) return { rate: hourlyRate, source: 'base' };
  return { rate: 0, source: 'unset' };
};

const round2 = (n) => Math.round(n * 100) / 100;

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

/**
 * Computes one teacher's pay for one month.
 *
 * Only sessions that are COMPLETED *and* had at least one student PRESENT are
 * paid: putting a class on the calendar must not create earnings, and neither
 * should a session nobody attended.
 */
export const computeTeacherPayroll = async (teacherId, targetMonth, targetYear) => {
  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0));

  const teacher = await prisma.user.findUniqueOrThrow({
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
      payRates: { select: { category: true, hourlyRate: true } },
      taughtClasses: {
        select: {
          id: true,
          name: true,
          subject: true,
          type: true,
          meetingUrl: true,
          sessions: {
            where: {
              date: { gte: startDate, lte: endDate },
              status: 'COMPLETED',
              attendance: { some: { status: 'PRESENT' } },
            },
            select: { id: true, date: true, startTime: true, endTime: true, status: true, meetingUrl: true },
            orderBy: { date: 'desc' },
          },
        },
      },
      timeOffRequests: {
        where: {
          status: 'APPROVED',
          date: { gte: new Date(targetYear, 0, 1), lte: new Date(targetYear, 11, 31) },
        },
      },
    },
  });

  const overrides = new Map(
    teacher.payRates.map((r) => [r.category, parseFloat(r.hourlyRate)])
  );
  const rateContext = {
    hourlyRate: teacher.hourlyRate == null ? null : parseFloat(teacher.hourlyRate),
    overrides,
  };

  // Accumulate per category so the breakdown mirrors how the rates are set.
  const byCategory = new Map();
  const classSummaries = [];
  let totalHours = 0;
  let hourlyEarnings = 0;
  let unratedHours = 0;

  for (const cls of teacher.taughtClasses) {
    let classHours = 0;
    for (const session of cls.sessions) {
      const hours = sessionHours(session);
      const category = sessionCategory(session, cls);
      const { rate, source } = resolveRate(category, rateContext);
      const amount = hours * rate;

      const bucket = byCategory.get(category) || { category, hours: 0, amount: 0, rate, source };
      bucket.hours += hours;
      bucket.amount += amount;
      // A rate change mid-month would make one bucket rate meaningless; the
      // rate is current-state, so this simply reflects what is set today.
      bucket.rate = rate;
      bucket.source = source;
      byCategory.set(category, bucket);

      totalHours += hours;
      hourlyEarnings += amount;
      if (source === 'unset') unratedHours += hours;
      classHours += hours;
    }

    if (cls.sessions.length > 0) {
      classSummaries.push({
        id: cls.id,
        name: cls.name,
        subject: cls.subject,
        type: cls.type,
        completedSessions: cls.sessions.length,
        hours: round2(classHours),
        sessions: cls.sessions.map((s) => ({
          id: s.id,
          date: s.date,
          hours: round2(sessionHours(s)),
          category: sessionCategory(s, cls),
        })),
      });
    }
  }

  // `baseSalary` stays the month's share, so every total already built on it
  // keeps meaning the same thing. The agreed figure rides alongside it.
  const salaryAmount = parseFloat(teacher.baseSalary || 0);
  const baseSalary = monthlySalary(teacher.baseSalary, teacher.salaryPeriod);
  const totalSessionCount = teacher.taughtClasses.reduce((n, c) => n + c.sessions.length, 0);

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
      hourlyRate: rateContext.hourlyRate,
      categoryRates: PAY_CATEGORIES.map(({ key, label }) => ({
        category: key,
        label,
        rate: overrides.has(key) ? overrides.get(key) : null,
        effectiveRate: resolveRate(key, rateContext).rate,
        source: resolveRate(key, rateContext).source,
      })),
      breakdown: [...byCategory.values()]
        .map((b) => ({ ...b, hours: round2(b.hours), amount: round2(b.amount) }))
        .sort((a, b) => b.amount - a.amount),
      totalSessionCount,
      totalHours: round2(totalHours),
      hourlyEarnings: round2(hourlyEarnings),
      totalEarnings: round2(baseSalary + hourlyEarnings),
      // Hours that were worked but priced at nothing because no rate is set.
      // Surfaced rather than buried: a $0 total on a month with real teaching
      // is almost always a missing rate, not a teacher who did nothing.
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
 * The per-teacher view answers "what did she earn"; this answers "what does the
 * academy owe this month, and is anything obviously wrong before I pay it".
 * Those are different questions, so this returns a roster with a total rather
 * than the per-class detail — an admin drills into one person from here.
 *
 * One query for the whole roster, not `computeTeacherPayroll` in a loop: that
 * would be a round trip per teacher plus a time-off query nobody reads on a
 * summary screen, and it grows with every hire.
 */
export const computePayrollSummary = async (targetMonth, targetYear) => {
  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0));

  const paidSessions = {
    date: { gte: startDate, lte: endDate },
    status: 'COMPLETED',
    attendance: { some: { status: 'PRESENT' } },
  };

  const teachers = await prisma.user.findMany({
    where: {
      OR: [
        { role: 'TEACHER' },
        { secondaryRoles: { has: 'TEACHER' } },
        // Anyone who actually taught a paid hour this month, whatever their
        // role says. Without this an admin who covers a class is missing from
        // the roster while their hours are still owed — a total that doesn't
        // match the payments is worse than no total.
        { taughtClasses: { some: { sessions: { some: paidSessions } } } },
      ],
    },
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      email: true,
      avatarUrl: true,
      status: true,
      baseSalary: true,
      salaryPeriod: true,
      hourlyRate: true,
      payRates: { select: { category: true, hourlyRate: true } },
      taughtClasses: {
        select: {
          id: true,
          // `type` is not decoration: a VIRTUAL class falls back to its own
          // meeting link, so without it every one of its sessions would be
          // priced as in-person.
          type: true,
          meetingUrl: true,
          sessions: {
            where: paidSessions,
            select: { id: true, startTime: true, endTime: true, meetingUrl: true },
          },
        },
      },
    },
  });

  const rows = teachers.map((teacher) => {
    const overrides = new Map(teacher.payRates.map((r) => [r.category, parseFloat(r.hourlyRate)]));
    const rateContext = {
      hourlyRate: teacher.hourlyRate == null ? null : parseFloat(teacher.hourlyRate),
      overrides,
    };

    const hoursByCategory = Object.fromEntries(PAY_CATEGORIES.map((c) => [c.key, 0]));
    let totalHours = 0;
    let hourlyEarnings = 0;
    let unratedHours = 0;
    let sessionCount = 0;

    for (const cls of teacher.taughtClasses) {
      for (const session of cls.sessions) {
        const hours = sessionHours(session);
        const category = sessionCategory(session, cls);
        const { rate, source } = resolveRate(category, rateContext);

        hoursByCategory[category] = (hoursByCategory[category] || 0) + hours;
        totalHours += hours;
        hourlyEarnings += hours * rate;
        if (source === 'unset') unratedHours += hours;
        sessionCount += 1;
      }
    }

    const salaryAmount = parseFloat(teacher.baseSalary || 0);
    const baseSalary = monthlySalary(teacher.baseSalary, teacher.salaryPeriod);

    return {
      teacher: {
        id: teacher.id,
        fullName: teacher.fullName,
        email: teacher.email,
        avatarUrl: teacher.avatarUrl,
        status: teacher.status,
      },
      salaryAmount,
      salaryPeriod: teacher.salaryPeriod,
      hourlyRate: rateContext.hourlyRate,
      categoryRates: PAY_CATEGORIES.map(({ key, label }) => ({
        category: key,
        label,
        rate: overrides.has(key) ? overrides.get(key) : null,
        effectiveRate: resolveRate(key, rateContext).rate,
        source: resolveRate(key, rateContext).source,
      })),
      hoursByCategory: Object.fromEntries(
        Object.entries(hoursByCategory).map(([k, v]) => [k, round2(v)])
      ),
      sessionCount,
      totalHours: round2(totalHours),
      baseSalary,
      hourlyEarnings: round2(hourlyEarnings),
      totalEarnings: round2(baseSalary + hourlyEarnings),
      // Hours worked at no rate. Carried per row so the screen can point at the
      // person to fix, not just warn that something somewhere is unpriced.
      unratedHours: round2(unratedHours),
    };
  });

  const sum = (pick) => round2(rows.reduce((n, r) => n + pick(r), 0));

  return {
    month: targetMonth,
    year: targetYear,
    rows,
    totals: {
      teachers: rows.length,
      // Only people who actually have something to be paid this month. The
      // roster length counts everyone listed, including the zero rows.
      paidTeachers: rows.filter((r) => r.totalEarnings > 0).length,
      sessionCount: rows.reduce((n, r) => n + r.sessionCount, 0),
      totalHours: sum((r) => r.totalHours),
      baseSalary: sum((r) => r.baseSalary),
      hourlyEarnings: sum((r) => r.hourlyEarnings),
      totalEarnings: sum((r) => r.totalEarnings),
      unratedHours: sum((r) => r.unratedHours),
    },
  };
};
