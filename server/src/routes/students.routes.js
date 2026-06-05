import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireSelfOrRole } from '../middleware/roles.js';
import {
  listStudents,
  getStudent,
  updateStudentHealth,
  updateSnackPunches,
  getAttendanceSummary,
} from '../controllers/students.controller.js';

const router = Router();

// GET /api/students — List all students (Admin/Teacher)
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listStudents);

// GET /api/students/:id — Get student detail (Admin/Teacher or self)
router.get('/:id', authenticate, requireSelfOrRole('ADMIN', 'TEACHER'), getStudent);

// PUT /api/students/:id/health — Update health info (Admin)
router.put('/:id/health', authenticate, requireRole('ADMIN'), updateStudentHealth);

// PUT /api/students/:id/snack-punches — Update snack punches (Admin/Teacher)
router.put('/:id/snack-punches', authenticate, requireRole('ADMIN', 'TEACHER'), updateSnackPunches);

// GET /api/students/:id/attendance-summary — Attendance stats (Admin/Teacher or self)
router.get('/:id/attendance-summary', authenticate, requireSelfOrRole('ADMIN', 'TEACHER'), getAttendanceSummary);

export default router;
