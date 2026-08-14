import prisma from '../config/database.js';
import { isOnly } from '../utils/roles.js';
import { sendNotification } from '../jobs/notification.helper.js';

export const createLessonPlan = async (req, res, next) => {
  try {
    const { classId, weekOf, type, mainActivity, materials, safetyNotes, skillConnection, differentiation, supplyItems, attachments } = req.body;
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
        attachments: attachments?.length > 0 ? {
          create: attachments.map(att => ({
            fileName: att.name || att.fileName,
            fileUrl: att.url || att.fileUrl,
            fileType: att.type || att.fileType
          }))
        } : undefined,
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
        attachments: true,
      },
    });

    // Let front-desk/admin know a purchase is needed — the supply list is
    // useless if nobody finds out until they happen to open this screen.
    if (lessonPlan.supplyItems.length > 0) {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      const itemSummary = lessonPlan.supplyItems
        .map(i => `${i.itemName} (×${i.quantity})`)
        .join(', ');

      await Promise.all(admins.map(admin => sendNotification({
        userId: admin.id,
        type: 'SUPPLY_REQUEST',
        title: 'New supply request',
        message: `${lessonPlan.teacher.fullName} requested supplies for ${lessonPlan.class?.name || 'a lesson plan'}: ${itemSummary}.`,
        referenceType: 'lesson_plan',
        referenceId: lessonPlan.id,
        dedupKey: `supply_request_${lessonPlan.id}`,
      })));
    }

    res.status(201).json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

export const listLessonPlans = async (req, res, next) => {
  try {
    const { classId, teacherId, weekOf, status, archived } = req.query;
    const where = {};
    if (classId) where.classId = classId;
    if (teacherId) where.teacherId = teacherId;
    if (status) where.status = status;
    if (weekOf) where.weekOf = new Date(weekOf);
    // Omitted entirely: callers referencing a plan by class/week (e.g. the
    // in-session lesson plan lookup) need it whether or not an admin has since
    // archived it. Only the review screens pass this explicitly to hide clutter.
    if (archived !== undefined) where.archived = archived === 'true';
    if (isOnly(req.user, 'TEACHER')) where.teacherId = req.user.id;

    const lessonPlans = await prisma.lessonPlan.findMany({
      where,
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
        attachments: true,
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
        attachments: true,
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
        attachments: true,
      },
    });

    res.json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

export const archiveLessonPlan = async (req, res, next) => {
  try {
    const { archived = true } = req.body;

    const lessonPlan = await prisma.lessonPlan.update({
      where: { id: req.params.id },
      data: { archived, archivedAt: archived ? new Date() : null },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
        attachments: true,
      },
    });

    res.json({ lessonPlan });
  } catch (error) {
    next(error);
  }
};

export const archiveLessonPlansByWeek = async (req, res, next) => {
  try {
    const { weekOf } = req.body;
    if (!weekOf) {
      return res.status(400).json({ error: 'Validation Error', message: 'weekOf is required.' });
    }

    // Teachers pick any date to represent "the week" on a lesson plan, not
    // necessarily a Monday, so two plans for the same week can carry different
    // weekOf values. `weekOf` here is the Monday the UI grouped them under —
    // archive the whole Mon-Sun span, not just an exact date match.
    const start = new Date(weekOf);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = await prisma.lessonPlan.updateMany({
      where: { weekOf: { gte: start, lt: end }, archived: false },
      data: { archived: true, archivedAt: new Date() },
    });

    res.json({ archivedCount: result.count });
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
        lessonPlan: { select: { id: true, weekOf: true, type: true, mainActivity: true, class: { select: { name: true } } } },
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
    const { cost, receiptUrl, status = 'PURCHASED' } = req.body;

    const item = await prisma.supplyItem.update({
      where: { id },
      data: { 
        status, 
        cost: status === 'PENDING' ? null : (cost ?? null), 
        receiptUrl: status === 'PENDING' ? null : (receiptUrl || null) 
      },
    });

    res.json({ item });
  } catch (error) {
    next(error);
  }
};
