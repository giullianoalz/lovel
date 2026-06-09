import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import {
  listClasses,
  getClass,
  createClass,
  updateClass,
  enrollStudent,
  unenrollStudent,
} from '../controllers/classes.controller.js';

const router = Router();

// GET /api/classes — key includes query string so filters get their own cache slot
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'),
  withCache(req => `classes:${new URLSearchParams(req.query).toString() || 'all'}`, 60),
  listClasses
);

// GET /api/classes/:id — Get class details (Admin/Teacher)
router.get('/:id', authenticate, requireRole('ADMIN', 'TEACHER'),
  withCache(req => `classes:${req.params.id}`, 60),
  getClass
);

// POST /api/classes — Create a new class (Admin)
router.post('/', authenticate, requireRole('ADMIN'), createClass);

// PUT /api/classes/:id — Update a class (Admin)
router.put('/:id', authenticate, requireRole('ADMIN'), updateClass);

// POST /api/classes/:id/enrollments — Enroll student (Admin)
router.post('/:id/enrollments', authenticate, requireRole('ADMIN'), enrollStudent);

// DELETE /api/classes/:id/enrollments/:studentId — Unenroll student (Admin)
router.delete('/:id/enrollments/:studentId', authenticate, requireRole('ADMIN'), unenrollStudent);

export default router;
