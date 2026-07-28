import prisma from '../config/database.js';
import { invalidate } from '../middleware/cache.js';

const MAX_STUDENTS_CAP = 100;

// Shared by createClass/updateClass — returns an error message string, or
// null if the input is valid. Catches typos (maxStudents=0, a stray letter)
// and a teacherId that doesn't point to an actual active-ish teacher before
// they become a class nobody can enroll into or a foreign-key crash.
const validateClassInput = async ({ maxStudents, teacherId, priceOverride }) => {
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
    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { role: true, status: true } });
    if (!teacher || teacher.role !== 'TEACHER') {
      return 'teacherId must reference an existing teacher account.';
    }
    if (teacher.status === 'SUSPENDED') {
      return 'This teacher is suspended and cannot be assigned to a class.';
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
    const { teacherId, status, search, page = 1, limit = 50, includeRoster } = req.query;

    const where = {};
    if (teacherId) where.teacherId = teacherId;
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
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          teacher: {
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
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
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
    const { name, subject, teacherId, type, meetingUrl, maxStudents, termId, groupType, priceOverride } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Validation Error', message: 'Class name is required.' });
    }

    const validationError = await validateClassInput({ maxStudents, teacherId, priceOverride });
    if (validationError) {
      return res.status(400).json({ error: 'Validation Error', message: validationError });
    }

    const newClass = await prisma.class.create({
      data: {
        name,
        subject,
        teacherId,
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
      },
      include: {
        teacher: { select: { fullName: true } },
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
    const { name, subject, teacherId, type, meetingUrl, maxStudents, status, groupType, priceOverride } = req.body;

    const validationError = await validateClassInput({ maxStudents, teacherId, priceOverride });
    if (validationError) {
      return res.status(400).json({ error: 'Validation Error', message: validationError });
    }

    // Unlike create, an explicitly empty priceOverride is meaningful here: it is
    // how the admin takes a class back off its own price and returns it to the
    // term rate. Omitting the key entirely still leaves the value untouched.
    const clearsPrice = priceOverride === null || priceOverride === '';
    const setsPrice = priceOverride !== undefined && !clearsPrice;

    const updatedClass = await prisma.class.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(subject !== undefined && { subject }),
        ...(teacherId !== undefined && { teacherId }),
        ...(type && { type }),
        ...(meetingUrl !== undefined && { meetingUrl }),
        ...(maxStudents && { maxStudents: parseInt(maxStudents) }),
        ...(status && { status }),
        ...(groupType && { groupType }),
        ...(clearsPrice ? { priceOverride: null } : {}),
        ...(setsPrice ? { priceOverride: Number(priceOverride) } : {}),
      },
    });

    invalidate('classes:*', 'registration:classes:*');
    res.json({ message: 'Class updated successfully.', class: updatedClass });
  } catch (error) {
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
      update: { status: 'active' },
      create: {
        classId: req.params.id,
        studentId,
        status: 'active',
      },
      include: {
        student: { select: { fullName: true } },
      },
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
      data: { status: 'inactive' },
    });

    invalidate('classes:*', 'registration:classes:*', 'portal:student:*', 'portal:parent:*');
    res.json({ message: 'Student unenrolled successfully.', enrollment });
  } catch (error) {
    next(error);
  }
};
