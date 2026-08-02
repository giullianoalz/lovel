import prisma from '../config/database.js';
import { isOnly, hasRole } from '../utils/roles.js';
import { sendAccountInvite, hasSignInAccount, isPlaceholderEmail } from '../services/invite.service.js';
import { computeTeacherPayroll, PAY_CATEGORIES } from '../services/payroll.service.js';

/**
 * What one staff member may learn about another.
 *
 * These two endpoints used to return the whole Prisma row. Two kinds of column
 * rode along that shouldn't have:
 *
 *  - `baseSalary` / `hourlyRate` — every colleague's pay. Not theoretical:
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
    // Matches secondary roles too, so filtering for TEACHER also turns up an
    // admin who teaches — otherwise they'd be missing from every teacher picker.
    if (role) {
      const wanted = role.toUpperCase();
      andClauses.push({ OR: [{ role: wanted }, { secondaryRoles: { has: wanted } }] });
    }
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
 * POST /api/users/:id/teaching-role
 * DELETE /api/users/:id/teaching-role
 *
 * Grants (or withdraws) the TEACHER hat as a secondary role. This exists because
 * a class can only be assigned to someone who holds TEACHER (see
 * validateClassInput), so an admin who runs a COVE herself was unassignable —
 * she simply never appeared in any teacher picker. Admin-only, and the usual
 * path is an admin adding herself.
 *
 * Withdrawing is blocked while the person still teaches something: dropping the
 * role would leave classes pointing at an account that no longer qualifies.
 */
export const setTeachingRole = async (req, res, next) => {
  try {
    const adding = req.method === 'POST';

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { id: true, fullName: true, role: true, secondaryRoles: true },
    });

    if (user.role === 'TEACHER') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'This account is already a teacher account — its primary role can only be changed by an admin.',
      });
    }

    const held = new Set(user.secondaryRoles || []);

    if (adding) {
      held.add('TEACHER');
    } else {
      const taught = await prisma.class.count({ where: { teacherId: user.id } });
      if (taught > 0) {
        return res.status(409).json({
          error: 'Still Teaching',
          message: `${user.fullName} is still assigned to ${taught} class${taught === 1 ? '' : 'es'}. Reassign them first.`,
        });
      }
      held.delete('TEACHER');
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { secondaryRoles: [...held] },
      select: { id: true, fullName: true, email: true, role: true, secondaryRoles: true, status: true },
    });

    res.json({
      message: adding
        ? `${updated.fullName} can now be assigned to classes.`
        : `${updated.fullName} is no longer listed as a teacher.`,
      user: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/users/:id/payroll
 * Set a teacher's pay rates (Admin only).
 *
 * Deliberately NOT part of `updateUser`. That route is `requireSelfOrRole`, so
 * anyone may edit their own profile — folding pay into it would let a teacher
 * give themselves a raise. Pay is the one thing on a User row that its owner
 * must not be able to change, so it gets its own admin-only endpoint.
 *
 * Body: {
 *   baseSalary?:   number|null,   // fixed monthly amount, for salaried staff
 *   hourlyRate?:   number|null,   // fallback rate per hour taught
 *   categoryRates?: { ONLINE?: number|null, IN_PERSON?: number|null }
 * }
 * Any part may be sent alone; null or '' clears that rate. Clearing a category
 * override removes the row, so the teacher falls back to their base rate.
 */
export const updateTeacherPayroll = async (req, res, next) => {
  try {
    const { baseSalary, hourlyRate, categoryRates } = req.body;

    if (baseSalary === undefined && hourlyRate === undefined && categoryRates === undefined) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send baseSalary, hourlyRate, or categoryRates.',
      });
    }

    // Money, so parse strictly: a stray character silently becoming NaN and
    // then null would quietly wipe someone's salary.
    const parseRate = (value, label) => {
      if (value === null || value === '') return { value: null };
      const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
      if (n < 0) return { error: `${label} cannot be negative.` };
      if (n > 99999999.99) return { error: `${label} is implausibly large.` };
      return { value: Math.round(n * 100) / 100 };
    };

    const data = {};
    for (const [key, raw, label] of [
      ['baseSalary', baseSalary, 'Base salary'],
      ['hourlyRate', hourlyRate, 'Hourly rate'],
    ]) {
      if (raw === undefined) continue;
      const parsed = parseRate(raw, label);
      if (parsed.error) return res.status(400).json({ error: 'Validation Error', message: parsed.error });
      data[key] = parsed.value;
    }

    // Validate every category override before touching the database, so a typo
    // in the second one can't leave the first already saved.
    const validKeys = PAY_CATEGORIES.map((c) => c.key);
    const overrideOps = [];
    for (const [category, raw] of Object.entries(categoryRates || {})) {
      if (!validKeys.includes(category)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Unknown pay category "${category}". Known categories: ${validKeys.join(', ')}.`,
        });
      }
      if (raw === undefined) continue;
      const parsed = parseRate(raw, `Rate for ${category}`);
      if (parsed.error) return res.status(400).json({ error: 'Validation Error', message: parsed.error });
      overrideOps.push({ category, rate: parsed.value });
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, fullName: true, role: true, secondaryRoles: true,
        baseSalary: true, hourlyRate: true,
        payRates: { select: { category: true, hourlyRate: true } },
      },
    });
    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'That user does not exist.' });
    }
    if (!hasRole(target, 'TEACHER', 'ADMIN')) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `${target.fullName} is not a teacher, so there is no payroll to set.`,
      });
    }

    // One transaction: a half-applied pay change is a wrong paycheque.
    await prisma.$transaction([
      ...(Object.keys(data).length
        ? [prisma.user.update({ where: { id: req.params.id }, data })]
        : []),
      ...overrideOps.map(({ category, rate }) =>
        // Clearing an override deletes the row rather than storing 0 — the
        // teacher should fall back to their base rate, not be paid nothing.
        rate === null
          ? prisma.teacherPayRate.deleteMany({ where: { teacherId: req.params.id, category } })
          : prisma.teacherPayRate.upsert({
              where: { teacherId_category: { teacherId: req.params.id, category } },
              update: { hourlyRate: rate },
              create: { teacherId: req.params.id, category, hourlyRate: rate },
            })
      ),
    ]);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        id: true, fullName: true, baseSalary: true, hourlyRate: true,
        payRates: { select: { category: true, hourlyRate: true } },
      },
    });

    // No audit table exists yet, so the server log is the only trace of who
    // changed whose pay. Worth a real record if this ever gets contested.
    const describe = (u) =>
      `base ${u.baseSalary ?? '—'}, hourly ${u.hourlyRate ?? '—'}` +
      (u.payRates.length ? `, ${u.payRates.map((r) => `${r.category}=${r.hourlyRate}`).join(' ')}` : '');
    console.log(`[Payroll] ${req.user.email} set ${target.fullName}: ${describe(target)} -> ${describe(updated)}`);

    res.json({ message: `Pay rates updated for ${updated.fullName}.`, user: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/:id/payroll
 * A teacher's earnings for one month, broken down by the kind of work.
 */
export const getTeacherPayroll = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();
    const targetMonth = parseInt(month) || (new Date().getMonth() + 1);

    res.json(await computeTeacherPayroll(req.params.id, targetMonth, targetYear));
  } catch (error) {
    next(error);
  }
};
