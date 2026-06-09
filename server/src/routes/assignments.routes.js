import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createAssignment,
  listAssignments,
  gradeAssignment
} from '../controllers/assignments.controller.js';

const router = Router();

// GET /api/assignments
router.get('/', authenticate, listAssignments);

// POST /api/assignments (Teachers only)
router.post('/', authenticate, requireRole('TEACHER', 'ADMIN'), createAssignment);

// POST /api/assignments/:assignmentId/grade (Teachers only)
router.post('/:assignmentId/grade', authenticate, requireRole('TEACHER', 'ADMIN'), gradeAssignment);

export default router;
