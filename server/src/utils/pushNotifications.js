import prisma from '../config/database.js';

/**
 * Sends a push notification to specific users.
 * Currently mocked for development. Will use Firebase Admin SDK later.
 */
export const sendPushNotification = async (userIds, title, body, data = {}) => {
  console.log(`[Push Notification] Sending to users: ${userIds.join(', ')}`);
  console.log(`[Push Notification] Title: ${title}`);
  console.log(`[Push Notification] Body: ${body}`);
  
  // Future implementation:
  // const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { fcmToken: true } });
  // const tokens = users.map(u => u.fcmToken).filter(Boolean);
  // if (tokens.length > 0) admin.messaging().sendMulticast({ tokens, notification: { title, body }, data });
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
