import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createAnnouncement,
  listAnnouncements,
  markAnnouncementRead
} from '../controllers/announcements.controller.js';

const router = Router();

// GET /api/announcements
router.get('/', authenticate, listAnnouncements);

// POST /api/announcements (Management only)
router.post('/', authenticate, requireRole('ADMIN'), createAnnouncement);

// POST /api/announcements/:id/read
router.post('/:id/read', authenticate, markAnnouncementRead);

export default router;
