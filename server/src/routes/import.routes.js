import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { importStudents } from '../controllers/import.controller.js';

const router = Router();

// POST /api/import/students — bulk import students/families (Admin)
router.post('/students', authenticate, requireRole('ADMIN'), importStudents);

export default router;
