import prisma from '../config/database.js';
import { hasRole, isOnly, isFrontDeskOnly } from '../utils/roles.js';
import { childIdsOfParent } from '../utils/family.js';
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
 * Today, as a filter on `Session.date`.
 *
 * Sessions are stored at UTC midnight of their calendar day, so the bounds are
 * built the same way rather than from the raw clock. The *local* day is
 * deliberate: read off UTC, the academy's day would roll over at 8pm Eastern
 * and blank the front desk's board while children are still in the building.
 */
const todayRange = () => {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const start = new Date(`${day}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

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
export const sessionScope = async (user) => {
  if (hasRole(user, 'ADMIN')) return {};

  // Each role the account holds contributes what it may see, and the branches
  // are ORed: a teacher who is also a parent watches her own classes *and* her
  // children's, which a single-branch scope would have forced her to choose
  // between.
  const branches = [];

  if (hasRole(user, 'TEACHER')) {
    branches.push({ class: { teacherId: user.id } });
  }

  // Front desk gets today's board across every class — who is in the building
  // right now, in which room, with which teacher — because that is the question
  // asked at the door. It stops there: yesterday's attendance and next month's
  // timetable are not reception's to read off a lobby screen, and a teacher who
  // covers the desk keeps the narrower teacher scope above.
  if (isFrontDeskOnly(user)) {
    branches.push({ date: todayRange() });
  }

  if (hasRole(user, 'STUDENT', 'PARENT')) {
    // A student sees their own classes; a parent sees their children's. Both
    // resolve to a set of student ids, so they share one branch.
    let studentIds = hasRole(user, 'STUDENT') ? [user.id] : [];
    if (hasRole(user, 'PARENT')) {
      studentIds = [...new Set([...studentIds, ...(await childIdsOfParent(user.id))])];
    }
    branches.push({
      class: { enrollments: { some: { studentId: { in: studentIds }, status: 'active' } } },
    });
  }

  if (branches.length === 0) return { id: { in: [] } }; // no role, nothing visible
  return branches.length === 1 ? branches[0] : { OR: branches };
};

/**
 * The same "own classes only" rule as sessionScope, for the write routes.
 *
 * Reads compose a Prisma filter; the write handlers instead take a classId or a
 * session id straight off the request, so each has to check ownership itself.
 * Without this a teacher could retime, cancel, take attendance on or write notes
 * against another teacher's class by id alone — and the attendance response
 * would confirm that class's roster back to them.
 *
 * Returns null when the caller may proceed, or a ready-to-send 404 body. 404
 * rather than 403, matching getClass: the answer must not tell a teacher whether
 * someone else's session exists.
 */
const NOT_FOUND = { error: 'Not Found', message: 'Session not found.' };

const denyForeignClass = async (user, classId) => {
  if (!isOnly(user, 'TEACHER')) return null;
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { teacherId: true },
  });
  return cls && cls.teacherId === user.id ? null : NOT_FOUND;
};

const denyForeignSession = async (user, sessionId) => {
  if (!isOnly(user, 'TEACHER')) return null;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { class: { select: { teacherId: true } } },
  });
  return session && session.class?.teacherId === user.id ? null : NOT_FOUND;
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
          // teacherId travels with the session so the calendar can offer the
          // admin's "Take Attendance" jump without depending on the separate
          // (paginated, staff-only) /classes fetch having the class in hand.
          select: { name: true, subject: true, type: true, meetingUrl: true, teacherId: true },
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
    const frontDesk = isFrontDeskOnly(req.user);
    // Front desk needs the roster to check children in at the door.
    const isStaff = hasRole(req.user, 'ADMIN', 'TEACHER') || frontDesk;

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

    // A receptionist who is also a parent reaches her own children's future
    // classes through the parent branch of the scope, where she is a parent and
    // not staff. The roster rides along only for the day she works the door.
    if (frontDesk && session.attendance) {
      const { gte, lt } = todayRange();
      if (!(session.date >= gte && session.date < lt)) delete session.attendance;
    }

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

    const denied = await denyForeignClass(req.user, classId);
    if (denied) return res.status(404).json(denied);

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

    const denied = await denyForeignClass(req.user, classId);
    if (denied) return res.status(404).json(denied);

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

    const denied = await denyForeignSession(req.user, req.params.id);
    if (denied) return res.status(404).json(denied);

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

    const denied = await denyForeignSession(req.user, req.params.id);
    if (denied) return res.status(404).json(denied);

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

/**
 * GET /api/sessions/check-in-board
 *
 * Today's classes with their rosters, each child already carrying whether the
 * desk has seen them arrive or leave. One request rather than a session list
 * plus a detail fetch per class: the lobby screen is open all day on a machine
 * nobody is watching, and it re-polls.
 *
 * Cancelled sessions are dropped — nobody is coming to those, and a room the
 * desk can't check anyone into is only noise on the board.
 */
export const checkInBoard = async (req, res, next) => {
  try {
    const { gte, lt } = todayRange();

    const sessions = await prisma.session.findMany({
      where: { date: { gte, lt }, status: { not: 'CANCELLED' } },
      orderBy: [{ startTime: 'asc' }],
      include: {
        class: {
          select: {
            id: true,
            name: true,
            subject: true,
            teacher: { select: { id: true, fullName: true } },
            enrollments: {
              where: { status: 'active' },
              select: { student: { select: { id: true, fullName: true, avatarUrl: true } } },
            },
          },
        },
        attendance: {
          select: { studentId: true, status: true, checkedAt: true, checkedOutAt: true, checkedOutTo: true },
        },
      },
    });

    // The roster is driven by enrolment, not by the attendance table: a child
    // nobody has touched yet must still appear, as a name waiting to be checked
    // in. Attendance only decorates them.
    const board = sessions.map((session) => {
      const marks = new Map(session.attendance.map((a) => [a.studentId, a]));
      return {
        id: session.id,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        status: session.status,
        className: session.class?.name || null,
        subject: session.class?.subject || null,
        teacherName: session.class?.teacher?.fullName || null,
        roster: (session.class?.enrollments || [])
          .map(({ student }) => {
            const mark = marks.get(student.id);
            return {
              studentId: student.id,
              fullName: student.fullName,
              avatarUrl: student.avatarUrl,
              status: mark?.status || null,
              checkedAt: mark?.checkedAt || null,
              checkedOutAt: mark?.checkedOutAt || null,
              checkedOutTo: mark?.checkedOutTo || null,
            };
          })
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      };
    });

    res.json({ sessions: board });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/pickup/scan
 *
 * The desk scans the QR a parent generated and the children it covers are
 * checked out, stamped with the name of the person collecting them.
 *
 * The scan is the whole action — no confirm step — so everything that could
 * make it the wrong action is refused before anything is written: an unknown
 * token, one past its valid date, or a child who never arrived today. A code
 * already used is not an error; it answers with the departure it already
 * recorded, because a second scan at a busy door is a repeat, not a new pickup.
 *
 * Releasing a child to the wrong adult is the failure that matters here, so the
 * response always names who the authorisation is for and who created it, and
 * the desk is expected to read it back before handing anyone over.
 */
export const scanPickup = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Validation Error', message: 'token is required.' });
    }

    const auth = await prisma.tempPickupAuth.findUnique({
      where: { qrCodeHash: token },
      include: {
        parent: { select: { id: true, fullName: true } },
        student: { select: { id: true, fullName: true } },
      },
    });

    if (!auth) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'This QR code is not recognised. Ask the parent to generate a new one.',
      });
    }

    // validDate is a DATE column — midnight UTC of the last day it covers — so
    // the comparison is against today's midnight, not the clock. Comparing raw
    // instants would expire a code that is still valid for the rest of the day.
    const { gte: todayStart, lt: tomorrowStart } = todayRange();
    if (auth.validDate < todayStart) {
      return res.status(410).json({
        error: 'Gone',
        message: `This authorisation expired on ${auth.validDate.toISOString().slice(0, 10)}.`,
        pickupPerson: auth.pickupPerson,
      });
    }

    // No student on the authorisation means the whole family, which is what the
    // portal's "All children" option writes.
    const studentIds = auth.studentId
      ? [auth.studentId]
      : await childIdsOfParent(auth.parentId);

    if (studentIds.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'This authorisation covers no children.',
      });
    }

    const attendance = await prisma.attendance.findMany({
      where: {
        studentId: { in: studentIds },
        session: { date: { gte: todayStart, lt: tomorrowStart } },
      },
      include: { student: { select: { id: true, fullName: true } } },
    });

    if (attendance.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Nobody on this authorisation has been checked in today, so there is no one to release.',
        pickupPerson: auth.pickupPerson,
      });
    }

    const alreadyOut = attendance.filter((a) => a.checkedOutAt);
    const toRelease = attendance.filter((a) => !a.checkedOutAt);

    const checkedOutAt = new Date();
    if (toRelease.length > 0) {
      await prisma.attendance.updateMany({
        where: { id: { in: toRelease.map((a) => a.id) } },
        data: { checkedOutAt, checkedOutTo: auth.pickupPerson },
      });
    }

    res.json({
      pickupPerson: auth.pickupPerson,
      relationship: auth.relationship,
      authorisedBy: auth.parent?.fullName || null,
      validDate: auth.validDate,
      released: toRelease.map((a) => ({
        studentId: a.studentId,
        fullName: a.student.fullName,
        checkedOutAt,
      })),
      alreadyOut: alreadyOut.map((a) => ({
        studentId: a.studentId,
        fullName: a.student.fullName,
        checkedOutAt: a.checkedOutAt,
        checkedOutTo: a.checkedOutTo,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/:id/check-in
 *
 * The desk's version of attendance: one child at a time, arriving or leaving,
 * for a session happening today.
 *
 * Deliberately not a widening of `PUT /:id/attendance`. That route takes the
 * whole sheet and runs the no-show review, so a mis-tap at the door could open
 * a suggested 50% charge against a family and notify the admin queue. Here the
 * desk may only record that someone walked in (PRESENT/LATE) or walked out.
 * ABSENT and EXCUSED remain the teacher's call — they held the slot and are the
 * ones who know whether the seat stayed empty.
 */
const CHECK_IN_STATUSES = ['PRESENT', 'LATE'];

export const checkInStudent = async (req, res, next) => {
  try {
    const { studentId, action = 'IN', status = 'PRESENT' } = req.body;
    const direction = String(action).toUpperCase();
    const arriving = direction === 'IN';

    if (!studentId) {
      return res.status(400).json({ error: 'Validation Error', message: 'studentId is required.' });
    }
    if (!['IN', 'OUT'].includes(direction)) {
      return res.status(400).json({ error: 'Validation Error', message: 'action must be IN or OUT.' });
    }
    const arrivalStatus = String(status).toUpperCase();
    if (arriving && !CHECK_IN_STATUSES.includes(arrivalStatus)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'status must be PRESENT or LATE. Absences are recorded by the teacher.',
      });
    }

    // The desk works one day: the door is the only thing it reports on. Loading
    // the session first also confirms the student is actually enrolled, so a
    // stray id can't create an attendance row against someone else's class.
    const { gte, lt } = todayRange();
    const session = await prisma.session.findFirst({
      where: { id: req.params.id, date: { gte, lt } },
      select: {
        id: true,
        class: {
          select: {
            enrollments: { where: { status: 'active', studentId }, select: { id: true } },
          },
        },
      },
    });

    if (!session) return res.status(404).json(NOT_FOUND);
    if (!session.class?.enrollments?.length) {
      return res.status(404).json({ error: 'Not Found', message: 'That student is not enrolled in this class.' });
    }

    const key = { sessionId_studentId: { sessionId: session.id, studentId } };

    if (!arriving) {
      // Check-out only annotates an arrival that already happened. Without this
      // the desk could stamp a departure for a child who never came in.
      const existing = await prisma.attendance.findUnique({ where: key });
      if (!existing) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'That student has not been checked in yet.',
        });
      }
      // No name on a manual check-out: the desk pressed a button, it didn't
      // verify anyone. Clearing it matters because the row may still carry the
      // person from an earlier scanned pickup, and a stale name here would read
      // as a record of who collected the child.
      const attendance = await prisma.attendance.update({
        where: key,
        data: { checkedOutAt: new Date(), checkedOutTo: null },
      });
      return res.json({ message: 'Checked out.', attendance });
    }

    const attendance = await prisma.attendance.upsert({
      where: key,
      // Re-checking someone in clears a departure stamp: children leave for a
      // pickup and come back, and the desk shouldn't have to explain that.
      update: { status: arrivalStatus, checkedAt: new Date(), checkedOutAt: null, checkedOutTo: null },
      create: { sessionId: session.id, studentId, status: arrivalStatus },
    });

    res.json({ message: 'Checked in.', attendance });
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

    const denied = await denyForeignSession(req.user, req.params.id);
    if (denied) return res.status(404).json(denied);

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
            // Ties the ledger line to the review it came out of, so the
            // billing screen can send an admin back to that cancellation
            // instead of leaving the fee looking like a manual entry.
            sessionCancellationId: cancellation.id,
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
