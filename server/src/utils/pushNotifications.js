import admin from 'firebase-admin';
import '../config/firebase-admin.js';
import prisma from '../config/database.js';

/**
 * Where tapping the notification should land, as an absolute URL.
 *
 * Two different consumers read the destination and they need different shapes:
 * our own service worker calls `clients.openWindow(data.link)`, which resolves
 * a relative path against its scope, while FCM's `webpush.fcmOptions.link`
 * requires a fully-qualified HTTPS URL and rejects a relative one. That second
 * path matters more than it looks: a payload carrying a `notification` block is
 * displayed by the FCM SDK itself, so `onBackgroundMessage` never runs and
 * `fcmOptions.link` is the only destination that applies.
 *
 * Returns null when FRONTEND_URL isn't configured, so the caller can leave
 * fcmOptions off entirely rather than send a value FCM would reject.
 */
const APP_ORIGIN = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
const absoluteLink = (path) => {
  if (!APP_ORIGIN || typeof path !== 'string' || !path.startsWith('/')) return null;
  return `${APP_ORIGIN}${path}`;
};

/**
 * Sends a real push notification (via Firebase Cloud Messaging) to specific users.
 * Falls back to a console log if a user has no registered device token.
 *
 * `data.link` — an app-relative path such as `/chat?thread=<id>` — controls
 * where the notification opens. Without it the push lands on the dashboard.
 */
export const sendPushNotification = async (userIds, title, body, data = {}) => {
  if (!userIds || userIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, fcmToken: true },
  });

  const tokens = users.map(u => u.fcmToken).filter(Boolean);

  console.log(`[Push Notification] "${title}" → ${userIds.length} user(s), ${tokens.length} with a device token.`);

  if (tokens.length === 0) return;

  // FCM data payloads must be flat string key/value pairs
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const clickUrl = absoluteLink(typeof data.link === 'string' ? data.link : '/');

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringData,
      webpush: {
        notification: { icon: '/logo.png' },
        ...(clickUrl ? { fcmOptions: { link: clickUrl } } : {}),
      },
    });

    // Clean up tokens that are no longer valid (app uninstalled, permissions revoked, etc.)
    const staleTokens = [];
    response.responses.forEach((r, i) => {
      if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
        staleTokens.push(tokens[i]);
      }
    });
    if (staleTokens.length > 0) {
      await prisma.user.updateMany({
        where: { fcmToken: { in: staleTokens } },
        data: { fcmToken: null },
      });
    }
  } catch (error) {
    console.error('[Push Notification] Error sending via FCM:', error.message);
  }
};

/**
 * Broadcasts a push notification to all active teachers and admins (e.g. for Lock Down)
 */
export const broadcastToStaff = async (title, body, data = {}) => {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['TEACHER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { id: true }
  });
  const userIds = staff.map(s => s.id);
  await sendPushNotification(userIds, title, body, data);
};

/**
 * Broadcasts a push notification to management (e.g. for Medic, Student Out, Support)
 */
export const broadcastToManagement = async (title, body, data = {}) => {
  const management = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true }
  });
  const userIds = management.map(m => m.id);
  await sendPushNotification(userIds, title, body, data);
};
