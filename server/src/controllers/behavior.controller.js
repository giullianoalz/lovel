import prisma from '../config/database.js';
import { notifyAdmins, sendNotification } from '../jobs/notification.helper.js';

// POST /api/behavior — Log a behavior entry
export const createBehaviorLog = async (req, res, next) => {
  try {
    const { studentId, additionalStudentIds = [], sessionId, place, ruleBroken, type, category, description } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !type || !category || !description) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'studentId, type, category, and description are required.',
      });
    }

    const allStudentIds = [studentId, ...additionalStudentIds];

    // Severity is intentionally NOT taken from the reporter. Teachers report the
    // incident; an admin decides the severity level afterwards during review
    // (see updateBehaviorStatus). It stays at the schema default until then.
    const logs = await prisma.$transaction(
      allStudentIds.map(sId =>
        prisma.behaviorLog.create({
          data: {
            studentId: sId,
            teacherId,
            sessionId: sessionId || null,
            place,
            ruleBroken,
            type,
            category,
            description,
            status: 'RECORDED'
          },
          include: {
            student: { select: { id: true, fullName: true } },
            teacher: { select: { id: true, fullName: true } },
          },
        })
      )
    );

    const io = req.app.get('io');
    const studentNames = logs.map(l => l.student.fullName).join(', ');

    // Persist a durable in-app notification for every admin (+ FCM push). This is
    // what makes the report show up in the notifications inbox even when no admin
    // is on the alerts screen and no device token is registered — previously it
    // only lived in the Behavior list. Severity isn't known yet — the admin sets
    // it while reviewing, so the report reads as pending review here.
    notifyAdmins({
      type: 'BEHAVIOR',
      title: type === 'POSITIVE' ? 'New Positive Note' : 'New Behavior Report — needs review',
      message: `${logs[0].teacher.fullName} reported a ${category.toLowerCase()} incident involving ${studentNames}.`,
      referenceType: 'behaviorLog',
      referenceId: logs[0].id,
      io,
    });

    // Emit real-time notification to admins
    if (io) {
      io.to('admin_room').emit('behavior_logged', {
        id: logs[0].id,
        studentName: logs.map(l => l.student.fullName).join(', '),
        teacherName: logs[0].teacher.fullName,
        type: logs[0].type,
        category: logs[0].category,
        severity: logs[0].severity,
        description: logs[0].description,
        createdAt: logs[0].createdAt,
      });
    }

    res.status(201).json({ logs });
  } catch (error) {
    next(error);
  }
};

// GET /api/behavior — List all behavior logs (admin view, with filters)
export const listBehaviorLogs = async (req, res, next) => {
  try {
    const { studentId, type, category, severity, from, to, page = 1, limit = 50 } = req.query;

    const where = {};
    if (studentId) where.studentId = studentId;
    if (type) where.type = type;
    if (category) where.category = category;
    if (severity) where.severity = severity;

    // For teachers, only show their own logs
    if (req.user.role === 'TEACHER') {
      where.teacherId = req.user.id;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      prisma.behaviorLog.findMany({
        where,
        include: {
          student: { select: { id: true, fullName: true, avatarUrl: true } },
          teacher: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.behaviorLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

// GET /api/behavior/student/:studentId — Get behavior history for a specific student
export const getStudentBehavior = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    const logs = await prisma.behaviorLog.findMany({
      where: { studentId },
      include: {
        teacher: { select: { id: true, fullName: true } },
        session: { select: { id: true, date: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Summary stats
    const summary = {
      totalWarnings: logs.filter(l => l.type === 'WARNING').length,
      totalSlips: logs.filter(l => l.type === 'SLIP').length,
      totalPositive: logs.filter(l => l.type === 'POSITIVE').length,
      severeCount: logs.filter(l => l.severity === 'SEVERE').length,
    };

    res.json({ logs, summary });
  } catch (error) {
    next(error);
  }
};

// PUT /api/behavior/:id/status — Manager updates status (e.g. DOWNGRADED, SENT_TO_PARENT)
// and, crucially, sets the severity level — this is the ONLY place severity is
// assigned, and it's admin-only (see behavior.routes.js).
const VALID_SEVERITIES = ['MINOR', 'MODERATE', 'SEVERE'];
export const updateBehaviorStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, managerNotes, severity } = req.body;

    const data = {
      status,
      managerNotes
    };

    if (severity !== undefined) {
      if (!VALID_SEVERITIES.includes(severity)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `severity must be one of: ${VALID_SEVERITIES.join(', ')}.`,
        });
      }
      data.severity = severity;
    }

    if (status === 'SENT_TO_PARENT') {
      data.parentNotifiedAt = new Date();
    }

    const log = await prisma.behaviorLog.update({
      where: { id },
      data,
      include: {
        student: true
      }
    });

    if (status === 'SENT_TO_PARENT') {
      // Find parent and send push notification
      const familyMembers = await prisma.familyMember.findMany({
        where: { userId: log.studentId },
        select: { family: { select: { members: { where: { role: 'PARENT' }, select: { userId: true } } } } }
      });
      const parentIds = familyMembers.flatMap(f => f.family.members.map(m => m.userId));

      // Persist a Notification (+ FCM push) per parent so it lands in their bell,
      // not just as an ephemeral push.
      await Promise.all(parentIds.map(userId => sendNotification({
        userId,
        type: 'BEHAVIOR',
        title: 'Behavior Incident Report',
        message: `An incident involving ${log.student.fullName} has been recorded.`,
        referenceType: 'behaviorLog',
        referenceId: log.id,
      })));
    }

    res.json({ log });
  } catch (error) {
    next(error);
  }
};
