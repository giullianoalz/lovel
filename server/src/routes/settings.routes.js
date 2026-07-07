import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { getNotificationSettings, putNotificationSettings } from '../controllers/settings.controller.js';

const router = Router();

// GET /api/settings/notifications — Admin-wide push notification config (Admin)
router.get('/notifications', authenticate, requireRole('ADMIN'), getNotificationSettings);

// PUT /api/settings/notifications — Update push notification config (Admin)
router.put('/notifications', authenticate, requireRole('ADMIN'), putNotificationSettings);

export default router;
