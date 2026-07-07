import prisma from '../config/database.js';

export const createLessonPlan = async (req, res, next) => {
  try {
    const { classId, weekOf, type, mainActivity, materials, safetyNotes, skillConnection, differentiation, supplyItems } = req.body;
    const teacherId = req.user.id;

    if (!weekOf || !mainActivity) {
      return res.status(400).json({ error: 'Validation Error', message: 'weekOf and mainActivity are required.' });
    }

    const lessonPlan = await prisma.lessonPlan.create({
      data: {
        teacherId,
        classId: classId || null,
        weekOf: new Date(weekOf),
        type: type || 'DISCOVERY_COVE',
        mainActivity,
        materials: materials || null,
        safetyNotes: safetyNotes || null,
        skillConnection: skillConnection || null,
        differentiation: differentiation || null,
        supplyItems: supplyItems?.length > 0 ? {
          create: supplyItems.map(item => ({
            teacherId,
            itemName: item.itemName,
            quantity: item.quantity || 1,
            dayNeeded: item.dayNeeded || null,
          }))
        } : undefined,
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
      },
    });

    res.status(201).json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

export const listLessonPlans = async (req, res, next) => {
  try {
    const { classId, teacherId, weekOf, status } = req.query;
    const where = {};
    if (classId) where.classId = classId;
    if (teacherId) where.teacherId = teacherId;
    if (status) where.status = status;
    if (weekOf) where.weekOf = new Date(weekOf);
    if (req.user.role === 'TEACHER') where.teacherId = req.user.id;

    const lessonPlans = await prisma.lessonPlan.findMany({
      where,
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
      },
      orderBy: { weekOf: 'desc' },
    });

    res.json({ lessonPlans });
  } catch (error) {
    next(error);
  }
};

export const getLessonPlan = async (req, res, next) => {
  try {
    const lessonPlan = await prisma.lessonPlan.findUnique({
      where: { id: req.params.id },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
      },
    });
    if (!lessonPlan) return res.status(404).json({ error: 'Not Found' });
    res.json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

export const reviewLessonPlan = async (req, res, next) => {
  try {
    const { status, managerFeedback } = req.body;
    if (!['APPROVED', 'NEEDS_REVISION'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED or NEEDS_REVISION' });
    }

    const lessonPlan = await prisma.lessonPlan.update({
      where: { id: req.params.id },
      data: { status, managerFeedback: managerFeedback || null },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
      },
    });

    res.json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

export const getSupplyList = async (req, res, next) => {
  try {
    const { weekOf } = req.query;
    const where = { lessonPlan: { status: 'APPROVED' } };
    if (weekOf) {
      where.lessonPlan.weekOf = new Date(weekOf);
    }

    const items = await prisma.supplyItem.findMany({
      where,
      include: {
        teacher: { select: { id: true, fullName: true } },
        lessonPlan: { select: { weekOf: true, class: { select: { name: true } } } },
      },
      orderBy: [{ dayNeeded: 'asc' }, { itemName: 'asc' }],
    });

    res.json({ supplyItems: items });
  } catch (error) {
    next(error);
  }
};

export const markSupplyPurchased = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cost, receiptUrl } = req.body;

    const item = await prisma.supplyItem.update({
      where: { id },
      data: { status: 'PURCHASED', cost: cost ?? null, receiptUrl: receiptUrl || null },
    });

    res.json({ item });
  } catch (error) {
    next(error);
  }
};
