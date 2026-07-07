import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
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
  sweepHolds,
  remindHolds,
  getBillingSummary,
  resendBillingEmail
} from '../controllers/registration.controller.js';

const router = Router();

// --- ADMIN ROUTES ---
router.get('/terms', authenticate, requireRole('ADMIN'), withCache('registration:terms', 120), getTerms);
router.post('/terms', authenticate, requireRole('ADMIN'), createTerm);
router.put('/terms/:id', authenticate, requireRole('ADMIN'), updateTerm);
router.post('/terms/:id/seed-priority', authenticate, requireRole('ADMIN'), seedPriorityHolds);

router.get('/classes', authenticate, requireRole('ADMIN'), withCache('registration:classes', 60), getRegistrationClasses);
router.get('/classes/:id/roster', authenticate, requireRole('ADMIN'), getClassRoster);

router.post('/promote/:classId', authenticate, requireRole('ADMIN'), promoteFromWaitlist);

router.delete('/holds/:id', authenticate, requireRole('ADMIN'), revokeHold);
router.post('/classes/:id/holds/sweep', authenticate, requireRole('ADMIN'), sweepHolds);
router.post('/classes/:id/holds/remind', authenticate, requireRole('ADMIN'), remindHolds);

router.get('/billing-summary', authenticate, requireRole('ADMIN'), getBillingSummary);
router.post('/requests/:id/resend-email', authenticate, requireRole('ADMIN'), resendBillingEmail);

// --- PARENT/USER ROUTES ---
// Consolidated parent registration view (open term, children eligibility, pods)
router.get('/parent', authenticate, getParentRegistration);

// Check window and status for a student
router.get('/status/:studentId', authenticate, getRegistrationStatus);

// Submit 1st/2nd choice
router.post('/request', authenticate, submitRegistrationRequest);

export default router;
