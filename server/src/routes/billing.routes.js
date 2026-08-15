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
  voidInvoice,
  editInvoice,
  getInvoice,
  downloadInvoicePdf,
  sendInvoice,
  generateEmaBatch,
  reconcileEmaRemittance,
  refundPayment,
  previewSessionCharges,
  generateSessionCharges,
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

// The invoice document: its full specification, its PDF, and emailing it
// (Admin). Declared before "/invoices/:id" itself so neither suffix is ever
// read as part of an id.
router.get('/invoices/:id/pdf', authenticate, requireRole('ADMIN'), downloadInvoicePdf);
router.post('/invoices/:id/send', authenticate, requireRole('ADMIN'), sendInvoice);
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

// GET /api/billing/session-charges — What the priced meetings would charge (Admin).
// Read-only: this is the sheet reviewed before any money is committed.
router.get('/session-charges', authenticate, requireRole('ADMIN'), previewSessionCharges);

// POST /api/billing/session-charges — Raise those charges into the ledger (Admin).
// Committing money to real families is an admin decision and nobody else's.
router.post('/session-charges', authenticate, requireRole('ADMIN'), generateSessionCharges);

export default router;
