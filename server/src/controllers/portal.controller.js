import prisma from '../config/database.js';
import crypto from 'crypto';
import stripe from '../config/stripe.js';

// GET /api/portal/teacher — Teacher dashboard (Today's classes, roster, etc)
export const getTeacherPortal = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Get today's start and end of day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    // Get today's sessions for this teacher
    const todaySessions = await prisma.session.findMany({
      where: {
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        class: {
          teacherId: userId
        }
      },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'active' },
              include: {
                student: {
                  select: {
                    id: true,
                    fullName: true,
                    age: true,
                    allergies: true,
                    medicalNotes: true,
                    accommodationNotes: true,
                    seashells: true,
                  }
                }
              }
            }
          }
        },
        attendance: true,
        materials: true
      },
      orderBy: { startTime: 'asc' }
    });

    // Get teacher's unread announcements
    const announcements = await prisma.announcement.findMany({
      where: {
        OR: [{ targetAudience: 'all' }, { targetAudience: 'teacher' }],
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
        ]
      },
      include: {
        reads: { where: { userId } }
      },
      orderBy: { publishedAt: 'desc' }
    });
    
    const unreadAnnouncements = announcements.filter(a => a.reads.length === 0);

    // Format schedule
    const schedule = todaySessions.map(session => ({
      sessionId: session.id,
      classId: session.class.id,
      className: session.class.name,
      startTime: session.startTime,
      endTime: session.endTime,
      roster: session.class.enrollments.map(e => {
        const student = e.student;
        return {
          id: student.id,
          name: student.fullName,
          age: student.age,
          allergies: student.allergies ? true : false,
          accommodation: student.accommodationNotes ? true : false,
          noPhoto: false, // Schema doesn't currently store this, defaulting to false
          upcomingBirthday: false, // Requires DOB to be tracked in schema, using placeholder
          seashells: student.seashells,
          attendance: session.attendance.find(a => a.studentId === student.id)?.status || 'PENDING'
        };
      })
    }));

    res.json({
      schedule,
      announcements: unreadAnnouncements
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/student — Student sees their own dashboard data
export const getStudentPortal = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get student profile with full details
    const student = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        age: true,
        allergies: true,
        medicalNotes: true,
        accommodationNotes: true,
        snackPunches: true,
        seashells: true,
        status: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Not Found', message: 'Student not found.' });
    }

    // Get enrollments & upcoming sessions
    const enrollments = await prisma.classEnrollment.findMany({
      where: { studentId: userId, status: 'active' },
      include: {
        class: {
          include: {
            teacher: { select: { id: true, fullName: true } },
            sessions: {
              where: { date: { gte: new Date() } },
              orderBy: { date: 'asc' },
              take: 5,
            },
          },
        },
      },
    });

    // Get prize history (last 20)
    const prizeHistory = await prisma.prizeHistory.findMany({
      where: { studentId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Get behavior summary (counts only — students don't see full details)
    const [warningCount, positiveCount] = await Promise.all([
      prisma.behaviorLog.count({ where: { studentId: userId, type: { in: ['WARNING', 'SLIP'] } } }),
      prisma.behaviorLog.count({ where: { studentId: userId, type: 'POSITIVE' } }),
    ]);

    // Get materials assigned to student (last 20)
    const materials = await prisma.material.findMany({
      where: { studentId: userId },
      orderBy: { uploadedAt: 'desc' },
      take: 20,
    });

    // Get announcements for students
    const announcements = await prisma.announcement.findMany({
      where: {
        targetAudience: { in: ['all', 'students'] },
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
      include: {
        author: { select: { fullName: true } },
      },
    });

    res.json({
      student,
      enrollments: enrollments.map(e => ({
        classId: e.class.id,
        className: e.class.name,
        teacherName: e.class.teacher?.fullName || 'TBD',
        upcomingSessions: e.class.sessions,
      })),
      prizeHistory,
      behaviorSummary: { warnings: warningCount, positives: positiveCount },
      materials,
      announcements,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/portal/parent/pickup — Create a temporary pickup authorization
export const createPickupAuth = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const { pickupPerson, relationship, validDate, studentName } = req.body;

    if (!pickupPerson || !validDate) {
      return res.status(400).json({ error: 'Bad Request', message: 'pickupPerson and validDate are required.' });
    }

    // Generate a unique hash token
    const rawData = `${parentId}-${pickupPerson}-${validDate}-${Date.now()}`;
    const qrCodeHash = crypto.createHash('sha256').update(rawData).digest('hex');

    const auth = await prisma.tempPickupAuth.create({
      data: {
        parentId,
        pickupPerson,
        validDate: new Date(validDate),
        qrCodeHash,
      },
    });

    res.status(201).json({ ...auth, relationship, studentName });
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/pickup — List parent's pickup authorizations
export const getPickupAuths = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const auths = await prisma.tempPickupAuth.findMany({
      where: { parentId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(auths);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/portal/parent/pickup/:id — Revoke a pickup auth
export const deletePickupAuth = async (req, res, next) => {
  try {
    const parentId = req.user.id;
    const { id } = req.params;
    const auth = await prisma.tempPickupAuth.findFirst({ where: { id, parentId } });
    if (!auth) return res.status(404).json({ error: 'Not Found' });
    await prisma.tempPickupAuth.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent — Parent sees all their children's data
export const getParentPortal = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Single query: families + all student members
    const familyMembers = await prisma.familyMember.findMany({
      where: { userId },
      include: {
        family: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    role: true,
                    age: true,
                    allergies: true,
                    medicalNotes: true,
                    snackPunches: true,
                    seashells: true,
                    avatarUrl: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Collect all student IDs up-front — no queries inside loops
    const studentMeta = []; // { user, familyName }
    for (const fm of familyMembers) {
      for (const member of fm.family.members) {
        if (member.user.role === 'STUDENT') {
          studentMeta.push({ user: member.user, familyName: fm.family.name });
        }
      }
    }

    const studentIds = studentMeta.map(s => s.user.id);

    if (studentIds.length === 0) {
      // Skip all batch queries when there are no children
      const announcements = await prisma.announcement.findMany({
        where: {
          targetAudience: { in: ['all', 'parents'] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        include: { author: { select: { fullName: true } } },
      });
      return res.json({ children: [], announcements });
    }

    // Batch all child-data queries in a single Promise.all — O(1) DB round-trips
    const [enrollments, behaviorCounts, prizeHistories, materials, announcements] = await Promise.all([
      prisma.classEnrollment.findMany({
        where: { studentId: { in: studentIds }, status: 'active' },
        include: {
          class: {
            include: {
              teacher: { select: { fullName: true } },
              sessions: {
                where: { date: { gte: new Date() } },
                orderBy: { date: 'asc' },
                take: 3,
              },
            },
          },
        },
      }),
      prisma.behaviorLog.groupBy({
        by: ['studentId', 'type'],
        where: {
          studentId: { in: studentIds },
          type: { in: ['WARNING', 'SLIP', 'POSITIVE'] },
        },
        _count: { id: true },
      }),
      prisma.prizeHistory.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.material.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.announcement.findMany({
        where: {
          targetAudience: { in: ['all', 'parents'] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        include: { author: { select: { fullName: true } } },
      }),
    ]);

    // Index results by studentId for O(1) lookups during assembly
    const enrollmentsByStudent = {};
    for (const e of enrollments) {
      if (!enrollmentsByStudent[e.studentId]) enrollmentsByStudent[e.studentId] = [];
      enrollmentsByStudent[e.studentId].push(e);
    }

    const behaviorByStudent = {};
    for (const row of behaviorCounts) {
      if (!behaviorByStudent[row.studentId]) behaviorByStudent[row.studentId] = { warnings: 0, positives: 0 };
      if (['WARNING', 'SLIP'].includes(row.type)) behaviorByStudent[row.studentId].warnings += row._count.id;
      if (row.type === 'POSITIVE') behaviorByStudent[row.studentId].positives += row._count.id;
    }

    const prizeByStudent = {};
    for (const p of prizeHistories) {
      if (!prizeByStudent[p.studentId]) prizeByStudent[p.studentId] = [];
      if (prizeByStudent[p.studentId].length < 10) prizeByStudent[p.studentId].push(p);
    }

    const materialsByStudent = {};
    for (const m of materials) {
      if (!materialsByStudent[m.studentId]) materialsByStudent[m.studentId] = [];
      if (materialsByStudent[m.studentId].length < 10) materialsByStudent[m.studentId].push(m);
    }

    // Assemble final response — pure JS, zero additional DB calls
    const children = studentMeta.map(({ user, familyName }) => {
      const studentEnrollments = enrollmentsByStudent[user.id] || [];
      return {
        ...user,
        familyName,
        enrollments: studentEnrollments.map(e => ({
          classId: e.class.id,
          className: e.class.name,
          teacherName: e.class.teacher?.fullName || 'TBD',
          upcomingSessions: e.class.sessions,
        })),
        behaviorSummary: behaviorByStudent[user.id] || { warnings: 0, positives: 0 },
        prizeHistory: prizeByStudent[user.id] || [],
        materials: materialsByStudent[user.id] || [],
      };
    });

    res.json({ children, announcements });
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/billing — Family account, invoices & transaction history
export const getParentBilling = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const familyMember = await prisma.familyMember.findFirst({
      where: { userId },
      select: { familyId: true, family: { select: { id: true, name: true } } },
    });

    if (!familyMember) return res.json({ balance: 0, invoices: [], transactions: [] });

    const familyId = familyMember.familyId;

    const [invoices, transactions] = await Promise.all([
      prisma.invoice.findMany({
        where: { familyId },
        orderBy: { date: 'desc' },
        include: { lines: true },
      }),
      prisma.transaction.findMany({
        where: { familyId },
        orderBy: { date: 'desc' },
        take: 50,
        include: { student: { select: { fullName: true } } },
      }),
    ]);

    // Balance = charges + refunds (increase what's owed) - payments/discounts/credits (reduce it)
    const balance = transactions.reduce((acc, t) => {
      const amt = Number(t.amount);
      if (t.type === 'CHARGE' || t.type === 'REFUND') return acc + amt;
      if (t.type === 'PAYMENT' || t.type === 'DISCOUNT' || t.type === 'CREDIT') return acc - amt;
      return acc;
    }, 0);

    res.json({
      familyId,
      familyName: familyMember.family.name,
      balance: Math.round(balance * 100) / 100,
      invoices: invoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date.toISOString().split('T')[0],
        dueDate: inv.dueDate ? inv.dueDate.toISOString().split('T')[0] : null,
        dateRange: inv.dateRange || '',
        subtotal: Number(inv.subtotal),
        total: Number(inv.totalAmount),
        amountPaid: Number(inv.amountPaid),
        amountDue: Math.max(0, Number(inv.totalAmount) - Number(inv.amountPaid)),
        status: inv.status,
        stripePaymentLink: inv.stripePaymentLink || null,
        lines: inv.lines.map(l => ({
          description: l.description,
          amount: Number(l.amount),
          quantity: l.quantity,
        })),
      })),
      transactions: transactions.map(t => ({
        id: t.id,
        date: t.date.toISOString().split('T')[0],
        description: t.description || '',
        amount: Number(t.amount),
        type: t.type,
        studentName: t.student?.fullName || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/portal/parent/billing/pay/:invoiceId — Create Stripe Checkout session
export const createPaymentSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { invoiceId } = req.params;

    // Verify this invoice belongs to the parent's family
    const familyMember = await prisma.familyMember.findFirst({ where: { userId } });
    if (!familyMember) return res.status(403).json({ error: 'No family account.' });

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, familyId: familyMember.familyId },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const amountDue = Number(invoice.totalAmount) - Number(invoice.amountPaid);
    if (amountDue <= 0) return res.status(400).json({ error: 'Invoice already paid.' });

    // If a Stripe payment link already exists, return it
    if (invoice.stripePaymentLink) {
      return res.json({ url: invoice.stripePaymentLink, existing: true });
    }

    if (!stripe) {
      return res.status(503).json({ error: 'Payment gateway not configured. Please contact the academy.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(amountDue * 100),
          product_data: {
            name: `Invoice ${invoice.invoiceNumber}`,
            description: invoice.dateRange || 'Lovelearning Academy',
          },
        },
        quantity: 1,
      }],
      metadata: { invoiceId: invoice.id, familyId: familyMember.familyId },
      success_url: `${frontendUrl}/portal/parent?payment=success`,
      cancel_url: `${frontendUrl}/portal/parent?payment=cancelled`,
    });

    // Save the Stripe URL so subsequent visits skip re-creation
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { stripePaymentLink: session.url, stripePaymentLinkId: session.id },
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
};
