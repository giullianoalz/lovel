import prisma from '../config/database.js';

/**
 * GET /api/users
 * List all users with optional filtering
 */
export const listUsers = async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 50 } = req.query;

    const where = {};
    if (role) where.role = role.toUpperCase();
    if (status) where.status = status.toUpperCase();
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { fullName: 'asc' },
        include: {
          familyMembers: { include: { family: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
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
 * GET /api/users/:id
 * Get a single user by ID
 */
export const getUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        familyMembers: { include: { family: true } },
        enrollments: { include: { class: true } },
      },
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/users/:id
 * Update a user's profile
 */
export const updateUser = async (req, res, next) => {
  try {
    const { fullName, phone, avatarUrl, age, allergies, quietHoursStart, quietHoursEnd, autoResponderMessage } = req.body;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(fullName && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(age !== undefined && { age: parseInt(age) }),
        ...(allergies !== undefined && { allergies }),
        ...(quietHoursStart !== undefined && { quietHoursStart }),
        ...(quietHoursEnd !== undefined && { quietHoursEnd }),
        ...(autoResponderMessage !== undefined && { autoResponderMessage }),
      },

      include: {
        familyMembers: { include: { family: true } },
      },
    });

    res.json({ message: 'User updated.', user });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/users/:id/status
 * Activate, deactivate, or suspend a user (Admin only)
 */
export const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

    if (!validStatuses.includes(status?.toUpperCase())) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: status.toUpperCase() },
    });

    res.json({ message: `User status updated to ${status}.`, user });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/:id/payroll
 * Calculate payroll for a teacher: monthly salary + per-session tutoring earnings
 */
export const getTeacherPayroll = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    
    // Default to current month
    const targetYear = parseInt(year) || new Date().getFullYear();
    const targetMonth = parseInt(month) || (new Date().getMonth() + 1); // 1-indexed
    
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0); // Last day of month

    const teacher = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        baseSalary: true,
        perSessionRate: true,
        status: true,
        taughtClasses: {
          select: {
            id: true,
            name: true,
            subject: true,
            type: true,
            sessions: {
              where: {
                date: { gte: startDate, lte: endDate },
                status: 'COMPLETED',
              },
              select: {
                id: true,
                date: true,
                startTime: true,
                endTime: true,
                status: true,
              },
              orderBy: { date: 'desc' },
            },
          },
        },
        timeOffRequests: {
          where: {
            date: {
              gte: new Date(targetYear, 0, 1),
              lte: new Date(targetYear, 11, 31)
            },
            status: 'APPROVED'
          }
        }
      },
    });

    // Separate classes by type for payroll calculation
    const inPersonClasses = teacher.taughtClasses.filter(c => c.type === 'IN_PERSON' || c.type === 'HYBRID');
    const onlineClasses = teacher.taughtClasses.filter(c => c.type === 'VIRTUAL');

    // Count completed sessions
    const inPersonSessions = inPersonClasses.flatMap(c => c.sessions);
    const onlineSessions = onlineClasses.flatMap(c => c.sessions);
    const allSessions = [...inPersonSessions, ...onlineSessions];

    // Calculate earnings
    const baseSalary = parseFloat(teacher.baseSalary || 0);
    const perSessionRate = parseFloat(teacher.perSessionRate || 0);
    const tutoringEarnings = onlineSessions.length * perSessionRate;
    const totalEarnings = baseSalary + tutoringEarnings;

    // Calculate time off
    const usedSickDays = teacher.timeOffRequests ? teacher.timeOffRequests.filter(r => r.type === 'SICK').length : 0;
    const usedPTODays = teacher.timeOffRequests ? teacher.timeOffRequests.filter(r => r.type === 'PTO').length : 0;

    res.json({
      teacher: {
        id: teacher.id,
        fullName: teacher.fullName,
        email: teacher.email,
        phone: teacher.phone,
        avatarUrl: teacher.avatarUrl,
        status: teacher.status,
      },
      payroll: {
        month: targetMonth,
        year: targetYear,
        baseSalary,
        perSessionRate,
        inPersonSessionCount: inPersonSessions.length,
        onlineSessionCount: onlineSessions.length,
        totalSessionCount: allSessions.length,
        tutoringEarnings,
        totalEarnings,
        usedSickDays,
        totalSickDays: 8,
        usedPTODays,
        totalPTODays: 12,
      },
      classes: teacher.taughtClasses.map(c => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        type: c.type,
        completedSessions: c.sessions.length,
        sessions: c.sessions,
      })),
    });
  } catch (error) {
    next(error);
  }
};

