import prisma from '../config/database.js';
import { invalidate } from '../middleware/cache.js';
import { isOnly } from '../utils/roles.js';
import { sendNotification } from '../jobs/notification.helper.js';
import { generateLessonPlanSummary, fallbackLessonPlanSummary } from '../services/ai.service.js';

// The Monday (UTC calendar date) of the week `date` falls in. Sessions and
// lesson plans are both stored as @db.Date — comparing on UTC calendar days
// (rather than local time) keeps this stable regardless of server timezone.
function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

// Publishes the manager-approved preview to every session of that week. Teachers
// pick any date to represent "the week" on a lesson plan, not necessarily a
// Monday, so plan and sessions are matched by which Mon-Sun week they fall in,
// not an exact date. Always clears old auto-notes first (covers NEEDS_REVISION
// and re-approval alike) so a plan that's no longer approved never leaves a
// stale preview for families.
//
// Re-approving overwrites edits made to the note afterwards. That is deliberate:
// approving is an explicit act by the manager, and the version they just signed
// off on is the one families should see.
async function syncLessonPlanSessionSummary(lessonPlan) {
  if (!lessonPlan.classId) return;

  const start = mondayOfWeek(lessonPlan.weekOf);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const sessions = await prisma.session.findMany({
    where: { classId: lessonPlan.classId, date: { gte: start, lt: end } },
    select: { id: true },
  });
  const sessionIds = sessions.map(s => s.id);
  if (sessionIds.length === 0) return;

  await prisma.sessionNote.deleteMany({
    where: { sessionId: { in: sessionIds }, source: 'lesson_plan_summary' },
  });

  if (lessonPlan.status === 'APPROVED') {
    const summary = lessonPlan.notesSummary?.trim() || fallbackLessonPlanSummary(lessonPlan);
    await prisma.sessionNote.createMany({
      data: sessionIds.map(sessionId => ({
        sessionId,
        notes: summary,
        visibility: 'all',
        source: 'lesson_plan_summary',
      })),
    });
  }
}

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

    // Drafted after responding, not before: the model takes ~30s on the local
    // Ollama box, and a teacher hitting "Submit" must not sit and wait for it.
    // The manager is the only one who reads this, minutes or hours later. If it
    // is somehow still missing when they open the plan, the review screen has a
    // Regenerate button that drafts one on the spot.
    void generateLessonPlanSummary(lessonPlan)
      .then(notesSummary => prisma.lessonPlan.update({
        where: { id: lessonPlan.id },
        data: { notesSummary },
      }))
      .catch(error => console.error(`[lesson-plan] Background summary failed for ${lessonPlan.id}:`, error.message));
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

    const classIds = [...new Set(lessonPlans.map((p) => p.classId).filter(Boolean))];
    if (classIds.length > 0) {
      const minWeek = new Date(Math.min(...lessonPlans.map((p) => p.weekOf)));
      const maxWeek = new Date(Math.max(...lessonPlans.map((p) => p.weekOf)));
      const start = mondayOfWeek(minWeek);
      const end = new Date(mondayOfWeek(maxWeek).getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const allSessions = await prisma.session.findMany({
        where: {
          classId: { in: classIds },
          date: { gte: start, lt: end },
          status: { not: 'CANCELLED' }
        },
        select: { classId: true, date: true }
      });

      for (const plan of lessonPlans) {
        if (!plan.classId) {
          plan.sessionDates = [];
          continue;
        }
        const pStart = mondayOfWeek(plan.weekOf);
        const pEnd = new Date(pStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        plan.sessionDates = allSessions
          .filter((s) => s.classId === plan.classId && s.date >= pStart && s.date < pEnd)
          .map((s) => s.date.toISOString());
      }
    }

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

/**
 * POST /api/lesson-plans/:id/regenerate-summary
 * Draft a fresh family-facing summary for a plan, on demand.
 *
 * Deliberately does NOT save: it hands the text back for the manager's textarea,
 * and only approving commits it. Regenerating a draft the manager then dislikes
 * must not destroy the wording that was already there.
 */
export const regenerateLessonPlanSummary = async (req, res, next) => {
  try {
    const lessonPlan = await prisma.lessonPlan.findUnique({
      where: { id: req.params.id },
      select: {
        mainActivity: true,
        materials: true,
        skillConnection: true,
        class: { select: { name: true } },
      },
    });
    if (!lessonPlan) return res.status(404).json({ error: 'Not Found' });

    const notesSummary = await generateLessonPlanSummary(lessonPlan);
    res.json({ notesSummary });
  } catch (error) {
    next(error);
  }
};

export const reviewLessonPlan = async (req, res, next) => {
  try {
    const { status, managerFeedback, notesSummary } = req.body;
    if (!['APPROVED', 'NEEDS_REVISION'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED or NEEDS_REVISION' });
    }

    const lessonPlan = await prisma.lessonPlan.update({
      where: { id: req.params.id },
      data: {
        status,
        managerFeedback: managerFeedback || null,
        // The manager's corrected wording, if they touched it. Undefined leaves
        // the assistant's draft as-is; an empty string is treated as "cleared"
        // and falls back at publish time rather than showing families a blank.
        ...(notesSummary !== undefined ? { notesSummary: notesSummary.trim() || null } : {}),
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        supplyItems: true,
        attachments: true,
      },
    });

    await syncLessonPlanSessionSummary(lessonPlan);
    // Approving publishes (or withdraws) what families see, so the cached
    // portal payloads carrying it are stale the moment this returns.
    invalidate('portal:*');

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
