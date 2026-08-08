import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate, createTransactionSchema, createInvoiceSchema } from '../utils/validators.js';
import {
  listTransactions,
  createTransaction,
  updateTransactionDate,
  deleteTransaction,
  listInvoices,
  createInvoice,
  voidInvoice,
  generateEmaBatch,
  reconcileEmaRemittance,
  refundPayment,
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

// PATCH /api/billing/transactions/:id — Correct a mistaken entry's date (Admin).
router.patch('/transactions/:id', authenticate, requireRole('ADMIN'), updateTransactionDate);

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

// DELETE /api/billing/invoices/:id — Void a mistaken invoice (Admin).
// Refused once a payment has touched it — see the controller.
router.delete('/invoices/:id', authenticate, requireRole('ADMIN'), voidInvoice);

// EMA Step Up — generate invoices from the Step Up CSV (Admin)
router.post('/ema/generate', authenticate, requireRole('ADMIN'), generateEmaBatch);

// EMA Step Up — reconcile a lump remittance against invoices (Admin)
router.post('/ema/reconcile', authenticate, requireRole('ADMIN'), reconcileEmaRemittance);

// POST /api/billing/payments/:id/refund — Refund a payment (Stripe reversal if card, ledger-only otherwise) (Admin)
router.post('/payments/:id/refund', authenticate, requireRole('ADMIN'), refundPayment);

export default router;
