import prisma from '../config/database.js';

/**
 * GET /api/sessions
 * List sessions, typically filtered by date range for a calendar view
 */
export const listSessions = async (req, res, next) => {
  try {
    const { startDate, endDate, classId, teacherId, status } = req.query;

    const where = {};
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }
    if (classId) where.classId = classId;
    if (status) where.status = status.toUpperCase();
    if (teacherId) {
      where.class = { teacherId };
    }

    const sessions = await prisma.session.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: {
        class: {
          select: { name: true, subject: true, type: true, meetingUrl: true },
        },
        notes: { orderBy: { createdAt: 'desc' } },
        materials: true,
      },
    });

    res.json({ sessions });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sessions/:id
 * Get a specific session with attendance records and notes
 */
export const getSession = async (req, res, next) => {
  try {
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        class: {
          include: { teacher: { select: { id: true, fullName: true } } },
        },
        attendance: {
          include: {
            student: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
        notes: true,
        materials: true,
      },
    });

    res.json({ session });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions
 * Schedule a new class session
 */
export const createSession = async (req, res, next) => {
  try {
    const { classId, date, startTime, endTime } = req.body;

    if (!classId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Validation Error', message: 'classId, date, startTime, and endTime are required.' });
    }

    // Convert startTime/endTime strings to proper DateTime objects for PostgreSQL TIME column
    const startObj = new Date(`1970-01-01T${startTime}:00Z`);
    const endObj = new Date(`1970-01-01T${endTime}:00Z`);

    const session = await prisma.session.create({
      data: {
        classId,
        date: new Date(date),
        startTime: startObj,
        endTime: endObj,
        status: 'SCHEDULED',
      },
    });

    // Auto-create blank attendance records for all active enrollments
    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'active' },
      select: { studentId: true },
    });

    if (enrollments.length > 0) {
      await prisma.attendance.createMany({
        data: enrollments.map((e) => ({
          sessionId: session.id,
          studentId: e.studentId,
          status: 'PRESENT', // Default assumption
        })),
      });
    }

    res.status(201).json({ message: 'Session created successfully.', session });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/bulk
 * Generate recurring sessions for a class across a date range on chosen weekdays.
 * This is the only real way to put a class on the schedule — without it, teachers
 * have nothing to complete and payroll/attendance never has real data to work with.
 */
export const bulkScheduleSessions = async (req, res, next) => {
  try {
    const { classId, startDate, endDate, weekdays, startTime, endTime } = req.body;

    if (!classId || !startDate || !endDate || !Array.isArray(weekdays) || weekdays.length === 0 || !startTime || !endTime) {
      return res.status(400).json({ error: 'Validation Error', message: 'classId, startDate, endDate, weekdays[], startTime, and endTime are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      return res.status(400).json({ error: 'Validation Error', message: 'endDate must be on or after startDate.' });
    }

    const weekdaySet = new Set(weekdays.map(Number));
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (weekdaySet.has(d.getDay())) dates.push(new Date(d));
    }

    if (dates.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'No dates in range match the selected weekdays.' });
    }

    // Skip dates that already have a session for this class (re-running must not duplicate).
    const existing = await prisma.session.findMany({
      where: { classId, date: { gte: start, lte: end } },
      select: { date: true },
    });
    const existingDates = new Set(existing.map((s) => s.date.toISOString().slice(0, 10)));
    const newDates = dates.filter((d) => !existingDates.has(d.toISOString().slice(0, 10)));

    if (newDates.length === 0) {
      return res.json({ message: 'All matching dates already have a session scheduled.', created: 0 });
    }

    const startObj = new Date(`1970-01-01T${startTime}:00Z`);
    const endObj = new Date(`1970-01-01T${endTime}:00Z`);

    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'active' },
      select: { studentId: true },
    });

    const createdSessions = await prisma.$transaction(
      newDates.map((date) =>
        prisma.session.create({
          data: { classId, date, startTime: startObj, endTime: endObj, status: 'SCHEDULED' },
        })
      )
    );

    if (enrollments.length > 0) {
      await prisma.attendance.createMany({
        data: createdSessions.flatMap((session) =>
          enrollments.map((e) => ({ sessionId: session.id, studentId: e.studentId, status: 'PRESENT' }))
        ),
      });
    }

    res.status(201).json({ message: `${createdSessions.length} sessions scheduled.`, created: createdSessions.length });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/sessions/:id
 * Update session status (e.g. mark as COMPLETED) or time
 */
export const updateSession = async (req, res, next) => {
  try {
    const { status, date, startTime, endTime } = req.body;
    const updateData = {};

    if (status) updateData.status = status.toUpperCase();
    if (date) updateData.date = new Date(date);
    if (startTime) updateData.startTime = new Date(`1970-01-01T${startTime}:00Z`);
    if (endTime) updateData.endTime = new Date(`1970-01-01T${endTime}:00Z`);

    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({ message: 'Session updated.', session });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/sessions/:id/attendance
 * Batch update attendance for a session
 */
export const updateAttendance = async (req, res, next) => {
  try {
    const { attendanceRecords } = req.body; // Array of { studentId, status }

    if (!Array.isArray(attendanceRecords)) {
      return res.status(400).json({ error: 'Validation Error', message: 'attendanceRecords must be an array.' });
    }

    // Execute all updates in a transaction
    await prisma.$transaction(
      attendanceRecords.map((record) =>
        prisma.attendance.upsert({
          where: {
            sessionId_studentId: {
              sessionId: req.params.id,
              studentId: record.studentId,
            },
          },
          update: {
            status: record.status.toUpperCase(),
            checkedAt: new Date(),
          },
          create: {
            sessionId: req.params.id,
            studentId: record.studentId,
            status: record.status.toUpperCase(),
          },
        })
      )
    );

    res.json({ message: 'Attendance records updated successfully.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/:id/notes
 * Add a note/report to a session
 */
/**
 * GET /api/sessions/supervision
 * Admin-only: all sessions with notes & materials, grouped by class
 */
export const supervisionSessions = async (req, res, next) => {
  try {
    const { classId, teacherId, from, to } = req.query;

    const where = {};
    if (classId) where.classId = classId;
    if (teacherId) where.class = { teacherId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const sessions = await prisma.session.findMany({
      where,
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      include: {
        class: {
          select: { id: true, name: true, subject: true, type: true },
        },
        notes: true,
        materials: true,
        attendance: {
          include: {
            student: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    const classes = await prisma.class.findMany({
      where: teacherId ? { teacherId } : undefined,
      orderBy: { name: 'asc' },
      include: {
        teacher: { select: { id: true, fullName: true } },
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    });

    const teachers = await prisma.user.findMany({
      where: { role: 'TEACHER' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });

    res.json({ sessions, classes, teachers });
  } catch (error) {
    next(error);
  }
};

export const addSessionNote = async (req, res, next) => {
  try {
    const { notes, visibility = 'all' } = req.body;

    const note = await prisma.sessionNote.create({
      data: {
        sessionId: req.params.id,
        notes,
        visibility,
      },
    });

    res.status(201).json({ message: 'Session note added.', note });
  } catch (error) {
    next(error);
  }
};
