import prisma from '../config/database.js';
import { canUseSnackPunches } from '../utils/snackEligibility.js';

/**
 * GET /api/students
 * List all students with optional filtering
 */
export const listStudents = async (req, res, next) => {
  try {
    const { status, search, familyId, page = 1, limit = 50 } = req.query;

    const where = {
      role: 'STUDENT',
    };
    if (status) where.status = status.toUpperCase();
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (familyId) {
      where.familyMembers = { some: { familyId } };
    }

    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { fullName: 'asc' },
        include: {
          familyMembers: {
            include: {
              family: true,
            },
          },
          enrollments: {
            where: { status: 'active' },
            include: {
              class: {
                select: { id: true, name: true, subject: true },
              },
            },
          },
          _count: {
            select: {
              snackPurchases: true,
              attendance: true,
              materials: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      students,
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
 * GET /api/students/:id
 * Get full student profile with all related data
 */
export const getStudent = async (req, res, next) => {
  try {
    const student = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id, role: 'STUDENT' },
      include: {
        familyMembers: {
          include: {
            family: {
              include: {
                members: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        role: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        enrollments: {
          include: {
            class: {
              include: {
                teacher: {
                  select: { id: true, fullName: true },
                },
              },
            },
          },
        },
        materials: {
          orderBy: { date: 'desc' },
          take: 20,
        },
        snackPurchases: {
          orderBy: { purchasedAt: 'desc' },
          take: 10,
          include: {
            snack: { select: { name: true, costPunches: true } },
          },
        },
        prizeHistory: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    // Teachers get academic/behavioral data only — parent contact info and family
    // billing stay out of their view so all communication routes through the app.
    if (req.user.role === 'TEACHER') {
      delete student.familyMembers;
    }

    res.json({ student });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/students/:id/health
 * Update student health info (allergies, snack authorization)
 */
export const updateStudentHealth = async (req, res, next) => {
  try {
    const { allergies, snackAuthorized } = req.body;

    const student = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(allergies !== undefined && { allergies }),
        ...(snackAuthorized !== undefined && { snackAuthorized }),
      },
    });

    res.json({ message: 'Student health info updated.', student });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/students/:id/snack-punches
 * Add or set snack punches for a student
 */
export const updateSnackPunches = async (req, res, next) => {
  try {
    const { punches, action = 'add' } = req.body;

    if (punches === undefined || isNaN(parseInt(punches))) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'punches (number) is required.',
      });
    }

    const student = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
    });

    const newPunches =
      action === 'set'
        ? parseInt(punches)
        : student.snackPunches + parseInt(punches);

    // Snack punches are for in-person students only — don't let an online-only
    // student end up with a positive balance (setting to 0 is still allowed).
    if (newPunches > 0 && !(await canUseSnackPunches(req.params.id))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Snack punches are only available to in-person students.',
      });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { snackPunches: newPunches },
    });

    res.json({
      message: `Snack punches updated. New balance: ${updated.snackPunches}`,
      student: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/students/:id/attendance-summary
 * Get attendance stats for a student (useful for notifications)
 */
export const getAttendanceSummary = async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendance = await prisma.attendance.findMany({
      where: {
        studentId: req.params.id,
        checkedAt: { gte: thirtyDaysAgo },
      },
      include: {
        session: {
          include: {
            class: { select: { name: true } },
          },
        },
      },
      orderBy: { checkedAt: 'desc' },
    });

    const summary = {
      totalSessions: attendance.length,
      present: attendance.filter((a) => a.status === 'PRESENT').length,
      absent: attendance.filter((a) => a.status === 'ABSENT').length,
      late: attendance.filter((a) => a.status === 'LATE').length,
      excused: attendance.filter((a) => a.status === 'EXCUSED').length,
      records: attendance,
    };

    res.json({ summary });
  } catch (error) {
    next(error);
  }
};
