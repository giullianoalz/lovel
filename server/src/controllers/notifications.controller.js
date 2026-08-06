import prisma from '../config/database.js';

// GET /api/notifications — the current user's in-app notifications
export const listNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { unreadOnly } = req.query;

    const where = { userId };
    if (unreadOnly === 'true') where.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    next(error);
  }
};

// POST /api/notifications/:id/read — mark one notification read
export const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Scope the update to the owner so a user can't flip someone else's row.
    const result = await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Not Found', message: 'Notification not found.' });
    }

    res.json({ message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/notifications/read-by-reference — mark read every unread notification
 * of the given referenceTypes.
 *
 * A screen that shows the same work its notifications point at (the front desk,
 * for one) has to clear them itself, or the sidebar badge counts items the user
 * is literally looking at. Same shape as the chat fix in getMessages: update,
 * then nudge the user's own bell so it drops without a reload.
 *
 * The allowlist keeps this from becoming a back door to read-all — a caller can
 * only clear the buckets a screen genuinely covers.
 */
const CLEARABLE_REFERENCE_TYPES = ['classAlert', 'sessionCancellation', 'snackReload', 'behaviorLog'];

export const markNotificationsReadByReference = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { referenceTypes } = req.body;

    if (!Array.isArray(referenceTypes) || referenceTypes.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'referenceTypes must be a non-empty array.',
      });
    }

    const allowed = referenceTypes.filter(t => CLEARABLE_REFERENCE_TYPES.includes(t));
    if (allowed.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `referenceTypes must be one of: ${CLEARABLE_REFERENCE_TYPES.join(', ')}.`,
      });
    }

    const { count } = await prisma.notification.updateMany({
      where: { userId, isRead: false, referenceType: { in: allowed } },
      data: { isRead: true, readAt: new Date() },
    });

    // Only signal when something actually changed, so an idle screen doesn't
    // trigger a refetch loop on every visit.
    const io = req.app.get('io');
    if (io && count > 0) io.to(`user_${userId}`).emit('notification', { type: 'read_sync' });

    res.json({ count });
  } catch (error) {
    next(error);
  }
};

// POST /api/notifications/read-all — mark all the user's notifications read
export const markAllNotificationsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    next(error);
  }
};
