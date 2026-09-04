/**
 * The days the academy did not open.
 *
 * Payroll asks this question constantly and the answer changes a few times a
 * year, so the list is cached in-process exactly like the pay categories next
 * door, and dropped whenever it is written.
 *
 * Everything here deals in `YYYY-MM-DD` strings rather than Dates. The stored
 * column is a DATE and the question is always "is this calendar day closed",
 * never an instant — comparing Date objects would drag the answer across a
 * timezone the moment the server and the academy disagree about midnight.
 */

import prisma from '../config/database.js';

let cache = null;
let cachedAt = 0;
const TTL_MS = 60_000;

export const invalidateClosures = () => {
  cache = null;
  cachedAt = 0;
};

/** `YYYY-MM-DD` for a Date, read in UTC to match how DATE columns come back. */
export const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

/** A UTC-midnight Date for a `YYYY-MM-DD`, which is how DATE columns are written. */
export const dayToDate = (iso) => new Date(`${iso}T00:00:00.000Z`);

/** Every closure, soonest first. */
export const loadClosures = async () => {
  if (!cache || Date.now() - cachedAt > TTL_MS) {
    const rows = await prisma.academyClosure.findMany({ orderBy: { date: 'asc' } });
    cache = rows.map((r) => ({
      id: r.id,
      day: isoDay(r.date),
      label: r.label,
      notes: r.notes ?? null,
      createdById: r.createdById ?? null,
    }));
    cachedAt = Date.now();
  }
  return cache;
};

/**
 * The closed days as Dates, ready to drop into a Prisma `date: { notIn }`.
 *
 * Returns Dates rather than strings because that is what the query layer wants,
 * and an empty array so callers can spread the result unconditionally.
 */
export const loadClosedDates = async () => (await loadClosures()).map((c) => dayToDate(c.day));

/** The closure covering a day, or null. Takes the list so callers fetch once. */
export const closureOn = (closures, value) => {
  const day = isoDay(value);
  return closures.find((c) => c.day === day) ?? null;
};

/**
 * The days from `start` to `end` inclusive, as `YYYY-MM-DD`.
 *
 * A break is declared as a range and stored a day at a time — see the model
 * comment. Capped, because a typo in a year turns one request into a decade of
 * rows and the caller should hear about it rather than discover it later.
 */
export const MAX_RANGE_DAYS = 120;

export const expandRange = (start, end) => {
  const from = isoDay(start);
  const to = isoDay(end ?? start);
  if (to < from) return { error: 'endDate cannot be before startDate.' };

  const days = [];
  const cursor = dayToDate(from);
  const last = dayToDate(to);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (days.length > MAX_RANGE_DAYS) {
      return { error: `A closure cannot span more than ${MAX_RANGE_DAYS} days.` };
    }
  }
  return { days };
};

/**
 * What a day would cost if it were left open — the hours and money that stop
 * being owed the moment it is declared closed.
 *
 * Shown before the closure is saved, because "this removes $280 from four
 * people" is the fact an admin needs in order to decide, and after the fact it
 * is a silent subtraction from somebody's payslip.
 */
export const closureImpact = async (days) => {
  const dates = days.map(dayToDate);
  const [sessions, shifts] = await Promise.all([
    prisma.session.findMany({
      where: { date: { in: dates }, status: { not: 'CANCELLED' }, absentAt: null },
      select: {
        date: true, startTime: true, endTime: true, paidRate: true, chargeAmount: true,
        teacher: { select: { fullName: true } },
        class: { select: { name: true, teacher: { select: { fullName: true } } } },
      },
    }),
    prisma.workShift.findMany({
      where: { date: { in: dates }, status: { not: 'CANCELLED' }, absentAt: null },
      select: { date: true, startTime: true, endTime: true, paidRate: true, staff: { select: { fullName: true } } },
    }),
  ]);

  const hours = (e) => {
    const h = (new Date(e.endTime) - new Date(e.startTime)) / 3_600_000;
    return h > 0 ? h : 0;
  };
  // Only what is already stamped can be quantified here. An unfrozen hour has
  // no price yet — it would have to be resolved through the whole rate cascade,
  // and reporting a guess next to a real figure would make the guess look like
  // one. Counted as hours instead.
  const frozenPay = [...sessions, ...shifts]
    .reduce((n, e) => n + (e.paidRate == null ? 0 : parseFloat(e.paidRate) * hours(e)), 0);

  return {
    sessions: sessions.length,
    shifts: shifts.length,
    hours: Math.round((sessions.reduce((n, s) => n + hours(s), 0)
      + shifts.reduce((n, s) => n + hours(s), 0)) * 100) / 100,
    frozenPay: Math.round(frozenPay * 100) / 100,
    // A priced meeting on a closed day would bill families for a day nobody
    // came in, so it is called out separately from the pay.
    pricedSessions: sessions.filter((s) => s.chargeAmount != null).length,
    people: [...new Set([
      ...sessions.map((s) => s.teacher?.fullName ?? s.class.teacher?.fullName).filter(Boolean),
      ...shifts.map((s) => s.staff?.fullName).filter(Boolean),
    ])].sort(),
  };
};
