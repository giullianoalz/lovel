import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listPayCategories,
  createPayCategory,
  updatePayCategory,
  deletePayCategory,
} from '../controllers/payCategories.controller.js';

const router = Router();

// GET /api/pay-categories — Every kind of work. Any signed-in member of staff,
// because the calendar pickers need the list; the rates are stripped for
// everyone but admins inside the controller.
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER', 'RECEPTIONIST'), listPayCategories);

// POST /api/pay-categories — Add a kind of work (Admin only)
router.post('/', authenticate, requireRole('ADMIN'), createPayCategory);

// PUT /api/pay-categories/:id — Rename, reprice or retire it (Admin only)
router.put('/:id', authenticate, requireRole('ADMIN'), updatePayCategory);

// DELETE /api/pay-categories/:id — Remove it, if nothing has been booked to it
router.delete('/:id', authenticate, requireRole('ADMIN'), deletePayCategory);

export default router;
