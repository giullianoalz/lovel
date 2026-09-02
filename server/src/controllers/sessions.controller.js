import prisma from '../config/database.js';
import { invalidate } from '../middleware/cache.js';
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
import { raiseSessionCharges } from '../services/sessionCharges.service.js';
import { sessionStartInstant, academyToday } from '../utils/academyTime.js';
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
 * Typing it CHARGES (changed 2026-09-01 — there used to be an approval screen
 * between the two). Every enrolled family owes it the moment the session is
 * saved; `chargeCalendarSessions` below is what commits it.
 *
 * Which means a fat-fingered price lands on a real balance, so correcting it
 * has to work: re-saving with the right number re-prices the charge, clearing
 * the price zeroes it, and cancelling the meeting zeroes it. All of that is
 * `raiseSessionCharges` in sessionCharges.service.js. The one thing that cannot
 * be undone from here is a charge already pulled onto an invoice.
 */
/**
 * The substitute who covered this one meeting, if this request may name one.
 *
 * Somebody stands in for the class's teacher and that hour is theirs: their
 * name on the register, their contract pricing it, their payslip it lands on.
 * Nothing on the Class can say so — it is true of a single Wednesday, not of
 * the timetable — which is why this hung outside the system until now, settled
 * by hand at the end of the month.
 *
 * Admin-only for the same reason pricing is: it moves an hour's pay from one
 * person to another. Empty hands the hour back to the class's own teacher.
 *
 * Returns { data } to merge into the write, or { error } to reject with.
 */
const readSubstituteField = async (req) => {
  const { teacherId } = req.body;
  if (teacherId === undefined) return { data: {} };

  if (!hasRole(req.user, 'ADMIN')) {
    return { error: 'Only an admin can say who taught a session.' };
  }

  // The picker sends '' for "no substitute", which has to reach the foreign key
  // as NULL — the column's way of saying "ask the class", not as a literal ''.
  if (teacherId === null || teacherId === '') return { data: { teacherId: null } };

  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { role: true, secondaryRoles: true, status: true },
  });
  // Any role held counts, same as assigning a class: an admin who covers an
  // hour is someone who taught it, and is owed for it.
  if (!teacher || !hasRole(teacher, 'TEACHER')) {
    return { error: 'A substitute must be an existing teacher account.' };
  }
  if (teacher.status === 'SUSPENDED') {
    return { error: 'This teacher is suspended and cannot be recorded as a substitute.' };
  }

  return { data: { teacherId } };
};

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

/**
 * Bill what these meetings now cost, right after they were saved.
 *
 * Called on every path that can change what a meeting charges — its price, its
 * date, whether it happens at all. Cheap to call when nothing changed: a
 * meeting with no price produces no lines, and one already charged at the same
 * number produces no writes.
 *
 * Never fails the save. The session is the record of what was scheduled and it
 * is already written; if the ledger write fails, the daily sweep in
 * cron.jobs.js raises the same charges within the day. Refusing the edit
 * instead would leave an admin unable to fix a calendar because billing is
 * having a bad afternoon.
 */
const chargeCalendarSessions = async (sessionIds, actorEmail) => {
  if (!sessionIds || sessionIds.length === 0) return;
  try {
    const result = await raiseSessionCharges({ sessionIds });
    if (result.created || result.corrected || result.zeroed) {
      console.log(
        `[Billing] ${actorEmail} priced ${sessionIds.length} session(s): `
        + `${result.created} charge(s) raised ($${result.total.toFixed(2)}), `
        + `${result.corrected} corrected, ${result.zeroed} zeroed`
        // Priced but deliberately not raised — almost always a student who
        // enrolled after the meeting. Released, if ever, by POST
        // /api/billing/session-charges with includeJoinedLate.
        + (result.held.length > 0 ? `, ${result.held.length} held back` : '')
        // Already invoiced, so the new price did not reach it.
        + (result.locked.length > 0 ? `, ${result.locked.length} already invoiced and left alone` : '')
      );
    }
  } catch (error) {
    console.error('[Billing] Could not charge saved session(s); the daily sweep will retry.', error);
  }
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
      OR: [
        // The hours they taught on a class that has since changed hands. Their
        // own work, and without this branch it disappears from their calendar
        // the day somebody else takes the class over — along with the record of
        // what it paid them.
        { teacherId: user.id },
        { class: { teacherId: user.id } },
        { class: { coTeachers: { some: { id: user.id } } } },
      ],
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everyone teaching a class, lead and co-teachers together.
 *
 * A co-teacher is not a spectator: they run the same hour, are paid for it
 * (payroll.service.js counts co-taught classes) and are held to the same
 * register. Anything addressed to "the teacher of this class" — a notification,
 * a redaction check — has to mean all of them, or the co-teacher is the last to
 * hear about a room they are standing in.
 *
 * Takes a class selected with `teacherId` and `coTeachers: { select: { id } }`;
 * a class with neither yields an empty list rather than throwing.
 */
export const teachersAssignedTo = (cls) => [
  ...new Set([cls?.teacherId, ...(cls?.coTeachers || []).map((t) => t.id)].filter(Boolean)),
];

/**
 * Who this particular hour belongs to.
 *
 * The same list as `teachersAssignedTo`, except that a session which names its
 * own teacher — because the class has changed hands since it ran — answers with
 * that person in the lead's place. It is their hour: their pay is on it, and
 * theirs is the name the calendar should show against it.
 *
 * Co-teachers come from the class either way. The stamp records who stood at
 * the front, not everybody who was in the room.
 */
/**
 * Who was on the roster on a given day.
 *
 * The class's enrolments are a live list, so reading it straight showed every
 * past session with today's names: a child enrolled this morning appeared in
 * three weeks of classes they never sat in, and one who left vanished from the
 * ones they did. Each enrolment is really an interval — `enrolledAt` to
 * `endedAt` — and this asks which of them covered the day in question.
 *
 * Both bounds are generous on purpose, because both can be missing:
 *
 *   - `endedAt` is null for everyone still enrolled, and also for everyone
 *     unenrolled before the column existed. Those old rows are treated as
 *     "left at some unknown point": shown on sessions already run, hidden from
 *     today onwards. Hiding them everywhere would erase a child from meetings
 *     they demonstrably attended; showing them everywhere would put a child who
 *     left months ago back on tomorrow's register.
 *   - `enrolledAt` is the row's creation, which for an imported roster is the
 *     day of the import, not the day the child joined. So it only hides a
 *     session that predates the enrolment by a clear day — a class cannot have
 *     been attended before anyone signed up for it, but a same-day import
 *     should not empty out that morning's register.
 *
 * `date` is a Postgres DATE stamped at UTC midnight; the timestamps are real
 * instants. Comparing them directly is right to within the hours either side of
 * midnight, which no session spans.
 */
export const rosterOn = (enrollments, date, now = new Date()) => {
  const day = new Date(date).getTime();
  const past = day < academyToday(now).getTime();
  return (enrollments || []).filter((e) => {
    const started = e.enrolledAt ? new Date(e.enrolledAt).getTime() : null;
    if (started !== null && started - day >= DAY_MS) return false;
    if (e.endedAt) return new Date(e.endedAt).getTime() >= day;
    return e.status === 'active' || past;
  });
};

export const teachersOnSession = (session) => [
  ...new Set(
    [
      session?.teacherId ?? session?.class?.teacherId,
      ...(session?.class?.coTeachers || []).map((t) => t.id),
    ].filter(Boolean)
  ),
];

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
    // A co-teacher stands in the same room as the lead and is paid for the same
    // hour, so "show me this teacher's calendar" has to find the classes they
    // co-teach as well. Matching the lead alone made a co-taught class vanish
    // from its own teacher's timetable, which reads as having been dropped from
    // the class rather than as a filter that missed it.
    //
    // A session that names its own teacher answers for itself: it belongs to
    // whoever taught it, not to whoever holds the class today. Without the
    // first two clauses, handing a class over would move its whole history onto
    // the new teacher's calendar and strip it from the old one's.
    if (teacherId) {
      where.OR = [
        { teacherId },
        { teacherId: null, class: { teacherId } },
        { class: { coTeachers: { some: { id: teacherId } } } },
      ];
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
            // Capacity, so the calendar's "hide full classes" filter can ask
            // whether a class is actually full instead of guessing at a number.
            // Not gated behind isStaff: how many seats a class holds is benign
            // — it carries no pricing and names nobody.
            maxStudents: true,
            teacher: { select: { id: true, fullName: true } },
            // The co-teachers ride along for the same reason the lead's name
            // does: the calendar names everyone standing in the room off this
            // payload, and front desk (who can't read GET /classes) saw a
            // co-taught class credited to the lead alone. It is also what the
            // redaction below matches on — a co-teacher is on this class.
            coTeachers: { select: { id: true, fullName: true } },
            ...(isStaff ? {
              // Every enrolment, not only the live ones, plus the dates that
              // bound it: which of them counts depends on the session's date,
              // and a nested `where` here cannot see it. Narrowed per session
              // by `rosterOn` below.
              enrollments: {
                select: {
                  status: true, enrolledAt: true, endedAt: true,
                  student: { select: { id: true, fullName: true } },
                },
              },
            } : {}),
          },
        },
        // Set only on an hour taught before its class changed hands. Overlaid
        // onto `class.teacher` below so the calendar names whoever was actually
        // at the front, without every reader having to know the rule.
        teacher: { select: { id: true, fullName: true } },
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
    // "Their own class" means assigned to it, lead or co: payroll pays both for
    // the hour (payroll.service.js), so both have the same claim on seeing what
    // it pays and on being told the hour was struck off as an absence.
    const teachesIt = (s) => teachersOnSession(s).includes(req.user.id);
    res.json({
      sessions: sessions.map((s) => {
        // Both halves of "don't rewrite what already happened", resolved once
        // here so every reader — calendar, payroll screens, the attendance
        // jump — gets the same answer without repeating the rule.
        const presented = {
          ...s,
          teacher: undefined,
          class: s.class && {
            ...s.class,
            // The effective teacher takes the class teacher's place, so every
            // reader that already asks the class for a name gets the right one
            // without knowing the rule. `ownTeacher` keeps the class's own
            // answer alongside it, for the one screen that has to show both:
            // the substitute picker, which needs to say whose hour this
            // normally is.
            ...(s.teacher
              ? { teacherId: s.teacher.id, teacher: s.teacher, ownTeacher: s.class.teacher }
              : { ownTeacher: s.class.teacher }),
            ...(s.class.enrollments
              ? { enrollments: rosterOn(s.class.enrollments, s.date) }
              : {}),
          },
        };
        const visible = isAdmin
          ? presented
          : { ...presented, chargeAmount: null, chargeNote: null, chargeOverrides: [] };
        return isAdmin || teachesIt(s)
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
          include: {
            teacher: { select: { id: true, fullName: true } },
            // Every enrolment, not only the live ones — narrowed to this
            // session's date by rosterOn() below. Without this the roster
            // panel had to fall back to GET /classes, which has no idea what
            // date it is being asked about and hands back today's list
            // whatever session is open: a class reassigned or re-rostered
            // since would show the modal a roster that never sat through it.
            ...(isStaff ? {
              enrollments: {
                select: {
                  status: true, enrolledAt: true, endedAt: true,
                  student: { select: { id: true, fullName: true, age: true, allergies: true } },
                },
              },
            } : {}),
          },
        },
        // Names whoever taught this hour, when its class has changed hands
        // since. Overlaid onto class.teacher below.
        teacher: { select: { id: true, fullName: true } },
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

    if (session.teacher) {
      session.class = { ...session.class, teacherId: session.teacher.id, teacher: session.teacher };
    }
    delete session.teacher;

    if (session.class?.enrollments) {
      session.class = { ...session.class, enrollments: rosterOn(session.class.enrollments, session.date) };
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

    // A price typed here is charged here.
    await chargeCalendarSessions([session.id], req.user.email);

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
    const { chargeAllSessions } = req.body;
    const createdSessions = await prisma.$transaction(
      newDates.map((date, index) =>
        prisma.session.create({
          data: { classId, date, startTime: startObj, endTime: endObj, status: 'SCHEDULED', ...pay.data, ...(index === 0 || chargeAllSessions ? charge.data : {}) },
        })
      )
    );

    // Only the sessions that actually carry the price are worth looking at —
    // with `chargeAllSessions` off that is the first one, which is the habit
    // the whole calendar-charging model is built around.
    await chargeCalendarSessions(
      createdSessions.filter((s) => s.chargeAmount != null).map((s) => s.id),
      req.user.email
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

    // Retiming a series moves the dates its charges carry, cancelling it zeroes
    // them, and re-pricing it re-prices them — all three are the same call.
    await chargeCalendarSessions(targetIds, req.user.email);

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

    const substitute = await readSubstituteField(req);
    if (substitute.error) return res.status(400).json({ error: 'Validation Error', message: substitute.error });

    const updateData = { ...pay.data, ...charge.data, ...substitute.data };

    if (status) updateData.status = status.toUpperCase();
    if (date) updateData.date = new Date(date);
    if (startTime) updateData.startTime = new Date(`1970-01-01T${startTime}:00Z`);
    if (endTime) updateData.endTime = new Date(`1970-01-01T${endTime}:00Z`);
    // An empty string clears the link — that's how the modal says "this meeting
    // is in person after all", and it has to reach the column as NULL.
    if (meetingUrl !== undefined) updateData.meetingUrl = meetingUrl?.trim() || null;

    // Who the hour was down to before this edit, so the reprice below can tell
    // a real change of teacher from the picker being re-confirmed.
    const before = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { teacherId: true },
    });

    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: updateData,
      include: { teacher: { select: { id: true, fullName: true } } },
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
    //
    // Naming a substitute reprices for the same reason, and it is the sharper
    // case: the stamped number was resolved from the class teacher's contract,
    // so leaving it would pay the cover a rate that was never theirs — the very
    // bug lineItem() guards co-teachers against, arriving through the front
    // door. Cleared, it re-freezes from whoever actually taught the hour.
    // Compared rather than assumed, so re-picking the same name is not an edit.
    const substituted =
      substitute.data.teacherId !== undefined && substitute.data.teacherId !== before?.teacherId;
    const repriced = pay.data.payRateOverride !== undefined || pay.data.payCategoryKey !== undefined;
    if (repriced || substituted || updateData.status === 'CANCELLED') {
      await clearFrozenRates({ sessionIds: [req.params.id] });
    }
    await freezeSessionRates([req.params.id]);

    // And the same for what the family owes: a new price is charged, a cleared
    // one is zeroed, a cancellation takes the charge with it.
    await chargeCalendarSessions([req.params.id], req.user.email);

    res.json({ message: 'Session updated.', session });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/sessions/:id/attendance
 * Batch update attendance for a session
 */
/**
 * How an attendance event was recorded. See AttendanceEvent.source.
 *
 * SHEET is not on this list on purpose: it is written only by the attendance
 * sheet below, never accepted from a request body, so the door can never claim
 * to be the classroom.
 */
const DESK_SOURCES = ['MANUAL', 'FAMILY_QR', 'PICKUP_QR'];

/**
 * Append to the attendance log — the door's arrivals and departures, and the
 * teacher's marks on the sheet.
 *
 * Deliberately never blocks the caller: a failed log is worth a line in the
 * server output, not a parent left standing at the counter while the desk
 * retries, nor a teacher's sheet refusing to save. Fired without awaiting for
 * the same reason.
 */
const logAttendanceEvents = (rows) => {
  if (rows.length === 0) return;
  prisma.attendanceEvent
    .createMany({ data: rows })
    .catch((err) => console.error('[Attendance log] could not record event:', err.message));
};

export const updateAttendance = async (req, res, next) => {
  try {
    const { attendanceRecords } = req.body; // Array of { studentId, status }

    if (!Array.isArray(attendanceRecords)) {
      return res.status(400).json({ error: 'Validation Error', message: 'attendanceRecords must be an array.' });
    }

    const denied = await denyForeignSession(req.user, req.params.id);
    if (denied) return res.status(404).json(denied);

    // What the sheet is about to overwrite. Read before the write for two
    // reasons: only actual changes are worth logging (this sheet is saved
    // several times a class), and an arrival already recorded at the door must
    // survive the save — see the update below.
    const before = new Map(
      (await prisma.attendance.findMany({
        where: { sessionId: req.params.id, studentId: { in: attendanceRecords.map((r) => r.studentId) } },
        select: { studentId: true, status: true, checkedAt: true },
      })).map((a) => [a.studentId, a])
    );

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
            // checkedAt is deliberately left alone. It used to be stamped with
            // the save time, which rewrote history: the desk logged a child in
            // at 1:02, the teacher saved the sheet at 1:40, and the arrival
            // became 1:40. The column means "when this child arrived", and the
            // sheet is not evidence of that — it is filled in from memory,
            // often after the fact. On a create it falls to the schema default,
            // which is the closest thing to an arrival time anyone has when
            // nobody was on the door.
            status: record.status.toUpperCase(),
          },
          create: {
            sessionId: req.params.id,
            studentId: record.studentId,
            status: record.status.toUpperCase(),
          },
        })
      )
    );

    // The sheet's marks, as marks — never as IN/OUT. The teacher recording
    // PRESENT at 1:40 did not witness an arrival at 1:40, and writing one would
    // put a fiction in the record next to the door's real stamps. Only changed
    // statuses are logged, so re-saving an unchanged sheet adds nothing.
    logAttendanceEvents(
      attendanceRecords
        .filter((r) => before.get(r.studentId)?.status !== r.status.toUpperCase())
        .map((r) => ({
          sessionId: req.params.id,
          studentId: r.studentId,
          direction: 'MARK',
          status: r.status.toUpperCase(),
          source: 'SHEET',
          byUserId: req.user.id,
        }))
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
 * GET /api/sessions/attendance-log
 *
 * The record read back: every arrival and departure at the door, and every
 * mark made on a teacher's attendance sheet, newest first, each naming who
 * recorded it and how.
 *
 * Defaults to today because that is the shift being worked. `date` reads one
 * past day and `studentId` narrows to one child, which between them cover the
 * questions actually asked of this log — "what happened at the door on
 * Tuesday", and "when has this child been signed out or marked, and by whom".
 */
export const attendanceLog = async (req, res, next) => {
  try {
    const { date, studentId } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

    const where = {};

    // Without a student the window is a single day: unbounded, this is a table
    // that only grows, and the desk screen would drag the whole term over the
    // wire. Asking about one child is the case where the history is the point,
    // so that one is capped by `limit` instead.
    if (date || !studentId) {
      const day = date ? new Date(`${date}T00:00:00`) : new Date();
      if (Number.isNaN(day.getTime())) {
        return res.status(400).json({ error: 'Validation Error', message: 'date must be YYYY-MM-DD.' });
      }
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      where.at = { gte: day, lt: next };
    }
    if (studentId) where.studentId = studentId;

    const events = await prisma.attendanceEvent.findMany({
      where,
      orderBy: { at: 'desc' },
      take: limit,
      select: {
        id: true,
        direction: true,
        status: true,
        source: true,
        releasedTo: true,
        at: true,
        student: { select: { id: true, fullName: true } },
        by: { select: { id: true, fullName: true } },
        session: { select: { id: true, class: { select: { name: true } } } },
      },
    });

    res.json({
      events: events.map((e) => ({
        id: e.id,
        direction: e.direction,
        status: e.status,
        source: e.source,
        releasedTo: e.releasedTo,
        at: e.at,
        studentId: e.student?.id || null,
        studentName: e.student?.fullName || null,
        // Null once the staff member's account is gone — the event survives
        // them on purpose, so this reads as "we no longer know who".
        byName: e.by?.fullName || null,
        className: e.session?.class?.name || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/front-desk/scan
 *
 * Read the household's standing QR and answer with who it covers and where each
 * child stands today — arrived, still to come, already gone home.
 *
 * Writes nothing on purpose, which is the difference between this and the
 * pickup scan. That code names one person and one date, so acting on it is
 * safe; a family code is permanent and covers every sibling, and a parent
 * dropping off one child would otherwise mark the other one present from home.
 * The desk taps the child in front of them and the ordinary check-in route does
 * the writing.
 */
export const scanFamilyCode = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Validation Error', message: 'code is required.' });
    }

    const family = await prisma.family.findUnique({
      where: { checkInCode: String(code) },
      select: {
        id: true,
        name: true,
        members: {
          where: { user: { role: 'STUDENT' } },
          select: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
        },
      },
    });

    if (!family) {
      // Give a helpful error if they pointed the check-in scanner at a pickup QR
      const isPickup = await prisma.tempPickupAuth.findUnique({
        where: { qrCodeHash: String(code) },
        select: { id: true },
      });
      if (isPickup) {
        return res.status(400).json({
          error: 'Wrong Scanner',
          message: 'This is a pickup authorisation code. Please close this and use "Scan pickup code" instead.',
        });
      }

      return res.status(404).json({
        error: 'Not Found',
        message: 'This code is not recognised. It may have been replaced — ask the family to reopen their portal.',
      });
    }

    const studentIds = family.members.map((m) => m.user.id);
    if (studentIds.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `${family.name} has no students on record.`,
      });
    }

    const { gte, lt } = todayRange();
    const sessions = await prisma.session.findMany({
      where: {
        date: { gte, lt },
        status: { not: 'CANCELLED' },
        class: { enrollments: { some: { status: 'active', studentId: { in: studentIds } } } },
      },
      orderBy: [{ startTime: 'asc' }],
      select: {
        id: true,
        startTime: true,
        endTime: true,
        class: {
          select: {
            name: true,
            teacher: { select: { fullName: true } },
            enrollments: {
              where: { status: 'active', studentId: { in: studentIds } },
              select: { studentId: true },
            },
          },
        },
        attendance: {
          where: { studentId: { in: studentIds } },
          select: { studentId: true, status: true, checkedAt: true, checkedOutAt: true, checkedOutTo: true },
        },
      },
    });

    // One row per child per class today: a sibling in two blocks is checked in
    // to each on its own, and the desk has to be able to tell them apart.
    const byStudent = new Map(
      family.members.map((m) => [m.user.id, { ...m.user, sessions: [] }])
    );

    for (const session of sessions) {
      const marks = new Map(session.attendance.map((a) => [a.studentId, a]));
      for (const { studentId } of session.class?.enrollments || []) {
        const mark = marks.get(studentId);
        byStudent.get(studentId)?.sessions.push({
          sessionId: session.id,
          className: session.class?.name || 'Class',
          teacherName: session.class?.teacher?.fullName || null,
          startTime: session.startTime,
          endTime: session.endTime,
          status: mark?.status || null,
          checkedAt: mark?.checkedAt || null,
          checkedOutAt: mark?.checkedOutAt || null,
          checkedOutTo: mark?.checkedOutTo || null,
        });
      }
    }

    res.json({
      familyId: family.id,
      familyName: family.name,
      students: [...byStudent.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    });
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
      // Give a helpful error if they pointed the pickup scanner at a check-in QR
      const isFamily = await prisma.family.findUnique({
        where: { checkInCode: String(token) },
        select: { id: true },
      });
      if (isFamily) {
        return res.status(400).json({
          error: 'Wrong Scanner',
          message: 'This is a family check-in code. Please close this and use "Scan family code" instead.',
        });
      }

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
      // The releases this scan performed, each naming the adult it was performed
      // for. This is the row that answers "who took this child home".
      logAttendanceEvents(toRelease.map((a) => ({
        sessionId: a.sessionId,
        studentId: a.studentId,
        direction: 'OUT',
        source: 'PICKUP_QR',
        byUserId: req.user.id,
        releasedTo: auth.pickupPerson,
        at: checkedOutAt,
      })));
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
    const { studentId, action = 'IN', status = 'PRESENT', source = 'MANUAL' } = req.body;
    const direction = String(action).toUpperCase();
    const arriving = direction === 'IN';
    // Whitelisted rather than trusted: this ends up in the record as the answer
    // to "did the family show their code, or did we just tap the name?".
    const doorSource = DESK_SOURCES.includes(String(source).toUpperCase())
      ? String(source).toUpperCase()
      : 'MANUAL';

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
      logAttendanceEvents([{
        sessionId: session.id,
        studentId,
        direction: 'OUT',
        source: doorSource,
        byUserId: req.user.id,
      }]);
      return res.json({ message: 'Checked out.', attendance });
    }

    const attendance = await prisma.attendance.upsert({
      where: key,
      // Re-checking someone in clears a departure stamp: children leave for a
      // pickup and come back, and the desk shouldn't have to explain that. The
      // trip out is not lost — the door log below keeps both legs of it.
      update: { status: arrivalStatus, checkedAt: new Date(), checkedOutAt: null, checkedOutTo: null },
      create: { sessionId: session.id, studentId, status: arrivalStatus },
    });

    logAttendanceEvents([{
      sessionId: session.id,
      studentId,
      direction: 'IN',
      status: arrivalStatus,
      source: doorSource,
      byUserId: req.user.id,
    }]);

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
    // Same rule as the calendar's filter: a teacher's work includes the classes
    // they co-teach, and supervising them by lead assignment alone hid half of
    // what a co-teacher actually ran.
    const taughtBy = (id) => ({ OR: [{ teacherId: id }, { coTeachers: { some: { id } } }] });
    if (teacherId) where.class = taughtBy(teacherId);
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
      where: teacherId ? taughtBy(teacherId) : undefined,
      orderBy: { name: 'asc' },
      include: {
        teacher: { select: { id: true, fullName: true } },
        coTeachers: { select: { id: true, fullName: true } },
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

/**
 * POST /api/sessions/:id/notes
 * Publish (or re-publish) the teacher's note for a session.
 *
 * Writes over the teacher's existing note for this session rather than adding a
 * second one. A session shows exactly one teacher note everywhere it is read —
 * the portal card, the family notes archive, the history list all take the
 * first — so appending meant a teacher who came back to make their note fuller
 * saw the original text stubbornly stay put, and saved again, and again. There
 * are sessions in the data carrying five identical copies from exactly that.
 */
export const addSessionNote = async (req, res, next) => {
  try {
    const { notes, visibility = 'all', recordingUrl, files = [] } = req.body;

    const denied = await denyForeignSession(req.user, req.params.id);
    if (denied) return res.status(404).json(denied);

    // Only ever the teacher's own note. The lesson-plan preview is a separate
    // row with its own source, and re-approving a plan owns that one.
    const existingNote = await prisma.sessionNote.findFirst({
      where: { sessionId: req.params.id, source: 'teacher' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    // Run in a transaction so we don't save notes if materials fail
    const result = await prisma.$transaction(async (tx) => {
      const note = existingNote
        ? await tx.sessionNote.update({
            where: { id: existingNote.id },
            data: {
              notes,
              visibility,
              // An edit that doesn't re-send the recording link must not wipe
              // the one already attached.
              ...(recordingUrl !== undefined ? { recordingUrl: recordingUrl || null } : {}),
            },
          })
        : await tx.sessionNote.create({
            data: {
              sessionId: req.params.id,
              notes,
              visibility,
              recordingUrl: recordingUrl || null,
            },
          });

      if (files && files.length > 0) {
        await tx.sessionMaterial.createMany({
          data: files.map(f => ({
            sessionId: req.params.id,
            name: f.name || 'Material',
            fileUrl: f.url || f.fileUrl,
            fileType: f.type || f.fileType || 'file',
          })),
        });
      }

      return note;
    });

    // The portal responses that carry this note are cached for 30-60 s. Without
    // this, a teacher who saves and refreshes is handed the pre-edit copy back
    // and concludes the save didn't take.
    invalidate('portal:*');

    res.status(201).json({ message: 'Session note added.', note: result });
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

    invalidate('portal:*');

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
      include: { class: { select: { id: true, name: true, teacherId: true, coTeachers: { select: { id: true } }, enrollments: { where: { status: 'active' } } } } },
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

    // Everyone assigned to the class hears it, lead and co alike: the person
    // who needs to know a student isn't coming is whoever is standing in the
    // room that day, and that is as often the co-teacher as the lead.
    for (const teacherId of teachersAssignedTo(session.class)) {
      await sendNotification({
        userId: teacherId,
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
      include: { student: { select: { id: true, fullName: true } }, session: { include: { class: { select: { name: true, teacherId: true, coTeachers: { select: { id: true } } } } } } },
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

    for (const teacherId of teachersAssignedTo(cancellation.session.class)) {
      await sendNotification({
        userId: teacherId,
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
