import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import { validate, createPickupAuthSchema } from '../utils/validators.js';
import {
  getStudentPortal,
  getParentPortal,
  getTeacherPortal,
  createPickupAuth,
  getPickupAuths,
  deletePickupAuth,
  getParentBilling,
  createPaymentSession,
  decideSnackReload,
  getFamilyCheckInCode,
  rotateFamilyCheckInCode,
  getStudentClassNotes,
  downloadStudentClassNotes,
  getParentChildClassNotes,
  downloadParentChildClassNotes,
  updateChildProfile,
} from '../controllers/portal.controller.js';

const router = Router();

// Portal caches are per-user. Teacher TTL is short (30 s) since it reflects today's live sessions.
router.get('/student', authenticate, requireRole('STUDENT'),
  withCache(req => `portal:student:${req.user.id}`, 60),
  getStudentPortal
);

router.get('/parent', authenticate, requireRole('PARENT'),
  withCache(req => `portal:parent:${req.user.id}`, 60),
  getParentPortal
);

// The day being viewed is part of the key: without it, browsing to tomorrow
// would be served today's cached roster (and would then poison it for 30 s).
// So is the teacher being viewed — an admin hopping between two teachers'
// events on the calendar is the same caller on the same date, and without it
// the second roster comes back as the first one's for the rest of the TTL.
router.get('/teacher', authenticate, requireRole('TEACHER', 'ADMIN'),
  withCache(
    req => `portal:teacher:${req.user.id}:${req.query.teacherId || 'self'}:${req.query.date || 'today'}`,
    30
  ),
  getTeacherPortal
);

// The full lesson-note history for one class the student is (or was) enrolled
// in — the portal card only carries the next few sessions. Cached briefly per
// student and class; a note only changes when a manager approves a plan.
router.get('/student/classes/:classId/notes', authenticate, requireRole('STUDENT'),
  withCache(req => `portal:student:${req.user.id}:class:${req.params.classId}:notes`, 60),
  getStudentClassNotes
);

// Not cached: withCache stores the JSON body, and a PDF is neither JSON nor
// worth holding in memory.
router.get('/student/classes/:classId/notes/pdf', authenticate, requireRole('STUDENT'), downloadStudentClassNotes);

// Same archive, opened by a parent for one of their children.
router.get('/parent/children/:studentId/classes/:classId/notes', authenticate, requireRole('PARENT'),
  withCache(req => `portal:parent:${req.user.id}:child:${req.params.studentId}:class:${req.params.classId}:notes`, 60),
  getParentChildClassNotes
);
router.get('/parent/children/:studentId/classes/:classId/notes/pdf', authenticate, requireRole('PARENT'), downloadParentChildClassNotes);

// Pickup Authorization routes
// A parent maintaining their own child's health / school details. Not cached
// and not role-shared: the controller checks family membership per request.
router.put('/parent/children/:studentId', authenticate, requireRole('PARENT'), updateChildProfile);

router.get('/parent/pickup', authenticate, requireRole('PARENT'), getPickupAuths);
router.post('/parent/pickup', authenticate, requireRole('PARENT'), validate(createPickupAuthSchema), createPickupAuth);
router.delete('/parent/pickup/:id', authenticate, requireRole('PARENT'), deletePickupAuth);

// The household's standing check-in QR. Students get it too — the one arriving
// is often the one holding the phone. Only a parent may void it and reissue.
router.get('/family/check-in-code', authenticate, requireRole('PARENT', 'STUDENT'), getFamilyCheckInCode);
router.post('/family/check-in-code/rotate', authenticate, requireRole('PARENT'), rotateFamilyCheckInCode);

// Snack-punch reload approval
router.patch('/parent/snack-reloads/:id', authenticate, requireRole('PARENT'), decideSnackReload);

// Families are created by staff (Add Student / CSV import) and the parent is
// then invited, so there is no self-service family creation endpoint. Letting a
// freshly signed-up account mint its own Family + STUDENT rows also duplicated
// children who were already imported.

// Billing & Payments
router.get('/parent/billing', authenticate, requireRole('PARENT'), getParentBilling);
router.post('/parent/billing/pay/:invoiceId', authenticate, requireRole('PARENT'), createPaymentSession);

export default router;
