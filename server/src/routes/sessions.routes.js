import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listSessions,
  getSession,
  createSession,
  bulkScheduleSessions,
  updateSession,
  updateAttendance,
  addSessionNote,
  supervisionSessions,
} from '../controllers/sessions.controller.js';

const router = Router();

// GET /api/sessions/supervision — Admin supervision view
router.get('/supervision', authenticate, requireRole('ADMIN'), supervisionSessions);

// GET /api/sessions — List sessions for calendar (All auth users)
router.get('/', authenticate, listSessions);

// GET /api/sessions/:id — Get session details (All auth users)
router.get('/:id', authenticate, getSession);

// POST /api/sessions — Create a session (Admin/Teacher)
router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), createSession);

// POST /api/sessions/bulk — Generate recurring sessions for a class (Admin/Teacher)
router.post('/bulk', authenticate, requireRole('ADMIN', 'TEACHER'), bulkScheduleSessions);

// PUT /api/sessions/:id — Update session status/time (Admin/Teacher)
router.put('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), updateSession);

// PUT /api/sessions/:id/attendance — Batch update attendance (Admin/Teacher)
router.put('/:id/attendance', authenticate, requireRole('ADMIN', 'TEACHER'), updateAttendance);

// POST /api/sessions/:id/notes — Add session notes (Admin/Teacher)
router.post('/:id/notes', authenticate, requireRole('ADMIN', 'TEACHER'), addSessionNote);

export default router;
