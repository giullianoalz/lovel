/**
 * The kinds of work the academy pays for, and what each one pays.
 *
 * This is the list an admin thinks in — "front desk $20, private tutoring $30,
 * in-person class $50, planning $20" — and it is the whole point of the pay
 * model: put the rate on the kind of work once, and scheduling somebody for an
 * hour of it is all it takes to know what that hour costs.
 *
 * Reading the list is open to any signed-in member of staff, because the
 * calendar pickers need it. Writing it is admin-only: a category rate is money
 * for everyone who works that category.
 */

import prisma from '../config/database.js';
import { loadPayCategories, invalidatePayCategories } from '../services/payroll.service.js';
import { hasRole } from '../utils/roles.js';

/** Money in, strictly. A stray character must not become null and wipe a rate. */
const parseRate = (value, label = 'Rate') => {
  if (value === null || value === '' || value === undefined) return { value: null };
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
  if (n < 0) return { error: `${label} cannot be negative.` };
  if (n > 99999999.99) return { error: `${label} is implausibly large.` };
  return { value: Math.round(n * 100) / 100 };
};

/**
 * Turns a label into a stable key: "Junior Jams class" -> "JUNIOR_JAMS_CLASS".
 *
 * Generated rather than typed because the key is permanent — every hour ever
 * booked to a category stores it — and asking an admin to invent an identifier
 * is asking for a typo they can never fix.
 */
const keyFromLabel = (label) =>
  label
    // Accents are stripped so "Música" and "Musica" can't become two keys for
    // the same class.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/**
 * GET /api/pay-categories
 * Every kind of work, with its default rate.
 *
 * `?activeOnly=true` for the calendar pickers, which should not offer a
 * category somebody retired. The settings screen wants the full list.
 */
export const listPayCategories = async (req, res, next) => {
  try {
    const all = await loadPayCategories();
    const categories = req.query.activeOnly === 'true' ? all.filter((c) => c.active) : all;

    // Rates are pay. Anyone may see that "Front desk" exists — they need it to
    // read their own calendar — but only admins see what it pays.
    const canSeeRates = hasRole(req.user, 'ADMIN');
    res.json({
      categories: categories.map((c) => (canSeeRates ? c : { ...c, defaultRate: null })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/pay-categories
 * Add a kind of work (Admin only).
 *
 * Body: { label, defaultRate?, teaching?, color?, sortOrder? }
 */
export const createPayCategory = async (req, res, next) => {
  try {
    const { label, defaultRate, teaching, color, sortOrder } = req.body;

    if (!label || !String(label).trim()) {
      return res.status(400).json({ error: 'Validation Error', message: 'A name is required.' });
    }
    const key = keyFromLabel(String(label));
    if (!key) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'That name has no letters or numbers to build an identifier from.',
      });
    }

    const rate = parseRate(defaultRate, 'Default rate');
    if (rate.error) return res.status(400).json({ error: 'Validation Error', message: rate.error });

    const existing = await prisma.payCategory.findUnique({ where: { key } });
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: `"${existing.label}" already covers that kind of work.`,
      });
    }

    const category = await prisma.payCategory.create({
      data: {
        key,
        label: String(label).trim().slice(0, 80),
        defaultRate: rate.value,
        teaching: Boolean(teaching),
        color: color || null,
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 100,
      },
    });

    invalidatePayCategories();
    console.log(`[Payroll] ${req.user.email} created pay category ${key} @ ${rate.value ?? 'no rate'}`);
    res.status(201).json({ message: `"${category.label}" added.`, category });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/pay-categories/:id
 * Rename, reprice or retire a kind of work (Admin only).
 *
 * The key is never editable. Renaming "Front desk" to "Reception" is a label
 * change; changing its key would orphan every hour already booked to it.
 */
export const updatePayCategory = async (req, res, next) => {
  try {
    const { label, defaultRate, teaching, color, sortOrder, active } = req.body;

    const existing = await prisma.payCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'That category does not exist.' });
    }

    const data = {};
    if (label !== undefined) {
      if (!String(label).trim()) {
        return res.status(400).json({ error: 'Validation Error', message: 'A name is required.' });
      }
      data.label = String(label).trim().slice(0, 80);
    }
    if (defaultRate !== undefined) {
      const rate = parseRate(defaultRate, 'Default rate');
      if (rate.error) return res.status(400).json({ error: 'Validation Error', message: rate.error });
      data.defaultRate = rate.value;
    }
    if (teaching !== undefined) data.teaching = Boolean(teaching);
    if (color !== undefined) data.color = color || null;
    if (active !== undefined) data.active = Boolean(active);
    if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) data.sortOrder = Number(sortOrder);

    const category = await prisma.payCategory.update({ where: { id: req.params.id }, data });

    invalidatePayCategories();
    console.log(
      `[Payroll] ${req.user.email} updated pay category ${existing.key}: ` +
      `${existing.defaultRate ?? '—'} -> ${category.defaultRate ?? '—'}` +
      (category.active === false ? ' (retired)' : '')
    );
    res.json({ message: `"${category.label}" updated.`, category });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/pay-categories/:id
 * Remove a kind of work (Admin only).
 *
 * Refused once anything has been booked to it. Deleting would leave sessions,
 * shifts and per-person rates pointing at a key with no name and no rate — pay
 * history that can no longer be explained. Those get retired instead, which
 * hides them from the pickers and leaves every past hour intact.
 */
export const deletePayCategory = async (req, res, next) => {
  try {
    const existing = await prisma.payCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'That category does not exist.' });
    }

    const [sessions, shifts, rates] = await Promise.all([
      prisma.session.count({ where: { payCategoryKey: existing.key } }),
      prisma.workShift.count({ where: { payCategoryKey: existing.key } }),
      prisma.teacherPayRate.count({ where: { category: existing.key } }),
    ]);
    const used = sessions + shifts + rates;

    if (used > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message:
          `"${existing.label}" is used by ${sessions} session${sessions === 1 ? '' : 's'}, ` +
          `${shifts} shift${shifts === 1 ? '' : 's'} and ${rates} personal rate${rates === 1 ? '' : 's'}. ` +
          'Retire it instead — it stops appearing when scheduling, and past pay still adds up.',
      });
    }

    await prisma.payCategory.delete({ where: { id: req.params.id } });
    invalidatePayCategories();
    console.log(`[Payroll] ${req.user.email} deleted unused pay category ${existing.key}`);
    res.json({ message: `"${existing.label}" removed.` });
  } catch (error) {
    next(error);
  }
};
