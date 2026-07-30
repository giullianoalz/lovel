import prisma from '../config/database.js';
import { canUseSnackPunches } from '../utils/snackEligibility.js';
import { hasRole, isOnly } from '../utils/roles.js';

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

  const taught = { enrollments: { some: { status: 'active', class: { teacherId: user.id } } } };
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
const familyWithMembers = {
  include: {
    family: {
      include: {
        members: {
          include: {
            user: {
              select: { id: true, fullName: true, email: true, phone: true, role: true, secondaryRoles: true },
            },
          },
        },
      },
    },
  },
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
const withParentContact = (student) => {
  const members = student.familyMembers?.[0]?.family?.members || [];
  const parents = members.filter(m => hasRole(m.user, 'PARENT'));
  const parent = (parents.find(m => m.isInvoiceRecipient) || parents[0])?.user || null;

  return {
    ...student,
    parentName: parent?.fullName || null,
    parentEmail: parent?.email || null,
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
    const { status, search, familyId, page = 1, limit = 50 } = req.query;
    // Parent contact stays out of any teacher's reach unless they're also an
    // admin — being a parent yourself doesn't earn you other families' details.
    const hideParentContact = hasRole(req.user, 'TEACHER') && !hasRole(req.user, 'ADMIN');

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
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { fullName: 'asc' },
        include: {
          familyMembers: hideParentContact ? { include: { family: true } } : familyWithMembers,
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
      students: hideParentContact ? students : students.map(withParentContact),
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
    // findFirst + rosterScope rather than findUnique: a teacher asking for a
    // student they don't teach gets the same 404 as one who doesn't exist, so
    // the response can't be used to confirm who is enrolled at the academy.
    const student = await prisma.user.findFirstOrThrow({
      where: { id: req.params.id, role: 'STUDENT', ...rosterScope(req.user) },
      include: {
        familyMembers: familyWithMembers,
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
      return res.json({ student });
    }

    res.json({ student: withParentContact(student) });
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
