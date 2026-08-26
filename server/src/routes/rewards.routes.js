import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listSnacks,
  getSnackImage,
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
// Anyone who can see the cabinet can see its photos — same audience as the
// list above, which parents reach from the portal.
router.get('/snacks/:id/image', authenticate, getSnackImage);
router.post('/snacks', authenticate, requireRole('ADMIN', 'TEACHER'), createSnack);
router.delete('/snacks/:id', authenticate, requireRole('ADMIN', 'TEACHER'), deleteSnack);
router.post('/snacks/purchase', authenticate, requireRole('ADMIN', 'TEACHER'), purchaseSnack);

// --- Snack reload (parent-approved top-up) queue ---
router.get('/snacks/reload-requests', authenticate, requireRole('ADMIN', 'TEACHER'), listReloadRequests);
router.post('/snacks/reload-requests/:id/fulfill', authenticate, requireRole('ADMIN', 'TEACHER'), fulfillReloadRequest);

// --- Seashells / prizes ---
// The front desk hands shells out too — a student walks up, does something
// worth rewarding, and the receptionist is who's standing there. Redeeming
// stays ADMIN/TEACHER: that one spends a balance and hands over a prize.
router.post('/seashells/award', authenticate, requireRole('ADMIN', 'TEACHER', 'RECEPTIONIST'), awardSeashells);
router.post('/seashells/redeem', authenticate, requireRole('ADMIN', 'TEACHER'), redeemSeashells);

export default router;
