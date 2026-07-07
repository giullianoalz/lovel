import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createLessonPlan,
  listLessonPlans,
  getLessonPlan,
  reviewLessonPlan,
  getSupplyList,
  markSupplyPurchased,
} from '../controllers/lessonPlan.controller.js';

const router = Router();

router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), createLessonPlan);
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listLessonPlans);
router.get('/supply-list', authenticate, requireRole('ADMIN'), getSupplyList);
router.patch('/supply-list/:id/purchased', authenticate, requireRole('ADMIN'), markSupplyPurchased);
router.get('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), getLessonPlan);
router.patch('/:id/review', authenticate, requireRole('ADMIN'), reviewLessonPlan);

export default router;
