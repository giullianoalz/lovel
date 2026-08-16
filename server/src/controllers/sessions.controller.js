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
import { loadPayCategories, freezeSessionRates, clearFrozenRates } from '../services/payroll.service.js';
import { sessionStartInstant } from '../utils/academyTime.js';
import {
  CANCELLATION_WINDOW_HOURS,
  ADVANCE_CANCELLATION_SUGGESTED_PERCENT,
  LATE_CANCELLATION_SUGGESTED_PERCENT,
} from '../constants/cancellationPolicy.js';

/**
 * The pay fields on a session, if this request is allowed to set them.
 *
 * What a session pays is chosen while scheduling it — "this Tuesday hour is
 * private tutoring, not a class" — so it rides on the ordinary session routes
 * rather than a separate screen. But those routes are open to the teacher who
 * owns the class, and a teacher must not be able to price their own hour, so
 * anyone who isn't an admin sending these fields is refused outright rather
 * than having them quietly dropped.
 *
 * Returns { data } to merge into the write, or { error } to reject with.
 */
const readPayFields = async (req) => {
  const { payCategoryKey, payRateOverride } = req.body;
  if (payCategoryKey === undefined && payRateOverride === undefined) return { data: {} };

  if (!hasRole(req.user, 'ADMIN')) {
    return { error: 'Only an admin can set what a session pays.' };
  }

  const data = {};
  if (payCategoryKey !== undefined) {
    if (payCategoryKey) {
      const categories = await loadPayCategories();
      if (!categories.some((c) => c.key === payCategoryKey)) {
        return { error: `There is no pay category "${payCategoryKey}".` };
      }
    }
    // Empty clears it, and the session falls back to the old guess — online if
    // it has a meeting link, in person otherwise.
    data.payCategoryKey = payCategoryKey || null;
  }

  if (payRateOverride !== undefined) {
    if (payRateOverride === null || payRateOverride === '') {
      data.payRateOverride = null;
    } else {
      const n = typeof payRateOverride === 'number'
        ? payRateOverride
        : parseFloat(String(payRateOverride).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: 'The rate for this session must be a number.' };
      if (n < 0) return { error: 'The rate for this session cannot be negative.' };
      if (n > 99999999.99) return { error: 'That rate is implausibly large.' };
      data.payRateOverride = Math.round(n * 100) / 100;
    }
  }

  return { data };
};

/**
 * The price this one meeting charges a family, off the request body.
 *
 * The mirror of readPayFields: that reads what the hour pays the teacher, this
 * reads what it bills the client. Admin-only for the same reason and then some
 * — it is the number a family will be asked for.
 *
 * Typing it charges nobody. It records what the meeting costs; an admin reviews
 * the pending ones and approves them into the ledger (see
 * sessionCharges.service.js), so a fat-fingered price is caught on a review
 * screen rather than on somebody's invoice.
 */
const readChargeFields = async (req) => {
  const { chargeAmount, chargeNote } = req.body;
  if (chargeAmount === undefined && chargeNote === undefined) return { data: {} };

  if (!hasRole(req.user, 'ADMIN')) {
    return { error: 'Only an admin can set what a session charges.' };
  }

  const data = {};
  if (chargeAmount !== undefined) {
    // Empty clears the price, and the meeting goes back to raising nothing.
    // Zero is kept as a real price — "this one is free" is a decision, and
    // collapsing it to null would make it indistinguishable from "not set".
    if (chargeAmount === null || chargeAmount === '') {
      data.chargeAmount = null;
    } else {
      const n = typeof chargeAmount === 'number'
        ? chargeAmount
        : parseFloat(String(chargeAmount).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: 'The price for this session must be a number.' };
      if (n < 0) return { error: 'The price for this session cannot be negative.' };
      if (n > 99999999.99) return { error: 'That price is implausibly large.' };
      data.chargeAmount = Math.round(n * 100) / 100;
    }
  }

  if (chargeNote !== undefined) {
    data.chargeNote = chargeNote?.trim()?.slice(0, 255) || null;
  }

  return { data };
};

// Every cancellation reaches the admin for a decision — none is ever charged
// automatically, however much notice was given. What the notice changes is the
// amount suggested; the window and percentages live in
// constants/cancellationPolicy.js, shared with payroll so that "the family is
// charged for this hour" and "the teacher is paid for this hour" can never
// disagree about where the 24-hour line falls.

// A student marked ABSENT with no prior cancellation is a no-show: the teacher
// held the slot and waited. No notice at all is the extreme of a late
// cancellation, so it suggests the same full charge. Like every other
// cancellation it opens a review item, never an automatic charge — the admin
// confirms the amount. The reason string is also the marker used to recognise
// (and clean up) auto-created no-show items when a mis-marked student is later
// set present.
const NO_SHOW_SUGGESTED_PERCENT = LATE_CANCELLATION_SUGGESTED_PERCENT;
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
  // Front desk sees every class on every date, same as admin — the calendar
  // is where reception finds "when is this child's next class" or "was
  // Tuesday's session moved," and that question isn't bounded to today. The
  // one thing that stays bounded to today is the *roster* (who actually
  // showed up) — getSession strips attendance for any day but today, and the
  // check-in board queries today directly rather than through this scope.
  if (hasRole(user, 'ADMIN') || isFrontDeskOnly(user)) return {};

  // Each role the account holds contributes what it may see, and the branches
  // are ORed: a teacher who is also a parent watches her own classes *and* her
  // children's, which a single-branch scope would have forced her to choose
  // between.
  const branches = [];

  if (hasRole(user, 'TEACHER')) {
    branches.push({
      class: {
        OR: [
          { teacherId: user.id },
          { coTeachers: { some: { id: user.id } } },
        ],
      },
    });
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
    select: { teacherId: true, coTeachers: { select: { id: true } } },
  });
  if (!cls) return NOT_FOUND;
  const isAssigned = cls.teacherId === user.id || cls.coTeachers.some((t) => t.id === user.id);
  return isAssigned ? null : NOT_FOUND;
};

const denyForeignSession = async (user, sessionId) => {
  if (!isOnly(user, 'TEACHER')) return null;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { class: { select: { teacherId: true, coTeachers: { select: { id: true } } } } },
  });
  if (!session) return NOT_FOUND;
  const isAssigned =
    session.class?.teacherId === user.id ||
    (session.class?.coTeachers || []).some((t) => t.id === user.id);
  return isAssigned ? null : NOT_FOUND;
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

    // The calendar's "By Students" filter needs a roster to search against, and
    // GET /classes?includeRoster=true — where it used to get one — is
    // ADMIN/TEACHER only (it also carries pricing, which is exactly why it's
    // gated). A parent or student browsing their *own* calendar doesn't need
    // classmates' names either. So the roster only rides along here for staff,
    // the same boundary getSession already draws around the attendance list.
    const isStaff = hasRole(req.user, 'ADMIN', 'TEACHER') || isFrontDeskOnly(req.user);

    const sessions = await prisma.session.findMany({
      where: scopedWhere,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: {
        class: {
          // teacherId travels with the session so the calendar can offer the
          // admin's "Take Attendance" jump without depending on the separate
          // (paginated, staff-only) /classes fetch having the class in hand.
          //
          // teacher.fullName rides along too, for the same reason: GET /classes
          // is ADMIN/TEACHER only (it also carries pricing and the full roster,
          // which front desk has no business reading), so without a name here
          // every calendar event front desk opens shows "Unassigned" — the id
          // was visible, just nothing anyone could resolve it to.
          select: {
            name: true, subject: true, type: true, meetingUrl: true, teacherId: true,
            teacher: { select: { id: true, fullName: true } },
            ...(isStaff ? {
              enrollments: {
                where: { status: 'active' },
                select: { student: { select: { id: true, fullName: true } } },
              },
            } : {}),
          },
        },
        notes: { orderBy: { createdAt: 'desc' } },
        materials: true,
        // Who marked the teacher absent, so the calendar can name them on the
        // session rather than showing an anonymous "not paid" flag.
        absentBy: { select: { fullName: true } },
        // What individual students pay instead of the meeting's price, so the
        // calendar can show the roster with each person's real number — which
        // is the whole reason pricing lives on the calendar rather than in a
        // billing screen: this is where you can see who is in the room.
        chargeOverrides: {
          select: { studentId: true, amount: true, reason: true },
        },
      },
    });

    // A one-off rate on a session is somebody's pay. Admins see it because they
    // set it, and a teacher sees it on their own class because it is their own
    // money — front desk, who can read the whole building's calendar, does not.
    //
    // An absence is redacted along the same line and for a stronger reason: it
    // is a statement about a member of staff, and a parent reading their child's
    // calendar has no business being told their tutor did not show up.
    //
    // The price the family is charged is admin-only, and not on the same line
    // as the two above: a teacher may see what their own hour pays, but what
    // the academy bills for it is not their business, and a parent must not see
    // a price that nobody has approved yet — it is a draft until it is raised.
    const isAdmin = hasRole(req.user, 'ADMIN');
    res.json({
      sessions: sessions.map((s) => {
        const visible = isAdmin ? s : { ...s, chargeAmount: null, chargeNote: null, chargeOverrides: [] };
        return isAdmin || s.class?.teacherId === req.user.id
          ? visible
          : { ...visible, payRateOverride: null, paidRate: null, absentAt: null, absentReason: null, absentBy: null };
      }),
    });
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

    const pay = await readPayFields(req);
    if (pay.error) return res.status(400).json({ error: 'Validation Error', message: pay.error });

    // What the meeting charges the family, set at the same moment as what it
    // pays the teacher. Booking somebody is the act that decides both numbers,
    // so refusing the price here would mean every priced session had to be
    // created and then immediately edited.
    const charge = await readChargeFields(req);
    if (charge.error) return res.status(400).json({ error: 'Validation Error', message: charge.error });

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
        ...pay.data,
        ...charge.data,
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

    // A term of Tuesdays is one kind of work all the way through, so the
    // category is set once here rather than on each generated session.
    const pay = await readPayFields(req);
    if (pay.error) return res.status(400).json({ error: 'Validation Error', message: pay.error });

    // The price rides along the same way — but note it lands on *every*
    // generated session, so a term of 30 Tuesdays priced at $50 is 30 separate
    // $50 charges per family, not one. That is right for a per-session price
    // and wrong for a term fee: a term fee belongs to the quarterly run.
    const charge = await readChargeFields(req);
    if (charge.error) return res.status(400).json({ error: 'Validation Error', message: charge.error });

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
          data: { classId, date, startTime: startObj, endTime: endObj, status: 'SCHEDULED', ...pay.data, ...charge.data },
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
    const pay = await readPayFields(req);
    if (pay.error) return res.status(400).json({ error: 'Validation Error', message: pay.error });

    const charge = await readChargeFields(req);
    if (charge.error) return res.status(400).json({ error: 'Validation Error', message: charge.error });

    if (!startTime && !endTime && !status && meetingUrl === undefined
        && Object.keys(pay.data).length === 0 && Object.keys(charge.data).length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'Nothing to change — pass startTime, endTime, status, meetingUrl, the pay category, or the price.' });
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

    const data = { ...pay.data, ...charge.data };
    if (startTime) data.startTime = new Date(`1970-01-01T${startTime}:00Z`);
    if (endTime) data.endTime = new Date(`1970-01-01T${endTime}:00Z`);
    if (status) data.status = status.toUpperCase();
    // Same link on every Tuesday of the term, and only on Tuesdays — the whole
    // point of the per-session field is that the other weekdays stay untouched.
    if (meetingUrl !== undefined) data.meetingUrl = meetingUrl?.trim() || null;

    const targetIds = targets.map((s) => s.id);
    await prisma.session.updateMany({
      where: { id: { in: targetIds } },
      data,
    });

    // Same rule as the single-session route: the stamp is only released when
    // the rate was touched or the hours stopped being payable, then whatever
    // is still payable and unstamped gets one.
    if (Object.keys(pay.data).length > 0 || data.status === 'CANCELLED') {
      await clearFrozenRates({ sessionIds: targetIds });
    }
    await freezeSessionRates(targetIds);

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

    const pay = await readPayFields(req);
    if (pay.error) return res.status(400).json({ error: 'Validation Error', message: pay.error });

    const charge = await readChargeFields(req);
    if (charge.error) return res.status(400).json({ error: 'Validation Error', message: charge.error });

    const updateData = { ...pay.data, ...charge.data };

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

    // An hour belongs to the contract that was in force when it happened, so
    // the rate is stamped onto the session once its hour has passed — and
    // released again if it stops being payable, or if an admin corrects the
    // rate on one already stamped. Order matters: clear first, then freeze, so
    // a correction re-stamps at the new number instead of keeping the old.
    //
    // Only cleared when the rate itself was touched or the hour stopped being
    // payable — clearing on every edit would mean fixing a typo in a Zoom link
    // silently repriced a class taught last March at today's rate.
    const repriced = pay.data.payRateOverride !== undefined || pay.data.payCategoryKey !== undefined;
    if (repriced || updateData.status === 'CANCELLED') {
      await clearFrozenRates({ sessionIds: [req.params.id] });
    }
    await freezeSessionRates([req.params.id]);

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
  const hoursBeforeClass = Math.min(0, (sessionStartInstant(session).getTime() - Date.now()) / 3_600_000);

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
 * PATCH /api/sessions/:id/notes/:noteId
 * Edit an existing note in place.
 *
 * Exists mainly for the preview auto-published from an approved lesson plan:
 * plans describe what a class WILL do, and when something changes or doesn't
 * happen, staff need to correct what families already see rather than publish
 * a second, contradicting note.
 */
export const updateSessionNote = async (req, res, next) => {
  try {
    const { id, noteId } = req.params;
    const { notes, visibility } = req.body;

    const denied = await denyForeignSession(req.user, id);
    if (denied) return res.status(404).json(denied);

    // Scoped to the session in the path so a valid note id from another class
    // can't be edited by someone who only has access to this one.
    const existing = await prisma.sessionNote.findFirst({
      where: { id: noteId, sessionId: id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json(NOT_FOUND);

    const note = await prisma.sessionNote.update({
      where: { id: noteId },
      data: {
        ...(notes !== undefined ? { notes } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
      },
    });

    res.json({ message: 'Session note updated.', note });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/:id/cancel-student
 * Admin/front-desk cancels a single student's spot in a session.
 *
 * Never charges anything by itself. It opens a review item and notifies the
 * admin, who decides the final amount — including waiving it. Notice only sets
 * what gets suggested: >=24h suggests 50%, later suggests the full session.
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

    const hoursBeforeClass = (sessionStartInstant(session).getTime() - Date.now()) / (1000 * 60 * 60);
    const inTime = hoursBeforeClass >= CANCELLATION_WINDOW_HOURS;
    const suggestedChargePercent = inTime
      ? ADVANCE_CANCELLATION_SUGGESTED_PERCENT
      : LATE_CANCELLATION_SUGGESTED_PERCENT;

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
          status: 'PENDING_REVIEW',
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
    const noticeSummary = hoursBeforeClass <= 0
      ? 'after the class had already started'
      : `with ${Math.round(hoursBeforeClass)}h notice`;
    const decisionMessage = `${cancellation.student.fullName} cancelled ${session.class.name} ${noticeSummary} — decide how much to charge (suggested ${suggestedChargePercent}%).`;
    await broadcastToManagement('Cancellation needs a decision', decisionMessage, { cancellationId: cancellation.id });
    // Durable copy for the admin bell (the FCM push + socket event above are ephemeral).
    await notifyAdmins({
      type: 'CANCELLATION',
      title: 'Cancellation needs a decision',
      message: decisionMessage,
      referenceType: 'sessionCancellation',
      referenceId: cancellation.id,
    });

    res.status(201).json({ cancellation });
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

/**
 * POST /api/sessions/absence
 * The teacher did not turn up — don't pay this hour (Admin only).
 *
 * Pay now accrues from the calendar: an hour that has passed is an hour that is
 * owed, and nobody is asked to confirm it class by class. That is right almost
 * always and wrong in exactly one case, which this handles — the teacher was
 * not there. Marking it takes the hour off payroll straight away.
 *
 * It lives on the calendar entry because the calendar is where the person who
 * knows about the absence already is, and because "which hour" is a question
 * only the calendar can answer. The class itself is untouched: it stays on the
 * timetable, its register and notes survive, and the families' view does not
 * change. This is a statement about pay, not about whether the class existed.
 *
 * Stamped with the name of whoever marked it, because it removes money from
 * somebody's payslip and that person is the least able to see it happen.
 *
 * Body: { sessionIds: string[], absent?: boolean, reason?: string }
 * `absent: false` undoes it, and the hour is paid again.
 */
export const setSessionAbsence = async (req, res, next) => {
  try {
    const { sessionIds, absent = true, reason } = req.body;

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send the sessions to mark in sessionIds.',
      });
    }

    const targets = await prisma.session.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, date: true, class: { select: { name: true, teacher: { select: { fullName: true } } } } },
    });

    if (targets.length === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'No such sessions.' });
    }

    const ids = targets.map((s) => s.id);

    await prisma.session.updateMany({
      where: { id: { in: ids } },
      data: absent
        ? {
          absentAt: new Date(),
          absentById: req.user.id,
          absentReason: reason?.trim()?.slice(0, 255) || null,
        }
        : { absentAt: null, absentById: null, absentReason: null },
    });

    // An hour nobody is paid for holds no rate; one that comes back gets the
    // rate stamped as any other elapsed hour would. Clear first, then freeze,
    // so undoing an absence prices at today's rate rather than a stale stamp.
    await clearFrozenRates({ sessionIds: ids });
    if (!absent) await freezeSessionRates(ids);

    // No audit table exists yet, so the log is the only trace of who took an
    // hour off somebody's pay. Worth a real record if this is ever questioned.
    console.log(
      `[Payroll] ${req.user.email} ${absent ? 'marked absent' : 'restored pay for'} ${ids.length} session(s): ` +
      targets.map((s) => `${s.class?.teacher?.fullName || '?'} ${s.date.toISOString().slice(0, 10)} ${s.class?.name || ''}`).join('; ')
    );

    res.json({
      message: absent
        ? `${ids.length} class${ids.length === 1 ? '' : 'es'} marked as not taught — they won't be paid.`
        : `${ids.length} class${ids.length === 1 ? '' : 'es'} back on payroll.`,
      count: ids.length,
    });
  } catch (error) {
    next(error);
  }
};
