import prisma from '../config/database.js';
import stripe from '../config/stripe.js';
import { applyAvailableCredit } from '../services/billingCredit.service.js';
import { broadcastToManagement } from '../utils/pushNotifications.js';

const MANUAL_PAYMENT_METHODS = new Set(['ZELLE', 'VENMO', 'PAYPAL', 'CASH', 'CHECK', 'OTHER']);

/**
 * GET /api/billing/transactions
 * List all transactions, optionally filtered by familyId
 */
export const listTransactions = async (req, res, next) => {
  try {
    const { familyId } = req.query;
    const where = {};
    if (familyId) where.familyId = familyId;

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        student: { select: { id: true, fullName: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    });

    // Map to frontend format
    const mapped = transactions.map((t) => ({
      id: t.id,
      studentId: t.studentId,
      studentName: t.student?.fullName || null,
      familyId: t.familyId,
      amount: Number(t.amount),
      type: t.type.charAt(0).toUpperCase() + t.type.slice(1), // charge -> Charge
      description: t.description || '',
      date: t.date.toISOString().split('T')[0],
      invoiceId: t.invoice?.invoiceNumber || null,
    }));

    res.json({ transactions: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/transactions
 * Create a new transaction (Charge, Payment, Refund, Discount)
 */
export const createTransaction = async (req, res, next) => {
  try {
    const { familyId, studentId, amount, type, description, date, paymentMethod, invoiceId } = req.body;

    if (!familyId || !amount || !type) {
      return res.status(400).json({ error: 'familyId, amount, and type are required.' });
    }

    const parsedAmount = parseFloat(amount);
    const upperType = type.toUpperCase();
    const method = paymentMethod ? paymentMethod.toUpperCase() : null;

    const tx = await prisma.$transaction(async (db) => {
      // Structured manual payment (Zelle/Venmo/PayPal/Cash/Check/Other) — mirrors
      // the Payment + Transaction pair created by the EMA remittance reconciler,
      // so these show up consistently in payment-method reporting.
      let payment = null;
      if (upperType === 'PAYMENT' && method && MANUAL_PAYMENT_METHODS.has(method)) {
        payment = await db.payment.create({
          data: {
            familyId,
            invoiceId: invoiceId || null,
            amount: parsedAmount,
            netAmount: parsedAmount,
            method,
            status: 'COMPLETED',
            notes: description || `Manual ${type} (${method})`,
          },
        });
      }

      let created = await db.transaction.create({
        data: {
          familyId,
          studentId: studentId || null,
          invoiceId: invoiceId || null,
          paymentId: payment?.id || null,
          amount: parsedAmount,
          type: upperType,
          description: description || `Manual ${type}`,
          date: date ? new Date(date) : new Date(),
        },
      });

      // If applied against a specific invoice, cap at what's actually due and
      // spill any excess into a CREDIT transaction instead of over-crediting
      // that one invoice.
      if (upperType === 'PAYMENT' && invoiceId) {
        const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
        if (invoice) {
          const due = Number(invoice.totalAmount) - Number(invoice.amountPaid);
          const appliedToInvoice = Math.min(parsedAmount, Math.max(0, due));
          const newPaid = Number(invoice.amountPaid) + appliedToInvoice;
          await db.invoice.update({
            where: { id: invoiceId },
            data: { amountPaid: newPaid, status: newPaid >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL' },
          });

          const excess = parsedAmount - appliedToInvoice;
          if (excess > 0) {
            await db.transaction.create({
              data: {
                familyId,
                studentId: studentId || null,
                amount: excess,
                type: 'CREDIT',
                description: 'Overpayment applied as account credit',
              },
            });
          }
        }
      }

      return created;
    });

    res.status(201).json({
      transaction: {
        id: tx.id,
        studentId: tx.studentId,
        familyId: tx.familyId,
        amount: Number(tx.amount),
        type: type.charAt(0).toUpperCase() + type.slice(1),
        description: tx.description,
        date: tx.date.toISOString().split('T')[0],
        invoiceId: null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/billing/invoices
 * List all invoices, optionally filtered by familyId
 */
export const listInvoices = async (req, res, next) => {
  try {
    const { familyId } = req.query;
    const where = {};
    if (familyId) where.familyId = familyId;

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        lines: true,
        payments: {
          where: { status: { in: ['COMPLETED', 'PARTIAL_REFUND'] } },
          select: { id: true, amount: true, method: true, status: true },
        },
      },
    });

    const mapped = invoices.map((inv) => ({
      id: inv.invoiceNumber,
      dbId: inv.id,
      familyId: inv.familyId,
      date: inv.date.toISOString().split('T')[0],
      dateRange: inv.dateRange || 'N/A',
      amount: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid),
      status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
      payments: inv.payments.map(p => ({ id: p.id, amount: Number(p.amount), method: p.method, status: p.status })),
    }));

    res.json({ invoices: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices
 * Generate a new invoice from uninvoiced charge transactions
 */
export const createInvoice = async (req, res, next) => {
  try {
    const { familyId, transactionIds } = req.body;

    if (!familyId || !transactionIds || transactionIds.length === 0) {
      return res.status(400).json({ error: 'familyId and transactionIds are required.' });
    }

    // Only pull transactions that belong to this family and aren't already
    // billed — otherwise a stale client selection (or a re-submit) would
    // double-invoice a charge the family already owes on another invoice.
    const txs = await prisma.transaction.findMany({
      where: { id: { in: transactionIds }, familyId, invoiceId: null },
    });

    if (txs.length === 0) {
      return res.status(400).json({ error: 'No uninvoiced transactions found for this family.' });
    }

    const subtotal = txs.reduce((acc, t) => {
      if (t.type === 'CHARGE') return acc + Number(t.amount);
      return acc - Number(t.amount);
    }, 0);

    // Invoice creation + marking the source transactions as billed must be
    // atomic — a crash between the two steps would leave transactions free
    // to be picked up again by a second invoice (double-billing the family).
    const invoice = await prisma.$transaction(async (tx) => {
      // Numeric max, not string sort — `invoiceNumber` is text, so a naive
      // ORDER BY desc breaks once numbers hit 5 digits ("LC-4391" > "LC-10000"
      // lexicographically). See nextLcNumber below for the same fix used by EMA.
      const invoiceNumber = `LC-${await nextLcNumber(tx)}`;

      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          familyId,
          subtotal,
          totalAmount: subtotal,
          status: 'SENT',
          dateRange: 'Current Unbilled',
          dueDate: new Date(Date.now() + 30 * 86400000), // 30 days from now
          lines: {
            create: txs.map((t) => ({
              description: t.description || 'Charge',
              amount: t.amount,
            })),
          },
        },
      });

      await tx.transaction.updateMany({
        where: { id: { in: txs.map((t) => t.id) } },
        data: { invoiceId: created.id },
      });

      // If the family has credit sitting on the books (e.g. a prior EMA
      // overpayment), apply it to this new invoice automatically.
      const { applied } = await applyAvailableCredit(tx, { familyId, invoiceId: created.id, invoiceTotal: subtotal });
      return applied > 0 ? { ...created, amountPaid: applied, status: applied >= subtotal ? 'PAID' : 'PARTIAL' } : created;
    });

    res.status(201).json({
      invoice: {
        id: invoice.invoiceNumber,
        familyId: invoice.familyId,
        date: invoice.date.toISOString().split('T')[0],
        dateRange: invoice.dateRange,
        amount: Number(invoice.totalAmount),
        status: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).toLowerCase(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────── EMA STEP UP ──────────────────────────── */

// Compute the next sequential LC-#### number (numeric, not lexicographic).
const nextLcNumber = async (tx) => {
  const invoices = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: 'LC-' } },
    select: { invoiceNumber: true },
  });
  let max = 4390;
  for (const inv of invoices) {
    const n = parseInt(inv.invoiceNumber.replace('LC-', ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
};

// POST /api/billing/ema/generate
// Body: { groups: [{ studentName, studentId, total, poNumbers: [], lines: [{description, amount}] }] }
// Assigns one sequential LC-#### invoice per student group and records invoices.
export const generateEmaBatch = async (req, res, next) => {
  try {
    const { groups } = req.body;
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ message: 'groups array is required.' });
    }

    const results = await prisma.$transaction(async (tx) => {
      let nextNum = await nextLcNumber(tx);
      const out = [];

      for (const g of groups) {
        const invoiceNumber = `LC-${nextNum++}`;

        // Match student by name to attach the family.
        const student = g.studentName
          ? await tx.user.findFirst({
              where: { role: 'STUDENT', fullName: { equals: g.studentName, mode: 'insensitive' } },
              select: { id: true, familyMembers: { select: { familyId: true }, take: 1 } },
            })
          : null;
        const familyId = student?.familyMembers?.[0]?.familyId || null;
        const total = Number(g.total) || 0;

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            familyId,
            studentId: student?.id || null,
            source: 'EMA',
            poNumbers: g.poNumbers || [],
            subtotal: total,
            totalAmount: total,
            status: 'SENT',
            dateRange: 'EMA Step Up Batch',
            lines: (g.lines && g.lines.length > 0)
              ? { create: g.lines.map(l => ({ description: l.description || 'EMA session', amount: Number(l.amount) || 0 })) }
              : undefined,
          },
        });

        // Apply any existing family credit (e.g. from a prior EMA overpayment)
        // to this new invoice automatically.
        if (familyId && total > 0) {
          await applyAvailableCredit(tx, { familyId, studentId: student?.id || null, invoiceId: invoice.id, invoiceTotal: total });
        }

        out.push({
          ...g,
          invoiceNumber: invoice.invoiceNumber,
          familyId,
          matched: !!student,
        });
      }
      return out;
    });

    res.json({ groups: results });
  } catch (error) {
    next(error);
  }
};

// POST /api/billing/ema/reconcile
// Body: { lines: [{ poNumber, studentName, amount }] }
// Matches each remittance line to the invoice covering that PO #, records a
// scholarship payment, and marks invoices PAID/PARTIAL.
export const reconcileEmaRemittance = async (req, res, next) => {
  try {
    const { lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: 'lines array is required.' });
    }

    const report = await prisma.$transaction(async (tx) => {
      const r = { matched: [], unmatched: [], alreadyReconciled: [], totalMatched: 0, invoicesPaid: [] };
      const touched = new Map();

      for (const line of lines) {
        const amount = Number(line.amount) || 0;
        const invoice = await tx.invoice.findFirst({
          where: {
            OR: [
              line.poNumber ? { poNumbers: { has: line.poNumber } } : undefined,
              line.poNumber ? { invoiceNumber: line.poNumber } : undefined,
            ].filter(Boolean),
          },
        });

        if (!invoice) { r.unmatched.push(line); continue; }

        // A remittance line already reconciled (e.g. the same CSV/paste
        // re-submitted by mistake) must not be applied twice — that would
        // double-pay the invoice and mint duplicate account credit.
        const alreadyPaid = await tx.payment.findFirst({
          where: {
            invoiceId: invoice.id,
            method: 'SCHOLARSHIP_EMA',
            externalReference: line.poNumber || invoice.invoiceNumber,
            amount,
          },
        });
        if (alreadyPaid) { r.alreadyReconciled.push({ ...line, invoiceNumber: invoice.invoiceNumber }); continue; }

        // Cap what's applied to THIS invoice at its total — a remittance line
        // that overpays (common with EMA's block payments) shouldn't inflate
        // amountPaid past totalAmount; the excess becomes family credit instead.
        const totalAmount = Number(invoice.totalAmount);
        const appliedToInvoice = Math.min(amount, Math.max(0, totalAmount - Number(invoice.amountPaid)));
        const excess = amount - appliedToInvoice;
        const newPaid = Number(invoice.amountPaid) + appliedToInvoice;
        await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid } });

        // Payment records the full amount actually received from the remittance.
        await tx.payment.create({
          data: {
            familyId: invoice.familyId,
            invoiceId: invoice.id,
            amount,
            netAmount: amount,
            method: 'SCHOLARSHIP_EMA',
            status: 'COMPLETED',
            externalReference: line.poNumber || invoice.invoiceNumber,
            notes: `EMA Step Up remittance — ${line.poNumber || invoice.invoiceNumber}`,
          },
        });

        if (invoice.familyId) {
          if (appliedToInvoice > 0) {
            await tx.transaction.create({
              data: {
                studentId: invoice.studentId || null,
                familyId: invoice.familyId,
                amount: appliedToInvoice,
                type: 'PAYMENT',
                description: `EMA Step Up — ${line.poNumber || invoice.invoiceNumber}`,
                invoiceId: invoice.id,
              },
            });
          }
          if (excess > 0) {
            await tx.transaction.create({
              data: {
                studentId: invoice.studentId || null,
                familyId: invoice.familyId,
                amount: excess,
                type: 'CREDIT',
                description: `EMA Step Up overpayment — ${line.poNumber || invoice.invoiceNumber} (account credit)`,
              },
            });
          }
        }

        r.matched.push({ ...line, invoiceNumber: invoice.invoiceNumber, familyId: invoice.familyId, creditApplied: excess });
        r.totalMatched += amount;
        touched.set(invoice.id, { total: totalAmount, paid: newPaid, number: invoice.invoiceNumber });
      }

      for (const [id, info] of touched) {
        const status = info.paid >= info.total ? 'PAID' : 'PARTIAL';
        await tx.invoice.update({ where: { id }, data: { status } });
        if (status === 'PAID') r.invoicesPaid.push(info.number);
      }

      return r;
    });

    res.json(report);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/payments/:id/refund
 * Refunds a payment. If it was a Stripe card payment, actually reverses the
 * charge via the Stripe API; otherwise (EMA, Zelle, cash, etc.) only records
 * the ledger entry, since the admin already returned the money outside the app.
 */
export const refundPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
    const refundAmount = amount ? Number(amount) : Number(payment.amount);

    if (refundAmount <= 0 || refundAmount > Number(payment.amount)) {
      return res.status(400).json({ error: 'Invalid refund amount.' });
    }

    // A payment already fully refunded must not be reversed again on Stripe —
    // without this guard a double-click or a retry after a ledger failure
    // (see below) would re-issue a second, separate refund on the card.
    if (payment.status === 'REFUNDED') {
      return res.status(409).json({ error: 'This payment was already fully refunded.' });
    }

    let stripeRefundId = null;
    if (payment.method === 'STRIPE_CARD') {
      if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
      if (!payment.stripePaymentIntentId) {
        return res.status(400).json({ error: 'This payment has no associated Stripe Payment Intent.' });
      }
      // Deterministic idempotency key: if this same refund is retried (e.g. the
      // ledger write below fails and an admin retries), Stripe returns the
      // original refund instead of reversing the card a second time.
      const stripeRefund = await stripe.refunds.create(
        {
          payment_intent: payment.stripePaymentIntentId,
          amount: Math.round(refundAmount * 100),
        },
        { idempotencyKey: `refund-${payment.id}-${Math.round(refundAmount * 100)}` }
      );
      stripeRefundId = stripeRefund.id;
    }

    const isFullRefund = refundAmount >= Number(payment.amount);
    const description = reason || `Refund — ${payment.method.toLowerCase()}`;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id },
          data: { status: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUND' },
        });

        if (payment.invoiceId) {
          const invoice = await tx.invoice.findUnique({ where: { id: payment.invoiceId } });
          if (invoice) {
            const newPaid = Math.max(0, Number(invoice.amountPaid) - refundAmount);
            await tx.invoice.update({
              where: { id: payment.invoiceId },
              data: {
                amountPaid: newPaid,
                status: newPaid <= 0 ? 'SENT' : (newPaid < Number(invoice.totalAmount) ? 'PARTIAL' : 'PAID'),
              },
            });
          }
        }

        await tx.transaction.create({
          data: {
            familyId: payment.familyId,
            invoiceId: payment.invoiceId,
            paymentId: payment.id,
            amount: refundAmount,
            type: 'REFUND',
            description: stripeRefundId ? `${description} (${stripeRefundId})` : description,
          },
        });
      });
    } catch (ledgerError) {
      // The card has already been refunded on Stripe's side at this point —
      // this must never surface as a generic retryable error, or an admin
      // retry would hit the idempotency guard above and think nothing happened.
      if (stripeRefundId) {
        console.error(
          `[Refund] Stripe refund ${stripeRefundId} succeeded for payment ${payment.id} but the ledger update failed — needs manual reconciliation.`,
          ledgerError
        );
        await broadcastToManagement(
          'Refund needs manual reconciliation',
          `Stripe refund ${stripeRefundId} for payment ${payment.id} (${payment.familyId || 'unknown family'}) succeeded, but recording it in the ledger failed. Check the payment and Stripe dashboard manually.`,
          { paymentId: payment.id, stripeRefundId }
        );
        return res.status(500).json({
          error: 'Stripe refund succeeded but the ledger update failed. Management has been alerted — do not retry this refund.',
          stripeRefundId,
        });
      }
      throw ledgerError;
    }

    res.json({ message: 'Refund processed.', refundAmount, stripeReversed: payment.method === 'STRIPE_CARD', stripeRefundId });
  } catch (error) {
    next(error);
  }
};
