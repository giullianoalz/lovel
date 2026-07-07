import cron from 'node-cron';
import prisma from '../config/database.js';
import { sendNotification } from './notification.helper.js';

/**
 * Scheduled background jobs for the Academy Management System.
 *
 * Schedule overview:
 *   - Overdue invoices check  → every day at 8:00 AM
 *   - Absence alert trigger   → every day at 5:00 PM (after last class)
 *   - Low snack-punches alert → every Monday at 7:00 AM
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

    for (const invoice of overdue) {
      const daysOverdue = Math.floor((Date.now() - new Date(invoice.dueDate)) / 86_400_000);
      const recipients = invoice.family?.members?.map((m) => m.user) || [];

      for (const parent of recipients) {
        await sendNotification({
          userId: parent.id,
          type: 'PAYMENT_OVERDUE',
          title: `Invoice ${invoice.invoiceNumber} is overdue`,
          message: `Your invoice of $${Number(invoice.totalAmount).toFixed(2)} was due ${daysOverdue} day(s) ago. Please make a payment as soon as possible.`,
          referenceType: 'invoice',
          referenceId: invoice.id,
          dedupKey: `overdue-invoice-${invoice.id}-${new Date().toISOString().split('T')[0]}`,
        });
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
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);

    // Count absences per student in the past 30 days
    const absences = await prisma.attendance.groupBy({
      by: ['studentId'],
      where: {
        status: { in: ['ABSENT', 'EXCUSED'] },
        checkedAt: { gte: since },
      },
      _count: { id: true },
      having: { id: { _count: { gte: 3 } } },
    });

    if (absences.length === 0) {
      console.log('[CRON] No repeated-absence alerts needed.');
      return;
    }

    // Find the admin(s) to notify
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });

    for (const row of absences) {
      const student = await prisma.user.findUnique({
        where: { id: row.studentId },
        select: { id: true, fullName: true },
      });
      if (!student) continue;

      const count = row._count.id;
      const todayStr = new Date().toISOString().split('T')[0];

      for (const admin of admins) {
        await sendNotification({
          userId: admin.id,
          type: 'REPEATED_ABSENCE',
          title: `Repeated absences — ${student.fullName}`,
          message: `${student.fullName} has missed ${count} session(s) in the last 30 days.`,
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
    const lowPunch = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        status: 'ACTIVE',
        snackAuthorized: true,
        snackPunches: { lte: 2 }, // 2 or fewer punches
      },
      select: { id: true, fullName: true, snackPunches: true },
    });

    if (lowPunch.length === 0) {
      console.log('[CRON] All snack balances are healthy.');
      return;
    }

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });

    const names = lowPunch.map((s) => `${s.fullName} (${s.snackPunches} punches)`).join(', ');
    const todayStr = new Date().toISOString().split('T')[0];

    for (const admin of admins) {
      await sendNotification({
        userId: admin.id,
        type: 'LOW_SNACK_PUNCHES',
        title: `${lowPunch.length} student(s) have low snack punches`,
        message: `The following students need a snack punch top-up: ${names}.`,
        referenceType: 'snack',
        referenceId: null,
        dedupKey: `low-snack-${todayStr}`,
      });
    }

    console.log(`[CRON] Low-snack alert sent for ${lowPunch.length} student(s).`);
  } catch (err) {
    console.error('[CRON] checkLowSnackPunches error:', err);
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

  console.log('[CRON] All scheduled jobs registered ✔');
};
