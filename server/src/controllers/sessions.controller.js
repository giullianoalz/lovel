import prisma from '../config/database.js';
import { broadcastToManagement } from '../utils/pushNotifications.js';
import { sendNotification } from '../jobs/notification.helper.js';
import { getAcademySettings } from '../services/settings.service.js';

// A student cancelling with less than this many hours' notice triggers a
// suggested (not automatic) 50% charge that the admin must review.
const CANCELLATION_WINDOW_HOURS = 48;
const LATE_CANCELLATION_SUGGESTED_PERCENT = 50;

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

    // Attendance is recorded by the teacher when the session happens (see
    // updateAttendance) — pre-filling PRESENT here would fabricate attendance
    // for a session that hasn't occurred yet, and payroll only pays for
    // sessions with a real PRESENT record.
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

    // Parse as UTC-midnight dates and check weekday with getUTCDay() throughout —
    // mixing local getDay() with UTC-parsed dates shifts the matched weekday
    // in any timezone behind UTC (the academy runs on US Eastern time).
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (end < start) {
      return res.status(400).json({ error: 'Validation Error', message: 'endDate must be on or after startDate.' });
    }

    const weekdaySet = new Set(weekdays.map(Number));
    const dates = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (weekdaySet.has(d.getUTCDay())) dates.push(new Date(d));
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

    // Attendance is not pre-filled here — it must be recorded by the teacher
    // when the session actually happens (see updateAttendance below). Payroll
    // only pays for sessions with a real PRESENT record, so scheduling a
    // class must not fabricate attendance on its own.
    const createdSessions = await prisma.$transaction(
      newDates.map((date) =>
        prisma.session.create({
          data: { classId, date, startTime: startObj, endTime: endObj, status: 'SCHEDULED' },
        })
      )
    );

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

    // Notify parents of anyone marked absent — fire-and-forget so a slow
    // notification fan-out never delays the teacher's save confirmation.
    const absentIds = attendanceRecords
      .filter((r) => r.status.toUpperCase() === 'ABSENT')
      .map((r) => r.studentId);
    if (absentIds.length > 0) {
      notifyParentsOfAbsence(req.params.id, absentIds).catch((err) =>
        console.error('[Attendance] absence notification failed:', err.message)
      );
    }
  } catch (error) {
    next(error);
  }
};

// Notifies each absent student's parent(s), respecting the admin's
// absenceAlertEnabled toggle. dedupKey is per session+student so re-saving
// the same attendance sheet (e.g. adding a note afterward) never re-notifies.
const notifyParentsOfAbsence = async (sessionId, studentIds) => {
  const settings = await getAcademySettings();
  if (!settings.absenceAlertEnabled) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { class: { select: { name: true } } },
  });
  if (!session) return;

  const familyMembers = await prisma.familyMember.findMany({
    where: { userId: { in: studentIds } },
    select: { familyId: true, userId: true, user: { select: { fullName: true } } },
  });

  for (const studentFM of familyMembers) {
    const parents = await prisma.familyMember.findMany({
      where: { familyId: studentFM.familyId, user: { role: 'PARENT' } },
      select: { userId: true },
    });

    for (const parent of parents) {
      await sendNotification({
        userId: parent.userId,
        type: 'ABSENCE',
        title: `${studentFM.user.fullName} was marked absent`,
        message: `${studentFM.user.fullName} was marked absent from ${session.class.name} today.`,
        referenceType: 'session',
        referenceId: sessionId,
        dedupKey: `absence-${sessionId}-${studentFM.userId}`,
      });
    }
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
        enrollments: {
          where: { status: 'active' },
          select: { student: { select: { id: true, fullName: true } } },
        },
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

/**
 * POST /api/sessions/:id/cancel-student
 * Admin/front-desk cancels a single student's spot in a session.
 * >=48h before the class: free, auto-resolved, no admin action needed.
 * <48h before the class: suggests a 50% charge but does NOT charge anything —
 * it opens a review item and notifies the admin, who decides the final amount.
 */
export const cancelStudentSession = async (req, res, next) => {
  try {
    const { studentId, reason } = req.body;
    const cancelledById = req.user.id;

    if (!studentId) {
      return res.status(400).json({ error: 'Validation Error', message: 'studentId is required.' });
    }

    const session = await prisma.session.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { class: { select: { id: true, name: true, enrollments: { where: { status: 'active' } } } } },
    });

    // A student can only be cancelled from a given session once — a double
    // submit here must not open two review items (and risk a double charge).
    const existingCancellation = await prisma.sessionCancellation.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId } },
    });
    if (existingCancellation) {
      return res.status(409).json({
        error: 'Already Cancelled',
        message: 'This student\'s enrollment in this session was already cancelled.',
        cancellation: existingCancellation,
      });
    }

    const classDateTime = new Date(session.date);
    const startOfDay = new Date(Date.UTC(classDateTime.getUTCFullYear(), classDateTime.getUTCMonth(), classDateTime.getUTCDate()));
    const startTime = new Date(session.startTime);
    startOfDay.setUTCHours(startTime.getUTCHours(), startTime.getUTCMinutes(), startTime.getUTCSeconds());

    const hoursBeforeClass = (startOfDay.getTime() - Date.now()) / (1000 * 60 * 60);
    const suggestedChargePercent = hoursBeforeClass >= CANCELLATION_WINDOW_HOURS ? 0 : LATE_CANCELLATION_SUGGESTED_PERCENT;
    const autoResolved = suggestedChargePercent === 0;

    const [, cancellation] = await prisma.$transaction([
      prisma.attendance.upsert({
        where: { sessionId_studentId: { sessionId: session.id, studentId } },
        update: { status: 'EXCUSED', checkedAt: new Date() },
        create: { sessionId: session.id, studentId, status: 'EXCUSED' },
      }),
      prisma.sessionCancellation.create({
        data: {
          sessionId: session.id,
          studentId,
          cancelledById,
          reason: reason || null,
          hoursBeforeClass,
          suggestedChargePercent,
          status: autoResolved ? 'RESOLVED' : 'PENDING_REVIEW',
          finalChargePercent: autoResolved ? 0 : null,
          resolvedAt: autoResolved ? new Date() : null,
        },
        include: { student: { select: { id: true, fullName: true } } },
      }),
    ]);

    // Cancelling the only enrolled student cancels the session itself —
    // for group sessions, the other students keep their spot.
    if (session.class.enrollments.length <= 1) {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'CANCELLED' } });
    }

    if (!autoResolved) {
      const io = req.app.get('io');
      if (io) {
        io.to('admin_room').emit('cancellation_pending', {
          id: cancellation.id,
          studentName: cancellation.student.fullName,
          className: session.class.name,
          sessionDate: session.date,
          hoursBeforeClass,
          suggestedChargePercent,
          reason: cancellation.reason,
          createdAt: cancellation.createdAt,
        });
      }
      await broadcastToManagement(
        'Cancellation needs a decision',
        `${cancellation.student.fullName} cancelled ${session.class.name} with less than 48h notice — decide how much to charge (suggested ${LATE_CANCELLATION_SUGGESTED_PERCENT}%).`,
        { cancellationId: cancellation.id }
      );
    }

    res.status(201).json({ cancellation, autoResolved });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sessions/cancellations — Admin review queue (default: pending only)
 */
export const listCancellations = async (req, res, next) => {
  try {
    const { status } = req.query;

    const cancellations = await prisma.sessionCancellation.findMany({
      where: { status: status ? status.toUpperCase() : 'PENDING_REVIEW' },
      include: {
        student: { select: { id: true, fullName: true } },
        cancelledBy: { select: { id: true, fullName: true } },
        resolvedBy: { select: { id: true, fullName: true } },
        session: { select: { id: true, date: true, startTime: true, class: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ cancellations });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/sessions/cancellations/:id/resolve
 * Admin decides the final charge. If a chargeAmount is given, it's recorded
 * as a real Charge transaction against the student's family right away.
 */
export const resolveCancellation = async (req, res, next) => {
  try {
    const { finalChargePercent, chargeAmount } = req.body;
    const resolvedById = req.user.id;

    if (finalChargePercent === undefined || finalChargePercent === null) {
      return res.status(400).json({ error: 'Validation Error', message: 'finalChargePercent is required.' });
    }

    const cancellation = await prisma.sessionCancellation.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { student: { select: { id: true, fullName: true } }, session: { include: { class: { select: { name: true } } } } },
    });

    // Idempotency guard: a double-click, two admins on the same queue, or a
    // network retry must never charge the family twice for one cancellation.
    if (cancellation.status === 'RESOLVED') {
      return res.status(409).json({ error: 'Already Resolved', message: 'This cancellation was already resolved.' });
    }

    const updated = await prisma.sessionCancellation.update({
      where: { id: req.params.id, status: 'PENDING_REVIEW' },
      data: {
        status: 'RESOLVED',
        finalChargePercent: parseInt(finalChargePercent),
        chargeAmount: chargeAmount != null ? parseFloat(chargeAmount) : null,
        resolvedById,
        resolvedAt: new Date(),
      },
    }).catch(() => null);

    if (!updated) {
      return res.status(409).json({ error: 'Already Resolved', message: 'This cancellation was already resolved.' });
    }

    if (chargeAmount != null && parseFloat(chargeAmount) > 0) {
      const familyMember = await prisma.familyMember.findFirst({ where: { userId: cancellation.studentId } });
      if (familyMember) {
        await prisma.transaction.create({
          data: {
            studentId: cancellation.studentId,
            familyId: familyMember.familyId,
            amount: parseFloat(chargeAmount),
            type: 'CHARGE',
            description: `Late cancellation fee — ${cancellation.session.class.name} (${cancellation.finalChargePercent ?? finalChargePercent}%)`,
          },
        });
      }
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('cancellation_resolved', { id: updated.id });
    }

    res.json({ cancellation: updated });
  } catch (error) {
    next(error);
  }
};
