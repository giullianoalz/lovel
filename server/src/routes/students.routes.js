import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireSelfOrRole } from '../middleware/roles.js';
import {
  listStudents,
  getStudent,
  updateStudentHealth,
  updateSnackPunches,
  getAttendanceSummary,
  exportStudentsCsv,
} from '../controllers/students.controller.js';

const router = Router();

// GET /api/students — List all students (Admin/Teacher/Front desk)
// The front desk needs the roster to hand out seashells and to know who's who
// at the door. Detail below stays ADMIN/TEACHER — the profile carries medical
// and billing history the desk has no business reading.
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER', 'RECEPTIONIST'), listStudents);

// GET /api/students/export — Download all students as CSV (Admin)
// Registered before '/:id' so "export" isn't captured as an id param.
router.get('/export', authenticate, requireRole('ADMIN'), exportStudentsCsv);

// GET /api/students/:id — Get student detail (Admin/Teacher or self)
router.get('/:id', authenticate, requireSelfOrRole('ADMIN', 'TEACHER'), getStudent);

// PUT /api/students/:id/health — Update health info (Admin)
router.put('/:id/health', authenticate, requireRole('ADMIN'), updateStudentHealth);

// PUT /api/students/:id/snack-punches — Update snack punches (Admin/Teacher)
router.put('/:id/snack-punches', authenticate, requireRole('ADMIN', 'TEACHER'), updateSnackPunches);

// GET /api/students/:id/attendance-summary — Attendance stats (Admin/Teacher or self)
router.get('/:id/attendance-summary', authenticate, requireSelfOrRole('ADMIN', 'TEACHER'), getAttendanceSummary);

export default router;
