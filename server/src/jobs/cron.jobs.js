import cron from 'node-cron';
import prisma from '../config/database.js';
import { sendNotification } from './notification.helper.js';
import {
  getEventConfig,
  getAdminUserIds,
  getParentUserIdsForStudents,
} from '../services/notificationConfig.service.js';

/**
 * Scheduled background jobs for the Academy Management System.
 *
 * Schedule overview:
 *   - Overdue invoices check       → every day at 8:00 AM
 *   - Absence alert trigger        → every day at 5:00 PM (after last class)
 *   - Low snack-punches alert      → every Monday at 7:00 AM
 *   - Class starting-soon reminder → every 5 minutes
 *
 * All jobs are registered here and started by calling startCronJobs()
 * from index.js after the server starts.
 */

// ─────────────────────────────────────────────────────────────
// JOB 1 — Overdue Invoice Alerts
// Every day at 8:00 AM: find invoices past due_date that are
// still SENT or PARTIAL, and notify the admin + parent.
// ─────────────────────────────────────────────────────────────
const checkOverdueInvoices = async () => {
  console.log('[CRON] Checking overdue invoices…');
  try {
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
  } catch (err) {
    console.error('[CRON] checkOverdueInvoices error:', err);
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
  try {
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
  } catch (err) {
    console.error('[CRON] checkRepeatedAbsences error:', err);
  }
};

// ─────────────────────────────────────────────────────────────
// JOB 3 — Low Snack Punches Alert
// Every Monday at 7 AM: notify admin for students with 0 punches
// who are snack-authorized (should have balance replenished).
// ─────────────────────────────────────────────────────────────
const checkLowSnackPunches = async () => {
  console.log('[CRON] Checking low snack punches…');
  try {
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
  } catch (err) {
    console.error('[CRON] checkLowSnackPunches error:', err);
  }
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
  try {
    const config = await getEventConfig('CLASS_REMINDER');
    if (!config?.enabled || config.audience.length === 0) return;

    const minutesBefore = config.params.minutesBefore;
    const notifyAdmins = config.audience.includes('ADMINS');
    const notifyParents = config.audience.includes('PARENTS');
    const adminIds = notifyAdmins ? await getAdminUserIds() : [];
    const now = new Date();
    const todayDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const sessions = await prisma.session.findMany({
      where: { date: todayDateOnly, status: 'SCHEDULED' },
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
      const startAt = new Date(todayDateOnly);
      const st = new Date(session.startTime);
      startAt.setUTCHours(st.getUTCHours(), st.getUTCMinutes(), st.getUTCSeconds());

      const minutesUntilStart = (startAt.getTime() - now.getTime()) / 60000;
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
  } catch (err) {
    console.error('[CRON] sendClassStartingSoonReminders error:', err);
  }
};

// ─────────────────────────────────────────────────────────────
// REGISTER ALL JOBS
// ─────────────────────────────────────────────────────────────
export const startCronJobs = () => {
  // Every day at 8:00 AM
  cron.schedule('0 8 * * *', checkOverdueInvoices, {
    timezone: 'America/New_York',
  });

  // Every day at 5:00 PM
  cron.schedule('0 17 * * *', checkRepeatedAbsences, {
    timezone: 'America/New_York',
  });

  // Every Monday at 7:00 AM
  cron.schedule('0 7 * * 1', checkLowSnackPunches, {
    timezone: 'America/New_York',
  });

  // Every 5 minutes
  cron.schedule('*/5 * * * *', sendClassStartingSoonReminders, {
    timezone: 'America/New_York',
  });

  console.log('[CRON] All scheduled jobs registered ✔');
};
