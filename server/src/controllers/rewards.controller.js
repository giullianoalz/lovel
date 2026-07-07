import prisma from '../config/database.js';

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

      const newBalance = student.snackPunches - snack.costPunches;
      await tx.user.update({ where: { id: studentId }, data: { snackPunches: newBalance } });
      await tx.snackPurchase.create({
        data: { studentId, snackId, punchesUsed: snack.costPunches },
      });
      return { newBalance, snackName: snack.name };
    });

    res.json({ success: true, newBalance: result.newBalance, snackName: result.snackName });
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
