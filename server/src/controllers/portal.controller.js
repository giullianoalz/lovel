import prisma from '../config/database.js';
import crypto from 'crypto';

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
                    prizePoints: true, // Used for seashells
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
          seashells: student.prizePoints,
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
        prizePoints: true,
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

    // Find all families this parent belongs to
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
                    prizePoints: true,
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

    // Get all student children
    const children = [];
    for (const fm of familyMembers) {
      for (const member of fm.family.members) {
        if (member.user.role === 'STUDENT') {
          const studentId = member.user.id;

          // Get their enrollments
          const enrollments = await prisma.classEnrollment.findMany({
            where: { studentId, status: 'active' },
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
          });

          // Get recent behavior summary
          const [warningCount, positiveCount] = await Promise.all([
            prisma.behaviorLog.count({ where: { studentId, type: { in: ['WARNING', 'SLIP'] } } }),
            prisma.behaviorLog.count({ where: { studentId, type: 'POSITIVE' } }),
          ]);

          // Get recent prize history
          const prizeHistory = await prisma.prizeHistory.findMany({
            where: { studentId },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });

          // Get materials
          const materials = await prisma.material.findMany({
            where: { studentId },
            orderBy: { uploadedAt: 'desc' },
            take: 10,
          });

          children.push({
            ...member.user,
            familyName: fm.family.name,
            enrollments: enrollments.map(e => ({
              classId: e.class.id,
              className: e.class.name,
              teacherName: e.class.teacher?.fullName || 'TBD',
              upcomingSessions: e.class.sessions,
            })),
            behaviorSummary: { warnings: warningCount, positives: positiveCount },
            prizeHistory,
            materials,
          });
        }
      }
    }

    // Get parent-targeted announcements
    const announcements = await prisma.announcement.findMany({
      where: {
        targetAudience: { in: ['all', 'parents'] },
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
      children,
      announcements,
    });
  } catch (error) {
    next(error);
  }
};
