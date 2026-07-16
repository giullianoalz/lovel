import prisma from '../config/database.js';
import { broadcastToStaff, broadcastToManagement } from '../utils/pushNotifications.js';
import { notifyAdmins } from '../jobs/notification.helper.js';

// POST /api/alerts — Teacher triggers a class alert (Student out, Class support, Medic)
export const createAlert = async (req, res, next) => {
  try {
    const { studentId, alertType, reason } = req.body;
    const reportedById = req.user.id;

    if (!alertType) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'alertType is required.',
      });
    }

    const alert = await prisma.classAlert.create({
      data: {
        studentId: studentId || null,
        reportedById,
        alertType,
        reason: reason || null,
      },
      include: {
        student: { select: { id: true, fullName: true, age: true, allergies: true, medicalNotes: true, accommodationNotes: true } },
        reportedBy: { select: { id: true, fullName: true } },
      },
    });

    // Broadcast to front desk / admin room via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('class_alert', {
        id: alert.id,
        studentName: alert.student?.fullName || 'N/A',
        studentAge: alert.student?.age,
        teacherName: alert.reportedBy.fullName,
        alertType: alert.alertType,
        reason: alert.reason,
        createdAt: alert.createdAt,
        status: alert.status,
      });
    }

    // Trigger Push Notifications based on Alert Type
    if (alertType.toUpperCase() === 'LOCK DOWN') {
      await broadcastToStaff(
        '🐰 Lock Down', // Non-threatening bunny rabbit as requested
        'Please secure your rooms immediately.',
        { alertId: alert.id }
      );
    } else if (['MEDIC', 'STUDENT OUT', 'CLASS SUPPORT'].includes(alertType.toUpperCase())) {
      await broadcastToManagement(
        `Alert: ${alertType}`,
        `${alert.reportedBy.fullName} needs assistance. Reason: ${alert.reason || 'N/A'}`,
        { alertId: alert.id }
      );
    }

    // Durable in-app notification for admins so the emergency alert also lands in
    // the notifications inbox, not only as an ephemeral FCM push / socket event.
    notifyAdmins({
      type: 'ALERT',
      title: `Alert: ${alertType}`,
      message: `${alert.reportedBy.fullName} raised a "${alertType}" alert${
        alert.student ? ` for ${alert.student.fullName}` : ''
      }.${alert.reason ? ` Reason: ${alert.reason}` : ''}`,
      referenceType: 'classAlert',
      referenceId: alert.id,
    });

    res.status(201).json({ alert });
  } catch (error) {
    next(error);
  }
};

// GET /api/alerts — Get active/all alerts (front desk dashboard)
export const listAlerts = async (req, res, next) => {
  try {
    const { status, from, to } = req.query;

    const where = {};
    if (status) {
      where.status = status;
    } else {
      // Default: show active alerts
      where.status = 'active';
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const alerts = await prisma.classAlert.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true, age: true } },
        reportedBy: { select: { id: true, fullName: true } },
        resolvedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ alerts });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/alerts/:id — Mark alert as resolved
export const updateAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const resolvedById = req.user.id;

    const data = { status: status || 'resolved' };

    if (status === 'resolved' || status === 'returned') {
      data.resolvedAt = new Date();
      data.resolvedById = resolvedById;
    }

    const updated = await prisma.classAlert.update({
      where: { id },
      data,
      include: {
        student: { select: { id: true, fullName: true } },
        reportedBy: { select: { id: true, fullName: true } },
        resolvedBy: { select: { id: true, fullName: true } },
      },
    });

    // Notify all connected clients that the alert was resolved
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('class_alert_update', {
        id: updated.id,
        status: updated.status,
        studentName: updated.student?.fullName || 'N/A',
        resolvedAt: updated.resolvedAt,
        resolvedByName: updated.resolvedBy?.fullName,
      });
    }

    res.json({ alert: updated });
  } catch (error) {
    next(error);
  }
};
