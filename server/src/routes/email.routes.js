import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { previewInviteEmail, previewBillingEmail } from '../controllers/email.controller.js';

const router = Router();

// Both power the review-before-sending modal — an admin edits the subject and
// message, this renders the real template around it so they see exactly what
// a family would receive before anything goes out.
router.post('/preview/invite', authenticate, requireRole('ADMIN'), previewInviteEmail);
router.post('/preview/billing', authenticate, requireRole('ADMIN'), previewBillingEmail);

export default router;
