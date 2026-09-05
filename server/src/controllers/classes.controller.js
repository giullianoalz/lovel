import prisma from '../config/database.js';
import { hasRole, isOnly } from '../utils/roles.js';
import { invalidate } from '../middleware/cache.js';
import { resolvePaging } from '../utils/helpers.js';
import { academyToday } from '../utils/academyTime.js';

const MAX_STUDENTS_CAP = 100;

// The co-teacher list as it should be stored: de-duplicated, and never
// containing the primary teacher.
//
// Both matter for money. Payroll walks `taughtClasses` and `coTaughtClasses`
// back to back, so somebody listed as both the teacher and a co-teacher of the
// same class is paid twice for every session on it; a name repeated inside the
// list is the same double count one level down. The picker can produce either
// — the primary is chosen in a separate control, and nothing stops it being
// re-picked below.
//
// Returns null when there was nothing to normalise (the key was absent), which
// the callers read as "leave the co-teachers alone".
const normalizeCoTeacherIds = (coTeacherIds, teacherId) => {
  if (!Array.isArray(coTeacherIds)) return null;
  const primary = teacherId === '' ? null : teacherId;
  return [...new Set(coTeacherIds.filter((id) => id && id !== primary))];
};

// Shared by createClass/updateClass — returns an error message string, or
// null if the input is valid. Catches typos (maxStudents=0, a stray letter)
// and a teacherId that doesn't point to an actual active-ish teacher before
// they become a class nobody can enroll into or a foreign-key crash.
const validateClassInput = async ({ maxStudents, teacherId, coTeacherIds, priceOverride }) => {
  if (maxStudents !== undefined && maxStudents !== null && maxStudents !== '') {
    const n = Number(maxStudents);
    if (!Number.isInteger(n) || n < 1 || n > MAX_STUDENTS_CAP) {
      return `maxStudents must be a whole number between 1 and ${MAX_STUDENTS_CAP}.`;
    }
  }

  // Anything that isn't a clearing value has to be a real, non-negative amount:
  // this figure is charged to a family's ledger, so a typo landing as NaN or a
  // negative would post a credit nobody authorised.
  if (priceOverride !== undefined && priceOverride !== null && priceOverride !== '') {
    const p = Number(priceOverride);
    if (!Number.isFinite(p) || p < 0) {
      return 'priceOverride must be a non-negative number, or empty to use the term rate.';
    }
  }

  if (teacherId) {
    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { role: true, secondaryRoles: true, status: true },
    });
    // Any role held counts: an admin who also teaches, or a teacher whose
    // primary hat is something else, is still someone who can run a class.
    if (!teacher || !hasRole(teacher, 'TEACHER')) {
      return 'teacherId must reference an existing teacher account.';
    }
    if (teacher.status === 'SUSPENDED') {
      return 'This teacher is suspended and cannot be assigned to a class.';
    }
  }

  // Normalised first, so a list that only *looks* wrong — the primary teacher
  // picked again below, or one name selected twice — is quietly corrected
  // instead of rejected. The counts below then compare like with like.
  const wantedCoTeacherIds = normalizeCoTeacherIds(coTeacherIds, teacherId) || [];
  if (wantedCoTeacherIds.length > 0) {
    const coTeachers = await prisma.user.findMany({
      where: { id: { in: wantedCoTeacherIds } },
      select: { id: true, role: true, secondaryRoles: true, status: true },
    });

    if (coTeachers.length !== wantedCoTeacherIds.length) {
      return 'One or more co-teachers do not exist.';
    }

    for (const t of coTeachers) {
      if (!hasRole(t, 'TEACHER')) {
        return 'All co-teachers must reference an existing teacher account.';
      }
      if (t.status === 'SUSPENDED') {
        return 'One of the co-teachers is suspended and cannot be assigned.';
      }
    }
  }

  return null;
};

/**
 * GET /api/classes
 * List all classes, optionally filtered by teacher or status
 */
export const listClasses = async (req, res, next) => {
  try {
    const { teacherId, status, search, includeRoster } = req.query;
    const { page, limit, skip, take } = resolvePaging(req.query);

    const where = {};
    // A teacher sees only their own classes — override whatever teacherId they
    // passed, so this can't be used to probe another teacher's roster. Only an
    // ADMIN is broad enough to escape the narrowing; a teacher who also covers
    // the front desk stays scoped to their own, same as on the calendar.
    if (isOnly(req.user, 'TEACHER')) {
      where.OR = [
        { teacherId: req.user.id },
        { coTeachers: { some: { id: req.user.id } } }
      ];
    } else if (teacherId) {
      // If there's an existing OR array (from search), we must combine with AND.
      // But we haven't added search yet, so it's safe to just set OR.
      where.OR = [
        { teacherId },
        { coTeachers: { some: { id: teacherId } } }
      ];
    }
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [classes, total] = await Promise.all([
      prisma.class.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: {
          teacher: {
            select: { id: true, fullName: true },
          },
          coTeachers: {
            select: { id: true, fullName: true },
          },
          _count: {
            select: { enrollments: { where: { status: 'active' } } },
          },
          // The calendar's "By Students" filter needs to know who is enrolled
          // in each class — opt-in so the default list response stays light.
          ...(includeRoster === 'true' ? {
            enrollments: {
              where: { status: 'active' },
              select: { student: { select: { id: true, fullName: true } } },
            },
          } : {}),
        },
      }),
      prisma.class.count({ where }),
    ]);

    res.json({
      classes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/classes/:id
 * Get full class details including active enrollments
 */
export const getClass = async (req, res, next) => {
  try {
    const classData = await prisma.class.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        teacher: {
          select: { id: true, fullName: true, email: true },
        },
        coTeachers: {
          select: { id: true, fullName: true, email: true },
        },
        enrollments: {
          where: { status: 'active' },
          include: {
            student: {
              select: { id: true, fullName: true, age: true, allergies: true },
            },
          },
        },
        sessions: {
          where: { date: { gte: new Date() } },
          orderBy: { date: 'asc' },
          take: 5, // Next 5 upcoming sessions
        },
      },
    });

    // Same rule as listClasses: a teacher-only account can't fetch another
    // teacher's class by guessing/enumerating IDs. 404 rather than 403 so the
    // response doesn't confirm the class exists. A co-teacher is assigned to
    // this class as much as the primary is, so the roster is theirs to open.
    const isAssigned =
      classData.teacherId === req.user.id ||
      classData.coTeachers.some((t) => t.id === req.user.id);
    if (isOnly(req.user, 'TEACHER') && !isAssigned) {
      return res.status(404).json({ error: 'Not Found', message: 'Class not found.' });
    }

    res.json({ class: classData });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/classes
 * Create a new class
 */
export const createClass = async (req, res, next) => {
  try {
    const { name, subject, teacherId, coTeacherIds, type, meetingUrl, maxStudents, termId, groupType, priceOverride } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Validation Error', message: 'Class name is required.' });
    }

    const validationError = await validateClassInput({ maxStudents, teacherId, coTeacherIds, priceOverride });
    if (validationError) {
      return res.status(400).json({ error: 'Validation Error', message: validationError });
    }

    const nextCoTeacherIds = normalizeCoTeacherIds(coTeacherIds, teacherId) || [];

    const newClass = await prisma.class.create({
      data: {
        name,
        subject,
        // '' from an unset picker would hit the foreign key as a literal empty
        // string; null is how a class starts life without a teacher.
        teacherId: teacherId || null,
        type: type || 'IN_PERSON',
        meetingUrl,
        maxStudents: maxStudents ? parseInt(maxStudents) : 10,
        // Link to a registration term when created from the Registration → Rosters
        // screen; otherwise it stays null (standalone class).
        ...(termId && { termId }),
        ...(groupType && { groupType }),
        // '' is how a cleared form field arrives; treat it as "use the term rate"
        // rather than as the number 0, which would make the class free.
        ...(priceOverride !== undefined && priceOverride !== null && priceOverride !== ''
          ? { priceOverride: Number(priceOverride) }
          : {}),
        ...(nextCoTeacherIds.length > 0
          ? { coTeachers: { connect: nextCoTeacherIds.map(id => ({ id })) } }
          : {}),
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        coTeachers: { select: { id: true, fullName: true } },
      },
    });

    invalidate('classes:*', 'registration:classes:*');
    res.status(201).json({ message: 'Class created successfully.', class: newClass });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/classes/:id
 * Update class details
 */
export const updateClass = async (req, res, next) => {
  try {
    const { name, subject, teacherId, coTeacherIds, type, meetingUrl, maxStudents, status, groupType, priceOverride } = req.body;

    const validationError = await validateClassInput({ maxStudents, teacherId, coTeacherIds, priceOverride });
    if (validationError) {
      return res.status(400).json({ error: 'Validation Error', message: validationError });
    }

    // Unlike create, an explicitly empty priceOverride is meaningful here: it is
    // how the admin takes a class back off its own price and returns it to the
    // term rate. Omitting the key entirely still leaves the value untouched.
    const clearsPrice = priceOverride === null || priceOverride === '';
    const setsPrice = priceOverride !== undefined && !clearsPrice;

    // "No teacher" arrives from the picker as an empty string, which would hit
    // the foreign key as a literal ''. Null is how a class goes unassigned.
    const nextTeacherId = teacherId === '' ? null : teacherId;

    // Who the primary teacher will be once this update lands. A caller editing
    // only the co-teachers omits `teacherId` entirely, and stripping the
    // primary out of the list needs to know who that is — so fall back to the
    // teacher the class already has rather than to undefined, which would let
    // them be stored as their own co-teacher and paid twice.
    // Read once and reuse: both the co-teacher normalisation below and the
    // handover need to know who currently holds the class.
    const existing = await prisma.class.findUnique({
      where: { id: req.params.id },
      select: { teacherId: true },
    });
    const currentTeacherId = existing?.teacherId ?? null;

    let effectivePrimaryId = nextTeacherId;
    if (teacherId === undefined && Array.isArray(coTeacherIds)) {
      effectivePrimaryId = currentTeacherId;
    }
    const nextCoTeacherIds = normalizeCoTeacherIds(coTeacherIds, effectivePrimaryId);

    // Handing a class over must not reach backwards. The teacher lives on the
    // Class, so without this every hour already taught would follow the class
    // to whoever takes it — off the outgoing teacher's payslip and onto the
    // incoming one's, for months that in some cases have already been paid.
    //
    // So the moment the class changes hands, the outgoing teacher is written
    // onto every meeting that has already happened. Only the ones not already
    // stamped: a session that names its own teacher was frozen by an earlier
    // handover, and that hour belongs to whoever taught it, not to the last
    // person to hold the class.
    //
    // Only when there is somebody to stamp — a class picked up from unassigned
    // has no past teacher to record, and leaving those null keeps them reading
    // as "nobody was assigned", which is the truth.
    const handsOver =
      teacherId !== undefined && currentTeacherId && currentTeacherId !== nextTeacherId;

    const updatedClass = await prisma.$transaction(async (tx) => {
      if (handsOver) {
        await tx.session.updateMany({
          where: {
            classId: req.params.id,
            teacherId: null,
            // Today's meetings are excluded: an hour that has not finished can
            // still be taught by the person taking over, and this runs on a
            // date column with no clock to consult. Erring towards the live
            // class costs at most one day of pay attribution, which the
            // per-session teacher can correct; erring the other way would
            // freeze a class onto someone who never taught it.
            date: { lt: academyToday() },
          },
          data: { teacherId: currentTeacherId },
        });
      }

      return tx.class.update({
        where: { id: req.params.id },
        data: {
          ...(name && { name }),
          ...(subject !== undefined && { subject }),
          ...(teacherId !== undefined && { teacherId: nextTeacherId }),
          ...(type && { type }),
          ...(meetingUrl !== undefined && { meetingUrl }),
          ...(maxStudents && { maxStudents: parseInt(maxStudents) }),
          ...(status && { status }),
          ...(groupType && { groupType }),
          ...(clearsPrice ? { priceOverride: null } : {}),
          ...(setsPrice ? { priceOverride: Number(priceOverride) } : {}),
          ...(nextCoTeacherIds
            ? { coTeachers: { set: nextCoTeacherIds.map(id => ({ id })) } }
            // Promoting an existing co-teacher to primary without touching the
            // co-teacher list would leave them on both — the same double count
            // normalizeCoTeacherIds prevents on the other path. Disconnecting is
            // a no-op when they weren't a co-teacher to begin with.
            : (nextTeacherId ? { coTeachers: { disconnect: { id: nextTeacherId } } } : {})),
        },
        include: {
          teacher: { select: { id: true, fullName: true } },
          coTeachers: { select: { id: true, fullName: true } },
        }
      });
    });

    // The handover rewrites who is paid for hours already worked, so the
    // payroll screens have to stop serving the old attribution.
    invalidate('classes:*', 'registration:classes:*');
    res.json({ message: 'Class updated successfully.', class: updatedClass });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/classes/:id
 * Delete a class. Blocked while it still has active enrollments, so an
 * admin can't accidentally drop students off their roster by deleting the
 * class out from under them.
 */
export const deleteClass = async (req, res, next) => {
  try {
    const activeCount = await prisma.classEnrollment.count({
      where: { classId: req.params.id, status: 'active' },
    });

    if (activeCount > 0) {
      return res.status(400).json({
        error: 'Class Not Empty',
        message: `This class still has ${activeCount} enrolled student${activeCount === 1 ? '' : 's'}. Remove them before deleting the class.`,
      });
    }

    await prisma.class.delete({ where: { id: req.params.id } });

    invalidate('classes:*', 'registration:classes:*');
    res.json({ message: 'Class deleted successfully.' });
  } catch (error) {
    // Foreign key violation — the class still has registration requests,
    // priority holds, or other history referencing it that isn't safe to
    // cascade away silently.
    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Class In Use',
        message: 'This class cannot be deleted because it has registration history (requests, holds, or sessions) tied to it.',
      });
    }
    next(error);
  }
};

/**
 * POST /api/classes/:id/enrollments
 * Enroll a student in a class
 */
export const enrollStudent = async (req, res, next) => {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'Validation Error', message: 'studentId is required.' });
    }

    // Check if class is full
    const classInfo = await prisma.class.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { enrollments: { where: { status: 'active' } } } } },
    });

    if (classInfo._count.enrollments >= classInfo.maxStudents) {
      return res.status(400).json({ error: 'Class Full', message: 'This class has reached its maximum capacity.' });
    }

    // Upsert enrollment (in case they were previously enrolled and inactive)
    const enrollment = await prisma.classEnrollment.upsert({
      where: {
        classId_studentId: { classId: req.params.id, studentId },
      },
      // Clearing endedAt as well: they are back on the roster, and a leaving
      // date left behind would hide them from every session after the day they
      // once left — including the ones they are now enrolled for.
      update: { status: 'active', endedAt: null },
      create: {
        classId: req.params.id,
        studentId,
        status: 'active',
      },
      include: {
        student: { select: { fullName: true } },
      },
    });

    // A self-signup account starts INACTIVE until staff settle its placement.
    // Enrolling them here is that decision, so lift the parking status the
    // same way the full registration flow does — scoped to INACTIVE so a
    // SUSPENDED student can never be revived just by re-enrolling them.
    await prisma.user.updateMany({
      where: { id: studentId, status: 'INACTIVE' },
      data: { status: 'ACTIVE' },
    });

    // Enrollments affect class counts and portal data
    invalidate('classes:*', 'registration:classes:*', 'portal:student:*', 'portal:parent:*');
    res.status(201).json({ message: 'Student enrolled successfully.', enrollment });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/classes/:id/enrollments/:studentId
 * Unenroll a student (sets status to inactive to preserve history)
 */
export const unenrollStudent = async (req, res, next) => {
  try {
    const enrollment = await prisma.classEnrollment.update({
      where: {
        classId_studentId: {
          classId: req.params.id,
          studentId: req.params.studentId,
        },
      },
      // The day they came off, not just the fact of it. `status` alone made
      // every past session re-read with today's roster — a child who left in
      // October disappeared from September's register, which they sat through.
      // Stamped as the academy's calendar day (not a raw instant): rosterOn()
      // compares this against Session.date, a UTC-midnight day stamp. A raw
      // `new Date()` taken after 8 PM local is already "tomorrow" in UTC, so a
      // student unenrolled that evening kept showing up on tomorrow's sessions.
      data: { status: 'inactive', endedAt: academyToday() },
    });

    invalidate('classes:*', 'registration:classes:*', 'portal:student:*', 'portal:parent:*');
    res.json({ message: 'Student unenrolled successfully.', enrollment });
  } catch (error) {
    next(error);
  }
};
