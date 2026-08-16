import cron from 'node-cron';
import prisma from '../config/database.js';
import { sendNotification, notifyAdmins } from './notification.helper.js';
import { previousOccurrence } from './cronSchedule.js';
import { runRecurringCharges } from '../services/recurringCharges.service.js';
import { freezeSessionRates, freezeShiftRates } from '../services/payroll.service.js';
import { buildSessionCharges } from '../services/sessionCharges.service.js';
import {
  getEventConfig,
  getAdminUserIds,
  getParentUserIdsForStudents,
} from '../services/notificationConfig.service.js';
import { ACADEMY_TIMEZONE, academyToday, academyDayOffset, sessionStartInstant } from '../utils/academyTime.js';

/**
 * Scheduled background jobs for the Academy Management System.
 *
 * Schedule overview:
 *   - Overdue invoices check       → every day at 8:00 AM
 *   - Absence alert trigger        → every day at 5:00 PM (after last class)
 *   - Low snack-punches alert      → every Monday at 7:00 AM
 *   - Class starting-soon reminder → every 5 minutes
 *   - Pay accrual (rate stamping)  → every hour, five past
 *   - Weekly billing review        → every Monday at 9:00 AM
 *
 * All jobs are registered in the JOBS table at the bottom of this file and
 * started by calling startCronJobs() from index.js after the server starts.
 *
 * Every run is recorded in the CronJobRun table, which lets startCronJobs()
 * also perform a catch-up pass: node-cron only fires forward from process
 * start, so a job whose slot elapsed while the server was down (deploy, crash,
 * host spin-down) would otherwise be silently skipped until the next slot —
 * an overdue-invoice sweep missed at 8 AM would wait a whole day. The handlers
 * are all idempotent (date-scoped dedupKeys, idempotent status writes), so
 * re-running one late is safe.
 */

// Same constant the session math uses, so the schedule that fires these jobs and
// the clock they reason about can never drift apart.
const TIMEZONE = ACADEMY_TIMEZONE;

// ─────────────────────────────────────────────────────────────
// JOB 1 — Overdue Invoice Alerts
// Every day at 8:00 AM: find invoices past due_date that are
// still SENT or PARTIAL, and notify the admin + parent.
// ─────────────────────────────────────────────────────────────
const checkOverdueInvoices = async () => {
  console.log('[CRON] Checking overdue invoices…');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdue = await prisma.invoice.findMany({
    where: {
      status: { in: ['SENT', 'PARTIAL'] },
      dueDate: { lt: today },
    },
    include: {
      family: {
        include: {
          members: {
            where: { isInvoiceRecipient: true },
            include: { user: { select: { id: true, fullName: true, email: true } } },
          },
        },
      },
    },
  });

  if (overdue.length === 0) {
    console.log('[CRON] No overdue invoices found.');
    return;
  }

  console.log(`[CRON] Found ${overdue.length} overdue invoice(s).`);

  // Marking invoices OVERDUE is an accounting state that must happen even if
  // the alert is switched off; only the notifications are gated by config.
  const config = await getEventConfig('PAYMENT_OVERDUE');
  const notify = config?.enabled && config.audience.length > 0;
  const adminIds = notify && config.audience.includes('ADMINS') ? await getAdminUserIds() : [];
  const todayStr = new Date().toISOString().split('T')[0];

  for (const invoice of overdue) {
    const daysOverdue = Math.floor((Date.now() - new Date(invoice.dueDate)) / 86_400_000);

    if (notify) {
      const recipients = new Set(adminIds);
      if (config.audience.includes('PARENTS')) {
        (invoice.family?.members || []).forEach((m) => m.user && recipients.add(m.user.id));
      }

      for (const userId of recipients) {
        await sendNotification({
          userId,
          type: 'PAYMENT_OVERDUE',
          title: `Invoice ${invoice.invoiceNumber} is overdue`,
          message: `Invoice ${invoice.invoiceNumber} of $${Number(invoice.totalAmount).toFixed(2)} was due ${daysOverdue} day(s) ago.`,
          referenceType: 'invoice',
          referenceId: invoice.id,
          dedupKey: `overdue-invoice-${invoice.id}-${todayStr}`,
        });
      }
    }

    // Mark invoice as OVERDUE in DB
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'OVERDUE' },
    });
  }
};

// ─────────────────────────────────────────────────────────────
// JOB 2 — Repeated Absence Alert
// Every day at 5 PM: check today's attendance and flag students
// who have missed 3 or more sessions in the past 30 days.
// Notifies admin once per student per day.
// ─────────────────────────────────────────────────────────────
const checkRepeatedAbsences = async () => {
  console.log('[CRON] Checking repeated absences…');
  const config = await getEventConfig('REPEATED_ABSENCE');
  if (!config?.enabled || config.audience.length === 0) return;

  const { thresholdCount, windowDays } = config.params;

  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  since.setHours(0, 0, 0, 0);

  // Count absences per student within the configured window
  const absences = await prisma.attendance.groupBy({
    by: ['studentId'],
    where: {
      status: { in: ['ABSENT', 'EXCUSED'] },
      checkedAt: { gte: since },
    },
    _count: { id: true },
    having: { id: { _count: { gte: thresholdCount } } },
  });

  if (absences.length === 0) {
    console.log('[CRON] No repeated-absence alerts needed.');
    return;
  }

  const adminIds = config.audience.includes('ADMINS') ? await getAdminUserIds() : [];
  const todayStr = new Date().toISOString().split('T')[0];

  for (const row of absences) {
    const student = await prisma.user.findUnique({
      where: { id: row.studentId },
      select: { id: true, fullName: true },
    });
    if (!student) continue;

    const count = row._count.id;
    const recipients = new Set(adminIds);
    if (config.audience.includes('PARENTS')) {
      const parentIds = await getParentUserIdsForStudents([student.id]);
      parentIds.forEach((id) => recipients.add(id));
    }

    for (const userId of recipients) {
      await sendNotification({
        userId,
        type: 'REPEATED_ABSENCE',
        title: `Repeated absences — ${student.fullName}`,
        message: `${student.fullName} has missed ${count} session(s) in the last ${windowDays} days.`,
        referenceType: 'student',
        referenceId: student.id,
        dedupKey: `repeated-absence-${student.id}-${todayStr}`,
      });
    }
  }

  console.log(`[CRON] Absence alerts sent for ${absences.length} student(s).`);
};

// ─────────────────────────────────────────────────────────────
// JOB 3 — Low Snack Punches Alert
// Every Monday at 7 AM: notify admin for students with 0 punches
// who are snack-authorized (should have balance replenished).
// ─────────────────────────────────────────────────────────────
const checkLowSnackPunches = async () => {
  console.log('[CRON] Checking low snack punches…');
  const config = await getEventConfig('LOW_SNACK_PUNCHES');
  if (!config?.enabled || config.audience.length === 0) return;

  const { thresholdPunches } = config.params;

  const lowPunch = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      snackAuthorized: true,
      snackPunches: { lte: thresholdPunches },
    },
    select: { id: true, fullName: true, snackPunches: true },
  });

  if (lowPunch.length === 0) {
    console.log('[CRON] All snack balances are healthy.');
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // Admins get a single roll-up listing every low student.
  if (config.audience.includes('ADMINS')) {
    const adminIds = await getAdminUserIds();
    const names = lowPunch.map((s) => `${s.fullName} (${s.snackPunches} punches)`).join(', ');
    for (const userId of adminIds) {
      await sendNotification({
        userId,
        type: 'LOW_SNACK_PUNCHES',
        title: `${lowPunch.length} student(s) have low snack punches`,
        message: `The following students need a snack punch top-up: ${names}.`,
        referenceType: 'snack',
        referenceId: null,
        dedupKey: `low-snack-${todayStr}`,
      });
    }
  }

  // Parents get a message about their own child only — never the full roster.
  if (config.audience.includes('PARENTS')) {
    for (const student of lowPunch) {
      const parentIds = await getParentUserIdsForStudents([student.id]);
      for (const userId of parentIds) {
        await sendNotification({
          userId,
          type: 'LOW_SNACK_PUNCHES',
          title: `${student.fullName} is low on snack punches`,
          message: `${student.fullName} has ${student.snackPunches} snack punch(es) left. Consider topping up.`,
          referenceType: 'snack',
          referenceId: student.id,
          dedupKey: `low-snack-${student.id}-${todayStr}`,
        });
      }
    }
  }

  console.log(`[CRON] Low-snack alert sent for ${lowPunch.length} student(s).`);
};

// ─────────────────────────────────────────────────────────────
// JOB 4 — Class Starting-Soon Reminder
// Every 5 minutes: notify parents of enrolled students when their
// class starts within the admin-configured window (default 15 min).
// Runs on a 5-minute tick, not per-minute, to keep this cheap — each
// session is only ever within the reminder window for one or two ticks,
// and sendNotification's dedupKey makes re-catching it on a later tick
// (a missed run, server restart, etc.) a no-op rather than a duplicate push.
// ─────────────────────────────────────────────────────────────
const sendClassStartingSoonReminders = async () => {
  const config = await getEventConfig('CLASS_REMINDER');
  if (!config?.enabled || config.audience.length === 0) return;

  const minutesBefore = config.params.minutesBefore;
  const notifyAdmins = config.audience.includes('ADMINS');
  const notifyParents = config.audience.includes('PARENTS');
  const adminIds = notifyAdmins ? await getAdminUserIds() : [];
  const now = new Date();
  // The academy's today, not the server's: after 8 PM local the UTC date has
  // already rolled over, and this job would be reading tomorrow's schedule.
  //
  // Tomorrow is pulled in as well because minutesBefore is admin-configurable.
  // At the default 15 minutes a reminder never leaves the day it belongs to,
  // but widen it to an hour and a 00:30 class needs to be visible at 23:30 the
  // night before — on today's query alone it would simply never be reminded.
  const todayDateOnly = academyToday(now);
  const tomorrowDateOnly = academyDayOffset(todayDateOnly, 1);

  const sessions = await prisma.session.findMany({
    where: { date: { in: [todayDateOnly, tomorrowDateOnly] }, status: 'SCHEDULED' },
    include: {
      class: {
        select: {
          name: true,
          enrollments: {
            where: { status: 'active' },
            select: { studentId: true },
          },
        },
      },
    },
  });

  if (sessions.length === 0) return;

  for (const session of sessions) {
    const minutesUntilStart = (sessionStartInstant(session).getTime() - now.getTime()) / 60000;
    // Already started, or further out than the configured window — skip.
    if (minutesUntilStart <= 0 || minutesUntilStart > minutesBefore) continue;

    const studentIds = session.class.enrollments.map((e) => e.studentId);
    if (studentIds.length === 0) continue;

    const recipients = new Set(adminIds);
    if (notifyParents) {
      const parentIds = await getParentUserIdsForStudents(studentIds);
      parentIds.forEach((id) => recipients.add(id));
    }
    if (recipients.size === 0) continue;

    const roundedMinutes = Math.max(1, Math.round(minutesUntilStart));
    for (const userId of recipients) {
      await sendNotification({
        userId,
        type: 'CLASS_REMINDER',
        title: `${session.class.name} starts soon`,
        message: `Class starts in about ${roundedMinutes} minute(s).`,
        referenceType: 'session',
        referenceId: session.id,
        dedupKey: `class-reminder-${session.id}-${userId}`,
      });
    }
  }
};

// ─────────────────────────────────────────────────────────────
// JOB 5 — Standing Monthly Charges
// Every day at 6:00 AM: raise the charges whose day of the month has come.
//
// Daily rather than monthly on purpose. Arrangements are billed on different
// days (the 1st, the 15th), and a single monthly slot would either bill them
// all on the same day or need one job per day. This asks the same question
// every morning — "who is due and not yet charged this month?" — which is also
// what makes it safe to miss a day: the charge is raised on the next run.
// ─────────────────────────────────────────────────────────────
const raiseRecurringCharges = async () => {
  console.log('[CRON] Raising standing monthly charges…');
  const result = await runRecurringCharges();

  if (result.createdCount > 0) {
    console.log(`[CRON] ${result.periodKey}: raised ${result.createdCount} charge(s), ${result.skippedCount} already done`);
  }
  // A failure here is money that did not get billed, so it is worth waking
  // somebody rather than sitting in a log nobody reads.
  if (result.failed.length > 0) {
    console.error('[CRON] Recurring charges failed:', result.failed);
    await notifyAdmins({
      type: 'BILLING_ALERT',
      title: 'Some monthly charges could not be raised',
      message: `${result.failed.length} standing charge(s) failed for ${result.periodKey}. They will be retried tomorrow, but the families are not billed yet.`,
      dedupKey: `recurring-charges-failed-${result.periodKey}`,
    });
  }
};

// ─────────────────────────────────────────────────────────────
// JOB TABLE
// `name` is the CronJobRun key — renaming one resets its history, which only
// costs a single skipped catch-up, but keep them stable anyway.
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// JOB 6 — Pay accrual
// Every hour: stamp the rate onto the classes and shifts whose
// hour has just ended, so a later raise cannot reprice them.
// ─────────────────────────────────────────────────────────────

/**
 * Pins the rate onto the hours that have just been earned.
 *
 * Pay accrues from the calendar now — an hour that has passed is an hour that
 * is owed — which means there is no longer a moment when a human confirms a
 * class and the rate can be stamped. The clock provides that moment instead:
 * every hour, everything that ended since the last sweep gets today's rate
 * written onto it, and from then on a raise cannot reach backwards and reprice
 * work that was done under the old contract.
 *
 * A week's lookback rather than an hour's, because this must not depend on
 * having run: a deploy, an outage or a clock skew would otherwise leave a band
 * of hours pricing live forever. Re-stamping is free — freezeSessionRates only
 * fills entries that have no rate yet — so a wide, dumb window is the cheap way
 * to be sure nothing slips through.
 */
const accruePay = async () => {
  const since = academyDayOffset(academyToday(), -7);

  const [sessions, shifts] = await Promise.all([
    prisma.session.findMany({
      where: { date: { gte: since }, paidRate: null },
      select: { id: true },
    }),
    prisma.workShift.findMany({
      where: { date: { gte: since }, paidRate: null },
      select: { id: true },
    }),
  ]);

  // Both helpers re-check payability themselves, so anything in the window that
  // is cancelled, absent or still in the future is skipped rather than paid.
  const [sessionCount, shiftCount] = await Promise.all([
    freezeSessionRates(sessions.map((s) => s.id)),
    freezeShiftRates(shifts.map((s) => s.id)),
  ]);

  if (sessionCount || shiftCount) {
    console.log(`[CRON] Pay accrual: priced ${sessionCount} session(s) and ${shiftCount} shift(s).`);
  }
};

// ─────────────────────────────────────────────────────────────
// JOB 7 — Weekly billing review
// Every Monday: count what the priced calendar entries are
// waiting to charge, and put it in front of an admin. Never
// charges anything on its own.
// ─────────────────────────────────────────────────────────────

/**
 * Tells an admin there is money waiting to be approved.
 *
 * Charging is weekly, and the approval is not optional: a price on a calendar
 * entry is a draft until a person releases it, and nothing here changes that.
 * What this job fixes is the other half of the problem — a review step nobody
 * is reminded about is a review step that gets skipped, and the charges then sit
 * unbilled for a month while the families who owe them forget the lesson ever
 * happened.
 *
 * Deliberately only a notification. It would be a small change to have this
 * raise the charges itself, and that is exactly the change that must not be
 * made: the whole point of the gap between pricing and charging is that a
 * human looks at the number first.
 */
const remindWeeklyBillingReview = async () => {
  const { summary } = await buildSessionCharges({});

  if (summary.billable === 0) {
    console.log('[CRON] Weekly billing review: nothing waiting.');
    return;
  }

  const waived = summary.waived > 0
    ? ` ${summary.overridden} line${summary.overridden === 1 ? '' : 's'} priced down by $${summary.waived.toLocaleString()}.`
    : '';

  await notifyAdmins({
    type: 'BILLING',
    title: `$${summary.total.toLocaleString()} waiting to be charged`,
    message:
      `${summary.billable} charge${summary.billable === 1 ? '' : 's'} across ${summary.sessions} `
      + `meeting${summary.sessions === 1 ? '' : 's'} are priced and waiting for approval.${waived} `
      + `Review them under Billing → Calendar Charges. Nothing has been billed.`,
    referenceType: 'billing',
    // One reminder per week, not one per boot: the catch-up pass re-runs a
    // missed job, and without this a Monday spent redeploying would stack up
    // identical alerts.
    dedupKey: `weekly-billing-review:${academyToday().toISOString().slice(0, 10)}`,
  });

  console.log(`[CRON] Weekly billing review: flagged $${summary.total} across ${summary.sessions} meeting(s).`);
};

const JOBS = [
  {
    name: 'overdue-invoices',
    schedule: '0 8 * * *', // every day at 8:00 AM
    handler: checkOverdueInvoices,
  },
  {
    name: 'repeated-absences',
    schedule: '0 17 * * *', // every day at 5:00 PM
    handler: checkRepeatedAbsences,
  },
  {
    name: 'low-snack-punches',
    schedule: '0 7 * * 1', // every Monday at 7:00 AM
    handler: checkLowSnackPunches,
  },
  {
    name: 'class-reminders',
    schedule: '*/5 * * * *', // every 5 minutes
    handler: sendClassStartingSoonReminders,
  },
  {
    name: 'recurring-charges',
    schedule: '0 6 * * *', // every day at 6:00 AM
    handler: raiseRecurringCharges,
  },
  {
    name: 'pay-accrual',
    schedule: '5 * * * *', // every hour, just after the hour
    handler: accruePay,
  },
  {
    name: 'weekly-billing-review',
    schedule: '0 9 * * 1', // every Monday at 9:00 AM
    handler: remindWeeklyBillingReview,
  },
];

// ─────────────────────────────────────────────────────────────
// RUN BOOKKEEPING + CATCH-UP
// ─────────────────────────────────────────────────────────────

// Guards against a slow run overlapping its own next tick (or the boot
// catch-up) — the handlers are idempotent, but running two copies of the
// overdue sweep concurrently only wastes queries.
const inFlight = new Set();

const recordRun = async (jobName, ranAt, error) => {
  try {
    await prisma.cronJobRun.upsert({
      where: { jobName },
      // A failed run deliberately leaves lastRunAt untouched: the schedule is
      // then still "missed", so the next boot's catch-up retries it.
      update: error
        ? { lastStatus: 'error', lastError: String(error.message || error).slice(0, 500) }
        : { lastRunAt: ranAt, lastStatus: 'ok', lastError: null },
      create: {
        jobName,
        lastRunAt: error ? null : ranAt,
        lastStatus: error ? 'error' : 'ok',
        lastError: error ? String(error.message || error).slice(0, 500) : null,
      },
    });
  } catch (err) {
    // Losing the bookkeeping must never take the job down with it; the worst
    // case is one redundant catch-up run on the next boot.
    console.error(`[CRON] Could not record run for ${jobName}:`, err.message);
  }
};

/**
 * Single error boundary + bookkeeping wrapper around every job handler.
 * @param {object} job     - entry from JOBS
 * @param {string} trigger - 'schedule' | 'catch-up', for the logs only
 */
const runJob = async (job, trigger) => {
  if (inFlight.has(job.name)) {
    console.warn(`[CRON] ${job.name} is still running — skipping this ${trigger} run.`);
    return;
  }

  inFlight.add(job.name);
  const startedAt = new Date();
  try {
    await job.handler();
    await recordRun(job.name, startedAt, null);
  } catch (err) {
    console.error(`[CRON] ${job.name} (${trigger}) failed:`, err);
    await recordRun(job.name, startedAt, err);
  } finally {
    inFlight.delete(job.name);
  }
};

/**
 * Re-runs, once at boot, any job whose most recent scheduled slot passed
 * without a recorded successful run — i.e. the slots missed while the process
 * was down. Jobs run sequentially so a long outage does not open every query
 * path at once.
 *
 * A job with no history at all is *seeded*, not run: the first boot after this
 * shipped (or on a fresh database) has no evidence anything was missed, and
 * firing all four at once would be a burst of alerts nobody asked for.
 */
export const runStartupCatchUp = async () => {
  const now = new Date();
  const history = await prisma.cronJobRun.findMany({
    where: { jobName: { in: JOBS.map((j) => j.name) } },
    select: { jobName: true, lastRunAt: true },
  });
  const lastRunByJob = new Map(history.map((row) => [row.jobName, row.lastRunAt]));

  for (const job of JOBS) {
    // Scoped so one job's bad schedule or seeding race cannot cancel the
    // catch-up for the jobs after it.
    try {
      const expectedAt = previousOccurrence(job.schedule, { timezone: TIMEZONE, now });
      if (!expectedAt) continue; // schedule has no slot in the lookback window

      if (!lastRunByJob.has(job.name)) {
        await prisma.cronJobRun.create({
          data: { jobName: job.name, lastRunAt: now, lastStatus: 'seeded' },
        });
        console.log(`[CRON] Catch-up: no history for ${job.name} — seeded, not run.`);
        continue;
      }

      const lastRunAt = lastRunByJob.get(job.name);
      if (lastRunAt && lastRunAt >= expectedAt) continue; // already ran for that slot

      console.log(
        `[CRON] Catch-up: running ${job.name} — due ${expectedAt.toISOString()}, `
        + `last run ${lastRunAt ? lastRunAt.toISOString() : 'never'}.`,
      );
      await runJob(job, 'catch-up');
    } catch (err) {
      console.error(`[CRON] Catch-up for ${job.name} failed:`, err);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// REGISTER ALL JOBS
// ─────────────────────────────────────────────────────────────
export const startCronJobs = () => {
  // Opt-out, and — like the test-login gate in middleware/auth.js — never
  // inferred from NODE_ENV: a deployment that forgets to set it would
  // otherwise silently stop reminding anyone of anything.
  //
  // Set this on any host whose DATABASE_URL points somewhere it should not be
  // writing. These jobs are not read-only bookkeeping: class-reminders runs
  // every five minutes and creates real Notification rows, so a laptop sharing
  // the production connection string quietly notifies real families.
  if (process.env.DISABLE_CRON === 'true') {
    console.log('[CRON] DISABLE_CRON=true — no jobs registered, no startup catch-up.');
    return;
  }

  for (const job of JOBS) {
    cron.schedule(job.schedule, () => runJob(job, 'schedule'), { timezone: TIMEZONE });
  }

  console.log(`[CRON] ${JOBS.length} scheduled jobs registered ✔`);

  // Deliberately not awaited: a slow catch-up (or an unreachable database)
  // must not hold up the process that just started listening.
  runStartupCatchUp().catch((err) => {
    console.error('[CRON] Startup catch-up failed:', err);
  });
};
