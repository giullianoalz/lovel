import prisma from '../config/database.js';
import { isOnly } from '../utils/roles.js';
import { sendAccountInvite, hasSignInAccount, isPlaceholderEmail } from '../services/invite.service.js';

/**
 * What one staff member may learn about another.
 *
 * These two endpoints used to return the whole Prisma row. Two kinds of column
 * rode along that shouldn't have:
 *
 *  - `baseSalary` / `perSessionRate` — every colleague's pay. Not theoretical:
 *    the Teachers tab of /students renders both, and that screen is open to
 *    TEACHER as well as ADMIN, so each teacher could read the whole payroll.
 *  - `firebaseUid` / `fcmToken` — handles that identify the account and its
 *    push device rather than describing the person. The UI never needs them;
 *    it needs `canSignIn`, which is derived from the uid below.
 *
 * Admins keep the full row: payroll and account administration are their job.
 */
const STAFF_VISIBLE_USER_FIELDS = [
  'id', 'fullName', 'email', 'phone', 'avatarUrl', 'role', 'status',
  'age', 'createdAt', 'updatedAt', 'familyMembers',
];

/**
 * Shapes one user row for `viewer`. `canSignIn`/`emailUsable` are derived, not
 * columns: the directory needs to show who can actually log in, which depends
 * on whether the row is backed by a real Firebase account and a deliverable
 * address.
 */
const presentUser = (user, viewer) => {
  const base = {
    canSignIn: hasSignInAccount(user),
    emailUsable: !isPlaceholderEmail(user.email),
  };

  if (viewer.role === 'ADMIN') {
    // eslint-disable-next-line no-unused-vars
    const { firebaseUid, fcmToken, ...rest } = user;
    return { ...rest, ...base };
  }

  for (const field of STAFF_VISIBLE_USER_FIELDS) {
    if (user[field] !== undefined) base[field] = user[field];
  }
  return base;
};

/**
 * GET /api/users
 * List all users with optional filtering
 */
export const listUsers = async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 50 } = req.query;

    const andClauses = [];
    if (role) andClauses.push({ role: role.toUpperCase() });
    if (status) andClauses.push({ status: status.toUpperCase() });
    if (search) {
      andClauses.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    // This endpoint backs the chat "New Conversation" picker. A teacher must
    // only be able to find staff (to reach management/colleagues) plus the
    // families of students currently enrolled in their own classes — never
    // the whole parent/student directory, which would let a teacher find and
    // privately message a family that isn't theirs.
    if (isOnly(req.user, 'TEACHER')) {
      const enrollments = await prisma.classEnrollment.findMany({
        where: { status: 'active', class: { teacherId: req.user.id } },
        select: { studentId: true },
      });
      const studentIds = enrollments.map((e) => e.studentId);
      const familyIds = studentIds.length
        ? (
            await prisma.familyMember.findMany({
              where: { userId: { in: studentIds } },
              select: { familyId: true },
            })
          ).map((f) => f.familyId)
        : [];
      const ownFamilyUserIds = familyIds.length
        ? (
            await prisma.familyMember.findMany({
              where: { familyId: { in: familyIds } },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : [];

      andClauses.push({
        OR: [{ role: { in: ['TEACHER', 'ADMIN'] } }, { id: { in: ownFamilyUserIds } }],
      });
    }

    const where = andClauses.length ? { AND: andClauses } : {};

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
      users: users.map((user) => presentUser(user, req.user)),
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

    // Reading your own row is never a disclosure — and the sidebar's quiet-hours
    // panel loads it this way — so self is returned whole, like an admin's view.
    // A teacher looking at someone else gets the trimmed projection.
    const isSelf = user.id === req.user.id;
    res.json({ user: isSelf ? user : presentUser(user, req.user) });
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
    const { fullName, phone, avatarUrl, age, allergies, quietHoursStart, quietHoursEnd, autoResponderMessage, fcmToken } = req.body;

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
        ...(fcmToken !== undefined && { fcmToken }),
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
 * POST /api/users/:id/invite
 * Emails this person a link to set their password (Admin only). Also used to
 * re-send: there is no separate "resend" path, inviting twice just issues a
 * fresh link, which is what an admin means when the first one expired.
 */
export const inviteUser = async (req, res, next) => {
  try {
    const result = await sendAccountInvite(req.params.id);

    if (!result.ok) {
      return res.status(result.message === 'User not found.' ? 404 : 400).json({
        error: 'Invite Failed',
        message: result.message,
      });
    }

    res.json({
      message: result.emailed
        ? `Invite sent to ${result.user.email}.`
        : `Account ready, but the email could not be sent (${result.deliveryError}). Share the link below yourself.`,
      emailed: result.emailed,
      link: result.link || null,
      user: { ...result.user, canSignIn: hasSignInAccount(result.user), emailUsable: true },
    });
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
                // Only pay for sessions where a student actually showed up —
                // scheduling a class must not generate earnings on its own.
                attendance: { some: { status: 'PRESENT' } },
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
            status: 'APPROVED',
            date: { gte: new Date(targetYear, 0, 1), lte: new Date(targetYear, 11, 31) },
          }
        }
      },
    });

    const allSessions = teacher.taughtClasses.flatMap(c => c.sessions);

    const baseSalary = parseFloat(teacher.baseSalary || 0);
    const perSessionRate = parseFloat(teacher.perSessionRate || 0);
    const sessionEarnings = allSessions.length * perSessionRate;
    const totalEarnings = baseSalary + sessionEarnings;

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
        totalSessionCount: allSessions.length,
        sessionEarnings,
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

