import prisma from '../config/database.js';
import crypto from 'crypto';
import stripe from '../config/stripe.js';
import { invalidate } from '../middleware/cache.js';
import { sendNotification } from '../jobs/notification.helper.js';
import { getAdminUserIds } from '../services/notificationConfig.service.js';
import { isOnly } from '../utils/roles.js';
import { childIdsOfParent, familyIdsOfUser, ensureFamilyCheckInCode } from '../utils/family.js';
import { getOrCreateInvoiceCheckoutUrl } from '../services/stripeCheckout.service.js';
import { buildLessonNotesPdf, lessonNotesPdfFilename } from '../services/lessonNotesPdf.service.js';

// Shape a behavior log for the student/parent portals — exposes the reason
// ("why") behind each positive note or warning, not just the count.
const mapBehaviorLog = (log) => ({
  id: log.id,
  type: log.type,
  category: log.category,
  description: log.description,
  ruleBroken: log.ruleBroken || null,
  severity: log.severity,
  createdAt: log.createdAt,
  teacherName: log.teacher?.fullName || 'Staff',
});

// Merge a student's snack-punch movements — purchases (spent) and fulfilled
// card reloads (added) — into one reverse-chronological list with a reason, so
// students/parents can see why the punch balance went up or down.
const buildPunchHistory = (purchases = [], reloads = []) => {
  const spent = purchases.map((p) => ({
    id: `spent_${p.id}`,
    kind: 'spent',
    amount: p.punchesUsed,
    reason: p.snack?.name || 'Snack',
    date: p.purchasedAt,
  }));
  const added = reloads.map((r) => ({
    id: `added_${r.id}`,
    kind: 'added',
    amount: r.punchCount,
    reason: r.price ? `Card reload — $${Number(r.price).toFixed(2)}` : 'Card reload',
    date: r.fulfilledAt || r.createdAt,
  }));
  return [...spent, ...added].sort((a, b) => new Date(b.date) - new Date(a.date));
};

// Validates a "YYYY-MM-DD" day, returning it unchanged or null. A typo should
// surface as a 400, not silently answer with today's roster.
const parseDayString = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const roundTrips =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  return roundTrips ? value : null;
};

// Today in the academy's local timezone. Deliberately not the UTC date: in
// Florida that flips over at 8pm, which would swap a teacher's evening portal
// to tomorrow's classes while they're still teaching today's.
const localDayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// GET /api/portal/teacher — Teacher dashboard (roster for one day, announcements)
// Optional ?date=YYYY-MM-DD; defaults to today. Teachers need to look ahead at
// tomorrow's roster and back at a day they still owe notes for.
export const getTeacherPortal = async (req, res, next) => {
  try {
    const { date, teacherId } = req.query;

    // A teacher only ever sees their own roster. An admin may pass ?teacherId=
    // to look at a specific teacher's day (e.g. jumping in from the calendar to
    // take attendance on their behalf); with no teacherId an admin sees their
    // own (usually empty) roster, same as before.
    let userId = req.user.id;
    if (teacherId && !isOnly(req.user, 'TEACHER')) {
      userId = teacherId;
    }

    const day = date === undefined ? localDayString() : parseDayString(String(date));
    if (!day) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'date must be a calendar date in YYYY-MM-DD format.',
      });
    }

    // session.date is a date-only column stamped at UTC midnight — that is how
    // it is written everywhere else (sessions.controller, cron.jobs). Bracketing
    // it with a *local* midnight, as this endpoint used to, shifted the whole
    // day by one for any timezone behind UTC: a class dated Aug 10 surfaced in
    // the portal on Aug 9, and today's classes never showed up at all.
    const startOfDay = new Date(`${day}T00:00:00.000Z`);
    const endOfDay = new Date(`${day}T23:59:59.999Z`);

    // Sessions this teacher runs on the requested day
    const todaySessions = await prisma.session.findMany({
      where: {
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        // A co-teacher is in the room for the lesson, so the lesson belongs on
        // their portal too — this is the screen they take attendance and write
        // session notes from, and matching only on `teacherId` left everyone
        // added as a co-teacher looking at an empty day.
        class: {
          OR: [
            { teacherId: userId },
            { coTeachers: { some: { id: userId } } },
          ],
        }
      },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'active' },
              include: {
                student: {
                  select: {
                    id: true,
                    fullName: true,
                    age: true,
                    allergies: true,
                    medicalNotes: true,
                    accommodationNotes: true,
                    seashells: true,
                  }
                }
              }
            }
          }
        },
        attendance: true,
        materials: true,
        // The family-facing preview published when an admin approved this
        // week's lesson plan, so the teacher can correct it from the same
        // screen when the class doesn't go the way the plan said.
        notes: { where: { source: 'lesson_plan_summary' }, take: 1 }
      },
      orderBy: { startTime: 'asc' }
    });

    // Get teacher's unread announcements
    const announcements = await prisma.announcement.findMany({
      where: {
        OR: [{ targetAudience: 'all' }, { targetAudience: 'teacher' }],
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
        ]
      },
      include: {
        reads: { where: { userId } }
      },
      orderBy: { publishedAt: 'desc' }
    });
    
    const unreadAnnouncements = announcements.filter(a => a.reads.length === 0);

    // When an admin is browsing another teacher's day, name whose roster this
    // is so the portal can show "Viewing: <name>" instead of looking like the
    // admin's own (usually empty) schedule.
    let viewingTeacher = null;
    if (userId !== req.user.id) {
      viewingTeacher = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true },
      });
    }

    // Format schedule
    const schedule = todaySessions.map(session => ({
      sessionId: session.id,
      classId: session.class.id,
      className: session.class.name,
      startTime: session.startTime,
      endTime: session.endTime,
      lessonPreview: session.notes?.[0]
        ? { id: session.notes[0].id, notes: session.notes[0].notes }
        : null,
      roster: session.class.enrollments.map(e => {
        const student = e.student;
        const mark = session.attendance.find(a => a.studentId === student.id);
        return {
          id: student.id,
          name: student.fullName,
          age: student.age,
          allergies: student.allergies ? true : false,
          accommodation: student.accommodationNotes ? true : false,
          noPhoto: false, // Schema doesn't currently store this, defaulting to false
          upcomingBirthday: false, // Requires DOB to be tracked in schema, using placeholder
          seashells: student.seashells,
          attendance: mark?.status || 'PENDING',
          // What the front desk saw at the door. The teacher marking the sheet
          // is often not the person who watched the child walk in, and marking
          // an absence is what opens a suggested charge against the family —
          // so the arrival the desk recorded belongs on the sheet, in front of
          // whoever is about to decide the child never came.
          //
          // Only sent once the desk has actually recorded something: a null
          // here means nobody was on the door, not that the child is missing.
          checkedAt: mark?.checkedAt || null,
          checkedOutAt: mark?.checkedOutAt || null,
          checkedOutTo: mark?.checkedOutTo || null,
        };
      })
    }));

    res.json({
      date: day,
      schedule,
      announcements: unreadAnnouncements,
      viewingTeacher
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/student — Student sees their own dashboard data
export const getStudentPortal = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get student profile with full details
    const student = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        age: true,
        allergies: true,
        medicalNotes: true,
        accommodationNotes: true,
        snackPunches: true,
        seashells: true,
        status: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Not Found', message: 'Student not found.' });
    }

    // Get enrollments & upcoming sessions
    const [enrollments, pastEnrollments] = await Promise.all([
      prisma.classEnrollment.findMany({
        where: { studentId: userId, status: 'active' },
        include: {
          class: {
            include: {
              teacher: { select: { id: true, fullName: true } },
              sessions: {
                where: { date: { gte: new Date() } },
                orderBy: { date: 'asc' },
                take: 5,
                include: {
                  notes: { where: { source: 'lesson_plan_summary' }, take: 1 },
                },
              },
            },
          },
        },
      }),
      // A class the student is no longer in — dropped, or the term ended.
      // Still worth listing: the notes archive stays reachable for a class
      // that has already wrapped, not just the ones running today.
      //
      // Only the classes they actually sat in. Unenrolling soft-deletes to
      // 'inactive' to preserve history, so a student put in the wrong class and
      // taken back out minutes later leaves a row indistinguishable from a term
      // that ended — and it showed here forever. Requiring one attendance
      // record keeps the real drops and drops the ghosts: there is no archive
      // worth reaching for a class that never met them.
      prisma.classEnrollment.findMany({
        where: {
          studentId: userId,
          status: { not: 'active' },
          class: { sessions: { some: { attendance: { some: { studentId: userId } } } } },
        },
        include: {
          class: { select: { id: true, name: true, teacher: { select: { fullName: true } } } },
        },
        orderBy: { enrolledAt: 'desc' },
      }),
    ]);

    // Get prize history (last 20)
    const prizeHistory = await prisma.prizeHistory.findMany({
      where: { studentId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Behavior history — the student can now see WHY each note/warning was
    // given, not just the count. Counts stay accurate (from a separate count),
    // while the detail list is capped to the 30 most recent for the modal.
    const [warningCount, positiveCount, behaviorLogs, snackPurchases, fulfilledReloads] = await Promise.all([
      prisma.behaviorLog.count({ where: { studentId: userId, type: { in: ['WARNING', 'SLIP'] } } }),
      prisma.behaviorLog.count({ where: { studentId: userId, type: 'POSITIVE' } }),
      prisma.behaviorLog.findMany({
        where: { studentId: userId, type: { in: ['WARNING', 'SLIP', 'POSITIVE'] } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { teacher: { select: { fullName: true } } },
      }),
      prisma.snackPurchase.findMany({
        where: { studentId: userId },
        orderBy: { purchasedAt: 'desc' },
        take: 30,
        include: { snack: { select: { name: true } } },
      }),
      prisma.snackReloadRequest.findMany({
        where: { studentId: userId, status: 'FULFILLED' },
        orderBy: { fulfilledAt: 'desc' },
        take: 30,
      }),
    ]);
    const behaviorHistory = behaviorLogs.map(mapBehaviorLog);
    const punchHistory = buildPunchHistory(snackPurchases, fulfilledReloads);

    // Get materials assigned to student (last 20)
    const materials = await prisma.material.findMany({
      where: { studentId: userId },
      orderBy: { uploadedAt: 'desc' },
      take: 20,
    });

    // Get announcements for students
    const announcements = await prisma.announcement.findMany({
      where: {
        targetAudience: { in: ['all', 'students'] },
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
      include: {
        author: { select: { fullName: true } },
      },
    });

    res.json({
      student: {
        ...student,
        // Snack cards are an on-site perk — hide the stat entirely for
        // students with no active in-person/hybrid class.
        isInPerson: enrollments.some(e => ['IN_PERSON', 'HYBRID'].includes(e.class.type)),
      },
      enrollments: enrollments.map(e => ({
        classId: e.class.id,
        className: e.class.name,
        teacherName: e.class.teacher?.fullName || 'TBD',
        upcomingSessions: e.class.sessions.map(s => ({
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          lessonPreview: s.notes?.[0]?.notes || null,
        })),
      })),
      pastEnrollments: pastEnrollments.map(e => ({
        classId: e.class.id,
        className: e.class.name,
        teacherName: e.class.teacher?.fullName || 'TBD',
      })),
      prizeHistory,
      behaviorSummary: { warnings: warningCount, positives: positiveCount },
      behaviorHistory,
      punchHistory,
      materials,
      announcements,
    });
  } catch (error) {
    next(error);
  }
};

// ── Lesson notes archive ─────────────────────────────────────────────────
// The class cards only ever carried the next few sessions, so a student could
// read the note for the day they were looking at and nothing else. These two
// endpoints hand them the whole class instead: every published summary, on
// screen and on paper.

// Shared by the JSON list and the PDF so the document can never contain a note
// the screen would have withheld.
const loadClassLessonNotes = async (studentId, classId) => {
  const enrollment = await prisma.classEnrollment.findUnique({
    where: { classId_studentId: { classId, studentId } },
    include: {
      class: {
        select: { id: true, name: true, subject: true, teacher: { select: { fullName: true } } },
      },
    },
  });

  // Enrollment is the whole authorisation check here: these notes belong to a
  // class, and a student who was never in it has no business reading them. A
  // finished enrollment still counts — last term's notes are still theirs.
  if (!enrollment) return null;

  const sessions = await prisma.session.findMany({
    where: {
      classId,
      notes: { some: { source: 'lesson_plan_summary', notes: { not: null } } },
    },
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
    include: {
      notes: {
        where: { source: 'lesson_plan_summary' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  return {
    class: {
      id: enrollment.class.id,
      name: enrollment.class.name,
      subject: enrollment.class.subject,
      teacherName: enrollment.class.teacher?.fullName || 'TBD',
    },
    notes: sessions
      .map((s) => ({
        sessionId: s.id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        notes: s.notes[0]?.notes || '',
      }))
      .filter((n) => n.notes.trim()),
  };
};

// GET /api/portal/student/classes/:classId/notes — every published lesson note
// for one of the student's classes, newest first.
export const getStudentClassNotes = async (req, res, next) => {
  try {
    const result = await loadClassLessonNotes(req.user.id, req.params.classId);
    if (!result) {
      return res.status(404).json({ error: 'Not Found', message: 'You are not enrolled in that class.' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/student/classes/:classId/notes/pdf — the same notes as a
// printable document, for revising away from the screen.
export const downloadStudentClassNotes = async (req, res, next) => {
  try {
    const result = await loadClassLessonNotes(req.user.id, req.params.classId);
    if (!result) {
      return res.status(404).json({ error: 'Not Found', message: 'You are not enrolled in that class.' });
    }

    const pdf = await buildLessonNotesPdf(result.class, { fullName: req.user.fullName }, result.notes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${lessonNotesPdfFilename(result.class)}"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/classes/:classId/notes — the same
// archive as the student sees, opened by a parent for one of their children.
// The parent's own family membership is the authorization check: a child not
// in the caller's family returns the same 404 as a class the child was never
// enrolled in, so neither leaks which is true.
export const getParentChildClassNotes = async (req, res, next) => {
  try {
    const { studentId, classId } = req.params;
    if (!(await childIdsOfParent(req.user.id)).includes(studentId)) {
      return res.status(404).json({ error: 'Not Found', message: 'That student is not in your family.' });
    }
    const result = await loadClassLessonNotes(studentId, classId);
    if (!result) {
      return res.status(404).json({ error: 'Not Found', message: 'That student is not enrolled in that class.' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/classes/:classId/notes/pdf
export const downloadParentChildClassNotes = async (req, res, next) => {
  try {
    const { studentId, classId } = req.params;
    if (!(await childIdsOfParent(req.user.id)).includes(studentId)) {
      return res.status(404).json({ error: 'Not Found', message: 'That student is not in your family.' });
    }
    const result = await loadClassLessonNotes(studentId, classId);
    if (!result) {
      return res.status(404).json({ error: 'Not Found', message: 'That student is not enrolled in that class.' });
    }

    const student = await prisma.user.findUnique({ where: { id: studentId }, select: { fullName: true } });
    const pdf = await buildLessonNotesPdf(result.class, student, result.notes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${lessonNotesPdfFilename(result.class)}"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
};

// POST /api/portal/parent/pickup — Create a temporary pickup authorization
export const createPickupAuth = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const { pickupPerson, relationship, validDate, studentId } = req.body;

    if (!pickupPerson || !validDate) {
      return res.status(400).json({ error: 'Bad Request', message: 'pickupPerson and validDate are required.' });
    }

    // An authorisation names a child, or it names none and covers the whole
    // family. What it must never do is name someone else's child: this code
    // releases a person from the building, so the parent's own family is the
    // hard boundary — checked here rather than trusted from the request.
    if (studentId && !(await childIdsOfParent(parentId)).includes(studentId)) {
      return res.status(403).json({ error: 'Forbidden', message: 'That student is not in your family.' });
    }

    // The token is what the QR carries and the only thing the desk gets back,
    // so it comes from the random source, not from a digest of the form fields
    // — those are guessable, and a guessable token releases a child.
    const qrCodeHash = crypto.randomBytes(32).toString('hex');

    const auth = await prisma.tempPickupAuth.create({
      data: {
        parentId,
        studentId: studentId || null,
        pickupPerson,
        relationship: relationship || null,
        validDate: new Date(validDate),
        qrCodeHash,
      },
      include: { student: { select: { id: true, fullName: true } } },
    });

    res.status(201).json(auth);
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/pickup — List parent's pickup authorizations
export const getPickupAuths = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const auths = await prisma.tempPickupAuth.findMany({
      where: { parentId },
      orderBy: { createdAt: 'desc' },
      include: { student: { select: { id: true, fullName: true } } },
    });
    res.json(auths);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/portal/parent/pickup/:id — Revoke a pickup auth
export const deletePickupAuth = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const { id } = req.params;
    const auth = await prisma.tempPickupAuth.findFirst({ where: { id, parentId } });
    if (!auth) return res.status(404).json({ error: 'Not Found' });
    await prisma.tempPickupAuth.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/portal/family/check-in-code
 *
 * The household's standing QR, for the parent's phone and for a student old
 * enough to carry their own. Open to both roles because both walk through the
 * same door — a teenager arriving alone should not need a parent present to be
 * checked in.
 *
 * Returns every family the caller belongs to: a child of separated parents sits
 * in two households, and each one has its own code.
 */
export const getFamilyCheckInCode = async (req, res, next) => {
  try {
    const familyIds = await familyIdsOfUser(req.user.id);
    if (familyIds.length === 0) return res.json({ families: [] });

    const families = await Promise.all(familyIds.map((id) => ensureFamilyCheckInCode(id)));

    res.json({
      families: families.filter(Boolean).map((f) => ({ id: f.id, name: f.name, code: f.checkInCode })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/portal/family/check-in-code/rotate
 *
 * Issue a new code and void the old one — for a lost phone, or a screenshot
 * that ended up somewhere it shouldn't have. Parents only: replacing the code
 * logs out every other copy of it, and that is the household's call, not a
 * child's.
 */
export const rotateFamilyCheckInCode = async (req, res, next) => {
  try {
    const { familyId } = req.body;
    const familyIds = await familyIdsOfUser(req.user.id);
    const target = familyId || familyIds[0];

    if (!target || !familyIds.includes(target)) {
      return res.status(403).json({ error: 'Forbidden', message: 'That is not your family.' });
    }

    const family = await ensureFamilyCheckInCode(target, { rotate: true });
    res.json({ id: family.id, name: family.name, code: family.checkInCode });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/portal/parent/snack-reloads/:id — Parent approves or rejects a
// paid snack-punch reload for their child. Approval only authorizes it; the
// front desk still has to top up + charge (see fulfillReloadRequest).
export const decideSnackReload = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const { decision } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'Bad Request', message: 'decision must be APPROVED or REJECTED.' });
    }

    const request = await prisma.snackReloadRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== 'PENDING') {
      return res.status(404).json({ error: 'Not Found', message: 'No pending reload request found.' });
    }

    // The request must belong to a child in one of this parent's families.
    const parentFamilies = await prisma.familyMember.findMany({
      where: { userId: parentId },
      select: { familyId: true },
    });
    const familyIds = parentFamilies.map((f) => f.familyId);
    const childLink = await prisma.familyMember.findFirst({
      where: { userId: request.studentId, familyId: { in: familyIds } },
    });
    if (!childLink) {
      return res.status(403).json({ error: 'Forbidden', message: 'This request is not for your child.' });
    }

    await prisma.snackReloadRequest.update({
      where: { id: request.id },
      data: { status: decision, decidedById: parentId, decidedAt: new Date() },
    });

    // Drop the parent's cached portal so the banner disappears immediately.
    invalidate(`portal:parent:${parentId}`);

    // Let front desk know a reload is now cleared to be topped up + charged.
    if (decision === 'APPROVED') {
      const student = await prisma.user.findUnique({
        where: { id: request.studentId },
        select: { fullName: true },
      });
      const adminIds = await getAdminUserIds();
      for (const userId of adminIds) {
        await sendNotification({
          userId,
          type: 'SNACK_PUNCHES_DEPLETED',
          title: `Reload approved — ${student?.fullName || 'a student'}`,
          message: `A parent approved reloading ${request.punchCount} snack punch(es) for $${Number(request.price).toFixed(2)}. Top up and charge from Front Desk Alerts.`,
          referenceType: 'snackReload',
          referenceId: request.id,
          dedupKey: `snack-reload-approved-${request.id}-${userId}`,
        });
      }
    }

    res.json({ success: true, status: decision });
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent — Parent sees all their children's data
export const getParentPortal = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Single query: families + all student members
    const familyMembers = await prisma.familyMember.findMany({
      where: { userId },
      include: {
        family: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    role: true,
                    age: true,
                    allergies: true,
                    medicalNotes: true,
                    snackPunches: true,
                    seashells: true,
                    avatarUrl: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Collect all student IDs up-front — no queries inside loops
    const studentMeta = []; // { user, familyName }
    for (const fm of familyMembers) {
      for (const member of fm.family.members) {
        if (member.user.role === 'STUDENT') {
          studentMeta.push({ user: member.user, familyName: fm.family.name });
        }
      }
    }

    const studentIds = studentMeta.map(s => s.user.id);

    if (studentIds.length === 0) {
      // Skip all batch queries when there are no children
      const announcements = await prisma.announcement.findMany({
        where: {
          targetAudience: { in: ['all', 'parents'] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        include: { author: { select: { fullName: true } } },
      });
      return res.json({ children: [], announcements });
    }

    // Batch all child-data queries in a single Promise.all — O(1) DB round-trips
    const [enrollments, pastEnrollments, behaviorLogs, prizeHistories, materials, announcements, pendingReloads, snackPurchases, fulfilledReloads, waivers] = await Promise.all([
      prisma.classEnrollment.findMany({
        where: { studentId: { in: studentIds }, status: 'active' },
        include: {
          class: {
            include: {
              teacher: { select: { fullName: true } },
              sessions: {
                where: { date: { gte: new Date() } },
                orderBy: { date: 'asc' },
                take: 3,
                include: {
                  // The auto-generated preview of that week's approved lesson
                  // plan — visibility is always 'all' for these, so no filter
                  // needed to keep this family-safe.
                  notes: { where: { source: 'lesson_plan_summary' }, take: 1 },
                },
              },
            },
          },
        },
      }), // class.type is used below to derive isInPerson
      // A class a child is no longer in — dropped, or the term ended. Kept
      // separate from the active list so the notes archive for it stays
      // reachable without cluttering the schedule with classes that already wrapped.
      prisma.classEnrollment.findMany({
        where: { studentId: { in: studentIds }, status: { not: 'active' } },
        include: { class: { select: { id: true, name: true, teacher: { select: { fullName: true } } } } },
        orderBy: { enrolledAt: 'desc' },
      }),
      // Full behavior logs (not just counts) so parents can see WHY each note or
      // warning was given. Volumes per family are modest; counts + the detail
      // list are both derived from this single fetch.
      prisma.behaviorLog.findMany({
        where: {
          studentId: { in: studentIds },
          type: { in: ['WARNING', 'SLIP', 'POSITIVE'] },
        },
        orderBy: { createdAt: 'desc' },
        include: { teacher: { select: { fullName: true } } },
      }),
      prisma.prizeHistory.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.material.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.announcement.findMany({
        where: {
          targetAudience: { in: ['all', 'parents'] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        include: { author: { select: { fullName: true } } },
      }),
      prisma.snackReloadRequest.findMany({
        where: { studentId: { in: studentIds }, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.snackPurchase.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { purchasedAt: 'desc' },
        include: { snack: { select: { name: true } } },
      }),
      prisma.snackReloadRequest.findMany({
        where: { studentId: { in: studentIds }, status: 'FULFILLED' },
        orderBy: { fulfilledAt: 'desc' },
      }),
      // Signed liability waivers. The signature image itself is deliberately not
      // selected — the portal only needs to know whether one exists, and it is
      // the largest column on the row.
      prisma.liabilityWaiver.findMany({
        where: { studentId: { in: studentIds } },
        select: { id: true, studentId: true, signedAt: true },
      }),
    ]);

    // Index results by studentId for O(1) lookups during assembly
    const enrollmentsByStudent = {};
    for (const e of enrollments) {
      if (!enrollmentsByStudent[e.studentId]) enrollmentsByStudent[e.studentId] = [];
      enrollmentsByStudent[e.studentId].push(e);
    }
    // Keep only the past classes the child actually sat in. Unenrolling
    // soft-deletes to 'inactive' to preserve history, so a child put in the
    // wrong class and taken back out minutes later leaves a row
    // indistinguishable from a term that ended — and it showed here forever.
    // One attendance record keeps the real drops and drops the ghosts: there is
    // no archive worth reaching for a class that never met them.
    //
    // Filtered here rather than in the query above because the check has to
    // correlate back to each row's own student — a nested `some` filter would
    // match on any sibling's attendance and resurrect the other's ghost row.
    const attendedPast = pastEnrollments.length
      ? await prisma.attendance.findMany({
          where: {
            studentId: { in: [...new Set(pastEnrollments.map(e => e.studentId))] },
            session: { classId: { in: [...new Set(pastEnrollments.map(e => e.classId))] } },
          },
          select: { studentId: true, session: { select: { classId: true } } },
        })
      : [];
    const attendedKeys = new Set(attendedPast.map(a => `${a.studentId}:${a.session.classId}`));

    const pastEnrollmentsByStudent = {};
    for (const e of pastEnrollments) {
      if (!attendedKeys.has(`${e.studentId}:${e.classId}`)) continue;
      if (!pastEnrollmentsByStudent[e.studentId]) pastEnrollmentsByStudent[e.studentId] = [];
      pastEnrollmentsByStudent[e.studentId].push(e);
    }

    // Derive both the counts (for the stat pills) and a capped detail list (for
    // the history modal) from the single behavior-log fetch.
    const behaviorByStudent = {};
    const behaviorHistoryByStudent = {};
    for (const log of behaviorLogs) {
      if (!behaviorByStudent[log.studentId]) behaviorByStudent[log.studentId] = { warnings: 0, positives: 0 };
      if (['WARNING', 'SLIP'].includes(log.type)) behaviorByStudent[log.studentId].warnings += 1;
      if (log.type === 'POSITIVE') behaviorByStudent[log.studentId].positives += 1;

      if (!behaviorHistoryByStudent[log.studentId]) behaviorHistoryByStudent[log.studentId] = [];
      if (behaviorHistoryByStudent[log.studentId].length < 30) {
        behaviorHistoryByStudent[log.studentId].push(mapBehaviorLog(log));
      }
    }

    // Group punch movements (purchases + fulfilled reloads) per student.
    const purchasesByStudent = {};
    for (const p of snackPurchases) {
      if (!purchasesByStudent[p.studentId]) purchasesByStudent[p.studentId] = [];
      purchasesByStudent[p.studentId].push(p);
    }
    const reloadsByStudent = {};
    for (const r of fulfilledReloads) {
      if (!reloadsByStudent[r.studentId]) reloadsByStudent[r.studentId] = [];
      reloadsByStudent[r.studentId].push(r);
    }

    const prizeByStudent = {};
    for (const p of prizeHistories) {
      if (!prizeByStudent[p.studentId]) prizeByStudent[p.studentId] = [];
      if (prizeByStudent[p.studentId].length < 10) prizeByStudent[p.studentId].push(p);
    }

    const materialsByStudent = {};
    for (const m of materials) {
      if (!materialsByStudent[m.studentId]) materialsByStudent[m.studentId] = [];
      if (materialsByStudent[m.studentId].length < 10) materialsByStudent[m.studentId].push(m);
    }

    // Keep only the newest pending reload request per student (there should only
    // ever be one open at a time, but be defensive).
    const reloadByStudent = {};
    for (const r of pendingReloads) {
      if (!reloadByStudent[r.studentId]) reloadByStudent[r.studentId] = r;
    }

    const waiverByStudent = {};
    for (const w of waivers) waiverByStudent[w.studentId] = w;

    // Assemble final response — pure JS, zero additional DB calls
    const children = studentMeta.map(({ user, familyName }) => {
      const studentEnrollments = enrollmentsByStudent[user.id] || [];
      return {
        ...user,
        familyName,
        // Pickup authorization and snack cards only make sense for students who
        // actually show up on-site — at least one active in-person/hybrid class.
        isInPerson: studentEnrollments.some(e => ['IN_PERSON', 'HYBRID'].includes(e.class.type)),
        enrollments: studentEnrollments.map(e => ({
          classId: e.class.id,
          className: e.class.name,
          teacherName: e.class.teacher?.fullName || 'TBD',
          upcomingSessions: e.class.sessions.map(s => ({
            id: s.id,
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            lessonPreview: s.notes?.[0]?.notes || null,
          })),
        })),
        pastEnrollments: (pastEnrollmentsByStudent[user.id] || []).map(e => ({
          classId: e.class.id,
          className: e.class.name,
          teacherName: e.class.teacher?.fullName || 'TBD',
        })),
        behaviorSummary: behaviorByStudent[user.id] || { warnings: 0, positives: 0 },
        behaviorHistory: behaviorHistoryByStudent[user.id] || [],
        punchHistory: buildPunchHistory(purchasesByStudent[user.id], reloadsByStudent[user.id]),
        prizeHistory: prizeByStudent[user.id] || [],
        materials: materialsByStudent[user.id] || [],
        pendingReload: reloadByStudent[user.id]
          ? {
              id: reloadByStudent[user.id].id,
              punchCount: reloadByStudent[user.id].punchCount,
              price: Number(reloadByStudent[user.id].price),
            }
          : null,
        waiver: waiverByStudent[user.id]
          ? { id: waiverByStudent[user.id].id, signedAt: waiverByStudent[user.id].signedAt }
          : null,
      };
    });

    res.json({ children, announcements });
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/billing — Family account, invoices & transaction history
export const getParentBilling = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const familyMember = await prisma.familyMember.findFirst({
      where: { userId },
      select: { familyId: true, family: { select: { id: true, name: true } } },
    });

    if (!familyMember) return res.json({ balance: 0, invoices: [], transactions: [] });

    const familyId = familyMember.familyId;

    const [invoices, transactions] = await Promise.all([
      prisma.invoice.findMany({
        where: { familyId },
        orderBy: { date: 'desc' },
        include: { lines: true },
      }),
      prisma.transaction.findMany({
        where: { familyId },
        orderBy: { date: 'desc' },
        take: 50,
        include: { student: { select: { fullName: true } } },
      }),
    ]);

    // Balance = charges + refunds (increase what's owed) - payments/discounts/credits (reduce it)
    const balance = transactions.reduce((acc, t) => {
      const amt = Number(t.amount);
      if (t.type === 'CHARGE' || t.type === 'REFUND') return acc + amt;
      if (t.type === 'PAYMENT' || t.type === 'DISCOUNT' || t.type === 'CREDIT') return acc - amt;
      return acc;
    }, 0);

    res.json({
      familyId,
      familyName: familyMember.family.name,
      balance: Math.round(balance * 100) / 100,
      invoices: invoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date.toISOString().split('T')[0],
        dueDate: inv.dueDate ? inv.dueDate.toISOString().split('T')[0] : null,
        dateRange: inv.dateRange || '',
        subtotal: Number(inv.subtotal),
        total: Number(inv.totalAmount),
        amountPaid: Number(inv.amountPaid),
        amountDue: Math.max(0, Number(inv.totalAmount) - Number(inv.amountPaid)),
        status: inv.status,
        stripePaymentLink: inv.stripePaymentLink || null,
        lines: inv.lines.map(l => ({
          description: l.description,
          amount: Number(l.amount),
          quantity: l.quantity,
        })),
      })),
      transactions: transactions.map(t => ({
        id: t.id,
        date: t.date.toISOString().split('T')[0],
        description: t.description || '',
        amount: Number(t.amount),
        type: t.type,
        studentName: t.student?.fullName || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/portal/parent/billing/pay/:invoiceId — Create Stripe Checkout session
export const createPaymentSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { invoiceId } = req.params;

    // Verify this invoice belongs to the parent's family
    const familyMember = await prisma.familyMember.findFirst({ where: { userId } });
    if (!familyMember) return res.status(403).json({ error: 'No family account.' });

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, familyId: familyMember.familyId },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const amountDue = Number(invoice.totalAmount) - Number(invoice.amountPaid);
    if (amountDue <= 0) return res.status(400).json({ error: 'Invoice already paid.' });

    if (!stripe) {
      return res.status(503).json({ error: 'Payment gateway not configured. Please contact the academy.' });
    }

    const url = await getOrCreateInvoiceCheckoutUrl(invoice);
    res.json({ url });
  } catch (error) {
    next(error);
  }
};
