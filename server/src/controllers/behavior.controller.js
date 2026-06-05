import prisma from '../config/database.js';

// POST /api/behavior — Log a behavior entry
export const createBehaviorLog = async (req, res, next) => {
  try {
    const { studentId, sessionId, type, category, description, severity } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !type || !category || !description) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'studentId, type, category, and description are required.',
      });
    }

    const log = await prisma.behaviorLog.create({
      data: {
        studentId,
        teacherId,
        sessionId: sessionId || null,
        type,
        category,
        description,
        severity: severity || 'MINOR',
      },
      include: {
        student: { select: { id: true, fullName: true } },
        teacher: { select: { id: true, fullName: true } },
      },
    });

    // Emit real-time notification to admins
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('behavior_logged', {
        id: log.id,
        studentName: log.student.fullName,
        teacherName: log.teacher.fullName,
        type: log.type,
        category: log.category,
        severity: log.severity,
        description: log.description,
        createdAt: log.createdAt,
      });
    }

    res.status(201).json({ log });
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
