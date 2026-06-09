import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import {
  getStudentPortal,
  getParentPortal,
  getTeacherPortal,
  createPickupAuth,
  getPickupAuths,
  deletePickupAuth,
} from '../controllers/portal.controller.js';

const router = Router();

// Portal caches are per-user. Teacher TTL is short (30 s) since it reflects today's live sessions.
router.get('/student', authenticate, requireRole('STUDENT'),
  withCache(req => `portal:student:${req.user.id}`, 60),
  getStudentPortal
);

router.get('/parent', authenticate, requireRole('PARENT'),
  withCache(req => `portal:parent:${req.user.id}`, 60),
  getParentPortal
);

router.get('/teacher', authenticate, requireRole('TEACHER', 'ADMIN'),
  withCache(req => `portal:teacher:${req.user.id}`, 30),
  getTeacherPortal
);

// Pickup Authorization routes
router.get('/parent/pickup', authenticate, requireRole('PARENT'), getPickupAuths);
router.post('/parent/pickup', authenticate, requireRole('PARENT'), createPickupAuth);
router.delete('/parent/pickup/:id', authenticate, requireRole('PARENT'), deletePickupAuth);

export default router;
