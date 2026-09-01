import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate, createTransactionSchema, createInvoiceSchema } from '../utils/validators.js';
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listInvoices,
  createInvoice,
  mergeInvoices,
  splitInvoice,
  applyCreditToInvoice,
  voidInvoice,
  editInvoice,
  getInvoice,
  downloadInvoicePdf,
  sendInvoice,
  generateEmaBatch,
  reconcileEmaRemittance,
  refundPayment,
  generateSessionCharges,
  setSessionChargeOverride,
  listBlockSessions,
  createBlockInvoice,
  listBlockRoster,
  createBlockInvoices,
} from '../controllers/billing.controller.js';
import {
  listRecurringCharges,
  createRecurringCharge,
  updateRecurringCharge,
  deleteRecurringCharge,
  previewDueCharges,
  runRecurringChargesNow,
} from '../controllers/recurringCharges.controller.js';

const router = Router();

// GET /api/billing/transactions — List transactions (Admin)
router.get('/transactions', authenticate, requireRole('ADMIN'), listTransactions);

// POST /api/billing/transactions — Create a transaction (Admin)
router.post('/transactions', authenticate, requireRole('ADMIN'), validate(createTransactionSchema), createTransaction);

// PATCH /api/billing/transactions/:id — Correct a mistaken entry (Admin).
// Date/amount/description/student; `type` is not editable — see the controller.
router.patch('/transactions/:id', authenticate, requireRole('ADMIN'), updateTransaction);

// DELETE /api/billing/transactions/:id — Remove a mistaken/test entry (Admin).
// Refused once an invoice or payment depends on it — see the controller.
router.delete('/transactions/:id', authenticate, requireRole('ADMIN'), deleteTransaction);

// Standing monthly charges (Admin). "due" and "run" are declared before "/:id"
// so neither word is ever read as an id.
router.get('/recurring/due', authenticate, requireRole('ADMIN'), previewDueCharges);
router.post('/recurring/run', authenticate, requireRole('ADMIN'), runRecurringChargesNow);
router.get('/recurring', authenticate, requireRole('ADMIN'), listRecurringCharges);
router.post('/recurring', authenticate, requireRole('ADMIN'), createRecurringCharge);
router.patch('/recurring/:id', authenticate, requireRole('ADMIN'), updateRecurringCharge);
router.delete('/recurring/:id', authenticate, requireRole('ADMIN'), deleteRecurringCharge);

// GET /api/billing/invoices — List invoices (Admin)
router.get('/invoices', authenticate, requireRole('ADMIN'), listInvoices);

// POST /api/billing/invoices — Generate an invoice (Admin)
router.post('/invoices', authenticate, requireRole('ADMIN'), validate(createInvoiceSchema), createInvoice);

// POST /api/billing/invoices/merge — Fold several of one family's invoices
// into one document (Admin). Declared before "/invoices/:id" so "merge" is
// never read as an id.
router.post('/invoices/merge', authenticate, requireRole('ADMIN'), mergeInvoices);

// The invoice document: its full specification, its PDF, and emailing it
// (Admin). Declared before "/invoices/:id" itself so neither suffix is ever
// read as part of an id.
router.get('/invoices/:id/pdf', authenticate, requireRole('ADMIN'), downloadInvoicePdf);
router.post('/invoices/:id/send', authenticate, requireRole('ADMIN'), sendInvoice);
// POST /api/billing/invoices/:id/split — Break a household invoice back into
// one per student (Admin). Same "before the generic GET/PATCH/DELETE :id
// routes" placement as pdf/send, for the same reason.
router.post('/invoices/:id/split', authenticate, requireRole('ADMIN'), splitInvoice);
// POST /api/billing/invoices/:id/apply-credit — Sweep existing account
// credit onto this invoice (Admin). Same placement reasoning as split/send.
router.post('/invoices/:id/apply-credit', authenticate, requireRole('ADMIN'), applyCreditToInvoice);
router.get('/invoices/:id', authenticate, requireRole('ADMIN'), getInvoice);

// PATCH /api/billing/invoices/:id — Rewrite an invoice's line items (Admin).
// Refused once a payment has touched it — see the controller.
router.patch('/invoices/:id', authenticate, requireRole('ADMIN'), editInvoice);

// DELETE /api/billing/invoices/:id — Void a mistaken invoice (Admin).
// Refused once a payment has touched it — see the controller.
router.delete('/invoices/:id', authenticate, requireRole('ADMIN'), voidInvoice);

// EMA Step Up — generate invoices from the Step Up CSV (Admin)
router.post('/ema/generate', authenticate, requireRole('ADMIN'), generateEmaBatch);

// EMA Step Up — reconcile a lump remittance against invoices (Admin)
router.post('/ema/reconcile', authenticate, requireRole('ADMIN'), reconcileEmaRemittance);

// POST /api/billing/payments/:id/refund — Refund a payment (Stripe reversal if card, ledger-only otherwise) (Admin)
router.post('/payments/:id/refund', authenticate, requireRole('ADMIN'), refundPayment);

// POST /api/billing/session-charges — the exception path (Admin). Pricing a
// meeting on the calendar already charges it; this is for the one case the
// automatic path refuses: a student who enrolled after the meeting happened.
router.post('/session-charges', authenticate, requireRole('ADMIN'), generateSessionCharges);

// PUT /api/billing/session-charges/override — what one student pays for one
// meeting, when the meeting's own price doesn't apply to them (Admin only).
router.put('/session-charges/override', authenticate, requireRole('ADMIN'), setSessionChargeOverride);

// GET /api/billing/block-sessions — a student's scheduled meetings, priced or
// not, so a block can be billed before it is taught (Admin). Read-only.
router.get('/block-sessions', authenticate, requireRole('ADMIN'), listBlockSessions);

// POST /api/billing/block-invoice — one invoice for a block of meetings, raised
// up front (Admin). Each meeting carries its sessionId, so the calendar sweep
// skips it later instead of billing it twice.
router.post('/block-invoice', authenticate, requireRole('ADMIN'), createBlockInvoice);

// The same block across a whole roster (Admin). "block-roster" is the sheet;
// "block-invoices" (plural) is the run that bills every family on it.
router.get('/block-roster', authenticate, requireRole('ADMIN'), listBlockRoster);
router.post('/block-invoices', authenticate, requireRole('ADMIN'), createBlockInvoices);

export default router;
