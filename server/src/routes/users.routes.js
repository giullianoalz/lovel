import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireSelfOrRole } from '../middleware/roles.js';
import { withCache } from '../middleware/cache.js';
import {
  listUsers,
  getUser,
  updateUser,
  updateUserStatus,
  inviteUser,
  inviteUsersBulk,
  setTeachingRole,
  getTeacherPayroll,
  getPayrollSummary,
  getWeeklyPayrollSummary,
  getProjectedPayroll,
  getMyProjectedPayroll,
  updateTeacherPayroll,
  getPayrollBalances,
  getTeacherLedger,
  createTeacherPayment,
  updateTeacherPaymentEntry,
  deleteTeacherPaymentEntry,
} from '../controllers/users.controller.js';

const router = Router();

// GET /api/users — List all users (Admin/Teacher)
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listUsers);

// GET /api/users/payroll/summary — The whole roster's pay for one month (Admin only).
// Declared before /:id so "payroll" is never read as a user id.
router.get('/payroll/summary', authenticate, requireRole('ADMIN'), getPayrollSummary);

// GET /api/users/payroll/weekly-summary — The whole roster's pay for one
// Monday-Sunday week (Admin only). Also declared before /:id.
router.get('/payroll/weekly-summary', authenticate, requireRole('ADMIN'), getWeeklyPayrollSummary);

// GET /api/users/payroll/projected — What the calendar already commits the
// academy to paying, per person (Admin only). Also declared before /:id.
router.get('/payroll/projected', authenticate, requireRole('ADMIN'), getProjectedPayroll);

// GET /api/users/payroll/balances — Who is owed what right now (Admin only).
// The payday screen, as opposed to the three above, which are periods.
// Cached, unlike its neighbours: this one prices every hour the academy has
// ever scheduled, which takes seconds rather than milliseconds. Two minutes is
// short enough that nothing else on the screen can drift, and recording a
// payment drops the entry outright (see the controller) so the number a
// balance was just settled to is never the stale one.
router.get(
  '/payroll/balances',
  authenticate,
  requireRole('ADMIN'),
  withCache((req) => `payroll:balances:${req.query.asOf || 'today'}`, 120),
  getPayrollBalances
);

// PUT|DELETE /api/users/payroll/payments/:paymentId — Correct or remove a
// recorded payment (Admin only). Addressed by the payment rather than the
// person: the row already knows whose it is, and declared before /:id so
// "payroll" is never read as a user id.
router.put('/payroll/payments/:paymentId', authenticate, requireRole('ADMIN'), updateTeacherPaymentEntry);
router.delete('/payroll/payments/:paymentId', authenticate, requireRole('ADMIN'), deleteTeacherPaymentEntry);

// GET /api/users/:id — Get a user by ID (Admin/Teacher or self)
router.get('/:id', authenticate, requireSelfOrRole('ADMIN', 'TEACHER'), getUser);

// PUT /api/users/:id — Update user profile (Admin or self)
router.put('/:id', authenticate, requireSelfOrRole('ADMIN'), updateUser);

// PUT /api/users/:id/status — Change user status (Admin only)
router.put('/:id/status', authenticate, requireRole('ADMIN'), updateUserStatus);

// POST /api/users/invite-bulk — Invite several people at once (Admin only).
// Declared before /:id/invite so "invite-bulk" is never read as an :id.
router.post('/invite-bulk', authenticate, requireRole('ADMIN'), inviteUsersBulk);

// POST /api/users/:id/invite — Email a set-your-password link (Admin only)
router.post('/:id/invite', authenticate, requireRole('ADMIN'), inviteUser);

// POST|DELETE /api/users/:id/teaching-role — Let an account be assigned to classes (Admin only)
router.post('/:id/teaching-role', authenticate, requireRole('ADMIN'), setTeachingRole);
router.delete('/:id/teaching-role', authenticate, requireRole('ADMIN'), setTeachingRole);

// GET /api/users/:id/payroll/projected — One person's upcoming pay (Admin or
// self). Declared before /:id/payroll so "projected" is never read as a month.
router.get('/:id/payroll/projected', authenticate, requireSelfOrRole('ADMIN'), getMyProjectedPayroll);

// GET /api/users/:id/payroll/ledger — One person's statement: every hour
// earned, every payment made, and the balance after each (Admin or self).
// Declared before /:id/payroll so "ledger" is never read as a month.
router.get('/:id/payroll/ledger', authenticate, requireSelfOrRole('ADMIN'), getTeacherLedger);

// POST /api/users/:id/payroll/payments — Record money paid to somebody (Admin
// ONLY). Reading your own balance is fine; settling it is not.
router.post('/:id/payroll/payments', authenticate, requireRole('ADMIN'), createTeacherPayment);

// GET /api/users/:id/payroll — Get teacher payroll summary (Admin or self)
router.get('/:id/payroll', authenticate, requireSelfOrRole('ADMIN'), getTeacherPayroll);

// PUT /api/users/:id/payroll — Set a teacher's pay rates (Admin ONLY).
// Not requireSelfOrRole, unlike the GET above and unlike PUT /:id: reading your
// own pay is fine, setting it is not.
router.put('/:id/payroll', authenticate, requireRole('ADMIN'), updateTeacherPayroll);

export default router;
