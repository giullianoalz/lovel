import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createLessonPlan,
  listLessonPlans,
  getLessonPlan,
} from '../controllers/lessonPlan.controller.js';

// Multer storage config for lesson plan uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads', 'lesson_plans'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `lesson-plan-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|doc|docx|ppt|pptx/;
    const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
    if (extValid) {
      return cb(null, true);
    }
    cb(new Error('Only document files (PDF, DOCX, PPTX) are allowed.'));
  },
});

const router = Router();

// POST /api/lesson-plans — Create lesson plan (Teacher/Admin)
router.post(
  '/', 
  authenticate, 
  requireRole('ADMIN', 'TEACHER'), 
  upload.single('file'), 
  createLessonPlan
);

// GET /api/lesson-plans — List lesson plans
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listLessonPlans);

// GET /api/lesson-plans/:id — Get one lesson plan
router.get('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), getLessonPlan);

export default router;
