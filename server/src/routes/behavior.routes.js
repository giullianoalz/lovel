import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createBehaviorLog,
  listBehaviorLogs,
  getStudentBehavior,
} from '../controllers/behavior.controller.js';

const router = Router();

// POST /api/behavior — Log a behavior entry (Teacher/Admin)
router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), createBehaviorLog);

// GET /api/behavior — List all logs (Admin sees all, Teacher sees own)
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listBehaviorLogs);

// GET /api/behavior/student/:studentId — Behavior history for a student
router.get('/student/:studentId', authenticate, requireRole('ADMIN', 'TEACHER'), getStudentBehavior);

export default router;
