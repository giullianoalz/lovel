/**
 * Standing monthly charges — the arrangement, not the money.
 *
 * Admin-only throughout. These rows decide what families are billed every
 * month without anyone typing it again, so the same rule as pay rates applies:
 * reading a balance is one thing, deciding what it will be is another.
 */

import prisma from '../config/database.js';
import { findDueCharges, runRecurringCharges } from '../services/recurringCharges.service.js';

/** Money, parsed strictly — a stray character must not become a silent NaN. */
const parseAmount = (value) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { error: 'Amount must be a number.' };
  if (n <= 0) return { error: 'Amount must be greater than zero.' };
  if (n > 99999999.99) return { error: 'Amount is implausibly large.' };
  return { value: Math.round(n * 100) / 100 };
};

const parseDay = (value) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 31) return { error: 'Day of month must be between 1 and 31.' };
  return { value: n };
};

/** YYYY-MM-DD at UTC midnight, matching how `date` columns are stored. */
const parseDate = (value, label) => {
  if (!value) return { error: `${label} is required.` };
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { error: `${label} is not a valid date.` };
  return { value: d };
};

const present = (r) => ({
  id: r.id,
  familyId: r.familyId,
  familyName: r.family?.name || null,
  studentId: r.studentId,
  studentName: r.student?.fullName || null,
  amount: Number(r.amount),
  description: r.description,
  dayOfMonth: r.dayOfMonth,
  startDate: r.startDate.toISOString().slice(0, 10),
  endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
  active: r.active,
  // How many months this has actually raised — an admin checking a family's
  // account wants to know the arrangement is running, not just that it exists.
  chargesRaised: r._count?.transactions ?? undefined,
  createdAt: r.createdAt,
});

const withRelations = {
  family: { select: { id: true, name: true } },
  student: { select: { id: true, fullName: true } },
  _count: { select: { transactions: true } },
};

/**
 * GET /api/billing/recurring?familyId=&includeInactive=
 * The standing arrangements, newest first.
 */
export const listRecurringCharges = async (req, res, next) => {
  try {
    const { familyId, includeInactive } = req.query;
    const where = {};
    if (familyId) where.familyId = familyId;
    if (includeInactive !== 'true') where.active = true;

    const rows = await prisma.recurringCharge.findMany({
      where,
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: withRelations,
    });

    res.json({ recurringCharges: rows.map(present) });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/recurring
 * Body: { familyId, studentId?, amount, description, dayOfMonth?, startDate?, endDate? }
 *
 * Does NOT raise the first charge itself. The monthly job owns that, so there
 * is exactly one code path that bills a family — if creating also charged, the
 * two would drift and the difference would be somebody's money.
 */
export const createRecurringCharge = async (req, res, next) => {
  try {
    const { familyId, studentId, amount, description, dayOfMonth, startDate, endDate } = req.body;

    if (!familyId) {
      return res.status(400).json({ error: 'Validation Error', message: 'familyId is required.' });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'Validation Error', message: 'A description is required — it is what the family sees on the charge.' });
    }

    const parsedAmount = parseAmount(amount);
    if (parsedAmount.error) return res.status(400).json({ error: 'Validation Error', message: parsedAmount.error });

    const start = parseDate(startDate || new Date().toISOString(), 'Start date');
    if (start.error) return res.status(400).json({ error: 'Validation Error', message: start.error });

    // Defaults to the day the arrangement starts, which is what an admin means
    // by "bill this every month" when they don't say a day.
    const parsedDay = parseDay(dayOfMonth ?? start.value.getUTCDate());
    if (parsedDay.error) return res.status(400).json({ error: 'Validation Error', message: parsedDay.error });

    let end = null;
    if (endDate) {
      const parsedEnd = parseDate(endDate, 'End date');
      if (parsedEnd.error) return res.status(400).json({ error: 'Validation Error', message: parsedEnd.error });
      if (parsedEnd.value < start.value) {
        return res.status(400).json({ error: 'Validation Error', message: 'The end date cannot be before the start date.' });
      }
      end = parsedEnd.value;
    }

    const family = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true } });
    if (!family) return res.status(404).json({ error: 'Not Found', message: 'That family does not exist.' });

    if (studentId) {
      const student = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) return res.status(404).json({ error: 'Not Found', message: 'That student does not exist.' });
    }

    const created = await prisma.recurringCharge.create({
      data: {
        familyId,
        studentId: studentId || null,
        amount: parsedAmount.value,
        description: String(description).trim(),
        dayOfMonth: parsedDay.value,
        startDate: start.value,
        endDate: end,
        createdById: req.user.id,
      },
      include: withRelations,
    });

    console.log(`[Recurring] ${req.user.email} created: ${created.description} $${created.amount} on day ${created.dayOfMonth} for family ${created.familyId}`);

    res.status(201).json({
      message: `"${created.description}" will be charged every month on day ${created.dayOfMonth}.`,
      recurringCharge: present(created),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/billing/recurring/:id
 * Pause, resume, re-price or re-date an arrangement.
 *
 * Only ever changes what happens next. Charges already raised are ordinary
 * transactions and stay exactly as they were billed — re-pricing an
 * arrangement is not a licence to rewrite what a family already owes.
 */
export const updateRecurringCharge = async (req, res, next) => {
  try {
    const { amount, description, dayOfMonth, endDate, active } = req.body;
    const data = {};

    if (amount !== undefined) {
      const parsed = parseAmount(amount);
      if (parsed.error) return res.status(400).json({ error: 'Validation Error', message: parsed.error });
      data.amount = parsed.value;
    }
    if (description !== undefined) {
      if (!String(description).trim()) {
        return res.status(400).json({ error: 'Validation Error', message: 'The description cannot be empty.' });
      }
      data.description = String(description).trim();
    }
    if (dayOfMonth !== undefined) {
      const parsed = parseDay(dayOfMonth);
      if (parsed.error) return res.status(400).json({ error: 'Validation Error', message: parsed.error });
      data.dayOfMonth = parsed.value;
    }
    if (endDate !== undefined) {
      if (endDate === null || endDate === '') data.endDate = null;
      else {
        const parsed = parseDate(endDate, 'End date');
        if (parsed.error) return res.status(400).json({ error: 'Validation Error', message: parsed.error });
        data.endDate = parsed.value;
      }
    }
    if (active !== undefined) data.active = Boolean(active);

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'Nothing to change.' });
    }

    const existing = await prisma.recurringCharge.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Not Found', message: 'That recurring charge does not exist.' });

    const updated = await prisma.recurringCharge.update({
      where: { id: req.params.id },
      data,
      include: withRelations,
    });

    console.log(`[Recurring] ${req.user.email} updated ${updated.id}: ${JSON.stringify(data)}`);

    res.json({
      message: active === false ? 'Recurring charge paused.' : 'Recurring charge updated.',
      recurringCharge: present(updated),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/billing/recurring/:id
 * Stops the arrangement for good. Charges it already raised keep standing —
 * the family really was billed those months, and deleting the schedule is not
 * a way to erase what they owe.
 */
export const deleteRecurringCharge = async (req, res, next) => {
  try {
    const existing = await prisma.recurringCharge.findUnique({
      where: { id: req.params.id },
      select: { id: true, description: true, _count: { select: { transactions: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Not Found', message: 'That recurring charge does not exist.' });

    await prisma.recurringCharge.delete({ where: { id: req.params.id } });

    console.log(`[Recurring] ${req.user.email} deleted ${existing.id} ("${existing.description}"), ${existing._count.transactions} past charges kept`);

    res.json({
      message: existing._count.transactions > 0
        ? `Stopped. The ${existing._count.transactions} charge${existing._count.transactions === 1 ? '' : 's'} it already raised stay on the account.`
        : 'Recurring charge removed.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/billing/recurring/due
 * What the next monthly run would raise, without raising it. Lets an admin
 * check the arrangement before the money is real.
 */
export const previewDueCharges = async (req, res, next) => {
  try {
    const { periodKey, due, notYet, alreadyCharged } = await findDueCharges();
    res.json({
      periodKey,
      due: due.map((r) => ({ ...present(r), dueDay: r.dueDay })),
      notYet: notYet.map((r) => ({ ...present(r), dueDay: r.dueDay })),
      alreadyChargedCount: alreadyCharged.length,
      total: due.reduce((n, r) => n + Number(r.amount), 0),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/recurring/run
 * Raises this month's charges now instead of waiting for the nightly job.
 * Safe to press twice — the unique index refuses a second charge for a month
 * that already has one.
 */
export const runRecurringChargesNow = async (req, res, next) => {
  try {
    const result = await runRecurringCharges();
    console.log(`[Recurring] ${req.user.email} ran ${result.periodKey} by hand: ${result.createdCount} raised, ${result.skippedCount} already done, ${result.failed.length} failed`);
    res.json({
      message: `${result.createdCount} charge${result.createdCount === 1 ? '' : 's'} raised for ${result.periodKey}.`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};
