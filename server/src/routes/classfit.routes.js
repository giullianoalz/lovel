import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createClassFitReport,
  listClassFitReports,
  reviewClassFitReport,
} from '../controllers/classfit.controller.js';

const router = Router();

// POST /api/class-fit — Submit a flag (Teacher/Admin)
router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), createClassFitReport);

// GET /api/class-fit — List reports (Admin sees all, Teacher sees own)
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listClassFitReports);

// PATCH /api/class-fit/:id — Admin reviews/resolves
router.patch('/:id', authenticate, requireRole('ADMIN'), reviewClassFitReport);

export default router;
