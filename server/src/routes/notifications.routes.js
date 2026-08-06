import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationsReadByReference,
} from '../controllers/notifications.controller.js';

const router = Router();

// GET /api/notifications — current user's in-app notifications
router.get('/', authenticate, listNotifications);

// POST /api/notifications/read-all — mark all as read
router.post('/read-all', authenticate, markAllNotificationsRead);

// POST /api/notifications/read-by-reference — mark a whole bucket read, so a
// screen can clear the notifications for the work it already displays.
router.post('/read-by-reference', authenticate, markNotificationsReadByReference);

// POST /api/notifications/:id/read — mark one as read
router.post('/:id/read', authenticate, markNotificationRead);

export default router;
