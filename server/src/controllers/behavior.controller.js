import prisma from '../config/database.js';

// POST /api/behavior — Log a behavior entry
export const createBehaviorLog = async (req, res, next) => {
  try {
    const { studentId, additionalStudentIds = [], sessionId, place, ruleBroken, type, category, description, severity } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !type || !category || !description) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'studentId, type, category, and description are required.',
      });
    }

    const allStudentIds = [studentId, ...additionalStudentIds];
    
    // Create logs for all involved students
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
            severity: severity || 'MINOR',
            status: 'RECORDED'
          },
          include: {
            student: { select: { id: true, fullName: true } },
            teacher: { select: { id: true, fullName: true } },
          },
        })
      )
    );

    // Send push notification to management
    import('../utils/pushNotifications.js').then(({ broadcastToManagement }) => {
      broadcastToManagement(
        'New Behavior Report',
        `${logs[0].teacher.fullName} reported a behavior incident involving ${logs.length} student(s).`,
        { type: 'BEHAVIOR' }
      );
    });

    // Emit real-time notification to admins
    const io = req.app.get('io');
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
export const updateBehaviorStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, managerNotes } = req.body;

    const data = {
      status,
      managerNotes
    };

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
      
      import('../utils/pushNotifications.js').then(({ sendPushNotification }) => {
        sendPushNotification(
          parentIds,
          'Behavior Incident Report',
          `An incident involving ${log.student.fullName} has been recorded.`,
          { logId: log.id }
        );
      });
    }

    res.json({ log });
  } catch (error) {
    next(error);
  }
};
