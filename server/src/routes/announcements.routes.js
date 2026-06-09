import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import {
  createAnnouncement,
  listAnnouncements,
  markAnnouncementRead
} from '../controllers/announcements.controller.js';

const router = Router();

// GET /api/announcements — keyed per user (response includes per-user isRead flags)
router.get('/', authenticate, withCache(req => `announcements:${req.user.id}`, 30), listAnnouncements);

// POST /api/announcements (Management only)
router.post('/', authenticate, requireRole('ADMIN'), createAnnouncement);

// POST /api/announcements/:id/read
router.post('/:id/read', authenticate, markAnnouncementRead);

export default router;
