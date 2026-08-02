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

  const baseSalary = parseFloat(teacher.baseSalary || 0);
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
