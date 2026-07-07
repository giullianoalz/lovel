import { Router } from 'express';
import { createAlert, listAlerts, updateAlert } from '../controllers/alert.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();

// Only teachers and admins can create alerts
router.post('/', authenticate, requireRole('TEACHER', 'ADMIN'), createAlert);

// Only front desk/admins can list all alerts
router.get('/', authenticate, requireRole('ADMIN'), listAlerts);

// Front desk/admins can resolve alerts
router.patch('/:id', authenticate, requireRole('ADMIN'), updateAlert);

export default router;
