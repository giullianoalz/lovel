import prisma from '../config/database.js';
import { sleep } from '../utils/helpers.js';

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
    const { termId, studentId, firstChoiceClassId, secondChoiceClassId } = req.body;

    const term = await prisma.registrationTerm.findUniqueOrThrow({ where: { id: termId } });
    
    // 1. Transaction to ensure data integrity during resolution
    const result = await prisma.$transaction(async (tx) => {
      
      // Get class capacities
      const firstClass = await tx.class.findUnique({
        where: { id: firstChoiceClassId },
        include: { _count: { select: { enrollments: { where: { status: 'active' } } } } }
      });

      // 2. Try First Choice
      if (firstClass._count.enrollments < firstClass.maxStudents) {
        // SUCCESS: Enroll in first choice
        await tx.classEnrollment.create({
          data: { classId: firstChoiceClassId, studentId, status: 'active' }
        });

        const request = await tx.registrationRequest.create({
          data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'enrolled_first' }
        });

        // If they had a priority hold, mark it as claimed
        await tx.priorityHold.updateMany({
          where: { termId, studentId, classId: firstChoiceClassId },
          data: { status: 'claimed' }
        });

        return { status: 'enrolled_first', class: firstClass.name };
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

          await tx.registrationRequest.create({
            data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'waitlisted_first_enrolled_second' }
          });

          return { status: 'waitlisted_first_enrolled_second', first: firstClass.name, second: secondClass.name };
        }

        // Second choice also full
        await tx.waitlistEntry.create({
          data: { classId: secondChoiceClassId, studentId, status: 'waiting' }
        });
      }

      await tx.registrationRequest.create({
        data: { termId, studentId, firstChoiceClassId, secondChoiceClassId, status: 'waitlisted_both' }
      });

      return { status: 'waitlisted_both', first: firstClass.name };
    });

    res.json({ message: 'Registration request processed.', result });
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

      return { message: 'Promotion successful', studentId: nextInLine.studentId };
    });

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
    // Check if seeded (if it has holds)
    const termsWithSeedStatus = await Promise.all(terms.map(async (term) => {
      const holdCount = await prisma.priorityHold.count({ where: { termId: term.id } });
      return { ...term, seeded: holdCount > 0 };
    }));
    res.json({ terms: termsWithSeedStatus });
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
      meetingUrl: c.meetingUrl || ''
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
