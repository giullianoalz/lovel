import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createSubmission,
  listSubmissions,
  getSubmission,
  updateSubmission,
  uploadPhotos,
} from '../controllers/marketing.controller.js';

// Multer storage config for marketing photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads', 'marketing'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `marketing-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov/;
    const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeValid = allowed.test(file.mimetype.split('/')[1]);
    if (extValid || mimeValid) {
      return cb(null, true);
    }
    cb(new Error('Only image and video files are allowed.'));
  },
});

const router = Router();

// POST /api/marketing/submissions — Create submission (Teacher/Admin)
router.post('/submissions', authenticate, requireRole('ADMIN', 'TEACHER'), createSubmission);

// GET /api/marketing/submissions — List submissions
router.get('/submissions', authenticate, requireRole('ADMIN', 'TEACHER'), listSubmissions);

// GET /api/marketing/submissions/:id — Get one submission
router.get('/submissions/:id', authenticate, requireRole('ADMIN', 'TEACHER'), getSubmission);

// PATCH /api/marketing/submissions/:id — Approve/update (Admin)
router.patch('/submissions/:id', authenticate, requireRole('ADMIN'), updateSubmission);

// POST /api/marketing/submissions/:id/photos — Upload photos (Teacher/Admin)
router.post(
  '/submissions/:id/photos',
  authenticate,
  requireRole('ADMIN', 'TEACHER'),
  upload.array('photos', 20), // Up to 20 photos at once
  uploadPhotos
);

export default router;
