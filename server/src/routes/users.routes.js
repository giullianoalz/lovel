import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireSelfOrRole } from '../middleware/roles.js';
import {
  listUsers,
  getUser,
  updateUser,
  updateUserStatus,
  getTeacherPayroll,
} from '../controllers/users.controller.js';

const router = Router();

// GET /api/users — List all users (Admin/Teacher)
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listUsers);

// GET /api/users/:id — Get a user by ID (Admin/Teacher or self)
router.get('/:id', authenticate, requireSelfOrRole('ADMIN', 'TEACHER'), getUser);

// PUT /api/users/:id — Update user profile (Admin or self)
router.put('/:id', authenticate, requireSelfOrRole('ADMIN'), updateUser);

// PUT /api/users/:id/status — Change user status (Admin only)
router.put('/:id/status', authenticate, requireRole('ADMIN'), updateUserStatus);

// GET /api/users/:id/payroll — Get teacher payroll summary (Admin or self)
router.get('/:id/payroll', authenticate, requireSelfOrRole('ADMIN'), getTeacherPayroll);

export default router;
