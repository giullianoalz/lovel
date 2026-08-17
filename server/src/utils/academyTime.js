/**
 * Turning a session's stored schedule into a real instant.
 *
 * `Session.date` is a Postgres DATE and `Session.startTime` a Postgres TIME, so
 * Prisma hands both back stamped at UTC: 1 PM on Aug 10 arrives as
 * "2026-08-10T00:00:00.000Z" plus "1970-01-01T13:00:00.000Z". Neither carries a
 * zone — together they are a wall clock, the one the admin typed into the
 * scheduler, and the academy reads it in America/New_York.
 *
 * Pasting those UTC digits together (`startOfDay.setUTCHours(st.getUTCHours()…)`)
 * produces 13:00 UTC, which is 9 AM local in summer — four hours early, and
 * three in winter. Anything comparing that against `Date.now()` is comparing a
 * clock face to an instant. Go through sessionStartInstant() instead.
 */

export const ACADEMY_TIMEZONE = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ACADEMY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** The wall clock the academy sees at a given instant. */
const academyPartsAt = (instant) => {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(instant)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  // hour12:false still yields 24 for midnight in some ICU versions.
  if (parts.hour === 24) parts.hour = 0;
  return parts;
};

/** Offset of the academy timezone at `instant`, in ms (negative west of UTC). */
const offsetAt = (instant) => {
  const p = academyPartsAt(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
};

/**
 * The instant at which the academy's clock reads the given wall time.
 *
 * The offset itself depends on the instant we are solving for, so this guesses
 * once (reading the wall clock as if it were UTC), then re-reads the offset at
 * that guess. One refinement is enough everywhere except inside a DST
 * transition, where an hour either does not exist or happens twice — 2 AM on
 * two nights a year, when nothing is scheduled.
 */
export const academyWallClockToInstant = (year, month, day, hour, minute = 0, second = 0) => {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPass = asIfUtc - offsetAt(new Date(asIfUtc));
  return new Date(asIfUtc - offsetAt(new Date(firstPass)));
};

/**
 * When a session actually starts, as a real instant.
 * @param {{ date: Date, startTime: Date }} session
 */
export const sessionStartInstant = ({ date, startTime }) => {
  const d = new Date(date);
  const t = new Date(startTime);
  return academyWallClockToInstant(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    t.getUTCHours(),
    t.getUTCMinutes(),
    t.getUTCSeconds(),
  );
};

/**
 * Today's date in the academy's timezone, stamped at UTC midnight so it can be
 * compared against `Session.date` directly. Note this is not the server's UTC
 * date: after 8 PM local the two disagree, and using the UTC one would have the
 * evening looking at tomorrow's schedule.
 */
export const academyToday = (now = new Date()) => {
  const p = academyPartsAt(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
};

/**
 * Now, split the way the calendar stores a booking: today's date at UTC
 * midnight, and the current time of day on the 1970 placeholder day.
 *
 * `Session.date` is a DATE and `Session.endTime` a TIME, and Postgres will not
 * compare a pair of them against an instant. Splitting the clock the same way
 * the columns are split lets a query ask "has this hour finished?" directly:
 * an earlier date, or today with an end time already behind us. Both halves
 * come from the academy's wall clock, so the answer is the one an admin
 * looking at the wall would give.
 */
export const academyNowParts = (now = new Date()) => {
  const p = academyPartsAt(now);
  return {
    date: new Date(Date.UTC(p.year, p.month - 1, p.day)),
    time: new Date(Date.UTC(1970, 0, 1, p.hour, p.minute, p.second)),
  };
};

/**
 * An instant as "2:10 PM" on the academy's wall clock.
 *
 * `Date.prototype.toLocaleTimeString()` with no zone uses the *server's* zone,
 * and Render runs in UTC — every timestamp it rendered came out four hours
 * ahead of the front desk in summer, three in winter.
 */
const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ACADEMY_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
export const formatAcademyClock = (instant) => clockFormatter.format(new Date(instant));

/** Midnight tonight-just-gone on the academy's clock, as a real instant. */
export const academyStartOfDay = (now = new Date()) => {
  const p = academyPartsAt(now);
  return academyWallClockToInstant(p.year, p.month, p.day, 0, 0, 0);
};

/** `academyToday` shifted by whole days — for windows that cross midnight. */
export const academyDayOffset = (dateOnly, days) =>
  new Date(dateOnly.getTime() + days * 86_400_000);
