import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  getStudentPortal,
  getParentPortal,
  getTeacherPortal,
  createPickupAuth,
  getPickupAuths,
  deletePickupAuth,
} from '../controllers/portal.controller.js';

const router = Router();

// GET /api/portal/student — Student dashboard
router.get('/student', authenticate, requireRole('STUDENT'), getStudentPortal);

// GET /api/portal/parent — Parent dashboard (all children)
router.get('/parent', authenticate, requireRole('PARENT'), getParentPortal);

// GET /api/portal/teacher — Teacher dashboard
router.get('/teacher', authenticate, requireRole('TEACHER', 'ADMIN'), getTeacherPortal);

// Pickup Authorization routes
router.get('/parent/pickup', authenticate, requireRole('PARENT'), getPickupAuths);
router.post('/parent/pickup', authenticate, requireRole('PARENT'), createPickupAuth);
router.delete('/parent/pickup/:id', authenticate, requireRole('PARENT'), deletePickupAuth);

export default router;
