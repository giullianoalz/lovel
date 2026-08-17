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
  scanFamilyCode,
  attendanceLog,
  addSessionNote,
  updateSessionNote,
  supervisionSessions,
  cancelStudentSession,
  listCancellations,
  resolveCancellation,
  setSessionAbsence,
} from '../controllers/sessions.controller.js';

const router = Router();

// GET /api/sessions/supervision — Admin supervision view
router.get('/supervision', authenticate, requireRole('ADMIN'), supervisionSessions);

// GET /api/sessions/cancellations — Admin review queue for late cancellations
router.get('/cancellations', authenticate, requireRole('ADMIN'), listCancellations);

// PATCH /api/sessions/cancellations/:id/resolve — Admin decides the final charge
router.patch('/cancellations/:id/resolve', authenticate, requireRole('ADMIN'), validate(resolveCancellationSchema), resolveCancellation);

/**
 * The door, for whoever is standing at it.
 *
 * Teachers are on this list alongside admins and the desk: covering reception
 * for an hour is ordinary here, and a teacher who can't check anyone in has to
 * fetch someone who can while a parent waits. What they may write is unchanged
 * — arrivals and departures for today, never an absence (see checkInStudent).
 *
 * All three sit above '/:id' so "check-in-board", "pickup" and "front-desk"
 * aren't read as session ids.
 */
const DESK_ROLES = ['ADMIN', 'RECEPTIONIST', 'TEACHER'];

// GET /api/sessions/check-in-board — Today's rosters for the door
router.get('/check-in-board', authenticate, requireRole(...DESK_ROLES), checkInBoard);

// POST /api/sessions/pickup/scan — Validate a pickup QR and release the child
router.post('/pickup/scan', authenticate, requireRole(...DESK_ROLES), scanPickup);

// POST /api/sessions/front-desk/scan — Resolve a family's standing QR into who
// it covers and where they stand today. Read-only; the check-in route writes.
router.post('/front-desk/scan', authenticate, requireRole(...DESK_ROLES), scanFamilyCode);

// GET /api/sessions/attendance-log — Door arrivals/departures and sheet marks,
// as they happened, with who recorded each one. Whoever may work the door or
// the sheet may read what either one wrote.
router.get('/attendance-log', authenticate, requireRole(...DESK_ROLES, 'ADMIN'), attendanceLog);

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
// (see DESK_ROLES). Narrower than the attendance sheet above on purpose: it
// only writes PRESENT/LATE for today, so whoever is on the door can never trip
// the no-show review that suggests a charge. See checkInStudent.
router.post('/:id/check-in', authenticate, requireRole(...DESK_ROLES), checkInStudent);

// POST /api/sessions/:id/notes — Add session notes (Admin/Teacher)
router.post('/:id/notes', authenticate, requireRole('ADMIN', 'TEACHER'), addSessionNote);

// PATCH /api/sessions/:id/notes/:noteId — Edit a note in place (Admin/Teacher)
router.patch('/:id/notes/:noteId', authenticate, requireRole('ADMIN', 'TEACHER'), updateSessionNote);

// POST /api/sessions/:id/cancel-student — Cancel one student's spot (Admin/front desk)
router.post('/:id/cancel-student', authenticate, requireRole('ADMIN'), validate(cancelStudentSchema), cancelStudentSession);

// POST /api/sessions/absence — the teacher didn't turn up, don't pay it (Admin only).
// Taking an hour off somebody's pay is an admin decision and nobody else's,
// least of all the teacher whose hour it is.
router.post('/absence', authenticate, requireRole('ADMIN'), setSessionAbsence);

export default router;
