import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listSnacks,
  createSnack,
  deleteSnack,
  purchaseSnack,
  listReloadRequests,
  fulfillReloadRequest,
  awardSeashells,
  redeemSeashells,
} from '../controllers/rewards.controller.js';

const router = Router();

// --- Snack cabinet ---
router.get('/snacks', authenticate, listSnacks);
router.post('/snacks', authenticate, requireRole('ADMIN', 'TEACHER'), createSnack);
router.delete('/snacks/:id', authenticate, requireRole('ADMIN', 'TEACHER'), deleteSnack);
router.post('/snacks/purchase', authenticate, requireRole('ADMIN', 'TEACHER'), purchaseSnack);

// --- Snack reload (parent-approved top-up) queue ---
router.get('/snacks/reload-requests', authenticate, requireRole('ADMIN', 'TEACHER'), listReloadRequests);
router.post('/snacks/reload-requests/:id/fulfill', authenticate, requireRole('ADMIN', 'TEACHER'), fulfillReloadRequest);

// --- Seashells / prizes ---
router.post('/seashells/award', authenticate, requireRole('ADMIN', 'TEACHER'), awardSeashells);
router.post('/seashells/redeem', authenticate, requireRole('ADMIN', 'TEACHER'), redeemSeashells);

export default router;
