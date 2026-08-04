import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import { validate, registrationRequestSchema, termIdQuerySchema } from '../utils/validators.js';
import {
  createTerm,
  seedPriorityHolds,
  getRegistrationStatus,
  getParentRegistration,
  submitRegistrationRequest,
  promoteFromWaitlist,
  getTerms,
  updateTerm,
  getRegistrationClasses,
  getClassRoster,
  revokeHold,
  moveRosterStudent,
  removeFromWaitlist,
  sweepHolds,
  remindHolds,
  getBillingSummary,
  resendBillingEmail,
  cancelRegistrationRequest,
  previewQuarterCharges,
  generateQuarterCharges,
  adminRegisterStudent,
  getTermElectives,
  createElective,
  updateElective,
  deleteElective,
  getEnrollmentApplications,
  declineApplication,
} from '../controllers/registration.controller.js';

const router = Router();

// --- ADMIN ROUTES ---
router.get('/terms', authenticate, requireRole('ADMIN'), withCache('registration:terms', 120), getTerms);
router.post('/terms', authenticate, requireRole('ADMIN'), createTerm);
router.put('/terms/:id', authenticate, requireRole('ADMIN'), updateTerm);
router.post('/terms/:id/seed-priority', authenticate, requireRole('ADMIN'), seedPriorityHolds);

router.get('/classes', authenticate, requireRole('ADMIN'), withCache(req => `registration:classes:${req.query.termId || 'all'}`, 60), getRegistrationClasses);
router.get('/classes/:id/roster', authenticate, requireRole('ADMIN'), getClassRoster);

// Electives for a specific term (used by Manual Registration UI)
router.get('/terms/:id/electives', authenticate, requireRole('ADMIN'), getTermElectives);
router.post('/terms/:id/electives', authenticate, requireRole('ADMIN'), createElective);
// Keyed by the elective itself — it already knows its term, and repeating the
// term in the path would let the two disagree.
router.put('/electives/:electiveId', authenticate, requireRole('ADMIN'), updateElective);
router.delete('/electives/:electiveId', authenticate, requireRole('ADMIN'), deleteElective);

router.post('/promote/:classId', authenticate, requireRole('ADMIN'), promoteFromWaitlist);

router.delete('/holds/:id', authenticate, requireRole('ADMIN'), revokeHold);
router.post('/classes/:id/holds/sweep', authenticate, requireRole('ADMIN'), sweepHolds);
router.post('/classes/:id/holds/remind', authenticate, requireRole('ADMIN'), remindHolds);
router.post('/classes/:id/roster/:studentId/move', authenticate, requireRole('ADMIN'), moveRosterStudent);
router.delete('/waitlist/:studentId', authenticate, requireRole('ADMIN'), removeFromWaitlist);

router.get('/billing-summary', authenticate, requireRole('ADMIN'), getBillingSummary);

// Quarterly tuition. The preview is read-only; the POST is what commits money,
// so both stay admin-only and neither is cached — an amount has to reflect the
// roster as it is right now, not a minute ago.
router.get('/quarter-charges', authenticate, requireRole('ADMIN'), previewQuarterCharges);
router.post('/quarter-charges', authenticate, requireRole('ADMIN'), generateQuarterCharges);
router.post('/requests/:id/resend-email', authenticate, requireRole('ADMIN'), resendBillingEmail);

// DELETE /api/registration/requests/:id — Undo a registration entirely (Admin).
// Frees the seat and removes the charge it raised, unless that charge is
// already invoiced or paid — see the controller.
router.delete('/requests/:id', authenticate, requireRole('ADMIN'), cancelRegistrationRequest);

// Self-signup review queue. Deliberately uncached: a placement made from this
// screen has to disappear from it on the next load, not a minute later.
router.get('/applications', authenticate, requireRole('ADMIN'), getEnrollmentApplications);
router.post('/applications/:id/decline', authenticate, requireRole('ADMIN'), declineApplication);

// Admin manual registration — bypasses window guards. Approving an application
// is this same call with its `applicationId`.
router.post('/admin-register', authenticate, requireRole('ADMIN'), adminRegisterStudent);

// --- PARENT/USER ROUTES ---
// Consolidated parent registration view (open term, children eligibility, coves)
router.get('/parent', authenticate, getParentRegistration);

// Check window and status for a student (requires ?termId=)
router.get('/status/:studentId', authenticate, validate(termIdQuerySchema, 'query'), getRegistrationStatus);

// Submit 1st/2nd choice
router.post('/request', authenticate, validate(registrationRequestSchema), submitRegistrationRequest);

export default router;
