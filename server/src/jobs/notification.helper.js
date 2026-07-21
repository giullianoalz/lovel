import prisma from '../config/database.js';
import { sendPushNotification } from '../utils/pushNotifications.js';
import { getAdminUserIds, getEventConfig } from '../services/notificationConfig.service.js';
import { EVENTS_BY_KEY } from '../config/notificationEvents.js';
import { sendNotificationEmail } from '../services/email.service.js';
import { sendSms } from '../services/sms.service.js';

/**
 * Fans a notification out to the EMAIL / SMS channels an admin enabled for this
 * event, on top of the in-app row the caller already persisted.
 *
 * Two gates, both of which must pass: the admin-level channel config for the
 * event (notificationEvents.js + NotificationEventConfig) and the recipient's
 * own NotificationPreference row for the event's category. A recipient with no
 * preference row falls back to the admin config alone.
 *
 * Every delivery is best-effort and independently caught — a bounced email must
 * not stop the text, and neither can surface to the caller.
 */
const deliverExtraChannels = async ({ userId, type, title, message }) => {
  const descriptor = EVENTS_BY_KEY[type];
  // Only catalog events have channel config. Everything else (chat messages,
  // medical incidents, …) stays in-app, exactly as before.
  if (!descriptor) return;

  const config = await getEventConfig(type);
  const wantsEmail = config.channels.includes('EMAIL');
  const wantsSms = config.channels.includes('SMS');
  if (!wantsEmail && !wantsSms) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true },
  });
  if (!user) return;

  const pref = descriptor.category
    ? await prisma.notificationPreference.findUnique({
      where: { userId_category: { userId, category: descriptor.category } },
      select: { email: true, sms: true },
    })
    : null;

  const jobs = [];
  if (wantsEmail && (pref ? pref.email : true) && user.email) {
    jobs.push(
      sendNotificationEmail({
        to: user.email,
        title,
        message,
        actionUrl: process.env.APP_URL || null,
      }).then((r) => {
        if (!r.ok) console.error(`[Notification] email to userId=${userId} failed: ${r.error}`);
      }),
    );
  }
  if (wantsSms && (pref ? pref.sms : true) && user.phone) {
    jobs.push(
      // Texts are charged per segment, so send the one-line version.
      sendSms({ to: user.phone, body: `${title} — ${message}` }).then((r) => {
        if (!r.ok) console.error(`[Notification] SMS to userId=${userId} failed: ${r.error}`);
      }),
    );
  }

  await Promise.all(jobs);
};

/**
 * Creates a persistent in-app Notification row (deduplicated), fires a Firebase
 * Cloud Messaging push if the user has an fcmToken saved, and — for catalog
 * events whose admin config enables them — also delivers by email and/or SMS.
 *
 * Deduplication: if a notification with the same `dedupKey` already exists
 * for this user, the function skips creation silently. This prevents the cron
 * jobs from spamming the same alert multiple times per day. Because dedup keys
 * live on the in-app row, that row is always written even when an admin cares
 * only about email/SMS — otherwise a daily cron would re-text every run.
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

    await deliverExtraChannels({ userId, type, title, message });
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
