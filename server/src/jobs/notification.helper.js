import prisma from '../config/database.js';
import { sendPushNotification } from '../utils/pushNotifications.js';
import { getAdminUserIds } from '../services/notificationConfig.service.js';

/**
 * Creates a persistent in-app Notification row (deduplicated) and optionally
 * fires a Firebase Cloud Messaging push if the user has an fcmToken saved.
 *
 * Deduplication: if a notification with the same `dedupKey` already exists
 * for this user, the function skips creation silently. This prevents the cron
 * jobs from spamming the same alert multiple times per day.
 *
 * @param {object} opts
 * @param {string}  opts.userId        - UUID of the recipient user
 * @param {string}  opts.type          - Notification type (e.g. 'PAYMENT_OVERDUE')
 * @param {string}  opts.title
 * @param {string}  opts.message
 * @param {string}  [opts.referenceType] - e.g. 'invoice', 'student'
 * @param {string|null} [opts.referenceId]
 * @param {string}  [opts.dedupKey]    - Unique key to prevent duplicate alerts
 */
export const sendNotification = async ({
  userId,
  type,
  title,
  message,
  referenceType = null,
  referenceId = null,
  dedupKey = null,
}) => {
  try {
    // Deduplication check
    if (dedupKey) {
      const existing = await prisma.notification.findFirst({
        where: { userId, dedupKey },
      });
      if (existing) return; // Already sent — skip silently
    }

    // Persist in-app notification
    await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        channel: 'in_app',
        isRead: false,
        referenceType,
        referenceId,
        dedupKey,
      },
    });

    // Fire the actual FCM push — the in-app row above is only visible once the
    // user opens the app, which defeats the point of a time-sensitive alert
    // like a class-starting-soon reminder.
    await sendPushNotification([userId], title, message, {
      type,
      referenceType: referenceType || '',
      referenceId: referenceId || '',
    });
  } catch (err) {
    // Notifications should never crash the main flow
    console.error(`[Notification] Failed to send to userId=${userId}:`, err.message);
  }
};

/**
 * Persist an in-app notification (+ FCM push) for every active admin / front-desk
 * user. Use this for staff-facing events — behavior reports, class alerts, medical
 * incidents — so the alert survives in the notifications inbox even when no admin
 * is on the alerts screen and no device token is registered.
 *
 * Optionally emits a Socket.IO `notification` event to `admin_room` so any admin
 * currently connected sees it in real time.
 *
 * @param {object} opts
 * @param {string} opts.type
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.referenceType]
 * @param {string|null} [opts.referenceId]
 * @param {string} [opts.dedupKey]
 * @param {import('socket.io').Server} [opts.io] - if provided, emits to admin_room
 */
export const notifyAdmins = async ({
  type,
  title,
  message,
  referenceType = null,
  referenceId = null,
  dedupKey = null,
  io = null,
}) => {
  try {
    const adminIds = await getAdminUserIds();
    await Promise.all(
      adminIds.map((userId) =>
        sendNotification({ userId, type, title, message, referenceType, referenceId, dedupKey }),
      ),
    );

    if (io) {
      io.to('admin_room').emit('notification', {
        type,
        title,
        message,
        referenceType,
        referenceId,
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.error('[Notification] notifyAdmins failed:', err.message);
  }
};
