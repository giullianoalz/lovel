import prisma from '../config/database.js';

// POST /api/class-fit — Submit a class-fit flag
export const createClassFitReport = async (req, res, next) => {
  try {
    const { studentId, classId, sessionId, reason, suggestion } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !classId || !reason) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'studentId, classId, and reason are required.',
      });
    }

    const report = await prisma.classFitReport.create({
      data: {
        studentId,
        classId,
        teacherId,
        sessionId: sessionId || null,
        reason,
        suggestion: suggestion || null,
      },
      include: {
        student: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        teacher: { select: { id: true, fullName: true } },
      },
    });

    // Notify admins via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('class_fit_report', {
        id: report.id,
        studentName: report.student.fullName,
        className: report.class.name,
        teacherName: report.teacher.fullName,
        reason: report.reason,
        suggestion: report.suggestion,
        createdAt: report.createdAt,
      });
    }

    res.status(201).json({ report });
  } catch (error) {
    next(error);
  }
};

// GET /api/class-fit — List all reports (admin view, with filters)
export const listClassFitReports = async (req, res, next) => {
  try {
    const { status, studentId, classId, from, to } = req.query;

    const where = {};
    if (status) where.status = status;
    if (studentId) where.studentId = studentId;
    if (classId) where.classId = classId;

    // Teachers only see their own reports
    if (req.user.role === 'TEACHER') {
      where.teacherId = req.user.id;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const reports = await prisma.classFitReport.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        teacher: { select: { id: true, fullName: true } },
        reviewer: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ reports });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/class-fit/:id — Admin reviews/resolves a report
export const reviewClassFitReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reviewNotes } = req.body;
    const reviewedBy = req.user.id;

    const updated = await prisma.classFitReport.update({
      where: { id },
      data: {
        status: status || 'reviewed',
        reviewedBy,
        reviewNotes: reviewNotes || null,
      },
      include: {
        student: { select: { id: true, fullName: true } },
        class: { select: { id: true, name: true } },
        teacher: { select: { id: true, fullName: true } },
        reviewer: { select: { id: true, fullName: true } },
      },
    });

    res.json({ report: updated });
  } catch (error) {
    next(error);
  }
};
