import prisma from '../config/database.js';
import { canUseSnackPunches } from '../utils/snackEligibility.js';
import { sendNotification } from '../jobs/notification.helper.js';
import { invalidate } from '../middleware/cache.js';
import {
  getEventConfig,
  getAdminUserIds,
  getParentUserIdsForStudents,
} from '../services/notificationConfig.service.js';

// A student can only have one open reload request at a time.
const OPEN_RELOAD_STATUSES = ['PENDING', 'APPROVED'];

/**
 * Raised the moment a snack purchase empties a student's card. Creates a
 * pending SnackReloadRequest (unless one is already open) and notifies the
 * parents (and/or admins) so the parent can approve a paid reload. Fully
 * best-effort: any failure here must never fail the underlying purchase.
 */
const maybeCreateReloadRequest = async (studentId, triggeredById) => {
  try {
    const config = await getEventConfig('SNACK_PUNCHES_DEPLETED');
    if (!config?.enabled || config.audience.length === 0) return;

    // Don't stack requests — one open request per student.
    const existing = await prisma.snackReloadRequest.findFirst({
      where: { studentId, status: { in: OPEN_RELOAD_STATUSES } },
    });
    if (existing) return;

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, fullName: true },
    });
    if (!student) return;

    const familyMember = await prisma.familyMember.findFirst({ where: { userId: studentId } });
    const punchCount = config.params.reloadPunches;
    const price = config.params.reloadPrice;

    const request = await prisma.snackReloadRequest.create({
      data: {
        studentId,
        familyId: familyMember?.familyId ?? null,
        punchCount,
        price,
        triggeredById: triggeredById ?? null,
      },
    });

    // Bust the parents' cached portal (60 s TTL) so the approval banner shows
    // up on their next load, not up to a minute later — regardless of whether
    // they're in the notification audience.
    const parentIds = await getParentUserIdsForStudents([studentId]);
    parentIds.forEach((id) => invalidate(`portal:parent:${id}`));

    const priceLabel = `$${Number(price).toFixed(2)}`;
    const recipients = new Set();
    if (config.audience.includes('PARENTS')) {
      parentIds.forEach((id) => recipients.add(id));
    }
    if (config.audience.includes('ADMINS')) {
      (await getAdminUserIds()).forEach((id) => recipients.add(id));
    }

    for (const userId of recipients) {
      await sendNotification({
        userId,
        type: 'SNACK_PUNCHES_DEPLETED',
        title: `${student.fullName} is out of snack punches`,
        message: `${student.fullName}'s snack card reached 0. Approve reloading ${punchCount} punch(es) for ${priceLabel}?`,
        referenceType: 'snackReload',
        referenceId: request.id,
        dedupKey: `snack-reload-${request.id}-${userId}`,
      });
    }
  } catch (err) {
    console.error('[Rewards] maybeCreateReloadRequest failed:', err.message);
  }
};

/* ──────────────────────────── SNACK CABINET ──────────────────────────── */

// GET /api/rewards/snacks — list active snack items
export const listSnacks = async (req, res, next) => {
  try {
    const items = await prisma.snackItem.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      snacks: items.map(s => ({
        id: s.id,
        name: s.name,
        costPunches: s.costPunches,
        image: s.imageUrl || '',
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/snacks — create a snack item
export const createSnack = async (req, res, next) => {
  try {
    const { name, cost, image } = req.body;
    if (!name || cost === undefined || isNaN(parseInt(cost))) {
      return res.status(400).json({ message: 'name and cost are required.' });
    }
    const item = await prisma.snackItem.create({
      data: { name, costPunches: parseInt(cost), imageUrl: image || null },
    });
    res.status(201).json({
      snack: { id: item.id, name: item.name, costPunches: item.costPunches, image: item.imageUrl || '' },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/rewards/snacks/:id — soft-delete a snack item
export const deleteSnack = async (req, res, next) => {
  try {
    await prisma.snackItem.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Snack removed.' });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/snacks/purchase — { studentId, snackId }
// Decrements punches and records the purchase atomically.
export const purchaseSnack = async (req, res, next) => {
  try {
    const { studentId, snackId } = req.body;
    if (!studentId || !snackId) {
      return res.status(400).json({ message: 'studentId and snackId are required.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const [student, snack] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: studentId } }),
        tx.snackItem.findUniqueOrThrow({ where: { id: snackId } }),
      ]);

      // Snack punches are for in-person students only — block online-only students.
      if (!(await canUseSnackPunches(studentId, tx))) {
        return { onlineStudent: true };
      }

      if (snack.costPunches > student.snackPunches) {
        return { insufficientBalance: true, currentBalance: student.snackPunches };
      }

      const newBalance = student.snackPunches - snack.costPunches;
      await tx.user.update({ where: { id: studentId }, data: { snackPunches: newBalance } });
      await tx.snackPurchase.create({
        data: { studentId, snackId, punchesUsed: snack.costPunches },
      });
      return { newBalance, snackName: snack.name };
    });

    if (result.onlineStudent) {
      return res.status(403).json({
        message: 'Snack punches are only available to in-person students.',
      });
    }

    if (result.insufficientBalance) {
      return res.status(400).json({
        message: `Student only has ${result.currentBalance} punches — cannot afford this snack.`,
      });
    }

    // Card just hit zero — ask the parent to approve a paid reload (best-effort,
    // never blocks the purchase response).
    if (result.newBalance === 0) {
      await maybeCreateReloadRequest(studentId, req.user?.id);
    }

    res.json({ success: true, newBalance: result.newBalance, snackName: result.snackName });
  } catch (error) {
    next(error);
  }
};

// GET /api/rewards/snacks/reload-requests?status=APPROVED
// Front-desk queue of reload requests. Defaults to parent-approved ones that
// are waiting to be topped up + charged.
export const listReloadRequests = async (req, res, next) => {
  try {
    const status = req.query.status || 'APPROVED';
    const requests = await prisma.snackReloadRequest.findMany({
      where: { status },
      orderBy: { decidedAt: 'asc' },
      include: {
        student: { select: { id: true, fullName: true } },
        family: { select: { id: true, name: true } },
      },
    });
    res.json({
      requests: requests.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.student?.fullName || 'Student',
        familyName: r.family?.name || null,
        punchCount: r.punchCount,
        price: Number(r.price),
        status: r.status,
        decidedAt: r.decidedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/snacks/reload-requests/:id/fulfill
// Adds the approved punches to the student AND records the CHARGE against the
// family, atomically. Only allowed once the parent has approved.
export const fulfillReloadRequest = async (req, res, next) => {
  try {
    const fulfilledById = req.user.id;

    const request = await prisma.snackReloadRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!request) {
      return res.status(404).json({ message: 'Reload request not found.' });
    }
    if (request.status !== 'APPROVED') {
      return res.status(409).json({
        message: `This request is ${request.status.toLowerCase()} — only parent-approved reloads can be fulfilled.`,
      });
    }

    // Online-only students can't hold snack punches — refuse the top-up.
    if (!(await canUseSnackPunches(request.studentId))) {
      return res.status(403).json({
        message: 'Snack punches are only available to in-person students.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Atomically claim the request first (same idempotency pattern as
      // resolveCancellation): a double-click, two admins on the same queue, or
      // a network retry must never add punches or charge the family twice.
      const claimed = await tx.snackReloadRequest.updateMany({
        where: { id: request.id, status: 'APPROVED' },
        data: { status: 'FULFILLED', fulfilledById, fulfilledAt: new Date() },
      });
      if (claimed.count === 0) return { alreadyFulfilled: true };

      const student = await tx.user.update({
        where: { id: request.studentId },
        data: { snackPunches: { increment: request.punchCount } },
        select: { snackPunches: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          studentId: request.studentId,
          familyId: request.familyId,
          amount: request.price,
          type: 'CHARGE',
          description: `Snack punch reload — ${request.punchCount} punch(es)`,
        },
      });

      await tx.snackReloadRequest.update({
        where: { id: request.id },
        data: { transactionId: transaction.id },
      });

      return { newBalance: student.snackPunches };
    });

    if (result.alreadyFulfilled) {
      return res.status(409).json({ message: 'This reload was already fulfilled.' });
    }

    res.json({ success: true, newBalance: result.newBalance });
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────── SEASHELLS / PRIZES ──────────────────────── */

// POST /api/rewards/seashells/award — { studentIds[], reason, points }
// Bulk-awards seashells and logs each in prize history.
export const awardSeashells = async (req, res, next) => {
  try {
    const { studentIds, reason, points } = req.body;
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    const pts = parseInt(points);
    if (ids.length === 0 || isNaN(pts) || !reason) {
      return res.status(400).json({ message: 'studentIds, reason and points are required.' });
    }

    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { seashells: { increment: pts } },
      }),
      prisma.prizeHistory.createMany({
        data: ids.map(id => ({ studentId: id, reason, points: pts, type: 'EARNED' })),
      }),
    ]);

    res.json({ success: true, awarded: ids.length, points: pts });
  } catch (error) {
    next(error);
  }
};

// POST /api/rewards/seashells/redeem — { studentId, reason, points }
export const redeemSeashells = async (req, res, next) => {
  try {
    const { studentId, reason, points } = req.body;
    const pts = parseInt(points);
    if (!studentId || isNaN(pts) || !reason) {
      return res.status(400).json({ message: 'studentId, reason and points are required.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.user.findUniqueOrThrow({ where: { id: studentId } });
      if (pts > student.seashells) {
        return { insufficientBalance: true, currentBalance: student.seashells };
      }
      const newBalance = student.seashells - pts;
      await tx.user.update({ where: { id: studentId }, data: { seashells: newBalance } });
      await tx.prizeHistory.create({
        data: { studentId, reason, points: pts, type: 'REDEEMED' },
      });
      return { newBalance };
    });

    if (result.insufficientBalance) {
      return res.status(400).json({
        message: `Student only has ${result.currentBalance} seashells — cannot redeem ${pts}.`,
      });
    }

    res.json({ success: true, newBalance: result.newBalance });
  } catch (error) {
    next(error);
  }
};
