import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listShifts,
  createShift,
  updateShift,
  setShiftAbsence,
  deleteShift,
} from '../controllers/shifts.controller.js';

const router = Router();

// GET /api/shifts — Shifts in a date range. Staff see their own; admins and the
// front desk see the building's (scoped inside the controller).
router.get('/', authenticate, listShifts);

// POST /api/shifts — Schedule someone (Admin only). Scheduling is deciding what
// an hour costs, so it is not delegated to the person being paid for it.
router.post('/', authenticate, requireRole('ADMIN'), createShift);

// POST /api/shifts/absence — nobody worked it, don't pay it (Admin only).
// Declared before /:id so "absence" is never read as a shift id.
router.post('/absence', authenticate, requireRole('ADMIN'), setShiftAbsence);

// PUT /api/shifts/:id — Change one (Admin only)
router.put('/:id', authenticate, requireRole('ADMIN'), updateShift);

// DELETE /api/shifts/:id — Remove it, or cancel it if it already counted (Admin only)
router.delete('/:id', authenticate, requireRole('ADMIN'), deleteShift);

export default router;
