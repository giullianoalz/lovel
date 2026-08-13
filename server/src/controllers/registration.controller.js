import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { hasRole } from '../utils/roles.js';
import { invalidate } from '../middleware/cache.js';
import { calculateRegistrationBilling, DEPOSIT_RATE, round2 } from '../services/registrationPricing.service.js';
import { buildQuarterCharges } from '../services/quarterlyBilling.service.js';
import { raiseInvoicedCharge } from '../services/invoicing.service.js';
import { sendRegistrationBillingEmail } from '../services/email.service.js';
import { sendNotification } from '../jobs/notification.helper.js';

/**
 * Notifies the student and the family's invoice-recipient parent (if any) that a
 * waitlist spot opened up for them — reuses the same recipient-resolution logic
 * as the billing confirmation email so both channels reach the same people.
 */
const notifyWaitlistPromotion = async (studentId, className, classId) => {
  try {
    const [student, familyMember] = await Promise.all([
      prisma.user.findUnique({ where: { id: studentId }, select: { fullName: true } }),
      prisma.familyMember.findFirst({
        where: { userId: studentId },
        select: { family: { select: { members: { where: { isInvoiceRecipient: true }, select: { userId: true } } } } },
      }),
    ]);

    const recipientIds = new Set([studentId]);
    const parentUserId = familyMember?.family?.members?.[0]?.userId;
    if (parentUserId) recipientIds.add(parentUserId);

    await Promise.all([...recipientIds].map(userId => sendNotification({
      userId,
      type: 'REGISTRATION_PROMOTED',
      title: 'Spot confirmed!',
      message: `${student?.fullName || 'Your child'} was promoted from the waitlist and now has a confirmed spot in ${className}.`,
      referenceType: 'class',
      referenceId: classId,
      dedupKey: `registration_promoted_${studentId}_${classId}`,
    })));
  } catch (err) {
    console.error('[Registration] Failed to notify waitlist promotion:', err.message);
  }
};

/**
 * Locks one or more Class rows for the rest of the transaction so a capacity
 * check ("enrollments < maxStudents") followed by an insert can't race with
 * another concurrent registration for the same class — without this, two
 * families submitting for the last open spot at the same moment could both
 * read "there's room" and both get enrolled, overbooking the class. Sorted so
 * two transactions touching the same pair of classes (e.g. one family's
 * first/second choice swapped with another's) always lock in the same order
 * and can't deadlock each other.
 */
const lockClassRows = async (tx, classIds) => {
  const ids = [...new Set(classIds.filter(Boolean))].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM classes WHERE id::text IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
};

/**
 * Windows must run in chronological order: Early opens -> Early ends/Public
 * opens -> Public opens -> Registration closes. Returns an error message, or
 * null if the order is valid.
 */
const validateWindowOrder = ({ window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses }) => {
  const [d1, d2, d3, d4] = [window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses].map(d => new Date(d));
  if (d1 >= d2) return 'The Early window must open before it ends.';
  if (d2 >= d3) return 'The Public window must open after the Early window ends.';
  if (d3 >= d4) return 'Registration must close after the Public window opens.';
  return null;
};

/**
 * POST /api/registration/terms
 * Create a new Term and auto-seed Priority Holds for existing students
 */
export const createTerm = async (req, res, next) => {
  try {
    const { name, startDate, endDate, window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses, regularRate, anchoredRate, depositDueDate } = req.body;

    const orderError = validateWindowOrder({ window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses });
    if (orderError) return res.status(400).json({ message: orderError });

    // Both rates are required at creation time — a term with no rate would
    // silently bill every registration in it at $0 (RegistrationTerm.regularRate
    // defaults to 0), which nobody would notice until a parent saw a $0 total.
    if (regularRate === undefined || regularRate === null || regularRate === '') {
      return res.status(400).json({ message: 'regularRate is required.' });
    }
    if (anchoredRate === undefined || anchoredRate === null || anchoredRate === '') {
      return res.status(400).json({ message: 'anchoredRate is required.' });
    }
    if (isNaN(Number(regularRate)) || Number(regularRate) < 0) {
      return res.status(400).json({ message: 'regularRate must be a non-negative number.' });
    }
    if (isNaN(Number(anchoredRate)) || Number(anchoredRate) < 0) {
      return res.status(400).json({ message: 'anchoredRate must be a non-negative number.' });
    }

    // 1. Create the Term
    const term = await prisma.registrationTerm.create({
      data: {
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        window1OpensAt: new Date(window1OpensAt),
        window2OpensAt: new Date(window2OpensAt),
        window3OpensAt: new Date(window3OpensAt),
        registrationCloses: new Date(registrationCloses),
        regularRate: Number(regularRate),
        anchoredRate: Number(anchoredRate),
        depositDueDate: depositDueDate ? new Date(depositDueDate) : null,
        status: 'UPCOMING',
      },
    });

    // 2. Clone Classes from the most recent active term (Optional step, can be manual too)
    // For now, we expect classes to be created and linked to this termId separately.

    invalidate('registration:terms');
    res.status(201).json({ message: 'Registration Term created.', term });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/terms/:id/seed-priority
 * Generates priority holds for all currently active students in their current days
 */
export const seedPriorityHolds = async (req, res, next) => {
  try {
    const termId = req.params.id;
    const { sourceTermId } = req.body;
    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });

    // Copy the rosters of the chosen source term (or, if none given, every current
    // active roster) and match them by class name into the new term.
    const currentEnrollments = await prisma.classEnrollment.findMany({
      where: {
        status: 'active',
        ...(sourceTermId ? { class: { termId: sourceTermId } } : {}),
      },
      include: { class: true },
    });

    // For each enrollment, find the matching class in the NEW term by name
    const newTermClasses = await prisma.class.findMany({ where: { termId } });

    const holds = [];
    for (const enrollment of currentEnrollments) {
      const matchingClass = newTermClasses.find(c => c.name === enrollment.class.name);
      
      if (matchingClass) {
        holds.push({
          termId,
          classId: matchingClass.id,
          studentId: enrollment.studentId,
          expiresAt: term.window2OpensAt, // Expires when Window 2 (switching) starts
        });
      }
    }

    await prisma.priorityHold.createMany({
      data: holds,
      skipDuplicates: true,
    });

    invalidate('registration:terms', 'registration:classes:*');
    res.json({ message: `Seeded ${holds.length} priority holds for the new term.`, count: holds.length });
  } catch (error) {
    next(error);
  }
};

/**
 * Whether `user` may see and act on `studentId`.
 *
 * The two parent-facing routes below take the student from the request rather
 * than from the session — a parent has several children and picks one — so the
 * link between caller and student has to be proven here. Nothing else does it:
 * the routes carry `authenticate` but no `requireRole`, so without this check
 * any signed-in account could register another family's child, take the last
 * seat in a class and post that family's quarterly CHARGE to their ledger.
 *
 * A student matches through their own family row, so self-registration keeps
 * working. Admins are allowed through even though they have their own
 * /admin-register, so submitting on a family's behalf never 403s.
 */
const canActForStudent = async (user, studentId) => {
  if (hasRole(user, 'ADMIN')) return true;

  const link = await prisma.familyMember.findFirst({
    where: {
      userId: studentId,
      family: { members: { some: { userId: user.id } } },
    },
    select: { id: true },
  });
  return !!link;
};

const NOT_YOUR_STUDENT = {
  error: 'Forbidden',
  message: 'You can only register students in your own family.',
};

/**
 * GET /api/registration/status/:studentId
 * Determines which window a student is currently in
 */
export const getRegistrationStatus = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { termId } = req.query;

    if (!(await canActForStudent(req.user, studentId))) {
      return res.status(403).json(NOT_YOUR_STUDENT);
    }

    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });
    const now = new Date();

    // Check if they have a priority hold
    const hold = await prisma.priorityHold.findFirst({
      where: { termId, studentId, status: 'pending' }
    });

    let window = 3; // Default Public
    if (now >= term.window1OpensAt && now < term.window2OpensAt && hold) window = 1;
    else if (now >= term.window2OpensAt && now < term.window3OpensAt) window = 2;
    else if (now >= term.window3OpensAt) window = 3;

    // Check if already registered
    const request = await prisma.registrationRequest.findFirst({
      where: { termId, studentId }
    });

    res.json({
      window,
      hasPriority: !!hold,
      priorityClassId: hold?.classId,
      isRegistered: !!request,
      requestStatus: request?.status,
      termName: term.name
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/request
 * The Core Resolver: Processes 1st/2nd choice registration
 */
export const submitRegistrationRequest = async (req, res, next) => {
  try {
    const { termId, studentId, firstChoiceClassId, secondChoiceClassId, electiveIds = [], ixlPlan = 'NONE' } = req.body;

    if (!(await canActForStudent(req.user, studentId))) {
      return res.status(403).json(NOT_YOUR_STUDENT);
    }

    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });

    // Window guard: registration must be open, and Window 1 requires a priority hold.
    const now = new Date();
    if (now < term.window1OpensAt) {
      return res.status(403).json({ message: 'Registration has not opened yet.' });
    }
    if (now > term.registrationCloses) {
      return res.status(403).json({ message: 'Registration has already closed.' });
    }
    if (now < term.window2OpensAt) {
      // Still in Window 1 — only students with a pending priority hold may register.
      const hold = await prisma.priorityHold.findFirst({
        where: { termId, studentId, status: 'pending' },
      });
      if (!hold) {
        return res.status(403).json({ message: 'Your registration window has not opened yet.' });
      }
    }

    // Prevent duplicate registration requests for the same term.
    const existing = await prisma.registrationRequest.findFirst({ where: { termId, studentId } });
    if (existing) {
      return res.status(409).json({ message: 'This student already has a request for this term.' });
    }

    // 1. Transaction to ensure data integrity during resolution
    const result = await prisma.$transaction(async (tx) => {
      // Lock both candidate classes before reading their capacity — see
      // lockClassRows for why this is required to avoid overbooking.
      await lockClassRows(tx, [firstChoiceClassId, secondChoiceClassId]);

      // Get class capacities
      const firstClass = await tx.class.findUnique({
        where: { id: firstChoiceClassId },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } }
      });

      // Pricing: replicates the Apps Script trigger (base rate + electives + IXL -> 15% deposit)
      const electives = electiveIds.length
        ? await tx.elective.findMany({ where: { id: { in: electiveIds } } })
        : [];
      const billing = calculateRegistrationBilling({ term, groupType: firstClass.groupType, priceOverride: firstClass.priceOverride, electives, ixlPlan });
      const billingData = {
        ixlPlan,
        baseRate: billing.baseRate,
        electivesTotal: billing.electivesTotal,
        ixlTotal: billing.ixlTotal,
        totalQuarterly: billing.totalQuarterly,
        depositAmount: billing.depositAmount,
        depositDueDate: billing.depositDueDate,
        electiveChoices: electiveIds.length ? { create: electiveIds.map(electiveId => ({ electiveId })) } : undefined,
      };

      // Get familyId to post the charge to the global billing ledger
      const familyMember = await tx.familyMember.findFirst({
        where: { userId: studentId },
        select: { familyId: true }
      });
      const familyId = familyMember?.familyId;

      // Only the 15% deposit is charged (and invoiced immediately) at
      // registration — the remaining 85% is raised later by the quarterly
      // billing run, which credits this deposit against Q1 (see
      // buildQuarterCharges's `creditDeposit`). That's also why this charge
      // does NOT carry termId/quarter: doing so would make the quarterly run
      // think Q1 was already fully billed and skip raising the remainder.
      const postCharge = async (className) => {
        if (familyId && billing.depositAmount > 0) {
          await raiseInvoicedCharge(tx, {
            familyId,
            studentId,
            termId,
            amount: billing.depositAmount,
            description: `Registration Deposit (15%) - ${term.name} - ${className}`,
          });
        }
      };

      // 2. Try First Choice
      if (firstClass._count.enrollments < firstClass.maxStudents) {
        // SUCCESS: Enroll in first choice
        await tx.classEnrollment.create({
          data: { classId: firstChoiceClassId, studentId, status: 'active' }
        });
        // Same INACTIVE-parking lift as the admin placement flow — a
        // self-signup account shouldn't stay parked once actually enrolled.
        await tx.user.updateMany({ where: { id: studentId, status: 'INACTIVE' }, data: { status: 'ACTIVE' } });

        const request = await tx.registrationRequest.create({
          data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'enrolled_first', ...billingData }
        });

        // If they had a priority hold, mark it as claimed
        await tx.priorityHold.updateMany({
          where: { termId, studentId, classId: firstChoiceClassId },
          data: { status: 'claimed' }
        });

        await postCharge(firstClass.name);

        return { status: 'enrolled_first', class: firstClass.name, requestId: request.id, className: firstClass.name, electives };
      }

      // 3. First Choice is FULL -> Add to Waitlist
      await tx.waitlistEntry.create({
        data: { classId: firstChoiceClassId, studentId, status: 'waiting' }
      });

      // 4. Try Second Choice if provided
      if (secondChoiceClassId) {
        const secondClass = await tx.class.findUnique({
          where: { id: secondChoiceClassId },
          include: { _count: { select: { enrollments: { where: { status: 'active' } } } } }
        });

        if (secondClass._count.enrollments < secondClass.maxStudents) {
          // SUCCESS: Enroll in second choice while waitlisted for first
          await tx.classEnrollment.create({
            data: { classId: secondChoiceClassId, studentId, status: 'active' }
          });
          await tx.user.updateMany({ where: { id: studentId, status: 'INACTIVE' }, data: { status: 'ACTIVE' } });

          const request = await tx.registrationRequest.create({
            data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'waitlisted_first_enrolled_second', ...billingData }
          });

          await postCharge(secondClass.name);

          return { status: 'waitlisted_first_enrolled_second', first: firstClass.name, second: secondClass.name, requestId: request.id, className: secondClass.name, electives };
        }

        // Second choice also full
        await tx.waitlistEntry.create({
          data: { classId: secondChoiceClassId, studentId, status: 'waiting' }
        });
      }

      const request = await tx.registrationRequest.create({
        data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'waitlisted_both', ...billingData }
      });

      return { status: 'waitlisted_both', first: firstClass.name, requestId: request.id, className: firstClass.name, electives };
    });

    // 2. Fire the billing confirmation email (outside the transaction — a failed send
    // must never roll back an enrollment that already succeeded).
    if (result.requestId) {
      const [student, familyMember] = await Promise.all([
        prisma.user.findUnique({ where: { id: studentId }, select: { fullName: true, email: true } }),
        prisma.familyMember.findFirst({
          where: { userId: studentId },
          select: { family: { select: { members: { where: { isInvoiceRecipient: true }, select: { user: { select: { email: true } } } } } } },
        }),
      ]);
      const recipientEmail = familyMember?.family?.members?.[0]?.user?.email || student?.email;

      const requestRow = await prisma.registrationRequest.findUnique({ where: { id: result.requestId } });
      const emailResult = recipientEmail
        ? await sendRegistrationBillingEmail({
            to: recipientEmail,
            studentName: student?.fullName || 'Student',
            className: result.className,
            electiveNames: result.electives.map(e => e.name),
            request: requestRow,
            term,
          })
        : { ok: false, error: 'No recipient email' };

      await prisma.registrationRequest.update({
        where: { id: result.requestId },
        data: {
          emailStatus: emailResult.ok ? 'SENT' : 'FAILED',
          emailSentAt: emailResult.ok ? new Date() : null,
        },
      });
    }

    res.json({ message: 'Registration request processed.', result });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/parent
 * Consolidated parent view: the open term, each child's window eligibility &
 * status, and the term's coves with live availability. One round-trip, no N+1.
 */
export const getParentRegistration = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // The parent's children = STUDENT members of the parent's families.
    const familyMembers = await prisma.familyMember.findMany({
      where: { userId },
      select: { familyId: true },
    });
    const familyIds = familyMembers.map(f => f.familyId);

    const studentMembers = await prisma.familyMember.findMany({
      where: { familyId: { in: familyIds }, user: { role: 'STUDENT' } },
      select: { user: { select: { id: true, fullName: true } } },
    });
    const students = studentMembers.map(s => s.user);
    const studentIds = students.map(s => s.id);

    // Most relevant registrable term: not yet closed, soonest to open.
    const now = new Date();
    const term = await prisma.registrationTerm.findFirst({
      where: { registrationCloses: { gte: now } },
      orderBy: { window1OpensAt: 'asc' },
    });

    if (!term) return res.json({ term: null, students: [], classes: [], electives: [] });

    const classesRaw = await prisma.class.findMany({
      where: { termId: term.id },
      include: {
        _count: { select: { enrollments: { where: { status: 'active' } } } },
        teacher: { select: { fullName: true } },
      },
    });
    const classes = classesRaw.map(c => ({
      id: c.id,
      name: c.name,
      capacity: c.maxStudents,
      enrolled: c._count.enrollments,
      available: Math.max(0, c.maxStudents - c._count.enrollments),
      teacherName: c.teacher?.fullName || null,
      meetingUrl: c.meetingUrl || '',
      groupType: c.groupType,
    }));

    const electivesRaw = await prisma.elective.findMany({ where: { termId: term.id } });
    const electives = electivesRaw.map(e => ({ id: e.id, name: e.name, price: Number(e.price) }));

    const [holds, requests, enrollments] = await Promise.all([
      prisma.priorityHold.findMany({ where: { termId: term.id, studentId: { in: studentIds }, status: 'pending' } }),
      prisma.registrationRequest.findMany({ where: { termId: term.id, studentId: { in: studentIds } } }),
      prisma.classEnrollment.findMany({
        where: { studentId: { in: studentIds }, status: 'active', class: { termId: term.id } },
        include: { class: { select: { id: true, name: true } } },
      }),
    ]);

    const studentStatus = students.map(s => {
      const hold = holds.find(h => h.studentId === s.id);
      const request = requests.find(r => r.studentId === s.id);
      const myEnrollments = enrollments
        .filter(e => e.studentId === s.id)
        .map(e => ({ classId: e.class.id, className: e.class.name }));

      let window = 3;
      if (now >= term.window1OpensAt && now < term.window2OpensAt && hold) window = 1;
      else if (now >= term.window2OpensAt && now < term.window3OpensAt) window = 2;
      else if (now >= term.window3OpensAt) window = 3;

      // Can this student register right now? Window 1 needs a hold; W2/W3 open to all.
      let windowOpen = false;
      if (now >= term.window1OpensAt && now < term.window2OpensAt) windowOpen = !!hold;
      else if (now >= term.window2OpensAt && now <= term.registrationCloses) windowOpen = true;

      return {
        id: s.id,
        name: s.fullName,
        window,
        windowOpen,
        hasPriority: !!hold,
        priorityClassId: hold?.classId || null,
        priorityClassName: hold ? (classes.find(c => c.id === hold.classId)?.name || null) : null,
        isRegistered: !!request,
        requestStatus: request?.status || null,
        enrollments: myEnrollments,
      };
    });

    res.json({
      term: {
        id: term.id,
        name: term.name,
        window1OpensAt: term.window1OpensAt,
        window2OpensAt: term.window2OpensAt,
        window3OpensAt: term.window3OpensAt,
        registrationCloses: term.registrationCloses,
        now: now.toISOString(),
      },
      students: studentStatus,
      classes,
      electives,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/promote/:classId
 * Manually or automatically trigger waitlist promotion when a seat opens
 */
export const promoteFromWaitlist = async (req, res, next) => {
  try {
    const { classId } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      // Lock the class row so a concurrent registration or a second promote
      // click can't both see the same freed-up spot and double-enroll into it.
      await lockClassRows(tx, [classId]);

      const classInfo = await tx.class.findUnique({
        where: { id: classId },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } }
      });

      if (classInfo._count.enrollments >= classInfo.maxStudents) {
        throw new Error('Class is still full.');
      }

      // Get next in line
      const nextInLine = await tx.waitlistEntry.findFirst({
        where: { classId, status: 'waiting' },
        orderBy: { addedAt: 'asc' },
        include: { request: true }
      });

      if (!nextInLine) return { message: 'Waitlist is empty.' };

      // 1. Enroll in this class
      await tx.classEnrollment.create({
        data: { classId, studentId: nextInLine.studentId, status: 'active' }
      });
      await tx.user.updateMany({ where: { id: nextInLine.studentId, status: 'INACTIVE' }, data: { status: 'ACTIVE' } });

      // 2. Mark waitlist entry as promoted
      await tx.waitlistEntry.update({
        where: { id: nextInLine.id },
        data: { status: 'promoted' }
      });

      // 3. If this was their First Choice, and they were in their Second Choice -> Drop Second Choice
      if (nextInLine.request && nextInLine.request.firstChoiceClassId === classId && nextInLine.request.secondChoiceClassId) {
        await tx.classEnrollment.updateMany({
          where: { 
            classId: nextInLine.request.secondChoiceClassId, 
            studentId: nextInLine.studentId 
          },
          data: { status: 'inactive' }
        });

        // Update request status
        await tx.registrationRequest.update({
          where: { id: nextInLine.request.id },
          data: { status: 'enrolled_first' }
        });

        // Recursively trigger promotion for the second choice class that just lost a student
        // This would be better handled as an event/queue in production, but we can call it here
        // or let the next cron cycle handle it.
      }

      return { message: 'Promotion successful', studentId: nextInLine.studentId, className: classInfo.name };
    });

    // Fire outside the transaction — a failed notification must never roll back the enrollment.
    if (result.studentId) {
      await notifyWaitlistPromotion(result.studentId, result.className, classId);
    }

    invalidate('registration:classes:*');
    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/terms
 * List all registration terms
 */
export const getTerms = async (req, res, next) => {
  try {
    const terms = await prisma.registrationTerm.findMany({
      orderBy: { startDate: 'desc' }
    });
    // Single groupBy instead of one COUNT per term
    const holdCounts = await prisma.priorityHold.groupBy({
      by: ['termId'],
      where: { termId: { in: terms.map(t => t.id) } },
      _count: { id: true },
    });
    const seededTermIds = new Set(holdCounts.map(h => h.termId));
    const termsWithSeedStatus = terms.map(term => ({
      ...term,
      // Ensure Decimal fields are serialised as plain numbers for the client
      regularRate: Number(term.regularRate),
      anchoredRate: Number(term.anchoredRate),
      seeded: seededTermIds.has(term.id),
    }));
    res.json({ terms: termsWithSeedStatus });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/terms/:id/electives
 * Returns all electives for a specific term (used by the Manual Registration UI).
 */
export const getTermElectives = async (req, res, next) => {
  try {
    const { id } = req.params;
    const electives = await prisma.elective.findMany({
      where: { termId: id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, price: true },
    });
    res.json({
      electives: electives.map(e => ({
        id: e.id,
        name: e.name,
        price: Number(e.price),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Name and price for a new or edited elective. The price is charged to a
 * family, so a blank or negative one must not reach the ledger — but an
 * omitted price on create is fine, since Elective.price defaults to 130.
 */
const validateElectiveInput = ({ name, price }, { priceRequired = false } = {}) => {
  if (!name || !String(name).trim()) return 'An elective name is required.';
  const missing = price === undefined || price === null || price === '';
  if (missing) return priceRequired ? 'A price is required.' : null;
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return 'Price must be a non-negative number.';
  return null;
};

// POST /api/registration/terms/:id/electives
export const createElective = async (req, res, next) => {
  try {
    const { name, price } = req.body;
    const problem = validateElectiveInput({ name, price });
    if (problem) return res.status(400).json({ error: 'Validation Error', message: problem });

    // Fails with P2025 -> 404 if the term doesn't exist, rather than leaving an
    // elective pointing at nothing.
    await prisma.registrationTerm.findUniqueOrThrow({ where: { id: req.params.id } });

    const elective = await prisma.elective.create({
      data: {
        termId: req.params.id,
        name: String(name).trim(),
        // Left out, the schema default ($130, one quarter) applies.
        ...(price === undefined || price === null || price === '' ? {} : { price: Number(price) }),
      },
    });

    res.status(201).json({ elective: { id: elective.id, name: elective.name, price: Number(elective.price) } });
  } catch (error) {
    next(error);
  }
};

// PUT /api/registration/electives/:electiveId
export const updateElective = async (req, res, next) => {
  try {
    const { name, price } = req.body;
    const problem = validateElectiveInput({ name: name ?? 'unchanged', price });
    if (problem) return res.status(400).json({ error: 'Validation Error', message: problem });

    const elective = await prisma.elective.update({
      where: { id: req.params.electiveId },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(price === undefined || price === null || price === '' ? {} : { price: Number(price) }),
      },
    });

    res.json({ elective: { id: elective.id, name: elective.name, price: Number(elective.price) } });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/registration/electives/:electiveId
export const deleteElective = async (req, res, next) => {
  try {
    // Families who already chose this elective were billed for it, so removing
    // the row would rewrite what their invoice was made of. Blocked outright:
    // the fix for "we're not offering it any more" is to stop listing it on the
    // next term, not to erase it from the one that was charged.
    const chosen = await prisma.registrationElectiveChoice.count({
      where: { electiveId: req.params.electiveId },
    });
    if (chosen > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: `This elective is already part of ${chosen} registration(s) and can't be deleted. Edit its name or price instead.`,
      });
    }

    await prisma.elective.delete({ where: { id: req.params.electiveId } });
    res.json({ message: 'Elective deleted.' });
  } catch (error) {
    next(error);
  }
};


/**
 * PUT /api/registration/terms/:id
 * Update an existing term
 */
export const updateTerm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses, regularRate, anchoredRate, depositDueDate, quarter2StartsAt } = req.body;

    const orderError = validateWindowOrder({ window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses });
    if (orderError) return res.status(400).json({ message: orderError });

    if (regularRate !== undefined && (isNaN(Number(regularRate)) || Number(regularRate) < 0)) {
      return res.status(400).json({ message: 'regularRate must be a non-negative number.' });
    }
    if (anchoredRate !== undefined && (isNaN(Number(anchoredRate)) || Number(anchoredRate) < 0)) {
      return res.status(400).json({ message: 'anchoredRate must be a non-negative number.' });
    }

    const term = await prisma.registrationTerm.update({
      where: { id },
      data: {
        name,
        window1OpensAt: new Date(window1OpensAt),
        window2OpensAt: new Date(window2OpensAt),
        window3OpensAt: new Date(window3OpensAt),
        registrationCloses: new Date(registrationCloses),
        ...(regularRate !== undefined && { regularRate: Number(regularRate) }),
        ...(anchoredRate !== undefined && { anchoredRate: Number(anchoredRate) }),
        ...(depositDueDate !== undefined && { depositDueDate: depositDueDate ? new Date(depositDueDate) : null }),
        ...(quarter2StartsAt !== undefined && { quarter2StartsAt: quarter2StartsAt ? new Date(quarter2StartsAt) : null }),
      }
    });
    invalidate('registration:terms');
    res.json({ message: 'Term updated', term });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/classes
 * List classes with enrollment counts (Active, Holds, Waitlist)
 */
export const getRegistrationClasses = async (req, res, next) => {
  try {
    const { termId } = req.query;
    const whereClause = termId ? { termId } : {};
    
    const classes = await prisma.class.findMany({
      where: whereClause,
      include: {
        teacher: { select: { id: true, fullName: true } },
        coTeachers: { select: { id: true, fullName: true } },
        _count: {
          select: {
            enrollments: { where: { status: 'active' } },
            priorityHolds: { where: { status: 'pending' } },
            waitlistEntries: { where: { status: 'waiting' } }
          }
        }
      }
    });

    const formattedClasses = classes.map(c => ({
      id: c.id,
      name: c.name,
      capacity: c.maxStudents,
      enrolled: c._count.enrollments,
      holds: c._count.priorityHolds,
      waitlist: c._count.waitlistEntries,
      meetingUrl: c.meetingUrl || '',
      // Who runs it: '' rather than null so the picker's "Unassigned" option
      // matches, and the name so the roster list can show it without a lookup.
      teacherId: c.teacherId || '',
      teacherName: c.teacher?.fullName || null,
      // Everyone else assigned to the class. Ids so the edit form can prefill
      // its picker, names so the roster list can show who else is in the room
      // without a second call.
      coTeacherIds: c.coTeachers.map(t => t.id),
      coTeacherNames: c.coTeachers.map(t => t.fullName),
      groupType: c.groupType || 'REGULAR',  // needed by billing preview
      // Also for the preview: when set, this is the price, not the term rate.
      // Number() so the client compares an amount rather than Prisma's Decimal.
      priceOverride: c.priceOverride === null ? null : Number(c.priceOverride),
    }));


    res.json({ classes: formattedClasses });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/classes/:id/roster
 * Get active enrollments, priority holds, and waitlist for a specific class
 */
export const getClassRoster = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const active = await prisma.classEnrollment.findMany({
      where: { classId: id, status: 'active' },
      include: { student: true }
    });
    
    const holds = await prisma.priorityHold.findMany({
      where: { classId: id, status: 'pending' },
      include: { student: true }
    });
    
    const waitlist = await prisma.waitlistEntry.findMany({
      where: { classId: id, status: 'waiting' },
      orderBy: { addedAt: 'asc' },
      include: { student: true }
    });

    res.json({
      active: active.map(a => ({ id: a.student.id, name: a.student.fullName, status: 'Active', date: a.enrolledAt })),
      holds: holds.map(h => ({ id: h.student.id, name: h.student.fullName, status: 'Priority Hold', expires: h.expiresAt })),
      waitlist: waitlist.map(w => ({ id: w.student.id, name: w.student.fullName, status: 'Waitlisted', requestedAt: w.addedAt }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/registration/holds/:id
 * Revoke a priority hold for a student. The ID passed is the studentId, requires classId in query.
 */
export const revokeHold = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { classId } = req.query;
    
    if (!classId) return res.status(400).json({ message: 'classId is required' });

    await prisma.priorityHold.deleteMany({
      where: { studentId: id, classId, status: 'pending' }
    });

    invalidate('registration:classes:*');
    res.json({ message: 'Hold revoked' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/classes/:id/roster/:studentId/move
 * Pull a student out of a class's active roster and drop them into either the
 * priority-hold queue or the waitlist for the same class — for a seat that was
 * confirmed by mistake and needs to go back through the normal claim/queue flow
 * instead of being enrolled outright.
 */
export const moveRosterStudent = async (req, res, next) => {
  try {
    const { id: classId, studentId } = req.params;
    const { destination } = req.body; // 'hold' | 'waitlist'

    if (!['hold', 'waitlist'].includes(destination)) {
      return res.status(400).json({ message: "destination must be 'hold' or 'waitlist'." });
    }

    const classInfo = await prisma.class.findUniqueOrThrow({
      where: { id: classId },
      include: { term: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.classEnrollment.updateMany({
        where: { classId, studentId, status: 'active' },
        data: { status: 'inactive' },
      });

      if (destination === 'hold') {
        await tx.priorityHold.upsert({
          where: { termId_studentId_classId: { termId: classInfo.termId, studentId, classId } },
          update: { status: 'pending', expiresAt: classInfo.term.window2OpensAt },
          create: { termId: classInfo.termId, studentId, classId, expiresAt: classInfo.term.window2OpensAt },
        });
      } else {
        await tx.waitlistEntry.upsert({
          where: { classId_studentId: { classId, studentId } },
          update: { status: 'waiting', addedAt: new Date() },
          create: { classId, studentId, status: 'waiting' },
        });
      }
    });

    invalidate('registration:classes:*');
    res.json({ message: destination === 'hold' ? 'Student moved to priority holds.' : 'Student moved to the waitlist.' });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/registration/waitlist/:studentId?classId=
 * Remove a student from a class's waitlist — for an entry added by mistake,
 * mirrors revokeHold below for priority holds.
 */
export const removeFromWaitlist = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { classId } = req.query;

    if (!classId) return res.status(400).json({ message: 'classId is required' });

    await prisma.waitlistEntry.deleteMany({
      where: { studentId, classId, status: 'waiting' },
    });

    invalidate('registration:classes:*');
    res.json({ message: 'Removed from waitlist' });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/registration/requests/:id
 * Undoes a registration outright (Admin only).
 *
 * Until now a completed registration was the one thing with no way back:
 * applications can be declined and waitlist entries removed, but once someone
 * reached `enrolled_first` the seat, the charge and the row were permanent. A
 * test entry or a child registered into the wrong class had to be fixed in the
 * database by hand.
 *
 * Reverses the whole thing in one transaction — the seat, the waitlist entries,
 * the elective choices, the request itself, and the tuition charge it raised.
 *
 * The charge is only removed when nothing depends on it, by the same rule as
 * DELETE /billing/transactions/:id: an invoiced or paid charge is money that
 * has already been communicated or collected, and the correction for that is a
 * credit or a refund, not deleting the record. That case is reported back
 * rather than silently skipped, so the admin knows there is still money to
 * settle.
 */
export const cancelRegistrationRequest = async (req, res, next) => {
  try {
    const request = await prisma.registrationRequest.findUnique({
      where: { id: req.params.id },
      include: {
        student: { select: { id: true, fullName: true } },
        firstChoice: { select: { id: true, name: true } },
        secondChoice: { select: { id: true } },
      },
    });
    if (!request) {
      return res.status(404).json({ error: 'Not Found', message: 'That registration no longer exists.' });
    }

    // Only the deposit charge this registration raised: it carries this term's
    // id but no quarter (quarter is only ever set by the quarterly billing
    // run), so a recurring charge, a manually added fee, or an already-raised
    // Q1/Q2 tuition charge for the same student is never swept up by
    // cancelling a registration.
    const charges = await prisma.transaction.findMany({
      where: { studentId: request.studentId, termId: request.termId, quarter: null, type: 'CHARGE' },
      select: { id: true, amount: true, invoiceId: true, paymentId: true },
    });
    const removable = charges.filter((c) => !c.invoiceId && !c.paymentId);
    const locked = charges.filter((c) => c.invoiceId || c.paymentId);

    const classIds = [request.firstChoiceClassId, request.secondChoiceClassId].filter(Boolean);

    await prisma.$transaction(async (tx) => {
      // Seats first, so the class is free again even if a later step is what
      // the admin ends up retrying.
      await tx.classEnrollment.deleteMany({
        where: { studentId: request.studentId, classId: { in: classIds } },
      });
      await tx.waitlistEntry.deleteMany({
        where: { OR: [{ requestId: request.id }, { studentId: request.studentId, classId: { in: classIds } }] },
      });
      await tx.registrationElectiveChoice.deleteMany({ where: { requestId: request.id } });

      if (removable.length) {
        await tx.transaction.deleteMany({ where: { id: { in: removable.map((c) => c.id) } } });
      }

      await tx.registrationRequest.delete({ where: { id: request.id } });
    });

    invalidate('registration:classes:*');

    // No audit table for registrations exists yet, so the server log is the
    // only trace of who cancelled what.
    console.log(`[Registration] ${req.user.email} cancelled ${request.student.fullName}'s registration for "${request.firstChoice.name}" (removed ${removable.length} charge(s), ${locked.length} left in place)`);

    // Says what actually happened rather than what usually happens: claiming a
    // charge was removed when the ledger had none is how an admin ends up
    // hunting for money that was never there.
    let message = 'Registration cancelled.';
    if (locked.length) {
      message += ` ${locked.length} charge(s) stayed on the ledger because they are already invoiced or paid — issue a credit or refund for those.`;
    } else if (removable.length) {
      message += ` Its ${removable.length === 1 ? 'charge was' : `${removable.length} charges were`} removed from the family's ledger.`;
    } else {
      message += ' There was no charge on the ledger to remove.';
    }

    res.json({ message, chargesRemoved: removable.length, chargesLeft: locked.length });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/quarter-charges?termId=&quarter=&creditDeposit=
 * What each enrolled student would be charged for this quarter. Read-only —
 * this is the sheet an admin checks before any money is committed.
 */
export const previewQuarterCharges = async (req, res, next) => {
  try {
    const { termId, quarter, creditDeposit } = req.query;
    if (!termId) return res.status(400).json({ message: 'termId is required.' });

    const q = Number(quarter);
    if (![1, 2].includes(q)) return res.status(400).json({ message: 'quarter must be 1 or 2.' });

    const preview = await buildQuarterCharges(termId, q, { creditDeposit: creditDeposit !== 'false' });
    res.json(preview);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/quarter-charges
 * Body: { termId, quarter, creditDeposit? }
 * Raises the quarter's tuition as Transactions, which is what the existing
 * invoicing screen bundles into an invoice.
 *
 * Recomputed here rather than trusting amounts posted by the client: the
 * browser must not be able to name the price. Re-running is safe — the unique
 * index on (studentId, termId, quarter) refuses a second charge for the same
 * quarter, so a double click or a retry after a timeout can't bill twice.
 */
export const generateQuarterCharges = async (req, res, next) => {
  try {
    const { termId, quarter, creditDeposit = true } = req.body;
    if (!termId) return res.status(400).json({ message: 'termId is required.' });

    const q = Number(quarter);
    if (![1, 2].includes(q)) return res.status(400).json({ message: 'quarter must be 1 or 2.' });

    const { term, lines } = await buildQuarterCharges(termId, q, { creditDeposit: !!creditDeposit });
    const billable = lines.filter(l => !l.alreadyCharged && !l.missingFamily && l.amount > 0);

    if (billable.length === 0) {
      return res.json({ message: 'Nothing to charge — every enrolled student is already billed for this quarter.', created: 0 });
    }

    const created = await prisma.transaction.createMany({
      data: billable.map(l => ({
        studentId: l.studentId,
        familyId: l.familyId,
        amount: l.amount,
        type: 'CHARGE',
        description: `${term.name} — Quarter ${q} tuition`,
        termId,
        quarter: q,
      })),
      // Belt and braces alongside the unique index: a concurrent second run
      // skips what it finds rather than failing the whole batch.
      skipDuplicates: true,
    });

    const skipped = lines.length - billable.length;
    res.json({
      message: `Raised ${created.count} charge${created.count === 1 ? '' : 's'} for Quarter ${q}.`,
      created: created.count,
      skipped,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/classes/:id/holds/sweep
 * Revoke all expired/unclaimed holds for a class
 */
export const sweepHolds = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.priorityHold.deleteMany({
      where: { classId: id, status: 'pending' }
    });
    invalidate('registration:classes:*');
    res.json({ message: 'All pending holds swept' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/classes/:id/holds/remind
 * Queue reminders for unclaimed holds
 */
export const remindHolds = async (req, res, next) => {
  try {
    const { id } = req.params; // classId

    const holds = await prisma.priorityHold.findMany({
      where: { classId: id, status: 'pending' },
      include: { class: { select: { name: true } } },
    });

    if (holds.length === 0) {
      return res.json({ message: 'No pending holds to remind.' });
    }

    // One reminder per student per day (dedupKey includes the date) so an admin
    // can nudge again tomorrow without spamming the same day.
    const today = new Date().toISOString().slice(0, 10);
    await Promise.all(holds.map(h => sendNotification({
      userId: h.studentId,
      type: 'REGISTRATION_HOLD_REMINDER',
      title: 'Reserve your guaranteed spot',
      message: `Your priority spot in ${h.class?.name || 'your class'} is still open. Complete registration before the early window closes to keep it.`,
      referenceType: 'class',
      referenceId: id,
      dedupKey: `hold_reminder_${h.studentId}_${id}_${today}`,
    })));

    res.json({ message: `Sent ${holds.length} reminder${holds.length === 1 ? '' : 's'}.` });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/billing-summary?termId=
 * Admin view of the calculated billing + email status per registration request,
 * replacing the Google Sheet columns AC/AD/AE.
 */
export const getBillingSummary = async (req, res, next) => {
  try {
    const { termId } = req.query;
    const requests = await prisma.registrationRequest.findMany({
      where: termId ? { termId } : {},
      orderBy: { submittedAt: 'desc' },
      include: {
        student: { select: { fullName: true, email: true } },
        firstChoice: { select: { name: true, groupType: true } },
        electiveChoices: { include: { elective: { select: { name: true } } } },
      },
    });

    res.json({
      requests: requests.map(r => ({
        id: r.id,
        studentName: r.student.fullName,
        studentEmail: r.student.email,
        className: r.firstChoice.name,
        groupType: r.firstChoice.groupType,
        status: r.status,
        ixlPlan: r.ixlPlan,
        electiveNames: r.electiveChoices.map(c => c.elective.name),
        baseRate: Number(r.baseRate),
        electivesTotal: Number(r.electivesTotal),
        ixlTotal: Number(r.ixlTotal),
        totalQuarterly: Number(r.totalQuarterly),
        depositAmount: Number(r.depositAmount),
        depositDueDate: r.depositDueDate,
        emailStatus: r.emailStatus,
        emailSentAt: r.emailSentAt,
        submittedAt: r.submittedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/applications?status=PENDING
 * The self-signup review queue (see POST /api/auth/signup).
 *
 * Every row is one child a family registered itself with. Those children are
 * parked INACTIVE and appear on no roster, no invoice and no payroll run, so
 * until staff act on the application this list is the only place they exist.
 */
export const getEnrollmentApplications = async (req, res, next) => {
  try {
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const where = status === 'ALL' ? {} : { status };

    const [applications, byStatus] = await Promise.all([
      prisma.enrollmentApplication.findMany({
        where,
        // Oldest first — this is a queue to work through, not a feed to read.
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          student: {
            select: {
              id: true, fullName: true, age: true, status: true,
              allergies: true, medicalNotes: true,
              enrollments: {
                where: { status: 'active' },
                select: { class: { select: { name: true } } },
              },
            },
          },
          family: { select: { id: true, name: true } },
          submittedBy: { select: { id: true, fullName: true, email: true, phone: true } },
          reviewedBy: { select: { fullName: true } },
        },
      }),
      prisma.enrollmentApplication.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    res.json({
      applications: applications.map(a => ({
        id: a.id,
        status: a.status,
        createdAt: a.createdAt,
        interests: a.interests,
        ixlPlan: a.ixlPlan,
        scholarship: a.scholarship,
        parentNotes: a.parentNotes,
        staffNotes: a.staffNotes,
        reviewedAt: a.reviewedAt,
        reviewedByName: a.reviewedBy?.fullName || null,
        family: a.family,
        parent: a.submittedBy,
        student: {
          id: a.student.id,
          fullName: a.student.fullName,
          age: a.student.age,
          status: a.student.status,
          allergies: a.student.allergies,
          medicalNotes: a.student.medicalNotes,
          // A pending application whose child is already on a roster means the
          // child was placed through the plain manual flow; staff need to see
          // that before they place them a second time.
          enrolledClassNames: a.student.enrollments.map(e => e.class.name),
        },
      })),
      counts: byStatus.reduce((acc, row) => ({ ...acc, [row.status]: row._count._all }), {}),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/applications/:id/decline
 * Closes an application without placing the child.
 *
 * There is nothing to undo: the student row was already INACTIVE and stays
 * that way, so this only records a decision (and stops the row nagging from
 * the queue). Approval is not a button — it happens when the child is actually
 * placed in a class, via POST /admin-register with this application's id.
 */
export const declineApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { staffNotes } = req.body || {};

    const application = await prisma.enrollmentApplication.findUnique({ where: { id } });
    if (!application) {
      return res.status(404).json({ message: 'Application not found.' });
    }
    if (application.status !== 'PENDING') {
      return res.status(409).json({ message: `This application was already ${application.status.toLowerCase()}.` });
    }

    await prisma.enrollmentApplication.update({
      where: { id },
      data: {
        status: 'DECLINED',
        staffNotes: staffNotes?.trim() || null,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });

    res.json({ message: 'Application declined.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/requests/:id/resend-email
 * Manually retries the billing confirmation email for one request.
 */
export const resendBillingEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Optional overrides from the admin's review-before-sending modal; without
    // them the service falls back to the standard wording.
    const { subject, message } = req.body || {};
    const request = await prisma.registrationRequest.findUniqueOrThrow({
      where: { id },
      include: {
        student: { select: { fullName: true, email: true } },
        firstChoice: { select: { name: true } },
        term: true,
        electiveChoices: { include: { elective: { select: { name: true } } } },
      },
    });

    const familyMember = await prisma.familyMember.findFirst({
      where: { userId: request.studentId },
      select: { family: { select: { members: { where: { isInvoiceRecipient: true }, select: { user: { select: { email: true } } } } } } },
    });
    const recipientEmail = familyMember?.family?.members?.[0]?.user?.email || request.student.email;

    const emailResult = await sendRegistrationBillingEmail({
      to: recipientEmail,
      studentName: request.student.fullName,
      className: request.firstChoice.name,
      electiveNames: request.electiveChoices.map(c => c.elective.name),
      request,
      term: request.term,
      subject,
      message,
    });

    await prisma.registrationRequest.update({
      where: { id },
      data: {
        emailStatus: emailResult.ok ? 'SENT' : 'FAILED',
        emailSentAt: emailResult.ok ? new Date() : null,
      },
    });

    if (!emailResult.ok) {
      return res.status(502).json({ message: `Could not send the email: ${emailResult.error}` });
    }
    res.json({ message: 'Email resent.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/registration/admin-register
 * Admin-only: register any student on behalf of a parent, bypassing all
 * registration window restrictions. Runs through the same pricing calculator
 * and billing email logic as the self-service parent flow.
 *
 * Optionally carries an `applicationId`: this is how a self-signup application
 * gets approved. Placing the child *is* the approval — there is no separate
 * button — because that is the moment the child stops being a form submission
 * and starts appearing on rosters, invoices and payroll.
 *
 * `classIds` replaces the old single `firstChoiceClassId` — a family's
 * application can ask for several modalities at once (a homeschool cove AND a
 * group class AND 1-on-1 tutoring), and placing them used to mean running this
 * endpoint could seat exactly one. Every class in the array is enrolled if it
 * has room or waitlisted if it doesn't, and each is billed at its own rate —
 * three classes cost three seats, not one. `firstChoiceClassId` is still
 * accepted as a single-class shorthand so nothing else calling this breaks.
 *
 * `secondChoiceClassId` only means something when exactly one class is
 * requested: a backup to try if that one class is full. Once more than one
 * class is deliberately chosen there is nothing to "fall back" to — each is
 * either enrolled or waitlisted on its own.
 */
export const adminRegisterStudent = async (req, res, next) => {
  try {
    const {
      termId,
      studentId,
      classIds: rawClassIds,
      firstChoiceClassId,
      secondChoiceClassId,
      electiveIds = [],
      ixlPlan = 'NONE',
      skipEmail = false,
      applicationId = null,
      // Optional overrides from the admin's review-before-sending modal.
      emailSubject,
      emailMessage,
    } = req.body;

    const classIds = [...new Set(
      (Array.isArray(rawClassIds) && rawClassIds.length ? rawClassIds : [firstChoiceClassId]).filter(Boolean)
    )];

    if (!termId || !studentId || classIds.length === 0) {
      return res.status(400).json({ message: 'termId, studentId y al menos una clase son requeridos.' });
    }

    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });

    // Prevent duplicate registrations
    const existing = await prisma.registrationRequest.findFirst({ where: { termId, studentId } });
    if (existing) {
      return res.status(409).json({ message: 'This student already has a request for this term.' });
    }

    if (applicationId) {
      const application = await prisma.enrollmentApplication.findUnique({ where: { id: applicationId } });
      if (!application) {
        return res.status(404).json({ message: 'Application not found.' });
      }
      // A mismatch means the admin changed the student after opening the
      // application, so approving this row would credit the wrong child.
      if (application.studentId !== studentId) {
        return res.status(400).json({ message: 'This application belongs to a different student.' });
      }
      if (application.status !== 'PENDING') {
        return res.status(409).json({ message: `This application was already ${application.status.toLowerCase()}.` });
      }
    }

    // Only a single class can fall back to a second choice — see the doc
    // comment above.
    const usesSecondChoiceFallback = classIds.length === 1 && Boolean(secondChoiceClassId);

    const result = await prisma.$transaction(async (tx) => {
      // Lock every candidate class before reading capacity — see lockClassRows
      // for why this is required to avoid overbooking.
      await lockClassRows(tx, usesSecondChoiceFallback ? [...classIds, secondChoiceClassId] : classIds);

      const classRows = await tx.class.findMany({
        where: { id: { in: classIds } },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } },
      });
      if (classRows.length !== classIds.length) {
        return { error: { status: 404, message: 'One of the selected classes no longer exists.' } };
      }
      // The admin's chosen order, not whatever order the DB returned rows in —
      // it is what the "first" class means for the legacy fallback path below.
      const classById = new Map(classRows.map((c) => [c.id, c]));
      const orderedClasses = classIds.map((id) => classById.get(id));
      const firstClass = orderedClasses[0];

      const electives = electiveIds.length
        ? await tx.elective.findMany({ where: { id: { in: electiveIds } } })
        : [];

      // Each class prices itself off the term/groupType or its own override;
      // summed, because a family enrolling in three classes owes three seats,
      // not one. Electives and IXL are chosen once for the whole placement,
      // not once per class, so they ride into the combined total via
      // priceOverride rather than being recalculated for every class.
      const classesBaseTotal = orderedClasses.reduce(
        (sum, cls) => sum + calculateRegistrationBilling({ term, groupType: cls.groupType, priceOverride: cls.priceOverride }).baseRate,
        0
      );
      const billing = calculateRegistrationBilling({ term, priceOverride: classesBaseTotal, electives, ixlPlan });
      const billingData = {
        ixlPlan,
        baseRate: billing.baseRate,
        electivesTotal: billing.electivesTotal,
        ixlTotal: billing.ixlTotal,
        totalQuarterly: billing.totalQuarterly,
        depositAmount: billing.depositAmount,
        depositDueDate: billing.depositDueDate,
        electiveChoices: electiveIds.length ? { create: electiveIds.map(electiveId => ({ electiveId })) } : undefined,
      };

      const familyMember = await tx.familyMember.findFirst({
        where: { userId: studentId },
        select: { familyId: true }
      });
      const familyId = familyMember?.familyId;

      // Whatever the outcome below — a seat or a waitlist place — staff have
      // decided this child attends, so the application is settled here and the
      // INACTIVE parking status a self-signup leaves behind is lifted. Scoped
      // to INACTIVE so this can never revive a SUSPENDED student by accident.
      if (applicationId) {
        await tx.enrollmentApplication.update({
          where: { id: applicationId },
          data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
        });
      }
      await tx.user.updateMany({
        where: { id: studentId, status: 'INACTIVE' },
        data: { status: 'ACTIVE' },
      });

      // `markQuarter` tags the row as the student's Q1 charge for this term, so
      // Only the 15% deposit is charged (and invoiced immediately) here — the
      // remaining 85% is raised later by the quarterly billing run, which
      // credits this deposit against Q1 (see buildQuarterCharges's
      // `creditDeposit`). So this charge deliberately does NOT carry
      // termId/quarter: doing so would make the quarterly run think Q1 was
      // already fully billed and skip raising the remainder.
      const postCharge = async (amount, className) => {
        const depositAmount = round2(amount * DEPOSIT_RATE);
        if (familyId && depositAmount > 0) {
          await raiseInvoicedCharge(tx, {
            familyId,
            studentId,
            termId,
            amount: depositAmount,
            description: `Registration Deposit (15%) - ${term.name} - ${className}`,
          });
        }
      };

      if (!usesSecondChoiceFallback) {
        // ── One or more deliberately-chosen classes — each stands on its own. ──
        const outcomes = [];
        for (const cls of orderedClasses) {
          if (cls._count.enrollments < cls.maxStudents) {
            await tx.classEnrollment.create({ data: { classId: cls.id, studentId, status: 'active' } });
            outcomes.push({ class: cls, enrolled: true });
          } else {
            await tx.waitlistEntry.create({ data: { classId: cls.id, studentId, status: 'waiting' } });
            outcomes.push({ class: cls, enrolled: false });
          }
        }

        const enrolledCount = outcomes.filter((o) => o.enrolled).length;
        const status = enrolledCount === 0
          ? (outcomes.length === 1 ? 'waitlisted_both' : 'waitlisted_all')
          : enrolledCount === outcomes.length
            ? (outcomes.length === 1 ? 'enrolled_first' : 'enrolled_all')
            : 'enrolled_partial';

        const request = await tx.registrationRequest.create({
          data: { termId, studentId, firstChoiceClassId: firstClass.id, secondChoiceClassId: null, status, ...billingData },
        });

        // A charge per seat actually taken — a waitlisted class costs nothing
        // until a seat opens. Electives/IXL are billed once, alongside the
        // first seat that clears, so waitlisting everything charges nothing
        // at all, matching how a single fully-waitlisted request already works.
        let extrasCharged = false;
        for (const o of outcomes) {
          if (!o.enrolled) continue;
          const classRate = calculateRegistrationBilling({ term, groupType: o.class.groupType, priceOverride: o.class.priceOverride }).baseRate;
          const extras = extrasCharged ? 0 : billing.electivesTotal + billing.ixlTotal;
          extrasCharged = true;
          await postCharge(classRate + extras, o.class.name);
        }

        return { status, requestId: request.id, className: outcomes.map((o) => o.class.name).join(', '), electives };
      }

      // ── Legacy path: exactly one chosen class with an explicit backup ──
      if (firstClass._count.enrollments < firstClass.maxStudents) {
        await tx.classEnrollment.create({ data: { classId: firstClass.id, studentId, status: 'active' } });
        const request = await tx.registrationRequest.create({
          data: { termId, studentId, firstChoiceClassId: firstClass.id, secondChoiceClassId, status: 'enrolled_first', ...billingData },
        });
        await postCharge(billing.totalQuarterly, firstClass.name);
        return { status: 'enrolled_first', requestId: request.id, className: firstClass.name, electives };
      }

      // First choice full — add to waitlist
      await tx.waitlistEntry.create({ data: { classId: firstClass.id, studentId, status: 'waiting' } });

      const secondClass = await tx.class.findUniqueOrThrow({
        where: { id: secondChoiceClassId },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } },
      });
      if (secondClass._count.enrollments < secondClass.maxStudents) {
        await tx.classEnrollment.create({ data: { classId: secondChoiceClassId, studentId, status: 'active' } });
        const request = await tx.registrationRequest.create({
          data: { termId, studentId, firstChoiceClassId: firstClass.id, secondChoiceClassId, status: 'waitlisted_first_enrolled_second', ...billingData },
        });
        await postCharge(billing.totalQuarterly, secondClass.name);
        return { status: 'waitlisted_first_enrolled_second', requestId: request.id, className: secondClass.name, electives };
      }
      await tx.waitlistEntry.create({ data: { classId: secondChoiceClassId, studentId, status: 'waiting' } });

      const request = await tx.registrationRequest.create({
        data: { termId, studentId, firstChoiceClassId: firstClass.id, secondChoiceClassId, status: 'waitlisted_both', ...billingData },
      });
      return { status: 'waitlisted_both', requestId: request.id, className: firstClass.name, electives };
    });

    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }

    // The roster counts this UI shows are cached for a minute; a seat that just
    // filled must not keep reading as free to the admin who filled it.
    invalidate('registration:classes:*');

    // Fire billing email (outside transaction — a failed send never rolls back the enrollment)
    let emailResult = { ok: false, error: 'skipped' };
    if (!skipEmail && result.requestId) {
      const [student, familyMember] = await Promise.all([
        prisma.user.findUnique({ where: { id: studentId }, select: { fullName: true, email: true } }),
        prisma.familyMember.findFirst({
          where: { userId: studentId },
          select: { family: { select: { members: { where: { isInvoiceRecipient: true }, select: { user: { select: { email: true } } } } } } },
        }),
      ]);
      const recipientEmail = familyMember?.family?.members?.[0]?.user?.email || student?.email;
      const requestRow = await prisma.registrationRequest.findUnique({ where: { id: result.requestId } });

      emailResult = recipientEmail
        ? await sendRegistrationBillingEmail({
            to: recipientEmail,
            studentName: student?.fullName || 'Student',
            className: result.className,
            electiveNames: result.electives.map(e => e.name),
            request: requestRow,
            term,
            subject: emailSubject,
            message: emailMessage,
          })
        : { ok: false, error: 'No hay correo de destinatario' };

      await prisma.registrationRequest.update({
        where: { id: result.requestId },
        data: {
          emailStatus: emailResult.ok ? 'SENT' : 'FAILED',
          emailSentAt: emailResult.ok ? new Date() : null,
        },
      });
    }

    res.status(201).json({
      message: 'Registro completado por el administrador.',
      result,
      emailSent: emailResult.ok,
    });
  } catch (error) {
    next(error);
  }
};

