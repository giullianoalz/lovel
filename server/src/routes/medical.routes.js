import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  createMedicalLog,
  listMedicalLogs,
  updateMedicalLog
} from '../controllers/medical.controller.js';

const router = Router();

// POST /api/medical
router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), createMedicalLog);

// GET /api/medical
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listMedicalLogs);

// PUT /api/medical/:id
router.put('/:id', authenticate, requireRole('ADMIN'), updateMedicalLog);

export default router;
