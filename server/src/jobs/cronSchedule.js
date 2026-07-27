/**
 * Minimal 5-field cron evaluation, used to answer one question the scheduler
 * itself cannot: "when *should* this job last have run?"
 *
 * node-cron only fires forward from the moment it is registered, so after a
 * restart (deploy, crash, Render spin-down) there is no way to ask it what was
 * missed. The startup catch-up in cron.jobs.js compares the answer from
 * previousOccurrence() against the last recorded run to decide what to re-run.
 *
 * Supports the subset of cron syntax this codebase uses: `*`, plain numbers,
 * `a-b` ranges, `a,b` lists and `/n` steps. Names (JAN, MON), `?`, `L` and `#`
 * are intentionally not supported — they throw rather than silently mismatch.
 */

const MINUTE_MS = 60_000;

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 7 },
];

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const parseField = (raw, field) => {
  const values = new Set();

  for (const part of raw.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid step in ${field.name} field: "${part}"`);
    }

    let from;
    let to;
    if (range === '*') {
      from = field.min;
      to = field.max;
    } else if (range.includes('-')) {
      [from, to] = range.split('-').map(Number);
    } else {
      from = Number(range);
      to = from;
    }

    if (
      !Number.isInteger(from) || !Number.isInteger(to)
      || from < field.min || to > field.max || from > to
    ) {
      throw new Error(`Invalid ${field.name} field: "${part}"`);
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values;
};

/**
 * @param {string} expression - standard 5-field cron expression
 * @returns {object} parsed field sets plus the two restriction flags needed for
 *                   cron's day-of-month / day-of-week OR rule
 */
export const parseCron = (expression) => {
  const parts = String(expression).trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected a 5-field cron expression, got ${parts.length}: "${expression}"`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((part, i) => parseField(part, FIELDS[i]));

  // Cron accepts both 0 and 7 for Sunday; normalise to 0 to match Date's numbering.
  if (dayOfWeek.delete(7)) dayOfWeek.add(0);

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    // Long-standing cron quirk: when *both* day-of-month and day-of-week are
    // restricted they are OR'd together, not AND'd.
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
};

const formatterCache = new Map();

const formatterFor = (timezone) => {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
};

/** Wall-clock fields of an instant as seen in `timezone` — the same view node-cron matches against. */
const fieldsInZone = (date, timezone) => {
  const parts = {};
  for (const { type, value } of formatterFor(timezone).formatToParts(date)) parts[type] = value;

  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: WEEKDAY_INDEX[parts.weekday],
  };
};

const matches = (cron, at) => {
  if (!cron.minute.has(at.minute) || !cron.hour.has(at.hour) || !cron.month.has(at.month)) return false;

  const dayOfMonthHit = cron.dayOfMonth.has(at.dayOfMonth);
  const dayOfWeekHit = cron.dayOfWeek.has(at.dayOfWeek);
  if (cron.domRestricted && cron.dowRestricted) return dayOfMonthHit || dayOfWeekHit;
  return dayOfMonthHit && dayOfWeekHit;
};

/**
 * Most recent instant at or before `now` that `expression` would have fired in
 * `timezone`, found by walking back a minute at a time. Brute force is fine
 * here: this runs once per job at boot, off the request path, and even the
 * weekly schedule resolves in ~100 ms of Intl formatting.
 *
 * @param {string} expression
 * @param {object} opts
 * @param {string} opts.timezone         - IANA zone the job is scheduled in
 * @param {Date}   [opts.now]
 * @param {number} [opts.maxLookbackDays] - give up past this horizon
 * @returns {Date|null} the fire time, minute-truncated, or null if none in range
 */
export const previousOccurrence = (expression, { timezone, now = new Date(), maxLookbackDays = 40 } = {}) => {
  const cron = parseCron(expression);

  let candidate = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const steps = maxLookbackDays * 24 * 60;

  for (let i = 0; i <= steps; i += 1) {
    if (matches(cron, fieldsInZone(candidate, timezone))) return candidate;
    candidate = new Date(candidate.getTime() - MINUTE_MS);
  }

  return null;
};
