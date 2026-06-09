import prisma from '../config/database.js';
import { invalidate } from '../middleware/cache.js';

/**
 * GET /api/classes
 * List all classes, optionally filtered by teacher or status
 */
export const listClasses = async (req, res, next) => {
  try {
    const { teacherId, status, search, page = 1, limit = 50 } = req.query;

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
    const { name, subject, teacherId, type, meetingUrl, maxStudents } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Validation Error', message: 'Class name is required.' });
    }

    const newClass = await prisma.class.create({
      data: {
        name,
        subject,
        teacherId,
        type: type || 'IN_PERSON',
        meetingUrl,
        maxStudents: maxStudents ? parseInt(maxStudents) : 10,
      },
      include: {
        teacher: { select: { fullName: true } },
      },
    });

    invalidate('classes:*', 'registration:classes');
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
    const { name, subject, teacherId, type, meetingUrl, maxStudents, status } = req.body;

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
      },
    });

    invalidate('classes:*', 'registration:classes');
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
    invalidate('classes:*', 'registration:classes', 'portal:student:*', 'portal:parent:*');
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

    invalidate('classes:*', 'registration:classes', 'portal:student:*', 'portal:parent:*');
    res.json({ message: 'Student unenrolled successfully.', enrollment });
  } catch (error) {
    next(error);
  }
};
