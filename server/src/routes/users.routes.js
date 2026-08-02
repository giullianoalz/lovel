import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireSelfOrRole } from '../middleware/roles.js';
import {
  listUsers,
  getUser,
  updateUser,
  updateUserStatus,
  inviteUser,
  setTeachingRole,
  getTeacherPayroll,
  updateTeacherPayroll,
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

// POST /api/users/:id/invite — Email a set-your-password link (Admin only)
router.post('/:id/invite', authenticate, requireRole('ADMIN'), inviteUser);

// POST|DELETE /api/users/:id/teaching-role — Let an account be assigned to classes (Admin only)
router.post('/:id/teaching-role', authenticate, requireRole('ADMIN'), setTeachingRole);
router.delete('/:id/teaching-role', authenticate, requireRole('ADMIN'), setTeachingRole);

// GET /api/users/:id/payroll — Get teacher payroll summary (Admin or self)
router.get('/:id/payroll', authenticate, requireSelfOrRole('ADMIN'), getTeacherPayroll);

// PUT /api/users/:id/payroll — Set a teacher's pay rates (Admin ONLY).
// Not requireSelfOrRole, unlike the GET above and unlike PUT /:id: reading your
// own pay is fine, setting it is not.
router.put('/:id/payroll', authenticate, requireRole('ADMIN'), updateTeacherPayroll);

export default router;
