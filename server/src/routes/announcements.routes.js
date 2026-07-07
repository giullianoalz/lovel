import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import {
  createAnnouncement,
  listAnnouncements,
  markAnnouncementRead,
  deleteAnnouncement,
} from '../controllers/announcements.controller.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'announcements');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `feed-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 }, // 50MB per file (videos), up to 10 items
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|webm/;
    const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeValid = allowed.test(file.mimetype.split('/')[1]);
    if (extValid || mimeValid) return cb(null, true);
    cb(new Error('Only image and video files are allowed.'));
  },
});

const router = Router();

// GET /api/announcements — keyed per user (response includes per-user isRead flags)
router.get('/', authenticate, withCache(req => `announcements:${req.user.id}`, 30), listAnnouncements);

// POST /api/announcements — Academy Feed post (Admin only — teachers can view but not publish)
// Accepts up to 10 photos/videos for a carousel-style post.
router.post('/', authenticate, requireRole('ADMIN'), upload.array('media', 10), createAnnouncement);

// POST /api/announcements/:id/read
router.post('/:id/read', authenticate, markAnnouncementRead);

// DELETE /api/announcements/:id — author or admin only
router.delete('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), deleteAnnouncement);

export default router;
