/**
 * Paid hours that aren't a class.
 *
 * Reception, planning, a staff meeting, setting up a room. A shift is a person,
 * a block of time and the kind of work it was — that last part is what decides
 * the rate, so scheduling somebody for 10–1 at the front desk is the same act
 * as saying those three hours cost $60.
 *
 * Shifts are scheduled by admins. Everyone can read their own; only admins and
 * the front desk see the whole building's.
 */

import prisma from '../config/database.js';
import { loadPayCategories, freezeShiftRates, clearFrozenRates } from '../services/payroll.service.js';
import { hasRole, isFrontDeskOnly } from '../utils/roles.js';

const SHIFT_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'];

/**
 * A wall-clock time ("10:00", "13:30") as the Date a TIME column expects.
 *
 * Pinned to the epoch date on purpose: the column stores a time of day, and
 * anchoring it to 1970-01-01 keeps the stored value identical however the
 * server's clock is set. Payroll subtracts two of these, so only the gap matters.
 */
const toTime = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, h, m] = match;
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) return null;
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
};

/** A date-only string ("2026-08-10") as the UTC midnight a DATE column expects. */
const toDate = (value) => {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseRate = (value, label = 'Rate') => {
  if (value === null || value === '' || value === undefined) return { value: null };
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
  if (n < 0) return { error: `${label} cannot be negative.` };
  if (n > 99999999.99) return { error: `${label} is implausibly large.` };
  return { value: Math.round(n * 100) / 100 };
};

const shiftInclude = {
  staff: { select: { id: true, fullName: true, avatarUrl: true } },
};

/** The hours in a shift, for the "3 h × $20 = $60" the scheduler shows back. */
const shiftHours = (shift) => {
  const ms = new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime();
  return ms > 0 ? Math.round((ms / 3_600_000) * 100) / 100 : 0;
};

/** Adds the category label and computed hours the calendar needs to render it. */
const decorate = (shift, categories) => ({
  ...shift,
  hours: shiftHours(shift),
  categoryLabel: categories.get(shift.payCategoryKey)?.label || null,
  categoryColor: categories.get(shift.payCategoryKey)?.color || null,
});

/**
 * GET /api/shifts?from=&to=&staffId=
 * Shifts in a date range.
 *
 * Defaults to the caller's own. Admins and the front desk may ask for the whole
 * building, or for one person, because that is the schedule they build.
 */
export const listShifts = async (req, res, next) => {
  try {
    const { from, to, staffId, status } = req.query;
    const canSeeEveryone = hasRole(req.user, 'ADMIN') || isFrontDeskOnly(req.user);

    const fromDate = toDate(from) || new Date(new Date().setHours(0, 0, 0, 0));
    const toDate_ = toDate(to) || new Date(new Date().setDate(new Date().getDate() + 30));

    // A teacher asking for someone else's shifts gets their own, the same way
    // the calendar scopes sessions. Nobody's paid hours are a colleague's business.
    const scopedStaffId = canSeeEveryone ? staffId : req.user.id;

    const shifts = await prisma.workShift.findMany({
      where: {
        date: { gte: fromDate, lte: toDate_ },
        ...(scopedStaffId ? { staffId: scopedStaffId } : {}),
        ...(status && SHIFT_STATUSES.includes(status) ? { status } : {}),
      },
      include: shiftInclude,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    const categories = new Map((await loadPayCategories()).map((c) => [c.key, c]));

    // The rate on a shift is that person's pay. Staff see their own; anyone
    // else's comes back without the number, so the calendar can still draw the
    // block without publishing what a colleague earns.
    const canSeePay = hasRole(req.user, 'ADMIN');
    res.json({
      shifts: shifts.map((s) => {
        const decorated = decorate(s, categories);
        return canSeePay || s.staffId === req.user.id
          ? decorated
          : { ...decorated, payRateOverride: null, notes: null };
      }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/shifts
 * Schedule someone (Admin only).
 *
 * Body: { staffId, date, startTime, endTime, payCategoryKey?, payRateOverride?,
 *         title?, notes?, repeatWeeks? }
 *
 * `repeatWeeks` books the same block on the same weekday for that many weeks —
 * a front desk rota is the same three hours every Tuesday, and entering it
 * twelve times by hand is how people stop entering it.
 */
export const createShift = async (req, res, next) => {
  try {
    const {
      staffId, date, startTime, endTime, payCategoryKey,
      payRateOverride, title, notes, repeatWeeks,
    } = req.body;

    if (!staffId || !date || !startTime || !endTime) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Who, what day, and from when to when — all four are required.',
      });
    }

    const shiftDate = toDate(date);
    const start = toTime(startTime);
    const end = toTime(endTime);
    if (!shiftDate) {
      return res.status(400).json({ error: 'Validation Error', message: 'That date is not a date.' });
    }
    if (!start || !end) {
      return res.status(400).json({ error: 'Validation Error', message: 'Times must look like 10:00 or 13:30.' });
    }
    if (end <= start) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'The shift has to end after it starts.',
      });
    }

    const rate = parseRate(payRateOverride, 'Rate for this shift');
    if (rate.error) return res.status(400).json({ error: 'Validation Error', message: rate.error });

    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { id: true, fullName: true, role: true, secondaryRoles: true },
    });
    if (!staff) {
      return res.status(404).json({ error: 'Not Found', message: 'That person does not exist.' });
    }
    // A shift is paid work, so it can only be scheduled for someone employed
    // here. Booking a parent or a student for the front desk would put them on
    // the payroll roster.
    if (!hasRole(staff, 'ADMIN', 'TEACHER', 'RECEPTIONIST')) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `${staff.fullName} is not staff, so there are no hours to pay.`,
      });
    }

    const categories = await loadPayCategories();
    if (payCategoryKey && !categories.some((c) => c.key === payCategoryKey)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `There is no pay category "${payCategoryKey}".`,
      });
    }

    const weeks = Math.min(Math.max(parseInt(repeatWeeks, 10) || 1, 1), 52);
    const dates = Array.from({ length: weeks }, (_, i) => {
      const d = new Date(shiftDate);
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d;
    });

    // Someone already booked for overlapping hours is nearly always a mistake,
    // and a silent one: it quietly doubles what the month costs. Refused with
    // the clash named, rather than merged or ignored.
    const clash = await prisma.workShift.findFirst({
      where: {
        staffId,
        date: { in: dates },
        status: { not: 'CANCELLED' },
        startTime: { lt: end },
        endTime: { gt: start },
      },
      select: { date: true },
    });
    if (clash) {
      return res.status(409).json({
        error: 'Conflict',
        message: `${staff.fullName} is already scheduled during those hours on ${clash.date.toISOString().slice(0, 10)}.`,
      });
    }

    const created = await prisma.$transaction(
      dates.map((d) =>
        prisma.workShift.create({
          data: {
            staffId,
            date: d,
            startTime: start,
            endTime: end,
            payCategoryKey: payCategoryKey || null,
            payRateOverride: rate.value,
            title: title ? String(title).slice(0, 255) : null,
            notes: notes || null,
            createdById: req.user.id,
          },
          include: shiftInclude,
        })
      )
    );

    const categoryMap = new Map(categories.map((c) => [c.key, c]));
    res.status(201).json({
      message:
        weeks > 1
          ? `${staff.fullName} is scheduled for ${weeks} weeks.`
          : `${staff.fullName} is scheduled.`,
      shifts: created.map((s) => decorate(s, categoryMap)),
      shift: decorate(created[0], categoryMap),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/shifts/:id
 * Change or close out a shift (Admin only).
 *
 * Marking it COMPLETED is what makes it pay — see payroll.service.js. Staff
 * cannot mark their own, for the same reason they cannot set their own rate.
 */
export const updateShift = async (req, res, next) => {
  try {
    const {
      date, startTime, endTime, payCategoryKey, payRateOverride,
      title, notes, status,
    } = req.body;

    const existing = await prisma.workShift.findUnique({
      where: { id: req.params.id },
      include: shiftInclude,
    });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'That shift does not exist.' });
    }

    const data = {};
    if (date !== undefined) {
      const d = toDate(date);
      if (!d) return res.status(400).json({ error: 'Validation Error', message: 'That date is not a date.' });
      data.date = d;
    }
    if (startTime !== undefined) {
      const t = toTime(startTime);
      if (!t) return res.status(400).json({ error: 'Validation Error', message: 'Times must look like 10:00 or 13:30.' });
      data.startTime = t;
    }
    if (endTime !== undefined) {
      const t = toTime(endTime);
      if (!t) return res.status(400).json({ error: 'Validation Error', message: 'Times must look like 10:00 or 13:30.' });
      data.endTime = t;
    }
    const finalStart = data.startTime ?? existing.startTime;
    const finalEnd = data.endTime ?? existing.endTime;
    if (new Date(finalEnd) <= new Date(finalStart)) {
      return res.status(400).json({ error: 'Validation Error', message: 'The shift has to end after it starts.' });
    }

    if (payRateOverride !== undefined) {
      const rate = parseRate(payRateOverride, 'Rate for this shift');
      if (rate.error) return res.status(400).json({ error: 'Validation Error', message: rate.error });
      data.payRateOverride = rate.value;
    }
    if (payCategoryKey !== undefined) {
      if (payCategoryKey) {
        const categories = await loadPayCategories();
        if (!categories.some((c) => c.key === payCategoryKey)) {
          return res.status(400).json({
            error: 'Validation Error',
            message: `There is no pay category "${payCategoryKey}".`,
          });
        }
      }
      data.payCategoryKey = payCategoryKey || null;
    }
    if (title !== undefined) data.title = title ? String(title).slice(0, 255) : null;
    if (notes !== undefined) data.notes = notes || null;
    if (status !== undefined) {
      if (!SHIFT_STATUSES.includes(status)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `status must be one of: ${SHIFT_STATUSES.join(', ')}.`,
        });
      }
      data.status = status;
    }

    const shift = await prisma.workShift.update({
      where: { id: req.params.id },
      data,
      include: shiftInclude,
    });

    // The rate is stamped on when the shift is confirmed worked, and released
    // if it stops being confirmed or if the rate on it is corrected after the
    // fact — see freezeShiftRates. An hour keeps the contract it was worked under.
    if (shift.status !== 'COMPLETED') {
      await clearFrozenRates({ shiftIds: [shift.id] });
    } else {
      if (data.payRateOverride !== undefined || data.payCategoryKey !== undefined) {
        await clearFrozenRates({ shiftIds: [shift.id] });
      }
      await freezeShiftRates([shift.id]);
    }

    if (status === 'COMPLETED' && existing.status !== 'COMPLETED') {
      console.log(`[Payroll] ${req.user.email} marked ${existing.staff.fullName}'s ${existing.date.toISOString().slice(0, 10)} shift worked`);
    }

    const categories = new Map((await loadPayCategories()).map((c) => [c.key, c]));
    res.json({ message: 'Shift updated.', shift: decorate(shift, categories) });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/shifts/complete
 * Mark a batch of shifts worked (Admin only).
 *
 * Payroll month-end is "everything on the rota happened, except Tuesday" — one
 * request rather than twenty, so closing out a month isn't a reason to skip it.
 * Body: { ids: string[] } or { from, to, staffId? }
 */
export const completeShifts = async (req, res, next) => {
  try {
    const { ids, from, to, staffId } = req.body;

    let where;
    if (Array.isArray(ids) && ids.length > 0) {
      where = { id: { in: ids }, status: 'SCHEDULED' };
    } else if (from && to) {
      const fromDate = toDate(from);
      const toDate_ = toDate(to);
      if (!fromDate || !toDate_) {
        return res.status(400).json({ error: 'Validation Error', message: 'from and to must be dates.' });
      }
      where = {
        date: { gte: fromDate, lte: toDate_ },
        status: 'SCHEDULED',
        ...(staffId ? { staffId } : {}),
      };
    } else {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send either ids, or a from/to range.',
      });
    }

    // Never ahead of the calendar: a shift that hasn't happened yet cannot be
    // confirmed as worked, and confirming a whole month in advance would put
    // money on hours nobody has stood there for.
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const requestedEnd = where.date?.lte;
    where.date = {
      ...(where.date || {}),
      // The earlier of "today" and whatever end date was asked for — replacing
      // the end outright would quietly confirm shifts past the range requested.
      lte: requestedEnd && requestedEnd < today ? requestedEnd : today,
    };

    // The ids are read before the write, because updateMany can't return them
    // and the rate has to be stamped onto exactly the rows this call confirmed.
    const confirming = await prisma.workShift.findMany({ where, select: { id: true } });
    const confirmedIds = confirming.map((s) => s.id);

    const { count } = await prisma.workShift.updateMany({
      where: { id: { in: confirmedIds } },
      data: { status: 'COMPLETED' },
    });
    await freezeShiftRates(confirmedIds);
    console.log(`[Payroll] ${req.user.email} marked ${count} shift(s) worked`);

    res.json({
      message: count === 0
        ? 'Nothing to confirm — those shifts are either already done or still in the future.'
        : `${count} shift${count === 1 ? '' : 's'} marked as worked.`,
      count,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/shifts/:id
 * Remove a shift (Admin only).
 *
 * A shift already marked worked is pay history, so it is cancelled rather than
 * deleted — the hours stop counting but the record of what was scheduled, and
 * that somebody unwound it, stays.
 */
export const deleteShift = async (req, res, next) => {
  try {
    const existing = await prisma.workShift.findUnique({
      where: { id: req.params.id },
      include: shiftInclude,
    });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'That shift does not exist.' });
    }

    if (existing.status === 'COMPLETED') {
      const shift = await prisma.workShift.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED' },
        include: shiftInclude,
      });
      // It no longer counts, so it no longer holds a rate — if it is ever
      // confirmed again it should price at whatever is true then.
      await clearFrozenRates({ shiftIds: [shift.id] });
      console.log(`[Payroll] ${req.user.email} cancelled a completed shift for ${existing.staff.fullName}`);
      return res.json({
        message: `That shift was already marked worked, so it was cancelled instead — it no longer counts towards pay.`,
        shift,
      });
    }

    await prisma.workShift.delete({ where: { id: req.params.id } });
    res.json({ message: 'Shift removed.' });
  } catch (error) {
    next(error);
  }
};
