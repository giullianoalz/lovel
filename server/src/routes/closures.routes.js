import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listClosures,
  previewClosure,
  createClosure,
  deleteClosure,
  closureConflicts,
} from '../controllers/closures.controller.js';

const router = Router();

// GET /api/closures — the declared closures. Readable by any authenticated
// user: a teacher looking at a gap in their payslip is owed the reason for it.
router.get('/', authenticate, listClosures);

// GET /api/closures/preview — what closing these days would cost, before it is
// done. Declared before /:id so "preview" is never read as a closure id.
router.get('/preview', authenticate, requireRole('ADMIN'), previewClosure);

// GET /api/closures/conflicts — closed days that still have meetings on them.
router.get('/conflicts', authenticate, requireRole('ADMIN'), closureConflicts);

// POST /api/closures — declare a day or a range closed (Admin only). It takes
// pay away from other people, so it is not delegated.
router.post('/', authenticate, requireRole('ADMIN'), createClosure);

// DELETE /api/closures/:id — the academy is open that day after all.
router.delete('/:id', authenticate, requireRole('ADMIN'), deleteClosure);

export default router;
