import prisma from '../config/database.js';
import { hasRole } from '../utils/roles.js';
import { broadcastToManagement } from '../utils/pushNotifications.js';
import { sendNotification, notifyAdmins } from '../jobs/notification.helper.js';
import {
  getEventConfig,
  getAdminUserIds,
  getParentUserIdsForStudents,
} from '../services/notificationConfig.service.js';

// A student cancelling with less than this many hours' notice triggers a
// suggested (not automatic) 50% charge that the admin must review.
const CANCELLATION_WINDOW_HOURS = 48;
const LATE_CANCELLATION_SUGGESTED_PERCENT = 50;

// A student marked ABSENT with no prior cancellation is a no-show: the teacher
// held the slot and waited, so it's chargeable. Like a late cancellation it
// opens a review item (never an automatic charge) — the admin confirms the
// amount. The reason string is also the marker used to recognise (and clean up)
// auto-created no-show items when a mis-marked student is later set present.
const NO_SHOW_SUGGESTED_PERCENT = 50;
const NO_SHOW_REASON = 'No-show — marked absent with no prior cancellation';

/**
 * Which sessions this user is allowed to see.
 *
 * `GET /sessions` and `GET /sessions/:id` carry `authenticate` and nothing
 * else, because /calendar is open to every role. That made the whole academy's
 * timetable readable by any signed-in account, and the detail route returned
 * each session's `attendance` — the full class roster, every child's id and
 * name — to students and parents alike.
 *
 * Returns a Prisma filter, so it composes with the caller's own filters
 * (date range, classId, teacherId) instead of replacing them.
 */
const sessionScope = async (user) => {
  if (hasRole(user, 'ADMIN')) return {};

  // Each role the account holds contributes what it may see, and the branches
  // are ORed: a teacher who is also a parent watches her own classes *and* her
  // children's, which a single-branch scope would have forced her to choose
  // between.
  const branches = [];

  if (hasRole(user, 'TEACHER')) {
    branches.push({ class: { teacherId: user.id } });
  }

  if (hasRole(user, 'STUDENT', 'PARENT')) {
    // A student sees their own classes; a parent sees their children's. Both
    // resolve to a set of student ids, so they share one branch.
    let studentIds = hasRole(user, 'STUDENT') ? [user.id] : [];
    if (hasRole(user, 'PARENT')) {
      const familyMembers = await prisma.familyMember.findMany({
        where: { userId: user.id },
        select: { familyId: true },
      });
      const children = await prisma.familyMember.findMany({
        where: {
          familyId: { in: familyMembers.map((f) => f.familyId) },
          user: { role: 'STUDENT' },
        },
        select: { userId: true },
      });
      studentIds = [...new Set([...studentIds, ...children.map((c) => c.userId)])];
    }
    branches.push({
      class: { enrollments: { some: { studentId: { in: studentIds }, status: 'active' } } },
    });
  }

  if (branches.length === 0) return { id: { in: [] } }; // no role, nothing visible
  return branches.length === 1 ? branches[0] : { OR: branches };
};

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

    // AND rather than merging keys: both sides can constrain `class`, and the
    // caller's filter must never widen what the scope allows.
    const scope = await sessionScope(req.user);
    const scopedWhere = Object.keys(scope).length ? { AND: [where, scope] } : where;

    const sessions = await prisma.session.findMany({
      where: scopedWhere,
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
    const scope = await sessionScope(req.user);
    const isStaff = hasRole(req.user, 'ADMIN', 'TEACHER');

    const session = await prisma.session.findFirstOrThrow({
      where: { id: req.params.id, ...scope },
      include: {
        class: {
          include: { teacher: { select: { id: true, fullName: true } } },
        },
        // The roster is staff-only. A parent opening a session on the calendar
        // needs its time, notes and materials — not the name of every other
        // child in the room. (The frontend reads only notes/materials here.)
        ...(isStaff ? {
          attendance: {
            include: {
              student: { select: { id: true, fullName: true, avatarUrl: true } },
            },
          },
        } : {}),
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
 * PATCH /api/sessions/bulk
 *
 * Retime (or cancel) a whole recurring series in one call. Putting a class on
 * the wrong hour and repeating it for a semester used to mean opening every
 * single session on the calendar and fixing it by hand — this is the way out.
 *
 * The series is identified the same way a human reads it off the roster: a
 * class, a weekday, and the time it currently starts at. Anything omitted just
 * widens the match, so `{ classId, startTime }` retimes every future session of
 * that class regardless of weekday.
 *
 * `from` defaults to today: history is a record of what happened, and moving a
 * class that already met would quietly rewrite it. Pass an explicit `from` to
 * include past dates when that's genuinely what's wanted.
 */
export const bulkUpdateSessions = async (req, res, next) => {
  try {
    const { classId, weekday, matchStartTime, from, to, startTime, endTime, status, meetingUrl } = req.body;

    if (!classId) {
      return res.status(400).json({ error: 'Validation Error', message: 'classId is required.' });
    }
    if (!startTime && !endTime && !status && meetingUrl === undefined) {
      return res.status(400).json({ error: 'Validation Error', message: 'Nothing to change — pass startTime, endTime, status, or meetingUrl.' });
    }
    if ((startTime && !endTime) || (endTime && !startTime)) {
      return res.status(400).json({ error: 'Validation Error', message: 'startTime and endTime must be changed together.' });
    }
    if (startTime && endTime && endTime <= startTime) {
      return res.status(400).json({ error: 'Validation Error', message: 'endTime must be after startTime.' });
    }

    // Dates are stored at UTC midnight and times on a 1970-01-01 placeholder, so
    // both sides of every comparison here are built the same way.
    const fromDate = new Date(`${from || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const where = { classId, date: { gte: fromDate } };
    if (to) where.date.lte = new Date(`${to}T00:00:00Z`);
    if (matchStartTime) where.startTime = new Date(`1970-01-01T${matchStartTime}:00Z`);
    // A cancelled session stays cancelled — sweeping it back onto the timetable
    // by retiming the series would un-cancel it in the families' calendars.
    if (!status) where.status = { not: 'CANCELLED' };

    const candidates = await prisma.session.findMany({ where, select: { id: true, date: true } });

    // Prisma has no weekday operator, so the day-of-week narrowing happens here.
    const wantedDay = weekday === undefined || weekday === null || weekday === '' ? null : Number(weekday);
    const targets = wantedDay === null
      ? candidates
      : candidates.filter((s) => s.date.getUTCDay() === wantedDay);

    if (targets.length === 0) {
      return res.json({ message: 'No sessions matched — nothing was changed.', updated: 0 });
    }

    const data = {};
    if (startTime) data.startTime = new Date(`1970-01-01T${startTime}:00Z`);
    if (endTime) data.endTime = new Date(`1970-01-01T${endTime}:00Z`);
    if (status) data.status = status.toUpperCase();
    // Same link on every Tuesday of the term, and only on Tuesdays — the whole
    // point of the per-session field is that the other weekdays stay untouched.
    if (meetingUrl !== undefined) data.meetingUrl = meetingUrl?.trim() || null;

    await prisma.session.updateMany({
      where: { id: { in: targets.map((s) => s.id) } },
      data,
    });

    res.json({
      message: `${targets.length} session${targets.length === 1 ? '' : 's'} updated.`,
      updated: targets.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/sessions/:id
 * Update session status (e.g. mark as COMPLETED), time, or this meeting's link
 */
export const updateSession = async (req, res, next) => {
  try {
    const { status, date, startTime, endTime, meetingUrl } = req.body;
    const updateData = {};

    if (status) updateData.status = status.toUpperCase();
    if (date) updateData.date = new Date(date);
    if (startTime) updateData.startTime = new Date(`1970-01-01T${startTime}:00Z`);
    if (endTime) updateData.endTime = new Date(`1970-01-01T${endTime}:00Z`);
    // An empty string clears the link — that's how the modal says "this meeting
    // is in person after all", and it has to reach the column as NULL.
    if (meetingUrl !== undefined) updateData.meetingUrl = meetingUrl?.trim() || null;

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

    // Open (or clear) no-show charge reviews based on this sheet. Wrapped so a
    // billing-review hiccup can never fail the teacher's attendance save — the
    // attendance itself is already committed above.
    let noShows = [];
    try {
      noShows = await processNoShowReviews(req.params.id, attendanceRecords, req.user.id);
    } catch (err) {
      console.error('[Attendance] no-show review processing failed:', err.message);
    }

    res.json({ message: 'Attendance records updated successfully.', noShowsFlagged: noShows.length });

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

    // Tell the admin queue about any newly-flagged no-show charges to review.
    if (noShows.length > 0) {
      notifyAdminsOfNoShows(req.app.get('io'), req.params.id, noShows).catch((err) =>
        console.error('[Attendance] no-show admin notification failed:', err.message)
      );
    }
  } catch (error) {
    next(error);
  }
};

// For a saved attendance sheet: any student marked ABSENT with no prior
// cancellation gets a PENDING no-show charge review (suggested 50%); any student
// now marked present/late has any still-pending no-show review removed (the
// teacher corrected a mis-mark before the admin acted on it). Students who
// cancelled are EXCUSED and already carry their own cancellation row, so they
// are never treated as no-shows here. Returns the review rows it created.
const processNoShowReviews = async (sessionId, attendanceRecords, staffId) => {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, date: true, startTime: true, class: { select: { name: true, teacherId: true } } },
  });
  if (!session) return [];

  // Notice is 0 or negative for a no-show (the class is happening / has passed).
  const start = new Date(session.date);
  const st = new Date(session.startTime);
  start.setUTCHours(st.getUTCHours(), st.getUTCMinutes(), st.getUTCSeconds());
  const hoursBeforeClass = Math.min(0, (start.getTime() - Date.now()) / 3_600_000);

  const created = [];
  for (const record of attendanceRecords) {
    const status = String(record.status || '').toUpperCase();

    if (status === 'ABSENT') {
      // Skip if this student already has any cancellation/no-show row for the
      // session — the unique(sessionId,studentId) also guarantees no duplicate.
      const existing = await prisma.sessionCancellation.findUnique({
        where: { sessionId_studentId: { sessionId, studentId: record.studentId } },
        select: { id: true },
      });
      if (existing) continue;

      const row = await prisma.sessionCancellation.create({
        data: {
          sessionId,
          studentId: record.studentId,
          cancelledById: staffId,
          reason: NO_SHOW_REASON,
          hoursBeforeClass,
          suggestedChargePercent: NO_SHOW_SUGGESTED_PERCENT,
          status: 'PENDING_REVIEW',
        },
        include: { student: { select: { id: true, fullName: true } } },
      });
      created.push({ ...row, className: session.class?.name });
    } else if (status === 'PRESENT' || status === 'LATE') {
      // Correction: drop a still-pending no-show review for a student now
      // present. Scoped to auto-created no-show rows (matched by reason) that
      // haven't been resolved, so real cancellations are never touched.
      await prisma.sessionCancellation.deleteMany({
        where: { sessionId, studentId: record.studentId, reason: NO_SHOW_REASON, status: 'PENDING_REVIEW' },
      });
    }
  }
  return created;
};

// Pushes newly-flagged no-shows into the same admin review surfaces that late
// cancellations use: the live admin_room socket event, a management push, and a
// durable notification for the admin bell.
const notifyAdminsOfNoShows = async (io, sessionId, noShows) => {
  for (const ns of noShows) {
    if (io) {
      io.to('admin_room').emit('cancellation_pending', {
        id: ns.id,
        studentName: ns.student.fullName,
        className: ns.className,
        sessionDate: ns.hoursBeforeClass,
        hoursBeforeClass: Number(ns.hoursBeforeClass),
        suggestedChargePercent: ns.suggestedChargePercent,
        reason: ns.reason,
        createdAt: ns.createdAt,
        noShow: true,
      });
    }
    await broadcastToManagement(
      'No-show needs a decision',
      `${ns.student.fullName} was a no-show for ${ns.className} (no cancellation) — decide how much to charge (suggested ${NO_SHOW_SUGGESTED_PERCENT}%).`,
      { cancellationId: ns.id }
    );
    await notifyAdmins({
      type: 'CANCELLATION',
      title: 'No-show needs a decision',
      message: `${ns.student.fullName} was a no-show for ${ns.className} (no cancellation) — decide how much to charge (suggested ${NO_SHOW_SUGGESTED_PERCENT}%).`,
      referenceType: 'sessionCancellation',
      referenceId: ns.id,
    });
  }
};

// Notifies the configured audience when a student is marked absent, respecting
// the admin's per-event ABSENCE config (on/off + audience). dedupKey is per
// session+student+recipient so re-saving the same attendance sheet (e.g. adding
// a note afterward) never re-notifies.
const notifyParentsOfAbsence = async (sessionId, studentIds) => {
  const config = await getEventConfig('ABSENCE');
  if (!config?.enabled || config.audience.length === 0) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { class: { select: { name: true } } },
  });
  if (!session) return;

  const students = await prisma.familyMember.findMany({
    where: { userId: { in: studentIds } },
    select: { userId: true, user: { select: { fullName: true } } },
  });

  // Admins are the same for every student in this batch, so resolve once.
  const adminIds = config.audience.includes('ADMINS') ? await getAdminUserIds() : [];

  for (const studentFM of students) {
    const recipients = new Set(adminIds);
    if (config.audience.includes('PARENTS')) {
      const parentIds = await getParentUserIdsForStudents([studentFM.userId]);
      parentIds.forEach((id) => recipients.add(id));
    }

    for (const userId of recipients) {
      await sendNotification({
        userId,
        type: 'ABSENCE',
        title: `${studentFM.user.fullName} was marked absent`,
        message: `${studentFM.user.fullName} was marked absent from ${session.class.name} today.`,
        referenceType: 'session',
        referenceId: sessionId,
        dedupKey: `absence-${sessionId}-${studentFM.userId}-${userId}`,
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
      include: { class: { select: { id: true, name: true, teacherId: true, enrollments: { where: { status: 'active' } } } } },
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
    const sessionCancelled = session.class.enrollments.length <= 1;
    if (sessionCancelled) {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'CANCELLED' } });
    }

    if (session.class.teacherId) {
      await sendNotification({
        userId: session.class.teacherId,
        type: 'SESSION_CANCELLED',
        title: sessionCancelled ? 'A session was cancelled' : 'A student cancelled their session',
        message: sessionCancelled
          ? `${cancellation.student.fullName} was your only student in ${session.class.name} — the session was cancelled.`
          : `${cancellation.student.fullName} cancelled their spot in ${session.class.name}. The rest of the class still meets as scheduled.`,
        referenceType: 'session',
        referenceId: session.id,
        dedupKey: `session-cancel-${cancellation.id}`,
      });
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
      // Durable copy for the admin bell (the FCM push + socket event above are ephemeral).
      await notifyAdmins({
        type: 'CANCELLATION',
        title: 'Cancellation needs a decision',
        message: `${cancellation.student.fullName} cancelled ${session.class.name} with less than 48h notice — decide how much to charge (suggested ${LATE_CANCELLATION_SUGGESTED_PERCENT}%).`,
        referenceType: 'sessionCancellation',
        referenceId: cancellation.id,
      });
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
      include: { student: { select: { id: true, fullName: true } }, session: { include: { class: { select: { name: true, teacherId: true } } } } },
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
        // Label the ledger line for what actually happened — a no-show routes
        // through this same queue but must not read as a "cancellation fee" on
        // the family's statement.
        const feeLabel = cancellation.reason === NO_SHOW_REASON ? 'No-show fee' : 'Late cancellation fee';
        await prisma.transaction.create({
          data: {
            studentId: cancellation.studentId,
            familyId: familyMember.familyId,
            amount: parseFloat(chargeAmount),
            type: 'CHARGE',
            description: `${feeLabel} — ${cancellation.session.class.name} (${cancellation.finalChargePercent ?? finalChargePercent}%)`,
          },
        });
      }
    }

    if (cancellation.session.class.teacherId) {
      await sendNotification({
        userId: cancellation.session.class.teacherId,
        type: 'CANCELLATION_RESOLVED',
        title: 'Cancellation charge decided',
        message: `${cancellation.student.fullName}'s cancellation for ${cancellation.session.class.name} was resolved at ${updated.finalChargePercent}%.`,
        referenceType: 'sessionCancellation',
        referenceId: cancellation.id,
        dedupKey: `cancel-resolve-${cancellation.id}`,
      });
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
