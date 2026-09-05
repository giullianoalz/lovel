import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { sendTextToParent } from '../controllers/sms.controller.js';

const router = Router();

// POST /api/sms/send-to-parent — one-off text to a student's parent (Admin/Front desk)
router.post('/send-to-parent', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), sendTextToParent);

export default router;
