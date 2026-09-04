/**
 * Declaring the days the academy does not open.
 *
 * Closing a day removes pay from people who did nothing wrong, so the two
 * things this has to get right are both about visibility: an admin sees the
 * cost before committing (`preview`), and any hour already priced for that day
 * has its stamp removed rather than left as a number nobody will honour.
 */

import prisma from '../config/database.js';
import {
  loadClosures, invalidateClosures, expandRange, closureImpact, dayToDate, isoDay,
} from '../services/closures.service.js';
import { clearFrozenRates } from '../services/payroll.service.js';

/** GET /api/closures — every declared closure, soonest first. */
export const listClosures = async (req, res) => {
  try {
    const rows = await prisma.academyClosure.findMany({
      orderBy: { date: 'asc' },
      select: {
        id: true, date: true, label: true, notes: true, createdAt: true,
        createdBy: { select: { fullName: true } },
      },
    });
    res.json(rows.map((r) => ({ ...r, date: isoDay(r.date) })));
  } catch (error) {
    console.error('[Closures] list failed:', error);
    res.status(500).json({ error: 'Server Error', message: 'Could not load the closures.' });
  }
};

/**
 * GET /api/closures/preview?startDate=&endDate= — what closing this would cost.
 *
 * Deliberately a separate read rather than something the create call returns:
 * the number is the input to the decision, not a receipt for it.
 */
export const previewClosure = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate) {
      return res.status(400).json({ error: 'Validation Error', message: 'startDate is required.' });
    }
    const { days, error } = expandRange(startDate, endDate);
    if (error) return res.status(400).json({ error: 'Validation Error', message: error });

    const existing = await prisma.academyClosure.findMany({
      where: { date: { in: days.map(dayToDate) } },
      select: { date: true, label: true },
    });
    res.json({
      days,
      alreadyClosed: existing.map((c) => ({ date: isoDay(c.date), label: c.label })),
      impact: await closureImpact(days),
    });
  } catch (error) {
    console.error('[Closures] preview failed:', error);
    res.status(500).json({ error: 'Server Error', message: 'Could not work out what this would cost.' });
  }
};

/**
 * POST /api/closures — declare a day, or a range, closed.
 *
 * A range is stored one row per day (see the model). Days already closed are
 * skipped rather than rejected: declaring "winter break" over a fortnight that
 * already contains Christmas Day should add the other thirteen, not fail.
 */
export const createClosure = async (req, res) => {
  try {
    const { startDate, endDate, label, notes } = req.body;
    if (!startDate || !label?.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'startDate and label are both required.',
      });
    }
    const { days, error } = expandRange(startDate, endDate);
    if (error) return res.status(400).json({ error: 'Validation Error', message: error });

    const dates = days.map(dayToDate);
    const existing = await prisma.academyClosure.findMany({
      where: { date: { in: dates } }, select: { date: true },
    });
    const taken = new Set(existing.map((c) => isoDay(c.date)));
    const fresh = days.filter((d) => !taken.has(d));

    // The two writes belong together: a day that counts as closed while an hour
    // on it still carries a price is the state this feature exists to prevent.
    const [affected] = await prisma.$transaction(async (tx) => {
      const [sessions, shifts] = await Promise.all([
        tx.session.findMany({ where: { date: { in: dates }, paidRate: { not: null } }, select: { id: true } }),
        tx.workShift.findMany({ where: { date: { in: dates }, paidRate: { not: null } }, select: { id: true } }),
      ]);
      if (fresh.length) {
        await tx.academyClosure.createMany({
          data: fresh.map((day) => ({
            date: dayToDate(day),
            label: label.trim(),
            notes: notes?.trim() || null,
            createdById: req.user.id,
          })),
        });
      }
      return [{ sessionIds: sessions.map((s) => s.id), shiftIds: shifts.map((s) => s.id) }];
    });

    // Outside the transaction on purpose: clearFrozenRates opens its own, and
    // a stamp left behind is self-healing — the hour simply prices live, and
    // the closure already keeps it out of every payable query.
    if (affected.sessionIds.length || affected.shiftIds.length) {
      await clearFrozenRates(affected);
    }
    invalidateClosures();

    res.status(201).json({
      created: fresh.length,
      skipped: days.length - fresh.length,
      unfrozen: affected.sessionIds.length + affected.shiftIds.length,
      days: fresh,
    });
  } catch (error) {
    console.error('[Closures] create failed:', error);
    res.status(500).json({ error: 'Server Error', message: 'Could not declare the closure.' });
  }
};

/**
 * DELETE /api/closures/:id — the academy is open that day after all.
 *
 * Nothing is re-frozen here. The hours go back to pricing live, and the next
 * pay-accrual sweep stamps them at whatever the rates say then — which is the
 * same path any other newly-payable hour takes.
 */
export const deleteClosure = async (req, res) => {
  try {
    const closure = await prisma.academyClosure.findUnique({ where: { id: req.params.id } });
    if (!closure) {
      return res.status(404).json({ error: 'Not Found', message: 'That closure does not exist.' });
    }
    await prisma.academyClosure.delete({ where: { id: req.params.id } });
    invalidateClosures();
    res.json({ message: `${isoDay(closure.date)} is open again.`, date: isoDay(closure.date) });
  } catch (error) {
    console.error('[Closures] delete failed:', error);
    res.status(500).json({ error: 'Server Error', message: 'Could not remove the closure.' });
  }
};

/**
 * GET /api/closures/conflicts — days that are closed but still have meetings.
 *
 * The audit that found this problem in the first place, kept as an endpoint:
 * closing a day stops it paying, but the sessions stay on the calendar, and
 * families reading the timetable have no way to know. Lists them so somebody
 * can cancel or move them.
 */
export const closureConflicts = async (req, res) => {
  try {
    const closures = await loadClosures();
    if (!closures.length) return res.json([]);
    const sessions = await prisma.session.findMany({
      where: { date: { in: closures.map((c) => dayToDate(c.day)) }, status: { not: 'CANCELLED' } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true, date: true, startTime: true, endTime: true, chargeAmount: true,
        teacher: { select: { fullName: true } },
        class: { select: { name: true, teacher: { select: { fullName: true } } } },
      },
    });
    const byDay = new Map();
    for (const s of sessions) {
      const day = isoDay(s.date);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({
        id: s.id,
        className: s.class.name,
        teacher: s.teacher?.fullName ?? s.class.teacher?.fullName ?? null,
        priced: s.chargeAmount != null,
      });
    }
    res.json(closures
      .filter((c) => byDay.has(c.day))
      .map((c) => ({ date: c.day, label: c.label, sessions: byDay.get(c.day) })));
  } catch (error) {
    console.error('[Closures] conflicts failed:', error);
    res.status(500).json({ error: 'Server Error', message: 'Could not check the closures.' });
  }
};
