import prisma from '../config/database.js';

export const createMedicalLog = async (req, res, next) => {
  try {
    const { studentId, time, place, description, actionsTaken, sentHome } = req.body;
    const teacherId = req.user.id;

    if (!studentId || !time || !place || !description || !actionsTaken) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'studentId, time, place, description, and actionsTaken are required.',
      });
    }

    const log = await prisma.medicalLog.create({
      data: {
        studentId,
        teacherId,
        time: new Date(time),
        place,
        description,
        actionsTaken,
        sentHome: sentHome || false,
        status: 'RECORDED'
      },
      include: {
        student: { select: { id: true, fullName: true } },
        teacher: { select: { id: true, fullName: true } },
      },
    });

    // Send push notification to management
    import('../utils/pushNotifications.js').then(({ broadcastToManagement }) => {
      broadcastToManagement(
        'Medical Incident Report',
        `${log.teacher.fullName} reported a medical incident involving ${log.student.fullName}.`,
        { type: 'MEDICAL' }
      );
    });

    res.status(201).json({ log });
  } catch (error) {
    next(error);
  }
};

export const listMedicalLogs = async (req, res, next) => {
  try {
    const { studentId, status, from, to, page = 1, limit = 50 } = req.query;

    const where = {};
    if (studentId) where.studentId = studentId;
    if (status) where.status = status;

    if (req.user.role === 'TEACHER') {
      where.teacherId = req.user.id;
    }

    if (from || to) {
      where.time = {};
      if (from) where.time.gte = new Date(from);
      if (to) where.time.lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      prisma.medicalLog.findMany({
        where,
        include: {
          student: { select: { id: true, fullName: true, avatarUrl: true } },
          teacher: { select: { id: true, fullName: true } },
          reviewedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { time: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.medicalLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    next(error);
  }
};

export const updateMedicalLog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { managerNotes, notifyParent } = req.body;
    const reviewedById = req.user.id;

    const log = await prisma.medicalLog.update({
      where: { id },
      data: {
        status: 'REVIEWED',
        managerNotes,
        reviewedById
      },
      include: {
        student: { select: { fullName: true } }
      }
    });

    if (notifyParent) {
      const familyMembers = await prisma.familyMember.findMany({
        where: { userId: log.studentId },
        select: { family: { select: { members: { where: { role: 'PARENT' }, select: { userId: true } } } } }
      });
      const parentIds = familyMembers.flatMap(f => f.family.members.map(m => m.userId));
      
      import('../utils/pushNotifications.js').then(({ sendPushNotification }) => {
        sendPushNotification(
          parentIds,
          'Medical Incident Report',
          `An incident involving ${log.student.fullName} has been recorded. Notes: ${managerNotes || 'Please contact management.'}`,
          { logId: log.id }
        );
      });
    }

    res.json({ log });
  } catch (error) {
    next(error);
  }
};
