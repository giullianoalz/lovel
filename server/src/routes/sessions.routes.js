import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listSessions,
  getSession,
  createSession,
  updateSession,
  updateAttendance,
  addSessionNote,
} from '../controllers/sessions.controller.js';

const router = Router();

// GET /api/sessions — List sessions for calendar (All auth users)
router.get('/', authenticate, listSessions);

// GET /api/sessions/:id — Get session details (All auth users)
router.get('/:id', authenticate, getSession);

// POST /api/sessions — Create a session (Admin/Teacher)
router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), createSession);

// PUT /api/sessions/:id — Update session status/time (Admin/Teacher)
router.put('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), updateSession);

// PUT /api/sessions/:id/attendance — Batch update attendance (Admin/Teacher)
router.put('/:id/attendance', authenticate, requireRole('ADMIN', 'TEACHER'), updateAttendance);

// POST /api/sessions/:id/notes — Add session notes (Admin/Teacher)
router.post('/:id/notes', authenticate, requireRole('ADMIN', 'TEACHER'), addSessionNote);

export default router;
