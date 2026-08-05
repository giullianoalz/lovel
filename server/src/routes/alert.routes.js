import { Router } from 'express';
import { createAlert, listAlerts, updateAlert } from '../controllers/alert.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();

// Only teachers and admins can create alerts
router.post('/', authenticate, requireRole('TEACHER', 'ADMIN'), createAlert);

// Admins and receptionists can list all alerts (receptionists are view-only)
router.get('/', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), listAlerts);

// Front desk closes out the alerts it just handled, same as admins
router.patch('/:id', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), updateAlert);

export default router;
