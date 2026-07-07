import admin from 'firebase-admin';
import '../config/firebase-admin.js';
import prisma from '../config/database.js';

/**
 * Sends a real push notification (via Firebase Cloud Messaging) to specific users.
 * Falls back to a console log if a user has no registered device token.
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

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringData,
      webpush: {
        notification: { icon: '/logo.png' },
        fcmOptions: { link: '/' },
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
