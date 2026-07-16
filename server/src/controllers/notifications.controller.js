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
