import prisma from '../config/database.js';
import { isOnly, hasRole } from '../utils/roles.js';
import { sendAccountInvite, hasSignInAccount, isPlaceholderEmail } from '../services/invite.service.js';
import { computeTeacherPayroll, computePayrollSummary, computeWeeklyPayrollSummary, loadPayCategories } from '../services/payroll.service.js';
import { buildParentMaskMap, masksParentIdentity } from '../utils/parentPrivacy.js';
import { resolvePaging } from '../utils/helpers.js';

const EMPTY_MASK_MAP = new Map();

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
 * The students sharing a family with `user`, as `{ id, fullName }`.
 *
 * The directory lists guardians by their own name, which is not how the office
 * thinks about them — the front desk knows "Ana's mum" and has to work out
 * which row that is. Sending the children along lets the card name them (and
 * the search box match on them) instead of showing a family label nobody uses.
 *
 * Empty unless the caller asked for the nested members; the chat picker doesn't.
 */
const childrenOf = (user) =>
  (user.familyMembers || [])
    .flatMap((fm) => fm.family?.members || [])
    .filter((m) => hasRole(m.user, 'STUDENT'))
    .map((m) => ({ id: m.user.id, fullName: m.user.fullName }))
    .filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i);

/**
 * Shapes one user row for `viewer`. `canSignIn`/`emailUsable` are derived, not
 * columns: the directory needs to show who can actually log in, which depends
 * on whether the row is backed by a real Firebase account and a deliverable
 * address.
 */
const presentUser = (user, viewer, maskMap = EMPTY_MASK_MAP) => {
  const base = {
    canSignIn: hasSignInAccount(user),
    emailUsable: !isPlaceholderEmail(user.email),
    children: childrenOf(user),
  };

  // A teacher browsing the directory (this endpoint backs the chat "New
  // Conversation" picker) gets guardians as "Ana's Parent", with no address or
  // phone attached — see utils/parentPrivacy.js.
  const maskedName = maskMap.get(user.id);
  if (maskedName) {
    return { ...base, id: user.id, fullName: maskedName, role: user.role, status: user.status, isMaskedParent: true };
  }

  // hasRole, not `viewer.role ===`: administration is a permission, and an
  // account whose primary hat is TEACHER but that also holds ADMIN runs the
  // office. Reading it strictly hid every colleague's pay from them, so the
  // Teachers tab showed blanks for someone who is allowed to set those rates.
  if (hasRole(viewer, 'ADMIN')) {
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
    const { role, status, search } = req.query;
    const { page, limit, skip, take } = resolvePaging(req.query);

    const andClauses = [];
    // Matches secondary roles too, so filtering for TEACHER also turns up an
    // admin who teaches — otherwise they'd be missing from every teacher picker.
    if (role) {
      const wanted = role.toUpperCase();
      andClauses.push({ OR: [{ role: wanted }, { secondaryRoles: { has: wanted } }] });
    }
    if (status) andClauses.push({ status: status.toUpperCase() });
    if (search) {
      const nameMatch = { fullName: { contains: search, mode: 'insensitive' } };
      const emailMatch = { email: { contains: search, mode: 'insensitive' } };

      if (masksParentIdentity(req.user)) {
        // Masking the label isn't enough on its own: if searching "maria" still
        // returned the row rendered as "Ana's Parent", the search box would
        // give back the exact name the label hides — same for the address.
        // For a teacher, guardians are reachable through their child's name.
        andClauses.push({
          OR: [
            {
              AND: [
                { role: { not: 'PARENT' } },
                { NOT: { secondaryRoles: { has: 'PARENT' } } },
                { OR: [nameMatch, emailMatch] },
              ],
            },
            {
              familyMembers: {
                some: {
                  family: { members: { some: { user: { AND: [{ role: 'STUDENT' }, nameMatch] } } } },
                },
              },
            },
          ],
        });
      } else {
        andClauses.push({ OR: [nameMatch, emailMatch] });
      }
    }

    // This endpoint backs the chat "New Conversation" picker. A teacher must
    // only be able to find staff (to reach management/colleagues) plus the
    // families of students currently enrolled in their own classes — never
    // the whole parent/student directory, which would let a teacher find and
    // privately message a family that isn't theirs.
    if (isOnly(req.user, 'TEACHER')) {
      const enrollments = await prisma.classEnrollment.findMany({
        where: {
          status: 'active',
          class: {
            OR: [
              { teacherId: req.user.id },
              { coTeachers: { some: { id: req.user.id } } },
            ],
          },
        },
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
        skip,
        take,
        orderBy: { fullName: 'asc' },
        include: {
          // The family's other members ride along so a guardian's row can name
          // their children — see childrenOf. Only names and roles, so this
          // stays cheap enough for the 200-row directory load.
          familyMembers: {
            include: {
              family: {
                include: {
                  members: {
                    include: {
                      user: { select: { id: true, fullName: true, role: true, secondaryRoles: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const maskMap = await buildParentMaskMap(req.user, users.map((u) => u.id));

    res.json({
      users: users.map((user) => presentUser(user, req.user, maskMap)),
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
    if (isSelf) return res.json({ user });

    const maskMap = await buildParentMaskMap(req.user, [user.id]);
    res.json({ user: presentUser(user, req.user, maskMap) });
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
    const { fullName, phone, avatarUrl, age, allergies, quietHoursStart, quietHoursEnd, quietHoursFullDays, autoResponderMessage, fcmToken } = req.body;

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
        ...(quietHoursFullDays !== undefined && { quietHoursFullDays }),
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
    const { subject, message } = req.body || {};
    const result = await sendAccountInvite(req.params.id, { subject, message });

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
 * POST /api/users/invite-bulk
 * Invites several people in one go (Admin only).
 *
 * Nobody in the academy has ever been invited — 71 of 81 accounts cannot sign
 * in — and doing that one profile at a time is why. This exists so the backlog
 * can be cleared in one pass.
 *
 * Deliberately transport-agnostic. `sendAccountInvite` creates the Firebase
 * account and the set-password link whether or not the email goes out, and
 * every link comes back in the response. So this is useful today, with email
 * delivery still unconfigured: the admin gets 28 working links to hand out by
 * whatever means they like, and the same call starts emailing the moment a
 * verified sender exists. No part of unblocking sign-in waits on Resend.
 *
 * Body: { userIds: string[] }  — explicit ids only. No "invite everyone who
 * matches a filter": mailing real families is not something to trigger by
 * accident, so the caller has to name each person.
 */
export const inviteUsersBulk = async (req, res, next) => {
  try {
    const { userIds, subject, message } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'userIds must be a non-empty array.' });
    }
    if (userIds.length > 100) {
      return res.status(400).json({ error: 'Validation Error', message: 'Invite at most 100 people at a time.' });
    }

    // Sequential, not Promise.all: each invite hits Firebase and the mail
    // provider, and firing 28 at once is how you trip a rate limit and end up
    // not knowing which half went out.
    const results = [];
    for (const id of userIds) {
      try {
        const r = await sendAccountInvite(id, { subject, message });
        results.push(
          r.ok
            ? { id, ok: true, emailed: Boolean(r.emailed), email: r.user.email, fullName: r.user.fullName, link: r.link || null }
            : { id, ok: false, message: r.message }
        );
      } catch (error) {
        // One bad row must not abandon the other 27.
        results.push({ id, ok: false, message: error.message });
      }
    }

    const sent = results.filter((r) => r.ok && r.emailed).length;
    const prepared = results.filter((r) => r.ok && !r.emailed).length;
    const failed = results.filter((r) => !r.ok).length;

    console.log(`[Invite] ${req.user.email} invited ${userIds.length}: ${sent} emailed, ${prepared} link-only, ${failed} failed`);

    res.json({
      message: `${sent} emailed, ${prepared} ready to share by hand, ${failed} failed.`,
      summary: { total: userIds.length, sent, prepared, failed },
      results,
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
      // Co-taught classes count as still teaching: dropping the TEACHER role
      // while they are on a roster would leave a class assigned to somebody the
      // system no longer treats as staff.
      const taught = await prisma.class.count({
        where: {
          OR: [{ teacherId: user.id }, { coTeachers: { some: { id: user.id } } }],
        },
      });
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
 *   baseSalary?:   number|null,   // fixed amount, for salaried staff
 *   salaryPeriod?: 'MONTHLY'|'ANNUAL',  // how to read baseSalary
 *   hourlyRate?:   number|null,   // fallback rate per hour worked
 *   flatRateOnly?: boolean,       // "$17.50 an hour, whatever the work"
 *   categoryRates?: { [categoryKey]: number|null }
 * }
 * Any part may be sent alone; null or '' clears that rate. Clearing a category
 * override removes the row, so the person falls back to the category's own rate
 * and then to their base rate.
 */
export const updateTeacherPayroll = async (req, res, next) => {
  try {
    const { baseSalary, salaryPeriod, hourlyRate, flatRateOnly, categoryRates } = req.body;

    if (
      baseSalary === undefined && salaryPeriod === undefined &&
      hourlyRate === undefined && categoryRates === undefined &&
      flatRateOnly === undefined
    ) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send baseSalary, salaryPeriod, hourlyRate, flatRateOnly, or categoryRates.',
      });
    }

    const SALARY_PERIODS = ['MONTHLY', 'ANNUAL'];
    if (salaryPeriod !== undefined && !SALARY_PERIODS.includes(salaryPeriod)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `salaryPeriod must be one of: ${SALARY_PERIODS.join(', ')}.`,
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
    if (salaryPeriod !== undefined) data.salaryPeriod = salaryPeriod;
    if (flatRateOnly !== undefined) data.flatRateOnly = Boolean(flatRateOnly);

    // Validate every category override before touching the database, so a typo
    // in the second one can't leave the first already saved.
    const validKeys = (await loadPayCategories()).map((c) => c.key);
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
        baseSalary: true, salaryPeriod: true, hourlyRate: true, flatRateOnly: true,
        payRates: { select: { category: true, hourlyRate: true } },
      },
    });
    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'That user does not exist.' });
    }
    // Front desk staff are paid for their shifts, so they need rates too — the
    // check is "does this person work here", not "does this person teach".
    if (!hasRole(target, 'TEACHER', 'ADMIN', 'RECEPTIONIST')) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `${target.fullName} is not staff, so there is no payroll to set.`,
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
        id: true, fullName: true, baseSalary: true, salaryPeriod: true, hourlyRate: true,
        flatRateOnly: true,
        payRates: { select: { category: true, hourlyRate: true } },
      },
    });

    // No audit table exists yet, so the server log is the only trace of who
    // changed whose pay. Worth a real record if this ever gets contested.
    const describe = (u) =>
      `base ${u.baseSalary ?? '—'}/${u.salaryPeriod === 'ANNUAL' ? 'yr' : 'mo'}, hourly ${u.hourlyRate ?? '—'}` +
      (u.flatRateOnly ? ' (flat)' : '') +
      (u.payRates.length ? `, ${u.payRates.map((r) => `${r.category}=${r.hourlyRate}`).join(' ')}` : '');
    console.log(`[Payroll] ${req.user.email} set ${target.fullName}: ${describe(target)} -> ${describe(updated)}`);

    res.json({ message: `Pay rates updated for ${updated.fullName}.`, user: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/payroll/summary
 * Every teacher's earnings for one month, plus the academy's total (Admin only).
 *
 * Admin-only with no self case, unlike GET /:id/payroll: a teacher may read her
 * own pay, but this screen is the whole roster's pay side by side.
 */
export const getPayrollSummary = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();
    const targetMonth = parseInt(month) || (new Date().getMonth() + 1);

    if (targetMonth < 1 || targetMonth > 12) {
      return res.status(400).json({ error: 'Validation Error', message: 'month must be 1-12.' });
    }

    res.json(await computePayrollSummary(targetMonth, targetYear));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/payroll/weekly-summary
 * Every teacher's earnings for one Monday-Sunday week (Admin only).
 *
 * Same shape as GET /payroll/summary, so the screen can reuse one table for
 * both — payroll is actually settled weekly, this is the view that matches
 * how the money goes out, while the monthly one stays for reviewing rates.
 */
export const getWeeklyPayrollSummary = async (req, res, next) => {
  try {
    const { weekStart } = req.query;
    if (weekStart && Number.isNaN(new Date(weekStart).getTime())) {
      return res.status(400).json({ error: 'Validation Error', message: 'weekStart must be a valid date.' });
    }
    res.json(await computeWeeklyPayrollSummary(weekStart));
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
