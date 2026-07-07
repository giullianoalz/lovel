import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listTransactions,
  createTransaction,
  listInvoices,
  createInvoice,
  generateEmaBatch,
  reconcileEmaRemittance,
} from '../controllers/billing.controller.js';

const router = Router();

// GET /api/billing/transactions — List transactions (Admin)
router.get('/transactions', authenticate, requireRole('ADMIN'), listTransactions);

// POST /api/billing/transactions — Create a transaction (Admin)
router.post('/transactions', authenticate, requireRole('ADMIN'), createTransaction);

// GET /api/billing/invoices — List invoices (Admin)
router.get('/invoices', authenticate, requireRole('ADMIN'), listInvoices);

// POST /api/billing/invoices — Generate an invoice (Admin)
router.post('/invoices', authenticate, requireRole('ADMIN'), createInvoice);

// EMA Step Up — generate invoices from the Step Up CSV (Admin)
router.post('/ema/generate', authenticate, requireRole('ADMIN'), generateEmaBatch);

// EMA Step Up — reconcile a lump remittance against invoices (Admin)
router.post('/ema/reconcile', authenticate, requireRole('ADMIN'), reconcileEmaRemittance);

export default router;
