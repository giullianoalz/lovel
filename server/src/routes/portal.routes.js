import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  getStudentPortal,
  getParentPortal,
} from '../controllers/portal.controller.js';

const router = Router();

// GET /api/portal/student — Student dashboard
router.get('/student', authenticate, requireRole('STUDENT'), getStudentPortal);

// GET /api/portal/parent — Parent dashboard (all children)
router.get('/parent', authenticate, requireRole('PARENT'), getParentPortal);

export default router;
