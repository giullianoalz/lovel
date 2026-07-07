import prisma from '../config/database.js';
import { sendPushNotification } from '../utils/pushNotifications.js';

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
