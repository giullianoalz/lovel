import prisma from '../config/database.js';
import { sleep } from '../utils/helpers.js';
import { invalidate } from '../middleware/cache.js';
import { calculateRegistrationBilling } from '../services/registrationPricing.service.js';
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
 * POST /api/registration/terms
 * Create a new Term and auto-seed Priority Holds for existing students
 */
export const createTerm = async (req, res, next) => {
  try {
    const { name, startDate, endDate, window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses } = req.body;

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
    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });

    // Find all active enrollments from classes NOT in this new term (current rosters)
    const currentEnrollments = await prisma.classEnrollment.findMany({
      where: { status: 'active' },
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

    invalidate('registration:terms');
    res.json({ message: `Seeded ${holds.length} priority holds for the new term.`, count: holds.length });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/registration/status/:studentId
 * Determines which window a student is currently in
 */
export const getRegistrationStatus = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { termId } = req.query;

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
      
      // Get class capacities
      const firstClass = await tx.class.findUnique({
        where: { id: firstChoiceClassId },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } }
      });

      // Pricing: replicates the Apps Script trigger (base rate + electives + IXL -> 15% deposit)
      const electives = electiveIds.length
        ? await tx.elective.findMany({ where: { id: { in: electiveIds } } })
        : [];
      const billing = calculateRegistrationBilling({ term, groupType: firstClass.groupType, electives, ixlPlan });
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

      const postCharge = async (className) => {
        if (familyId && billing.totalQuarterly > 0) {
          await tx.transaction.create({
            data: {
              familyId,
              studentId,
              amount: billing.totalQuarterly,
              type: 'CHARGE',
              description: `Registration - ${term.name} - ${className}`
            }
          });
        }
      };

      // 2. Try First Choice
      if (firstClass._count.enrollments < firstClass.maxStudents) {
        // SUCCESS: Enroll in first choice
        await tx.classEnrollment.create({
          data: { classId: firstChoiceClassId, studentId, status: 'active' }
        });

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
 * status, and the term's pods with live availability. One round-trip, no N+1.
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
 * PUT /api/registration/terms/:id
 * Update an existing term
 */
export const updateTerm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, window1OpensAt, window2OpensAt, window3OpensAt, registrationCloses } = req.body;
    const term = await prisma.registrationTerm.update({
      where: { id },
      data: {
        name,
        window1OpensAt: new Date(window1OpensAt),
        window2OpensAt: new Date(window2OpensAt),
        window3OpensAt: new Date(window3OpensAt),
        registrationCloses: new Date(registrationCloses)
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
      groupType: c.groupType || 'REGULAR',  // needed by billing preview
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
    
    res.json({ message: 'Hold revoked' });
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
    res.json({ message: 'Reminders queued' });
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
 * POST /api/registration/requests/:id/resend-email
 * Manually retries the billing confirmation email for one request.
 */
export const resendBillingEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
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
 */
export const adminRegisterStudent = async (req, res, next) => {
  try {
    const {
      termId,
      studentId,
      firstChoiceClassId,
      secondChoiceClassId,
      electiveIds = [],
      ixlPlan = 'NONE',
      skipEmail = false,
    } = req.body;

    if (!termId || !studentId || !firstChoiceClassId) {
      return res.status(400).json({ message: 'termId, studentId y firstChoiceClassId son requeridos.' });
    }

    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });

    // Prevent duplicate registrations
    const existing = await prisma.registrationRequest.findFirst({ where: { termId, studentId } });
    if (existing) {
      return res.status(409).json({ message: 'This student already has a request for this term.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const firstClass = await tx.class.findUniqueOrThrow({
        where: { id: firstChoiceClassId },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } },
      });

      const electives = electiveIds.length
        ? await tx.elective.findMany({ where: { id: { in: electiveIds } } })
        : [];

      const billing = calculateRegistrationBilling({ term, groupType: firstClass.groupType, electives, ixlPlan });
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

      const postCharge = async (className) => {
        if (familyId && billing.totalQuarterly > 0) {
          await tx.transaction.create({
            data: {
              familyId,
              studentId,
              amount: billing.totalQuarterly,
              type: 'CHARGE',
              description: `Admin Registration - ${term.name} - ${className}`
            }
          });
        }
      };

      // Try first choice
      if (firstClass._count.enrollments < firstClass.maxStudents) {
        await tx.classEnrollment.create({ data: { classId: firstChoiceClassId, studentId, status: 'active' } });
        const request = await tx.registrationRequest.create({
          data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'enrolled_first', ...billingData },
        });
        await postCharge(firstClass.name);
        return { status: 'enrolled_first', requestId: request.id, className: firstClass.name, electives };
      }

      // First choice full — add to waitlist
      await tx.waitlistEntry.create({ data: { classId: firstChoiceClassId, studentId, status: 'waiting' } });

      if (secondChoiceClassId) {
        const secondClass = await tx.class.findUniqueOrThrow({
          where: { id: secondChoiceClassId },
          include: { _count: { select: { enrollments: { where: { status: 'active' } } } } },
        });
        if (secondClass._count.enrollments < secondClass.maxStudents) {
          await tx.classEnrollment.create({ data: { classId: secondChoiceClassId, studentId, status: 'active' } });
          const request = await tx.registrationRequest.create({
            data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'waitlisted_first_enrolled_second', ...billingData },
          });
          await postCharge(secondClass.name);
          return { status: 'waitlisted_first_enrolled_second', requestId: request.id, className: secondClass.name, electives };
        }
        await tx.waitlistEntry.create({ data: { classId: secondChoiceClassId, studentId, status: 'waiting' } });
      }

      const request = await tx.registrationRequest.create({
        data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'waitlisted_both', ...billingData },
      });
      return { status: 'waitlisted_both', requestId: request.id, className: firstClass.name, electives };
    });

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

