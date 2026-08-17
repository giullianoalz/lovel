import prisma from '../config/database.js';
import { canUseSnackPunches } from '../utils/snackEligibility.js';
import { hasRole, isOnly, isFrontDeskOnly } from '../utils/roles.js';
import { resolvePaging } from '../utils/helpers.js';

/**
 * Prisma filter limiting a teacher to the students they actually teach.
 *
 * Role alone was the only gate here, so any teacher could list — and open the
 * profile of — every child in the academy, including `allergies` and
 * `medicalNotes`. The intent to narrow their view already existed one level
 * down (getStudent strips `familyMembers` for teachers so contact details stay
 * out of reach); this applies the same intent to which rows they get at all.
 *
 * Admins are unfiltered: placement, billing and health records are their job —
 * `isOnly` rather than `hasRole` so an admin who also teaches keeps that.
 *
 * A teacher who is also a parent gets their own children on top of their
 * roster: the filter widens rather than replaces, or enrolling your child at
 * your own workplace would hide them from you.
 */
const rosterScope = (user) => {
  if (!isOnly(user, 'TEACHER')) return {};

  // Co-teaching a class puts those students on your roster exactly as teaching
  // it does — otherwise a co-teacher can see the class on their portal but not
  // open a single one of its students.
  const taughtClass = {
    OR: [{ teacherId: user.id }, { coTeachers: { some: { id: user.id } } }],
  };
  const taught = { enrollments: { some: { status: 'active', class: taughtClass } } };
  if (!hasRole(user, 'PARENT')) return taught;

  return {
    OR: [
      taught,
      { familyMembers: { some: { family: { members: { some: { userId: user.id } } } } } },
    ],
  };
};

/**
 * Prisma `include` that reaches a student's family and everyone in it, so the
 * guardian's contact details can be resolved. Teachers never get this — parent
 * contact stays inside the app so families can't be solicited directly.
 */
const familyWithMembers = (withEmail = true) => ({
  include: {
    family: {
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true, fullName: true, phone: true, role: true, secondaryRoles: true,
                ...(withEmail ? { email: true } : {}),
              },
            },
          },
        },
      },
    },
  },
});

/**
 * How much of a guardian's contact details this caller may read.
 *
 *   'full'  — admins.
 *   'phone' — the front desk, and only the number. Reception answers the door
 *             and the phone: when a child is waiting for a pickup that hasn't
 *             come, someone has to be able to call. An address book entry is
 *             enough for that. Email is not, because a written channel is
 *             exactly what the app exists to keep the record of.
 *   'none'  — everyone else, teachers included. Being a parent yourself doesn't
 *             earn you another family's details.
 */
const parentContactLevel = (user) => {
  if (hasRole(user, 'ADMIN')) return 'full';
  if (isFrontDeskOnly(user)) return 'phone';
  return 'none';
};

/**
 * Drops `staffNotes` unless the caller is an admin.
 *
 * The student queries below return the whole user row rather than a `select`,
 * so a new column is visible to every caller the moment it exists — which is
 * how billing shorthand ended up in front of teachers in the first place. This
 * is applied on the way out of every student response instead of trusting each
 * query to remember.
 */
const stripStaffNotes = (student, user) => {
  if (hasRole(user, 'ADMIN')) return student;
  const { staffNotes, ...rest } = student;
  return rest;
};

/**
 * Flattens a student's guardian onto `parentName` / `parentEmail` / `parentPhone`,
 * which is the shape the directory and profile modal read.
 *
 * The guardian is picked by the *user's* role rather than the free-form
 * `FamilyMember.role` string: the importer writes that as lowercase 'parent'
 * while other call sites wrote 'PARENT'/'Mother'/'Father', so matching on it
 * silently found nobody and every student rendered "No Parent Assigned".
 * The invoice recipient wins when a family has more than one parent.
 *
 * Any role counts, not just the primary one — a teacher's own child would
 * otherwise come back with no parent at all, since her primary role is TEACHER.
 */
const withParentContact = (student, { includeEmail = true } = {}) => {
  const members = student.familyMembers?.[0]?.family?.members || [];
  const parents = members.filter(m => hasRole(m.user, 'PARENT'));
  const parent = (parents.find(m => m.isInvoiceRecipient) || parents[0])?.user || null;

  return {
    ...student,
    parentName: parent?.fullName || null,
    parentEmail: includeEmail ? (parent?.email || null) : null,
    parentPhone: parent?.phone || null,
  };
};

/**
 * GET /api/students/export
 * Downloads every student as a CSV whose columns mirror the importer
 * (see import.controller.js), so an admin can export → edit → re-import
 * without duplicating (the import matches students by email).
 */
export const exportStudentsCsv = async (req, res, next) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      orderBy: { fullName: 'asc' },
      select: {
        fullName: true,
        email: true,
        phone: true,
        age: true,
        birthday: true,
        allergies: true,
        status: true,
        familyMembers: {
          select: {
            family: {
              select: {
                name: true,
                tags: true,
                members: {
                  where: { isInvoiceRecipient: true },
                  select: { user: { select: { fullName: true, email: true, phone: true } } },
                },
              },
            },
          },
        },
      },
    });

    const headers = [
      'studentName', 'studentEmail', 'studentPhone', 'age', 'birthday', 'allergies', 'status',
      'parentName', 'parentEmail', 'parentPhone', 'familyName', 'tags',
    ];

    // RFC-4180-ish: wrap every field in quotes and double any internal quote.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const lines = [headers.join(',')];
    for (const s of students) {
      const family = s.familyMembers[0]?.family || null;
      const parent = family?.members?.[0]?.user || null;
      lines.push([
        s.fullName,
        s.email,
        s.phone ?? '',
        s.age ?? '',
        // Emitted as YYYY-MM-DD, which is exactly what the importer parses back.
        s.birthday ? s.birthday.toISOString().slice(0, 10) : '',
        s.allergies ?? '',
        s.status,
        parent?.fullName ?? '',
        parent?.email ?? '',
        parent?.phone ?? '',
        family?.name ?? '',
        (family?.tags || []).join(';'),
      ].map(esc).join(','));
    }

    const csv = '﻿' + lines.join('\r\n'); // BOM so Excel opens UTF-8 correctly
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/students
 * List all students with optional filtering
 */
export const listStudents = async (req, res, next) => {
  try {
    const { status, search, familyId } = req.query;
    const { page, limit, skip, take } = resolvePaging(req.query);
    // See parentContactLevel. The directory is the only place the desk gets a
    // guardian's number; the profile below stays admin/teacher, so reception
    // reads a name and a phone and not a family's medical or billing history.
    const contactLevel = parentContactLevel(req.user);
    const hideParentContact = contactLevel === 'none';

    // Every clause is ANDed rather than merged onto one object: rosterScope can
    // itself be an OR (a teacher who is also a parent), and assigning
    // `where.OR` for the search would silently replace it — handing them the
    // whole directory instead of their own roster.
    const filters = [rosterScope(req.user)].filter(f => Object.keys(f).length > 0);
    if (search) {
      filters.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (familyId) filters.push({ familyMembers: { some: { familyId } } });

    const where = {
      role: 'STUDENT',
      ...(status ? { status: status.toUpperCase() } : {}),
      ...(filters.length ? { AND: filters } : {}),
    };

    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { fullName: 'asc' },
        include: {
          familyMembers: hideParentContact
            ? { include: { family: true } }
            : familyWithMembers(contactLevel === 'full'),
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
      students: (hideParentContact
        ? students
        : students.map(s => withParentContact(s, { includeEmail: contactLevel === 'full' }))
      ).map(s => stripStaffNotes(s, req.user)),
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
 * GET /api/students/:id
 * Get full student profile with all related data
 */
export const getStudent = async (req, res, next) => {
  try {
    // findFirst + rosterScope rather than findUnique: a teacher asking for a
    // student they don't teach gets the same 404 as one who doesn't exist, so
    // the response can't be used to confirm who is enrolled at the academy.
    const student = await prisma.user.findFirstOrThrow({
      where: { id: req.params.id, role: 'STUDENT', ...rosterScope(req.user) },
      include: {
        familyMembers: familyWithMembers(),
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
    // Their own children are the exception: a teacher-parent looking at their
    // own child is looking at their own contact details.
    const ownChild = (student.familyMembers || []).some(fm =>
      (fm.family?.members || []).some(m => m.userId === req.user.id));

    if (hasRole(req.user, 'TEACHER') && !hasRole(req.user, 'ADMIN') && !ownChild) {
      delete student.familyMembers;
      return res.json({ student: stripStaffNotes(student, req.user) });
    }

    res.json({ student: stripStaffNotes(withParentContact(student), req.user) });
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
 * PUT /api/students/:id/info
 * Edit a student's core profile fields (name, contact, status, birthday,
 * allergies). ADMIN only — the directory's "Edit Student" action.
 */
export const updateStudentInfo = async (req, res, next) => {
  try {
    const { fullName, email, phone, status, birthday, allergies, accommodationNotes } = req.body;

    if (fullName !== undefined && !fullName.trim()) {
      return res.status(400).json({ error: 'Validation Error', message: 'Full name cannot be empty.' });
    }
    if (email !== undefined && !email.trim()) {
      return res.status(400).json({ error: 'Validation Error', message: 'Email cannot be empty.' });
    }
    if (status !== undefined && !['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ error: 'Validation Error', message: 'status must be ACTIVE, INACTIVE or SUSPENDED.' });
    }

    // Same target as every other student write: an id must resolve to an
    // actual STUDENT row, not any user, before it's touched.
    await prisma.user.findFirstOrThrow({ where: { id: req.params.id, role: 'STUDENT' } });

    const student = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(fullName !== undefined && { fullName: fullName.trim() }),
        ...(email !== undefined && { email: email.trim().toLowerCase() }),
        ...(phone !== undefined && { phone: phone.trim() || null }),
        ...(status !== undefined && { status }),
        ...(birthday !== undefined && { birthday: birthday ? new Date(`${birthday}T00:00:00.000Z`) : null }),
        ...(allergies !== undefined && { allergies }),
        ...(accommodationNotes !== undefined && { accommodationNotes }),
      },
    });

    res.json({ message: 'Student updated.', student });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/students/:id/staff-notes
 * Back-office notes about a student. ADMIN only, both to write and to read
 * back — the route is gated, and every other student response strips the field.
 */
export const updateStaffNotes = async (req, res, next) => {
  try {
    const { staffNotes } = req.body;

    if (staffNotes !== null && typeof staffNotes !== 'string') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'staffNotes must be a string, or null to clear it.',
      });
    }

    const trimmed = typeof staffNotes === 'string' ? staffNotes.trim() : null;
    if (trimmed && trimmed.length > 2000) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'staffNotes is limited to 2000 characters.',
      });
    }

    const student = await prisma.user.update({
      where: { id: req.params.id },
      data: { staffNotes: trimmed || null },
      select: { id: true, fullName: true, staffNotes: true },
    });

    res.json({ message: 'Staff notes updated.', student });
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

    // Same roster rule as the read paths — this is the write counterpart, and
    // the route is open to every teacher. `role: 'STUDENT'` matters too: the id
    // was matched against any user row, so a punch balance could be written
    // onto a teacher's or an admin's account.
    const student = await prisma.user.findFirstOrThrow({
      where: { id: req.params.id, role: 'STUDENT', ...rosterScope(req.user) },
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
    // Same roster rule as getStudent — attendance is a student record too, and
    // this route is reachable by any teacher.
    if (isOnly(req.user, 'TEACHER')) {
      const onRoster = await prisma.user.findFirst({
        where: { id: req.params.id, ...rosterScope(req.user) },
        select: { id: true },
      });
      if (!onRoster) {
        return res.status(404).json({ error: 'Not Found', message: 'Student not found.' });
      }
    }

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
