import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  validate,
  createSessionSchema,
  updateAttendanceSchema,
  cancelStudentSchema,
  resolveCancellationSchema,
} from '../utils/validators.js';
import {
  listSessions,
  getSession,
  createSession,
  bulkScheduleSessions,
  bulkUpdateSessions,
  updateSession,
  updateAttendance,
  checkInBoard,
  checkInStudent,
  scanPickup,
  addSessionNote,
  supervisionSessions,
  cancelStudentSession,
  listCancellations,
  resolveCancellation,
  setSessionPayApproval,
} from '../controllers/sessions.controller.js';

const router = Router();

// GET /api/sessions/supervision — Admin supervision view
router.get('/supervision', authenticate, requireRole('ADMIN'), supervisionSessions);

// GET /api/sessions/cancellations — Admin review queue for late cancellations
router.get('/cancellations', authenticate, requireRole('ADMIN'), listCancellations);

// PATCH /api/sessions/cancellations/:id/resolve — Admin decides the final charge
router.patch('/cancellations/:id/resolve', authenticate, requireRole('ADMIN'), validate(resolveCancellationSchema), resolveCancellation);

// GET /api/sessions/check-in-board — Today's rosters for the door (Admin/front
// desk). Above '/:id' so "check-in-board" isn't read as a session id.
router.get('/check-in-board', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), checkInBoard);

// POST /api/sessions/pickup/scan — Validate a pickup QR and release the child
// (Admin/front desk). Above '/:id' so "pickup" isn't read as a session id.
router.post('/pickup/scan', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), scanPickup);

// GET /api/sessions — List sessions for calendar (All auth users)
router.get('/', authenticate, listSessions);

// GET /api/sessions/:id — Get session details (All auth users)
router.get('/:id', authenticate, getSession);

// POST /api/sessions — Create a session (Admin/Teacher)
router.post('/', authenticate, requireRole('ADMIN', 'TEACHER'), validate(createSessionSchema), createSession);

// POST /api/sessions/bulk — Generate recurring sessions for a class (Admin/Teacher)
router.post('/bulk', authenticate, requireRole('ADMIN', 'TEACHER'), bulkScheduleSessions);

// PATCH /api/sessions/bulk — Retime or cancel a whole recurring series (Admin only)
router.patch('/bulk', authenticate, requireRole('ADMIN'), bulkUpdateSessions);

// PUT /api/sessions/:id — Update session status/time (Admin/Teacher)
router.put('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), updateSession);

// PUT /api/sessions/:id/attendance — Batch update attendance (Admin/Teacher)
router.put('/:id/attendance', authenticate, requireRole('ADMIN', 'TEACHER'), validate(updateAttendanceSchema), updateAttendance);

// POST /api/sessions/:id/check-in — Record one arrival/departure at the door
// (Admin/front desk). Narrower than the attendance sheet above on purpose: it
// only writes PRESENT/LATE for today, so the desk can never trip the no-show
// review that suggests a charge. See checkInStudent.
router.post('/:id/check-in', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), checkInStudent);

// POST /api/sessions/:id/notes — Add session notes (Admin/Teacher)
router.post('/:id/notes', authenticate, requireRole('ADMIN', 'TEACHER'), addSessionNote);

// POST /api/sessions/:id/cancel-student — Cancel one student's spot (Admin/front desk)
router.post('/:id/cancel-student', authenticate, requireRole('ADMIN'), validate(cancelStudentSchema), cancelStudentSession);

// POST /api/sessions/pay-approval — Pay for classes nobody closed out (Admin only).
// Authorising money against no register is an admin decision and nobody else's,
// least of all the teacher being paid for the hour.
router.post('/pay-approval', authenticate, requireRole('ADMIN'), setSessionPayApproval);

export default router;
