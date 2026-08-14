/**
 * Time-of-day helpers for Session.startTime / Session.endTime.
 *
 * Those columns are Postgres `TIME`, and Prisma hands them back as a Date on a
 * 1970-01-01 placeholder: 2:10 PM is stored and serialised as
 * "1970-01-01T14:10:00.000Z". The value is a wall clock, not an instant — the
 * write path builds it the same way (`new Date(\`1970-01-01T${hhmm}:00Z\`)` in
 * sessions.controller).
 *
 * So it must always be read back with the UTC getters. Formatting it with
 * toLocaleTimeString() converts a clock face that was never in UTC, and since
 * the placeholder date sits in January every US timezone applies its *standard*
 * offset: a 2:10 PM class rendered as 9:10 AM year-round.
 */

/** Accepts "14:10", "14:10:00" or an ISO/Date value. Returns {h, m}. */
export const timeOfDayParts = (value) => {
  if (value instanceof Date) return { h: value.getUTCHours(), m: value.getUTCMinutes() };
  if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    return { h, m };
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { h: 0, m: 0 } : { h: d.getUTCHours(), m: d.getUTCMinutes() };
};

/** "1970-01-01T14:10:00.000Z" or "14:10" → "2:10 PM". */
export const formatTimeOfDay = (value) => {
  const { h, m } = timeOfDayParts(value);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

/** Minutes since midnight — for comparing a class slot against the clock. */
export const timeOfDayMinutes = (value) => {
  const { h, m } = timeOfDayParts(value);
  return h * 60 + m;
};

/**
 * Session.date is a date-only column, also stamped at UTC midnight. Reading it
 * with the local getters shows the day before for anyone behind UTC — a Monday
 * class advertised to students as Sunday. Format from the UTC parts instead.
 *
 * Only for date-only columns: real timestamps (createdAt, publishedAt) are
 * instants and should keep using toLocaleDateString directly.
 */
export const formatDateOnly = (value, options = { month: 'short', day: 'numeric' }) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).toLocaleDateString('en-US', options);
};

/** Minutes since midnight for right now, in the viewer's own timezone. */
export const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/**
 * Parses a date string (like "YYYY-MM-DD" or "1970-01-01T00:00:00.000Z") into
 * a local Date object that represents the same year/month/day at local midnight,
 * preventing timezone shifts from crossing into the previous day.
 */
export const parseDateOnly = (value) => {
  if (!value) return new Date();
  const str = typeof value === 'string' ? value : value.toISOString();
  const [y, m, d] = str.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
};
