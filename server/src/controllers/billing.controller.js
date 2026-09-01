import prisma from '../config/database.js';
import stripe from '../config/stripe.js';
import {
  applyAvailableCredit, applyCreditAcrossInvoices, applyPerStudentCredit,
  sweepPaymentOntoOpenInvoices, applyCreditToExistingInvoice,
} from '../services/billingCredit.service.js';
import { broadcastToManagement } from '../utils/pushNotifications.js';
import { notifyAdmins, sendNotification } from '../jobs/notification.helper.js';
import { round2 } from '../services/registrationPricing.service.js';
import { nextLcNumber } from '../services/invoicing.service.js';
import { buildInvoicePdf, invoicePdfFilename } from '../services/invoicePdf.service.js';
import { sendInvoiceEmail } from '../services/email.service.js';
import { getOrCreateInvoiceCheckoutUrl } from '../services/stripeCheckout.service.js';
import { buildSessionCharges, isBillable } from '../services/sessionCharges.service.js';
import { academyToday, academyDayOffset } from '../utils/academyTime.js';
import { syncInvoiceToWave } from '../services/wave.service.js';

// Fires the Wave sync for one or more just-created invoices without blocking
// the response — a Wave outage or misconfiguration must never delay or fail
// invoice creation. syncInvoiceToWave never throws; this is only a belt for
// the case a caller awaits it directly.
const queueWaveSync = (invoiceIds) => {
  for (const id of [].concat(invoiceIds).filter(Boolean)) {
    syncInvoiceToWave(id).catch((err) => console.error(`[Wave] queueWaveSync(${id}) failed:`, err));
  }
};

/**
 * Methods an admin can put on a payment they are keying in by hand.
 *
 * SCHOLARSHIP_EMA is here because scholarship money does arrive outside the
 * remittance CSV — a parent's EMA direct-pay lands as a deposit with no PO
 * number attached, and until now the only honest thing to call it was "Other".
 * STRIPE_CARD is deliberately absent: a card payment is created by the webhook
 * that watched the money move, and typing one by hand invents a charge that
 * Stripe knows nothing about.
 */
const PAYMENT_METHODS_ACCEPTED = new Set([
  'ZELLE', 'VENMO', 'PAYPAL', 'CASH', 'CHECK', 'SCHOLARSHIP_EMA', 'SCHOLARSHIP_FES', 'OTHER',
]);

/**
 * What produced a ledger row, worked out from the links it carries.
 *
 * A charge raised by machinery — a term's tuition run, a standing monthly
 * arrangement, a cancellation review — is a *consequence*, not the decision
 * itself. Correcting the row alone leaves the thing that generated it still
 * saying the old number, and the next run puts it back. So the billing screen
 * needs to know where a row came from in order to send an admin there instead.
 *
 * `href` is where that source lives in the app. Null means there is nowhere to
 * go: a manual entry is its own source, and a fulfilled snack reload has no
 * screen of its own to correct.
 */
const originOf = (t) => {
  if (t.recurringChargeId) {
    return { kind: 'RECURRING', label: 'Monthly arrangement', href: null, recurringChargeId: t.recurringChargeId };
  }
  if (t.termId && t.quarter) {
    return { kind: 'QUARTERLY', label: `Quarter ${t.quarter} tuition`, href: '/registration' };
  }
  if (t.termId) {
    return { kind: 'DEPOSIT', label: 'Registration deposit', href: '/registration' };
  }
  if (t.sessionCancellationId) {
    // /alerts, not /supervision: staff *record* a cancellation in Supervision,
    // but the admin decides its charge in the Front Desk queue, which is the
    // screen that can actually change this fee.
    return { kind: 'CANCELLATION_FEE', label: 'Cancellation review', href: '/alerts' };
  }
  if (t.sessionId) {
    // The price lives on the calendar entry, so that is where an admin has to
    // go to change what this charge will be next time it is raised.
    return { kind: 'SESSION', label: 'Priced on the calendar', href: '/schedule', sessionId: t.sessionId };
  }
  if (t.snackReload) {
    return { kind: 'REWARD', label: 'Snack punch reload', href: null };
  }
  return { kind: 'MANUAL', label: 'Manual entry', href: null };
};

/**
 * Whether money has actually reached an invoice — the one rule that locks the
 * rows underneath it against being edited or deleted.
 *
 * A `Payment` row is NOT enough to answer this. One is only created when the
 * admin picks a manual method (Zelle, cash, check…) in createTransaction; a
 * payment recorded without one moves `amountPaid` and leaves a PAYMENT
 * transaction behind, and nothing else. Asking `payment.count()` alone said
 * "nobody has paid" about invoices that were paid in full — which is how, on
 * 2026-08-26, a $130 line was deleted out of two invoices the Brooks family had
 * already settled, leaving both at totalAmount 1590 against amountPaid 1720.
 *
 * So: the invoice's own `amountPaid`, plus either shape of payment record.
 */
const invoiceHasMoneyOn = async (invoiceId) => {
  if (!invoiceId) return false;
  const [invoice, payments, paymentTxs] = await Promise.all([
    prisma.invoice.findUnique({ where: { id: invoiceId }, select: { amountPaid: true } }),
    prisma.payment.count({ where: { invoiceId } }),
    prisma.transaction.count({ where: { invoiceId, type: { in: ['PAYMENT', 'CREDIT'] } } }),
  ]);
  return Number(invoice?.amountPaid ?? 0) > 0 || payments > 0 || paymentTxs > 0;
};

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
        invoice: { select: { id: true, invoiceNumber: true, amountPaid: true, _count: { select: { payments: true } } } },
        snackReload: { select: { id: true } },
      },
    });

    // Map to frontend format
    const mapped = transactions.map((t) => {
      // Money having actually moved is what locks a row — see
      // DELETE/PATCH /transactions/:id. Exposed as plain booleans rather than
      // making the UI infer them, so the one rule lives in one place.
      const locked = Boolean(t.paymentId)
        || (t.invoice?._count.payments ?? 0) > 0
        || Number(t.invoice?.amountPaid ?? 0) > 0;
      return {
        id: t.id,
        studentId: t.studentId,
        studentName: t.student?.fullName || null,
        familyId: t.familyId,
        amount: Number(t.amount),
        // CHARGE -> Charge. The enum comes out of Prisma fully upper-cased, so
        // the tail has to be lowered too — without that this produced "CHARGE"
        // and the client's `type === 'Charge'` comparisons silently never matched.
        type: t.type.charAt(0) + t.type.slice(1).toLowerCase(),
        description: t.description || '',
        date: t.date.toISOString().split('T')[0],
        invoiceId: t.invoice?.invoiceNumber || null,
        deletable: !locked,
        editable: !locked,
        origin: originOf(t),
      };
    });

    res.json({ transactions: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/billing/transactions/:id
 * Removes a mistaken or test entry from a family's ledger (Admin only).
 *
 * A charge now gets an invoice the moment it's raised, so "is it invoiced?"
 * can no longer be the thing that blocks deletion — that would make almost
 * every charge undeletable. What blocks it is money having actually moved: a
 * Payment applied to this row, or anything paid against the invoice it sits on
 * — see invoiceHasMoneyOn, which counts a payment recorded without a manual
 * method too. At that point the fix is a refund or a credit, not erasing the
 * original.
 *
 * Otherwise the invoice comes with it: the line is removed and the invoice
 * either shrinks to what's left or, if this was its only line, goes away
 * entirely — an invoice for nothing is not a document anyone should keep.
 */
export const deleteTransaction = async (req, res, next) => {
  try {
    const existing = await prisma.transaction.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, familyId: true, amount: true, type: true, description: true,
        invoiceId: true, paymentId: true,
      },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'That transaction does not exist.' });
    }
    if (existing.paymentId) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A payment is already applied to this. Refund the payment instead of deleting the transaction underneath it.',
      });
    }
    if (await invoiceHasMoneyOn(existing.invoiceId)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A payment has already been made against this entry\'s invoice. Refund it instead of deleting the charge underneath it.',
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { transactionId: existing.id } });
      await tx.transaction.delete({ where: { id: existing.id } });

      if (!existing.invoiceId) return;

      const remaining = await tx.invoiceLine.findMany({
        where: { invoiceId: existing.invoiceId },
        select: { amount: true },
      });
      const invoice = await tx.invoice.findUnique({ where: { id: existing.invoiceId } });
      const amountPaid = Number(invoice.amountPaid);

      if (remaining.length === 0) {
        // An invoice for nothing is not a document anyone should keep — unless
        // money reached it, in which case deleting it destroys the only record
        // of what the family paid for. The guard above should already have
        // refused, so reaching here means a payment landed mid-delete.
        if (amountPaid > 0) {
          throw new Error(`Refusing to delete invoice ${invoice.invoiceNumber}: $${amountPaid} has been paid against it.`);
        }
        await tx.invoice.delete({ where: { id: existing.invoiceId } });
        return;
      }

      const newTotal = round2(remaining.reduce((sum, l) => sum + Number(l.amount), 0));
      await tx.invoice.update({
        where: { id: existing.invoiceId },
        data: {
          subtotal: newTotal,
          totalAmount: newTotal,
          // amountPaid is untouched by this edit, so if it's still <=0 the
          // invoice can't have been PAID before — its DRAFT/SENT/OVERDUE
          // status is unaffected by a line's total changing.
          status: amountPaid <= 0 ? invoice.status : (amountPaid >= newTotal ? 'PAID' : invoice.status),
        },
      });
    });

    // No audit table for the ledger exists yet, so the server log is the only
    // trace of who removed what — worth a real record if this is ever disputed.
    console.log(`[Billing] ${req.user.email} deleted transaction ${existing.id}: ${existing.type} $${existing.amount} "${existing.description || ''}" (family ${existing.familyId})`);

    res.json({ message: 'Transaction removed.' });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/billing/transactions/:id
 * Body: { date?, amount?, description?, studentId? }
 * Corrects a mistaken ledger entry in place — the "Edit Transaction" panel.
 *
 * `type` is deliberately NOT editable: flipping a charge into a payment (or
 * back) reverses which way the row moves the balance, and any invoice built
 * on it would silently mean the opposite of what it did before. That is a
 * reversing entry, not an edit.
 *
 * When the row is already on an invoice, the invoice moves with it — its date,
 * its matching line, and its recomputed total — so the ledger and what the
 * family sees in the portal can never drift apart. Editing is refused once a
 * real Payment references that invoice, same rule as voiding: money that has
 * already moved gets corrected with a refund or a credit, not by rewriting
 * what it was for.
 */
export const updateTransaction = async (req, res, next) => {
  try {
    const { date, amount, description, studentId } = req.body;

    if (date !== undefined && (!date || isNaN(new Date(date).getTime()))) {
      return res.status(400).json({ error: 'Validation Error', message: 'A valid date is required.' });
    }
    let parsedAmount;
    if (amount !== undefined) {
      parsedAmount = Number(amount);
      if (!isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Validation Error', message: 'Amount must be a positive number.' });
      }
    }

    const existing = await prisma.transaction.findUnique({
      where: { id: req.params.id },
      select: { id: true, invoiceId: true, amount: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'That transaction does not exist.' });
    }

    if (await invoiceHasMoneyOn(existing.invoiceId)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This entry is on an invoice a payment has already been made against. Refund the payment instead of editing it.',
      });
    }

    const newDate = date !== undefined ? new Date(`${date}T00:00:00.000Z`) : undefined;

    const transaction = await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id: existing.id },
        data: {
          ...(newDate !== undefined && { date: newDate }),
          ...(parsedAmount !== undefined && { amount: parsedAmount }),
          ...(description !== undefined && { description: String(description).trim() || null }),
          ...(studentId !== undefined && { studentId: studentId || null }),
        },
      });

      if (existing.invoiceId) {
        // Keep the invoice line this row backs in step with it. Matched by
        // transactionId, so an invoice bundling several charges only has the
        // edited one rewritten rather than all of them.
        await tx.invoiceLine.updateMany({
          where: { transactionId: existing.id },
          data: {
            ...(parsedAmount !== undefined && { amount: parsedAmount }),
            ...(description !== undefined && { description: String(description).trim() || 'Charge' }),
          },
        });

        // Recomputed from the lines rather than by adjusting the old total by
        // the difference — an invoice whose total had already drifted would
        // otherwise stay wrong forever.
        const lines = await tx.invoiceLine.findMany({
          where: { invoiceId: existing.invoiceId },
          select: { amount: true },
        });
        const newTotal = round2(lines.reduce((sum, l) => sum + Number(l.amount), 0));
        const invoice = await tx.invoice.findUnique({ where: { id: existing.invoiceId } });
        const amountPaid = Number(invoice.amountPaid);

        await tx.invoice.update({
          where: { id: existing.invoiceId },
          data: {
            ...(newDate !== undefined && { date: newDate }),
            subtotal: newTotal,
            totalAmount: newTotal,
            status: amountPaid <= 0 ? invoice.status : (amountPaid >= newTotal ? 'PAID' : invoice.status),
          },
        });
      }

      return updated;
    });

    res.json({
      message: 'Transaction updated.',
      transaction: {
        id: transaction.id,
        studentId: transaction.studentId,
        familyId: transaction.familyId,
        amount: Number(transaction.amount),
        type: transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1).toLowerCase(),
        description: transaction.description || '',
        date: transaction.date.toISOString().split('T')[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Releases an invoice's charges back onto the ledger and deletes the empty
 * document — what voiding an invoice means. Named rather than inlined into
 * voidInvoice so the contrast with editInvoice's "no lines left" branch, which
 * deliberately does the opposite, is visible from both sides.
 *
 * **Voiding removes the document, never the charges.** It used to delete them
 * too, and that was a real bug: the way an admin fixes a wrong invoice is to
 * void it and raise a correct one, and every charge underneath vanished with
 * the first step — the family's ledger emptied out and there was nothing left
 * to re-invoice. Worse, a deleted charge takes its identity with it: the
 * `(studentId, sessionId)` unique index is the only thing stopping the calendar
 * sweep from billing the same meeting twice, and a charge that no longer exists
 * no longer blocks anything.
 *
 * Detached charges land back in the unbilled list, which is exactly where
 * createInvoice looks (`invoiceId: null`), so the correct invoice can be built
 * from them straight away. A charge that genuinely should not exist is removed
 * one row at a time from the ledger, by an admin who means it — see
 * deleteTransaction.
 *
 * Returns how many charges were released so the caller can say so.
 */
const releaseChargesAndDeleteInvoice = async (tx, invoiceId) => {
  const { count } = await tx.transaction.updateMany({
    where: { invoiceId },
    data: { invoiceId: null },
  });
  // InvoiceLine cascades on delete (see schema.prisma), and its transactionId
  // FK is SET NULL, so the charges detached above are left untouched by it.
  await tx.invoice.delete({ where: { id: invoiceId } });
  return count;
};

/**
 * DELETE /api/billing/invoices/:id
 * Voids a mistaken invoice — e.g. a registration deposit raised against a
 * class whose price was wrong. The charges underneath it are released back to
 * the ledger as unbilled, ready to go onto a corrected invoice; see
 * releaseChargesAndDeleteInvoice for why they are never deleted here.
 *
 * Refused once any Payment row references the invoice, same spirit as
 * deleteTransaction: once real money has touched it (even a PENDING Stripe
 * session), the correct fix is a refund/credit, not erasing the record. An
 * invoice can still show amountPaid > 0 with zero Payment rows — that's
 * family credit auto-applied at creation (see applyAvailableCredit) rather
 * than a real payment, and voiding just releases that credit for reuse, so
 * it does not block this.
 */
export const voidInvoice = async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, invoiceNumber: true, familyId: true, totalAmount: true },
    });
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }

    const paymentCount = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    if (paymentCount > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A payment already exists against this invoice. Refund it instead of voiding the invoice.',
      });
    }

    const released = await prisma.$transaction((tx) => releaseChargesAndDeleteInvoice(tx, invoice.id));

    console.log(`[Billing] ${req.user.email} voided invoice ${invoice.invoiceNumber} ($${invoice.totalAmount}, family ${invoice.familyId}) — ${released} charge(s) released back to the ledger`);

    res.json({
      message: released > 0
        ? `Invoice voided. ${released} charge${released === 1 ? '' : 's'} released back to the ledger — invoice them again from Unbilled.`
        : 'Invoice voided.',
      released,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/billing/invoices/:id
 * Body: { lines: [{ id?, description, amount }] }
 * Rewrites an invoice's line items — a mistaken price or description on a
 * charge that's already been billed. Each submitted line with an `id` updates
 * that line (and the ledger Transaction underneath it, so the family's balance
 * stays correct); a line with no `id` raises a brand new charge on the invoice.
 *
 * An existing line left out of the array is taken off the invoice and its
 * charge is **released back to the ledger as unbilled** — not deleted. Same
 * rule as voidInvoice, and an empty array is just that rule applied to every
 * line at once, so it takes the same path.
 *
 * Removing a line used to delete its charge. That made "take this off the
 * invoice" and "this charge should never have existed" the same button, and
 * they are not the same thing: the first is routine (the wrong line landed on
 * the wrong document) and the second is rare. Nothing on the invoice screen
 * deletes a charge any more. Deleting one is done deliberately, one row at a
 * time, from the ledger — see deleteTransaction.
 *
 * Same money-already-moved guard as voidInvoice: refused once any Payment
 * references the invoice. Editing a paid line would silently change what a
 * completed card charge or a recorded Zelle/Venmo payment was "for" — the
 * correct fix at that point is a credit or refund, not rewriting history.
 */
export const editInvoice = async (req, res, next) => {
  try {
    const { lines } = req.body;
    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'Validation Error', message: 'lines must be an array.' });
    }
    for (const l of lines) {
      const amt = Number(l.amount);
      if (!l.description || !String(l.description).trim() || !isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'Validation Error', message: 'Each line needs a description and a positive amount.' });
      }
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { lines: { select: { id: true, transactionId: true } } },
    });
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }

    const paymentCount = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    if (paymentCount > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A payment already exists against this invoice. Refund it instead of editing the invoice.',
      });
    }

    const existingLineIds = new Set(invoice.lines.map((l) => l.id));
    for (const l of lines) {
      if (l.id && !existingLineIds.has(l.id)) {
        return res.status(400).json({ error: 'Validation Error', message: 'One of the submitted lines does not belong to this invoice.' });
      }
    }

    // Every line struck off leaves no document to keep, and taking the last
    // line off an invoice means the same thing as voiding it — so it is the
    // same code, not a second version of it that could drift.
    if (lines.length === 0) {
      const released = await prisma.$transaction((tx) => releaseChargesAndDeleteInvoice(tx, invoice.id));
      console.log(`[Billing] ${req.user.email} emptied and voided invoice ${invoice.invoiceNumber} via edit (family ${invoice.familyId}) — ${released} charge(s) released back to the ledger`);
      return res.json({
        message: released > 0
          ? `Invoice had no lines left and was voided. ${released} charge${released === 1 ? '' : 's'} released back to the ledger — invoice them again from Unbilled.`
          : 'Invoice had no lines left and was voided.',
        voided: true,
        released,
      });
    }

    const submittedIds = new Set(lines.filter((l) => l.id).map((l) => l.id));
    const removedLines = invoice.lines.filter((l) => !submittedIds.has(l.id));

    const updated = await prisma.$transaction(async (tx) => {
      // Off the document, still on the ledger. Deleting the line is enough to
      // release the charge: InvoiceLine.transactionId is the only thing tying
      // the two together, and the charge's own invoiceId is cleared here so it
      // shows up as unbilled and can go onto the corrected invoice.
      for (const removed of removedLines) {
        await tx.invoiceLine.delete({ where: { id: removed.id } });
        if (removed.transactionId) {
          await tx.transaction.update({
            where: { id: removed.transactionId },
            data: { invoiceId: null },
          });
        }
      }

      for (const l of lines) {
        const amount = Number(l.amount);
        const description = String(l.description).trim();
        if (l.id) {
          const existingLine = invoice.lines.find((el) => el.id === l.id);
          await tx.invoiceLine.update({ where: { id: l.id }, data: { description, amount } });
          if (existingLine.transactionId) {
            await tx.transaction.update({ where: { id: existingLine.transactionId }, data: { description, amount } });
          }
        } else {
          const transaction = await tx.transaction.create({
            data: {
              familyId: invoice.familyId,
              studentId: invoice.studentId,
              invoiceId: invoice.id,
              amount,
              type: 'CHARGE',
              description,
            },
          });
          await tx.invoiceLine.create({
            data: { invoiceId: invoice.id, description, amount, transactionId: transaction.id },
          });
        }
      }

      const newTotal = round2(lines.reduce((sum, l) => sum + Number(l.amount), 0));
      const amountPaid = Number(invoice.amountPaid);
      const status = amountPaid <= 0 ? invoice.status : (amountPaid >= newTotal ? 'PAID' : invoice.status);

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { subtotal: newTotal, totalAmount: newTotal, status },
        include: { lines: true },
      });
    });

    const released = removedLines.filter((l) => l.transactionId).length;

    console.log(`[Billing] ${req.user.email} edited invoice ${invoice.invoiceNumber} (family ${invoice.familyId}) — new total $${updated.totalAmount}, ${released} charge(s) released back to the ledger`);

    res.json({
      message: released > 0
        ? `Invoice updated. ${released} charge${released === 1 ? '' : 's'} taken off it and left unbilled on the ledger.`
        : 'Invoice updated.',
      released,
      invoice: {
        id: updated.invoiceNumber,
        dbId: updated.id,
        amount: Number(updated.totalAmount),
        amountPaid: Number(updated.amountPaid),
        status: updated.status.charAt(0).toUpperCase() + updated.status.slice(1).toLowerCase(),
        lines: updated.lines.map((l) => ({ id: l.id, description: l.description, amount: Number(l.amount) })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Everything an invoice document needs, in one shape, used by the detail view,
 * the PDF and the email alike so the three can never disagree about what a
 * family owes.
 */
const loadInvoiceForDocument = (id) =>
  prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { description: 'asc' } },
      family: { select: { id: true, name: true } },
      payments: {
        where: { status: { in: ['COMPLETED', 'PARTIAL_REFUND'] } },
        select: { id: true, amount: true, method: true, status: true, createdAt: true },
      },
    },
  });

// The invoice's own student if it has one, otherwise nothing — an invoice
// bundling several children's charges is not "for" any one of them.
const invoiceStudent = async (invoice) =>
  invoice.studentId
    ? prisma.user.findUnique({ where: { id: invoice.studentId }, select: { id: true, fullName: true } })
    : null;

const serializeInvoice = (invoice, student) => ({
  id: invoice.invoiceNumber,
  dbId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  familyId: invoice.familyId,
  familyName: invoice.family?.name || null,
  student: student ? { id: student.id, fullName: student.fullName } : null,
  date: invoice.date.toISOString().split('T')[0],
  dueDate: invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : null,
  sentAt: invoice.sentAt ? invoice.sentAt.toISOString() : null,
  dateRange: invoice.dateRange || null,
  source: invoice.source || null,
  poNumbers: invoice.poNumbers || [],
  subtotal: Number(invoice.subtotal),
  totalAmount: Number(invoice.totalAmount),
  amountPaid: Number(invoice.amountPaid),
  balance: Number(invoice.totalAmount) - Number(invoice.amountPaid),
  status: invoice.status,
  lines: invoice.lines.map((l) => ({ id: l.id, description: l.description, amount: Number(l.amount), quantity: l.quantity })),
  payments: invoice.payments.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    method: p.method,
    status: p.status,
    date: p.createdAt.toISOString().split('T')[0],
  })),
});

/**
 * Who an invoice is emailed to: the parent flagged as the invoice recipient,
 * falling back to any other adult on the family, and finally to the student's
 * own address. Returns null when there is nobody — the caller must refuse to
 * "send" rather than quietly succeed at mailing no one.
 */
const invoiceRecipient = async (invoice) => {
  if (invoice.familyId) {
    const members = await prisma.familyMember.findMany({
      where: { familyId: invoice.familyId },
      select: { isInvoiceRecipient: true, user: { select: { id: true, fullName: true, email: true, role: true } } },
    });
    const withEmail = members.filter((m) => m.user?.email && !m.user.email.endsWith('@selfreg.local'));
    const flagged = withEmail.find((m) => m.isInvoiceRecipient);
    const adult = withEmail.find((m) => m.user.role !== 'STUDENT');
    const chosen = flagged || adult || withEmail[0];
    if (chosen) return chosen.user;
  }
  if (invoice.studentId) {
    const student = await prisma.user.findUnique({
      where: { id: invoice.studentId },
      select: { id: true, fullName: true, email: true },
    });
    if (student?.email && !student.email.endsWith('@selfreg.local')) return student;
  }
  return null;
};

/**
 * GET /api/billing/invoices/:id
 * The full specification of one invoice — its lines, totals, payments and who
 * it would be emailed to. Read-only; this is what the "View invoice" panel and
 * the send flow both read.
 */
export const getInvoice = async (req, res, next) => {
  try {
    const invoice = await loadInvoiceForDocument(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }
    const [student, recipient] = await Promise.all([invoiceStudent(invoice), invoiceRecipient(invoice)]);

    res.json({
      invoice: serializeInvoice(invoice, student),
      recipient: recipient ? { id: recipient.id, fullName: recipient.fullName, email: recipient.email } : null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/billing/invoices/:id/pdf
 * The same PDF that gets attached to the emailed invoice, so an admin can read
 * exactly what a family will receive before approving the send.
 */
export const downloadInvoicePdf = async (req, res, next) => {
  try {
    const invoice = await loadInvoiceForDocument(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }
    const student = await invoiceStudent(invoice);
    const pdf = await buildInvoicePdf({ ...invoice, student });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoicePdfFilename(invoice)}"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices/:id/send
 * Body: { subject?, message?, to? }
 * Emails the invoice with its PDF attached.
 *
 * `to` is honoured when given so an admin can send a test copy to themselves
 * rather than to a real family. Left out, it goes to the family's invoice
 * recipient. Nothing is guessed: with no address at all this refuses instead of
 * reporting a send that never happened.
 */
export const sendInvoice = async (req, res, next) => {
  try {
    const { subject, message, to } = req.body || {};

    const invoice = await loadInvoiceForDocument(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }

    const recipient = to ? { email: to, fullName: to } : await invoiceRecipient(invoice);
    if (!recipient?.email) {
      return res.status(422).json({
        error: 'No Recipient',
        message: 'This family has no email address on file, so there is nobody to send the invoice to.',
      });
    }

    const student = await invoiceStudent(invoice);
    const withStudent = { ...invoice, student };
    const [pdf, checkoutUrl] = await Promise.all([
      buildInvoicePdf(withStudent),
      // Missing Stripe config or an already-paid invoice both come back null
      // here — the email just omits the card button rather than failing the
      // whole send over a payment method the family doesn't need anyway.
      getOrCreateInvoiceCheckoutUrl(invoice).catch(() => null),
    ]);

    const result = await sendInvoiceEmail({
      to: recipient.email,
      invoice: withStudent,
      subject,
      message,
      pdf,
      pdfFilename: invoicePdfFilename(invoice),
      checkoutUrl,
    });

    if (!result.ok) {
      return res.status(502).json({
        error: 'Send Failed',
        message: result.error || 'The email could not be sent.',
      });
    }

    // Only a DRAFT graduates to SENT here — an invoice already PAID/OVERDUE
    // keeps its accounting status even if an admin re-sends the copy.
    // sentAt itself is always stamped with the latest send, status change or not.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { sentAt: new Date(), ...(invoice.status === 'DRAFT' ? { status: 'SENT' } : {}) },
    });

    if (recipient.id) {
      sendNotification({
        userId: recipient.id,
        type: 'NEW_INVOICE',
        title: 'New Invoice Available',
        message: `Invoice ${invoice.invoiceNumber} for $${invoice.totalAmount} is now ready.`,
      }).catch(err => console.error('Failed to notify parent about new invoice:', err));
    }

    console.log(`[Billing] ${req.user.email} emailed invoice ${invoice.invoiceNumber} to ${recipient.email}`);
    res.json({ message: `Invoice ${invoice.invoiceNumber} sent to ${recipient.email}.`, to: recipient.email });
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
      // Every payment gets a Payment row, method chosen or not.
      //
      // It used to depend on the admin picking one from the dropdown, and
      // leaving it on "Not specified" recorded the money in the ledger only.
      // That is not a cosmetic difference: the Wave income sync reads the
      // Payment table, and so does anything asking "has this invoice been
      // paid?" — on 2026-08-26 four payments worth $6,540 were entered that
      // way and none of them existed as far as either was concerned.
      //
      // OTHER when nothing was chosen: an honest "some way we didn't record",
      // which is what happened, rather than guessing at Zelle or cash.
      let payment = null;
      if (upperType === 'PAYMENT') {
        const resolvedMethod = method && PAYMENT_METHODS_ACCEPTED.has(method) ? method : 'OTHER';
        payment = await db.payment.create({
          data: {
            familyId,
            invoiceId: invoiceId || null,
            amount: parsedAmount,
            netAmount: parsedAmount,
            method: resolvedMethod,
            status: 'COMPLETED',
            // Who keyed it in. Nothing wrote this before, so every payment in
            // the system reads "nobody" and no question about one can be
            // answered — see the same gap on SessionChargeOverride.createdById.
            recordedById: req.user?.id || null,
            paidAt: date ? new Date(date) : new Date(),
            notes: description || `Manual ${type}${method ? ` (${method})` : ''}`,
          },
        });
      }

      // If the payment targets a specific invoice, cap what's applied there at
      // what's actually due, and record the ledger rows the same way the EMA
      // reconciler does: PAYMENT for the applied part, CREDIT for the excess.
      // Together they sum to the money received — recording the full payment
      // AND a credit would count the excess twice and understate the balance.
      let txAmount = parsedAmount;
      let excess = 0;
      if (upperType === 'PAYMENT' && invoiceId) {
        const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
        if (invoice) {
          const due = Number(invoice.totalAmount) - Number(invoice.amountPaid);
          const appliedToInvoice = Math.min(parsedAmount, Math.max(0, due));
          const newPaid = Number(invoice.amountPaid) + appliedToInvoice;
          await db.invoice.update({
            where: { id: invoiceId },
            data: { amountPaid: newPaid, status: newPaid >= Number(invoice.totalAmount) ? 'PAID' : invoice.status },
          });
          txAmount = appliedToInvoice;
          excess = parsedAmount - appliedToInvoice;
        }
      }

      const txDate = date ? new Date(date) : new Date();
      const created = await db.transaction.create({
        data: {
          familyId,
          studentId: studentId || null,
          invoiceId: invoiceId || null,
          paymentId: payment?.id || null,
          amount: txAmount,
          type: upperType,
          description: description || `Manual ${type}`,
          date: txDate,
        },
      });

      // A charge lands on the ledger and waits there. It is *not* invoiced
      // here: one invoice per charge is how a family ends up holding three
      // documents for one week of the same programme, each with its own
      // LC-#### number, none of which is the bill they were expecting.
      //
      // The invoice is a statement of a period, raised from Billing → the
      // family → "Bill a period", which sweeps every pending charge in the
      // window the admin names. The family still sees the money owed
      // immediately — the ledger balance in the portal counts uninvoiced
      // charges, which is what the earlier auto-invoicing was really for.
      const invoiceNumber = null;

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

      // A payment recorded without picking a specific invoice — "General
      // family balance" in the Add Transaction form — used to just sit there
      // as floating credit until whoever built the next invoice happened to
      // trigger applyAvailableCredit. The common case is a deposit that lands
      // *after* the family's invoice already exists, which never triggers
      // that path at all: the credit is invisible on the invoice until
      // someone notices the family still shows a balance. Sweep it onto
      // whatever's already open the moment it's recorded instead.
      if (upperType === 'PAYMENT' && !invoiceId) {
        await sweepPaymentOntoOpenInvoices(db, { familyId, studentId: studentId || null, amount: txAmount });
      }

      return { created, invoiceNumber };
    });

    res.status(201).json({
      transaction: {
        id: tx.created.id,
        studentId: tx.created.studentId,
        familyId: tx.created.familyId,
        amount: Number(tx.created.amount),
        type: type.charAt(0).toUpperCase() + type.slice(1),
        description: tx.created.description,
        date: tx.created.date.toISOString().split('T')[0],
        invoiceId: tx.invoiceNumber,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices/merge
 * Fold several of one family's invoices into a single document.
 *
 * The calendar sweep groups charges by family *within one run*, so approving
 * two batches leaves a family holding two invoices for the same week. Nobody
 * wants three envelopes for one month of the same programme, and paying them
 * separately is how a family ends up half-paid across documents.
 *
 * The oldest invoice absorbs the others rather than a fresh number being
 * minted: whichever number the family has already seen stays the one that is
 * still good. The absorbed invoices are deleted, but — unlike voidInvoice —
 * their charges are *moved*, never dropped. A merge changes the document
 * count, never the ledger total.
 *
 * Refused once any Payment row references any of them, same reasoning as
 * voidInvoice: money that landed against a specific invoice number cannot be
 * silently reassigned to a different one.
 *
 * Body: { invoiceIds: string[] }
 */
export const mergeInvoices = async (req, res, next) => {
  try {
    const { invoiceIds } = req.body;

    if (!Array.isArray(invoiceIds) || invoiceIds.length < 2) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Pick at least two invoices to combine.',
      });
    }

    const ids = [...new Set(invoiceIds)];
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: ids } },
      include: { lines: { include: { transaction: { select: { studentId: true } } } } },
    });

    if (invoices.length !== ids.length) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'One of those invoices no longer exists. Reload and try again.',
      });
    }

    if (new Set(invoices.map((i) => i.familyId)).size > 1 || !invoices[0].familyId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invoices can only be combined within a single family.',
      });
    }

    // Siblings keep their own documents. Billing raises one invoice per child
    // on purpose (see createInvoice); folding two of them back together would
    // rebuild exactly the unreadable household invoice that was the problem.
    // Combining several invoices belonging to the *same* child is the point.
    //
    // Derived from each invoice's own LINES, not its studentId column: every
    // invoice raised before per-student billing existed has that column
    // NULL, even when every one of its lines is unmistakably one student's
    // (e.g. LC-4434, all Abigail Celli, studentId column still null). Trusting
    // the column here would treat two different siblings' old invoices as
    // "the same null student" and wave the merge through — exactly the
    // regression this check exists to prevent, just for older invoices.
    const studentsOf = (inv) => new Set(
      inv.lines.map((l) => l.transaction?.studentId).filter(Boolean)
    );
    const allStudents = new Set(invoices.flatMap((i) => [...studentsOf(i)]));
    if (allStudents.size > 1) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Those invoices belong to different students. Each student is billed separately — combine only invoices for the same one.',
      });
    }

    // amountPaid without a Payment row is family credit auto-applied at
    // creation. Unlike voiding — which releases that credit back for reuse —
    // a merge has nowhere to put it, so both cases block here.
    const paid = invoices.filter((i) => Number(i.amountPaid) > 0);
    if (paid.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: `${paid.map((i) => i.invoiceNumber).join(', ')} already `
          + `${paid.length === 1 ? 'has' : 'have'} money applied. Only unpaid invoices can be combined.`,
      });
    }

    const paymentCount = await prisma.payment.count({ where: { invoiceId: { in: ids } } });
    if (paymentCount > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A payment already exists against one of those invoices. Refund it before combining.',
      });
    }

    // Oldest wins, and the lower LC number breaks a same-day tie so the same
    // pick happens every time rather than however Postgres ordered the rows.
    const ordered = [...invoices].sort((a, b) => (
      a.date.getTime() - b.date.getTime()
      || a.invoiceNumber.localeCompare(b.invoiceNumber, 'en', { numeric: true })
    ));
    const [target, ...absorbed] = ordered;
    const absorbedIds = absorbed.map((i) => i.id);

    const subtotal = round2(invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0));

    // Guaranteed at most one real student by the check above. Written from
    // that derived set, not copied off invoices[0].studentId — same reasoning
    // as the guard: the column can be null on an invoice whose lines are all
    // one real student, and copying it forward would leave the merged
    // invoice just as mislabeled as the one it absorbed.
    const studentId = allStudents.size === 1 ? [...allStudents][0] : null;

    const ranges = [...new Set(invoices.map((i) => i.dateRange).filter(Boolean))];

    const merged = await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.updateMany({
        where: { invoiceId: { in: absorbedIds } },
        data: { invoiceId: target.id },
      });
      await tx.transaction.updateMany({
        where: { invoiceId: { in: absorbedIds } },
        data: { invoiceId: target.id },
      });

      // Their lines and charges have moved by now, so this deletes empty
      // shells — nothing of value cascades away with them.
      await tx.invoice.deleteMany({ where: { id: { in: absorbedIds } } });

      return tx.invoice.update({
        where: { id: target.id },
        data: {
          subtotal,
          totalAmount: subtotal,
          studentId,
          dateRange: ranges.length === 1 ? ranges[0] : 'Combined charges',
          // Back to a draft deliberately: this document is not the one any
          // family was shown, so an admin reads it before it goes out.
          status: 'DRAFT',
        },
      });
    });

    console.log(
      `[Billing] ${req.user.email} combined ${absorbed.map((i) => i.invoiceNumber).join(', ')} `
      + `into ${target.invoiceNumber} ($${subtotal}, family ${target.familyId})`
    );

    res.json({
      message: `Combined ${invoices.length} invoices into ${target.invoiceNumber}.`,
      invoice: {
        id: merged.invoiceNumber,
        familyId: merged.familyId,
        date: merged.date.toISOString().split('T')[0],
        dateRange: merged.dateRange,
        amount: Number(merged.totalAmount),
        status: merged.status.charAt(0).toUpperCase() + merged.status.slice(1).toLowerCase(),
      },
      absorbed: absorbed.map((i) => i.invoiceNumber),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices/:id/split
 * Break a household invoice back apart into one invoice per student.
 *
 * For invoices raised before createInvoice started billing per child (or
 * built by hand across siblings), where two children's charges landed on one
 * document with no way to tell whose line was whose. Keeps the original
 * invoice number for whichever student has the largest share — that number
 * is the one a family may already have seen — and mints a fresh LC-#### for
 * every other student. Lines with no linked student stay together as one
 * "Family charges" invoice, same as a manual entry with no student picked.
 *
 * Refused once a real Payment exists against the invoice, same as
 * voidInvoice/mergeInvoices: money already receipted against this specific
 * number cannot be silently reassigned to a different one. An invoice paid
 * down from account credit (amountPaid > 0, zero Payment rows) is fine —
 * splitting re-runs the same credit allocation createInvoice uses, so the
 * money follows the charges it was actually covering.
 */
export const splitInvoice = async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { transaction: { select: { id: true, studentId: true } } } } },
    });
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }

    const paymentCount = await prisma.payment.count({ where: { invoiceId: invoice.id } });
    if (paymentCount > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A payment already exists against this invoice. Refund it before splitting.',
      });
    }

    const groups = new Map(); // studentId ('' for none) -> lines[]
    for (const line of invoice.lines) {
      const key = line.transaction?.studentId ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(line);
    }

    if (groups.size < 2) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'This invoice already belongs to a single student — there is nothing to split.',
      });
    }

    const studentIds = [...groups.keys()].filter(Boolean);
    const students = studentIds.length
      ? await prisma.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true } })
      : [];
    const studentName = new Map(students.map((s) => [s.id, s.fullName]));

    // The student with the largest dollar share keeps the original number —
    // arbitrary in principle, but consistent and it means the child owing the
    // most keeps the number a parent is most likely to already reference.
    const ranked = [...groups.entries()]
      .map(([studentId, lines]) => ({
        studentId,
        lines,
        total: round2(lines.reduce((sum, l) => sum + Number(l.amount), 0)),
      }))
      .sort((a, b) => b.total - a.total);
    const [keeper, ...rest] = ranked;

    // Populated inside the transaction below with the ids of the brand-new
    // invoices the split raises (not the keeper, which already existed) —
    // read after the transaction commits to fire their Wave sync.
    const newInvoiceIds = [];

    const created = await prisma.$transaction(async (tx) => {
      const out = [];

      // The keeper: re-point at only its own lines and re-total. amountPaid
      // and status reset to zero/DRAFT along with everything else — whatever
      // was covering the old combined total is about to be recomputed from
      // scratch below, and leaving the old status/amountPaid in place here
      // would only matter if applyCreditAcrossInvoices found less credit than
      // before, which cannot happen: splitting does not spend or create any.
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          studentId: keeper.studentId || null,
          subtotal: keeper.total,
          totalAmount: keeper.total,
          amountPaid: 0,
          status: 'DRAFT',
          dateRange: keeper.studentId ? (studentName.get(keeper.studentId) ?? invoice.dateRange) : invoice.dateRange,
        },
      });
      out.push({ id: invoice.id, studentId: keeper.studentId || null, total: keeper.total });

      // Every other student gets a brand-new invoice, and their lines (and the
      // transactions those lines came from) move onto it.
      for (const group of rest) {
        const invoiceNumber = `LC-${await nextLcNumber(tx)}`;
        const doc = await tx.invoice.create({
          data: {
            invoiceNumber,
            familyId: invoice.familyId,
            studentId: group.studentId || null,
            subtotal: group.total,
            totalAmount: group.total,
            status: 'DRAFT',
            dateRange: group.studentId ? (studentName.get(group.studentId) ?? invoice.dateRange) : invoice.dateRange,
            dueDate: invoice.dueDate,
          },
        });
        newInvoiceIds.push(doc.id);

        await tx.invoiceLine.updateMany({
          where: { id: { in: group.lines.map((l) => l.id) } },
          data: { invoiceId: doc.id },
        });
        const txIds = group.lines.map((l) => l.transaction?.id).filter(Boolean);
        if (txIds.length) {
          await tx.transaction.updateMany({ where: { id: { in: txIds } }, data: { invoiceId: doc.id } });
        }

        out.push({ id: doc.id, studentId: group.studentId || null, total: group.total });
      }

      // Whatever was covering the original invoice (credit only — a real
      // Payment would have blocked this above) is re-attributed per student,
      // not pooled and handed out in invoice order. A split is un-mixing
      // money that the ledger already knows whose it was — Remi's deposit is
      // a Transaction with Remi's studentId, Presley's likewise — and giving
      // Remi's own payment to whichever invoice happened to be built first
      // would defeat the point of splitting them apart. See
      // applyPerStudentCredit. Lines the split could not attribute to a
      // student (studentId '') fall back to the family-pooled measure, same
      // as any other family-level invoice.
      const batchTxIds = invoice.lines.map((l) => l.transaction?.id).filter(Boolean);
      for (const o of out) {
        if (!o.studentId) continue; // handled below, pooled with the same batch exclusion
        await applyPerStudentCredit(tx, {
          familyId: invoice.familyId,
          studentId: o.studentId,
          batchTxIds,
          invoiceId: o.id,
          invoiceTotal: o.total,
        });
      }
      // Any invoice this split could not attribute to a student (a line with
      // no linked transaction, or a transaction with no studentId) falls back
      // to family-pooled credit — but still excluding the *entire* batch, via
      // applyCreditAcrossInvoices, not applyAvailableCredit's single-invoice
      // exclusion: the other invoices' charges above have already moved onto
      // their own invoiceId, and counting them as this one's debt would be
      // the exact double-count applyCreditAcrossInvoices exists to avoid.
      const unattributed = out.filter((o) => !o.studentId);
      if (unattributed.length) {
        await applyCreditAcrossInvoices(tx, { familyId: invoice.familyId, batchTxIds, invoices: unattributed });
      }

      // Every invoice was just reset to (amountPaid: 0, status: DRAFT) — the
      // keeper explicitly above, every new one by its create defaults — and
      // the credit calls above already wrote the real numbers over that for
      // whichever ones actually received any. A plain re-read is the truth.
      return tx.invoice.findMany({ where: { id: { in: out.map((o) => o.id) } } });
    });
    queueWaveSync(newInvoiceIds);

    const shape = (d) => ({
      id: d.invoiceNumber,
      familyId: d.familyId,
      studentId: d.studentId,
      studentName: d.studentId ? (studentName.get(d.studentId) ?? null) : null,
      date: d.date.toISOString().split('T')[0],
      dateRange: d.dateRange,
      amount: Number(d.totalAmount),
      status: d.status.charAt(0).toUpperCase() + d.status.slice(1).toLowerCase(),
    });

    console.log(
      `[Billing] ${req.user.email} split ${invoice.invoiceNumber} into `
      + `${created.map((d) => d.invoiceNumber).join(', ')} (family ${invoice.familyId})`
    );

    res.json({
      message: `Split into ${created.length} invoices — one per student.`,
      invoices: created.map(shape),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices/:id/apply-credit
 * Recompute this invoice's available credit from scratch and apply it.
 *
 * createTransaction now sweeps a new payment onto whatever's already open the
 * moment it's recorded (see sweepPaymentOntoOpenInvoices), but that only
 * covers payments made *after* this existed. This is the manual counterpart —
 * for a deposit that landed before that sweep existed, one recorded through a
 * path that doesn't call it (the EMA/Step Up reconciler, an import), or
 * simply an admin double-checking a balance that looks wrong. Safe to call on
 * any invoice, any time: it only ever raises amountPaid, never lowers it.
 */
export const applyCreditToInvoice = async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { transaction: { select: { studentId: true } } } } },
    });
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }
    if (['PAID', 'CANCELLED'].includes(invoice.status)) {
      return res.json({ message: 'Nothing to apply — this invoice is already settled.', applied: 0 });
    }

    const before = Number(invoice.amountPaid);
    const updated = await prisma.$transaction(async (tx) => {
      await applyCreditToExistingInvoice(tx, { invoice });
      return tx.invoice.findUnique({ where: { id: invoice.id } });
    });
    const applied = Math.round((Number(updated.amountPaid) - before) * 100) / 100;

    console.log(`[Billing] ${req.user.email} applied $${applied} of existing credit to ${invoice.invoiceNumber}`);

    res.json({
      message: applied > 0 ? `Applied $${applied.toFixed(2)} of existing credit.` : 'No available credit found for this invoice.',
      applied,
      invoice: {
        id: updated.invoiceNumber,
        amount: Number(updated.totalAmount),
        amountPaid: Number(updated.amountPaid),
        status: updated.status.charAt(0).toUpperCase() + updated.status.slice(1).toLowerCase(),
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
        lines: { include: { transaction: { select: { studentId: true } } } },
        payments: {
          where: { status: { in: ['COMPLETED', 'PARTIAL_REFUND'] } },
          select: { id: true, amount: true, method: true, status: true },
        },
        // Unfiltered count — a PENDING payment (say, a Stripe session the
        // family hasn't finished) still means real money may be in flight
        // against this invoice, so it blocks voiding same as a completed one.
        _count: { select: { payments: true } },
      },
    });

    const mapped = invoices.map((inv) => ({
      id: inv.invoiceNumber,
      dbId: inv.id,
      familyId: inv.familyId,
      studentId: inv.studentId,
      date: inv.date.toISOString().split('T')[0],
      dateRange: inv.dateRange || 'N/A',
      sentAt: inv.sentAt ? inv.sentAt.toISOString() : null,
      amount: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid),
      status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
      payments: inv.payments.map(p => ({ id: p.id, amount: Number(p.amount), method: p.method, status: p.status })),
      lines: inv.lines.map(l => ({ id: l.id, description: l.description, amount: Number(l.amount) })),
      // Whether DELETE (void) or PATCH (edit) /invoices/:id would actually
      // accept this — see voidInvoice/editInvoice. Same condition either way:
      // no real Payment has touched the invoice yet.
      voidable: inv._count.payments === 0,
      editable: inv._count.payments === 0,
      // Whether POST /invoices/:id/split has anything to do — more than one
      // student's charges sharing this document. Same no-real-payment gate as
      // void/edit; splitInvoice enforces it server-side regardless.
      splittable: inv._count.payments === 0
        && new Set(inv.lines.map((l) => l.transaction?.studentId ?? '')).size > 1,
    }));

    res.json({ invoices: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * The { studentId, lines } half of POST /api/billing/invoices — an invoice
 * written from scratch for one student.
 *
 * Every line raises its own CHARGE transaction, exactly as editInvoice does
 * when an admin adds a line by hand. That is not bookkeeping ceremony: a
 * family's balance is the sum of its Transactions, so an invoice whose lines
 * had no charges behind them would be a document the ledger never heard of —
 * the family would owe money that no balance, statement or overdue check
 * could see.
 *
 * The student's household comes from FamilyMember rather than the request, so
 * a client cannot bill one family for another family's child.
 */
const createManualInvoice = async (req, res, next, { studentId, lines }) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, fullName: true, role: true, familyMembers: { select: { familyId: true } } },
    });
    if (!student) {
      return res.status(404).json({ error: 'Not Found', message: 'That student does not exist.' });
    }
    if (student.role !== 'STUDENT') {
      return res.status(400).json({ error: 'Validation Error', message: 'Invoices can only be raised against a student.' });
    }
    // No household means nobody to bill and nowhere to hang the balance. Better
    // a clear refusal than an invoice with a null familyId that never shows up
    // on any family's account.
    if (student.familyMembers.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: `${student.fullName} is not attached to a family yet, so there is no account to bill. Add them to a family first.`,
      });
    }
    const familyId = student.familyMembers[0].familyId;

    const cleanLines = lines.map((l) => ({ description: String(l.description).trim(), amount: round2(Number(l.amount)) }));
    const subtotal = round2(cleanLines.reduce((sum, l) => sum + l.amount, 0));

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = `LC-${await nextLcNumber(tx)}`;

      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          familyId,
          studentId,
          subtotal,
          totalAmount: subtotal,
          status: 'DRAFT',
          dateRange: 'Manual',
          dueDate: new Date(Date.now() + 30 * 86400000), // 30 days, same as the sweep
        },
      });

      for (const line of cleanLines) {
        const charge = await tx.transaction.create({
          data: {
            familyId,
            studentId,
            invoiceId: created.id,
            amount: line.amount,
            type: 'CHARGE',
            description: line.description,
          },
        });
        await tx.invoiceLine.create({
          data: { invoiceId: created.id, description: line.description, amount: line.amount, transactionId: charge.id },
        });
      }

      const { applied } = await applyAvailableCredit(tx, { familyId, invoiceId: created.id, invoiceTotal: subtotal });
      return applied > 0
        ? { ...created, amountPaid: applied, status: applied >= subtotal ? 'PAID' : 'DRAFT' }
        : created;
    });
    queueWaveSync(invoice.id);

    console.log(`[Billing] ${req.user.email} raised invoice ${invoice.invoiceNumber} for ${student.fullName} ($${subtotal}, ${cleanLines.length} lines)`);

    res.status(201).json({
      invoice: {
        id: invoice.invoiceNumber,
        dbId: invoice.id,
        familyId: invoice.familyId,
        studentId: invoice.studentId,
        date: invoice.date.toISOString().split('T')[0],
        dateRange: invoice.dateRange,
        amount: Number(invoice.totalAmount),
        amountPaid: Number(invoice.amountPaid),
        status: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).toLowerCase(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/invoices
 *
 * Two shapes, split by the validator (see createInvoiceSchema):
 *
 *  - { familyId, transactionIds } bundles charges already sitting unbilled on
 *    the ledger — the calendar-charge sweep. One invoice per FAMILY.
 *  - { studentId, lines } writes an invoice from scratch for ONE student, each
 *    line raising its own CHARGE. Nothing needs to exist on the ledger first.
 *
 * The second path is why this endpoint stopped requiring transactionIds: with
 * the migrated ledger gone there is routinely nothing unbilled to bundle, and
 * "New Invoice" could do nothing at all. Billing per student is also what the
 * family invoice never expressed — with several siblings in one household, a
 * single invoice mixed their charges together and no line said whose it was.
 */
export const createInvoice = async (req, res, next) => {
  try {
    const { familyId, transactionIds, studentId, lines } = req.body;

    if (lines) return createManualInvoice(req, res, next, { studentId, lines });

    // Only pull transactions that belong to this family and aren't already
    // billed — otherwise a stale client selection (or a re-submit) would
    // double-invoice a charge the family already owes on another invoice.
    const txs = await prisma.transaction.findMany({
      where: { id: { in: transactionIds }, familyId, invoiceId: null },
    });

    if (txs.length === 0) {
      return res.status(400).json({ error: 'No uninvoiced transactions found for this family.' });
    }

    // One invoice per child, not one per family. A household with two children
    // in the same class produced a document with two identical $130 lines and
    // nothing saying which was whose — unreadable for the parent, and useless
    // to a scholarship administrator who has to file per student. Charges with
    // no student on them (a family-level fee) still get their own document.
    const byStudent = new Map();
    for (const t of txs) {
      const key = t.studentId ?? '';
      if (!byStudent.has(key)) byStudent.set(key, []);
      byStudent.get(key).push(t);
    }

    const studentNames = new Map();
    const studentIds = [...byStudent.keys()].filter(Boolean);
    if (studentIds.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, fullName: true },
      });
      for (const u of users) studentNames.set(u.id, u.fullName);
    }

    // Invoice creation + marking the source transactions as billed must be
    // atomic — a crash between the two steps would leave transactions free
    // to be picked up again by a second invoice (double-billing the family).
    // One transaction spans every student's invoice so a failure part-way
    // cannot leave a household half-billed.
    const invoices = await prisma.$transaction(async (tx) => {
      const out = [];
      const totals = [];

      for (const [key, group] of byStudent) {
        const subtotal = round2(group.reduce((acc, t) => (
          t.type === 'CHARGE' ? acc + Number(t.amount) : acc - Number(t.amount)
        ), 0));

        const invoiceNumber = `LC-${await nextLcNumber(tx)}`;
        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            familyId,
            studentId: key || null,
            subtotal,
            totalAmount: subtotal,
            status: 'DRAFT',
            dateRange: key ? (studentNames.get(key) ?? 'Current Unbilled') : 'Family charges',
            dueDate: new Date(Date.now() + 30 * 86400000), // 30 days from now
            // One line per transaction, each linked back by transactionId — what
            // lets an admin edit or remove a single line later without guessing
            // which ledger row it came from (createMany can't take relations, so
            // this is per-row rather than a single nested create).
            lines: {
              create: group.map((t) => ({
                description: t.description || 'Charge',
                amount: t.amount,
                transactionId: t.id,
              })),
            },
          },
        });

        await tx.transaction.updateMany({
          where: { id: { in: group.map((t) => t.id) } },
          data: { invoiceId: created.id },
        });

        out.push(created);
        totals.push({ id: created.id, total: subtotal });
      }

      // Credit is allocated once the whole batch exists, not per invoice as it
      // is built: measuring it invoice-by-invoice makes each sibling's charges
      // look like debt against the other's credit. See applyCreditAcrossInvoices.
      const applied = await applyCreditAcrossInvoices(tx, {
        familyId,
        batchTxIds: txs.map((t) => t.id),
        invoices: totals,
      });

      return out.map((inv) => {
        const amount = applied.get(inv.id) ?? 0;
        if (amount <= 0) return inv;
        const total = totals.find((t) => t.id === inv.id).total;
        return { ...inv, amountPaid: amount, status: amount >= total ? 'PAID' : inv.status };
      });
    });
    queueWaveSync(invoices.map((inv) => inv.id));

    const shape = (invoice) => ({
      id: invoice.invoiceNumber,
      familyId: invoice.familyId,
      studentId: invoice.studentId,
      studentName: invoice.studentId ? (studentNames.get(invoice.studentId) ?? null) : null,
      date: invoice.date.toISOString().split('T')[0],
      dateRange: invoice.dateRange,
      amount: Number(invoice.totalAmount),
      status: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).toLowerCase(),
    });

    res.status(201).json({
      invoices: invoices.map(shape),
      // Kept so a caller written against the single-invoice shape still reads
      // something sensible rather than undefined.
      invoice: shape(invoices[0]),
    });
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────── EMA STEP UP ──────────────────────────── */

// POST /api/billing/ema/generate
// Body: { groups: [{ studentName, emaStudentId, total, poNumbers: [], rows: [{poNumber, amount}] }] }
// Assigns one sequential LC-#### invoice per student group, records invoices,
// and — for each row — finds the actual dated charge (Transaction) behind
// that amount so the CSV's START/END DATE can reflect the real session date
// instead of the batch's purchase date.
export const generateEmaBatch = async (req, res, next) => {
  try {
    const { groups } = req.body;
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ message: 'groups array is required.' });
    }

    const results = await prisma.$transaction(async (tx) => {
      let nextNum = await nextLcNumber(tx);
      const out = [];

      // ── Batched prefetch ──────────────────────────────────────────────
      // This used to run one student lookup (sometimes two) per group and one
      // charge lookup per CSV row. A real Step Up export is ~20 students and
      // ~90 rows, so that was ~100 sequential round trips inside a single
      // transaction — measured at 72s against the pooled Neon connection,
      // which blew the transaction budget every time and surfaced to the
      // admin as a bare 500. The same work is three queries when batched.
      const students = await tx.user.findMany({
        where: { role: 'STUDENT' },
        select: { id: true, fullName: true, emaStudentId: true, familyMembers: { select: { familyId: true }, take: 1 } },
      });
      const studentByEmaId = new Map();
      const studentByName = new Map();
      for (const s of students) {
        if (s.emaStudentId) studentByEmaId.set(s.emaStudentId, s);
        // First writer wins, so a duplicate name resolves the same way the
        // old findFirst did rather than silently flipping between rows.
        const nameKey = (s.fullName || '').trim().toLowerCase();
        if (nameKey && !studentByName.has(nameKey)) studentByName.set(nameKey, s);
      }

      // Step Up's own student ID is stable across submissions — once we've
      // seen it for a student, it's a far more reliable match than a name
      // string (typos, "Jr."/"III" suffixes, married-name changes, etc.).
      const matchedByGroup = new Map();
      for (const g of groups) {
        const match = (g.emaStudentId ? studentByEmaId.get(g.emaStudentId) : null)
          || (g.studentName ? studentByName.get(g.studentName.trim().toLowerCase()) : null)
          || null;
        if (match) matchedByGroup.set(g, match);
      }

      const matchedIds = [...new Set([...matchedByGroup.values()].map((s) => s.id))];
      const matchedFamilyIds = [...new Set(
        [...matchedByGroup.values()].map((s) => s.familyMembers?.[0]?.familyId).filter(Boolean),
      )];

      // ── The invoice each student's rows belong to ─────────────────────
      // Step Up is paying an invoice that already exists: the term's coves and
      // electives were billed when the calendar charges were approved, and the
      // scholarship covers part of that (which is why these invoices are still
      // open — SENT/OVERDUE with a partial amountPaid). Minting a fresh invoice
      // per batch would bill the family a second time for money already
      // invoiced, so reuse the open one and only create a number when the
      // student genuinely has none.
      const openInvoices = matchedIds.length > 0 || matchedFamilyIds.length > 0
        ? await tx.invoice.findMany({
            where: {
              status: { notIn: ['PAID', 'CANCELLED'] },
              OR: [
                { studentId: { in: matchedIds } },
                // Invoices raised for the household rather than one child.
                { familyId: { in: matchedFamilyIds }, studentId: null },
              ],
            },
            orderBy: { date: 'asc' },
            select: {
              id: true, invoiceNumber: true, studentId: true, familyId: true, poNumbers: true,
              totalAmount: true, amountPaid: true,
            },
          })
        : [];
      const openByStudent = new Map();
      const openByFamily = new Map();
      for (const inv of openInvoices) {
        const bucket = inv.studentId ? openByStudent : openByFamily;
        const key = inv.studentId || inv.familyId;
        if (!key) continue;
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push(inv);
      }

      // ── Where the START/END DATE of each row comes from ───────────────
      // The student's own completed meetings. Note these are deliberately NOT
      // de-duplicated by date: a child in two coves that both met on the 10th
      // has two sessions that day, and two of their Step Up rows should say
      // the 10th. Dates are never invented past today — this feeds a real
      // state scholarship filing.
      const today = academyToday();
      const sessionsByStudent = new Map();
      if (matchedIds.length > 0) {
        const enrollments = await tx.classEnrollment.findMany({
          where: { studentId: { in: matchedIds } },
          select: { classId: true, studentId: true },
        });
        const classIds = [...new Set(enrollments.map((e) => e.classId))];
        const sessions = classIds.length > 0
          ? await tx.session.findMany({
              where: { classId: { in: classIds }, status: 'COMPLETED', date: { lte: today } },
              orderBy: { date: 'asc' },
              select: { classId: true, date: true },
            })
          : [];
        const byClass = new Map();
        for (const s of sessions) {
          if (!byClass.has(s.classId)) byClass.set(s.classId, []);
          byClass.get(s.classId).push(s.date);
        }
        for (const e of enrollments) {
          if (!sessionsByStudent.has(e.studentId)) sessionsByStudent.set(e.studentId, []);
          sessionsByStudent.get(e.studentId).push(...(byClass.get(e.classId) || []));
        }
        for (const list of sessionsByStudent.values()) list.sort((a, b) => a - b);
      }

      // Learn Step Up IDs for next time where we could only match by name.
      for (const [g, s] of matchedByGroup) {
        if (g.emaStudentId && !s.emaStudentId) {
          await tx.user.update({ where: { id: s.id }, data: { emaStudentId: g.emaStudentId } }).catch(() => {
            // A different student already claimed this emaStudentId (data mix-up) — don't crash the whole batch over it.
          });
        }
      }

      // ── What this batch has already been filed as ─────────────────────
      // A Step Up PO number identifies one service order for all time, so it
      // is the only reliable way to recognise a CSV we have already processed.
      // Without this, re-uploading the same file finds no open invoice for a
      // student whose invoice the first run marked PAID, raises a second one
      // under a fresh number carrying the same POs, and pays it all over
      // again — the exact double-count everything else here guards against.
      const allBatchPos = [...new Set(groups.flatMap((g) => g.poNumbers || []))];
      const invoiceByPo = new Map();
      const alreadyPaidPos = new Set();
      if (allBatchPos.length > 0) {
        const carrying = await tx.invoice.findMany({
          where: { poNumbers: { hasSome: allBatchPos } },
          select: {
            id: true, invoiceNumber: true, studentId: true, familyId: true, poNumbers: true,
            totalAmount: true, amountPaid: true,
          },
        });
        for (const inv of carrying) {
          for (const po of inv.poNumbers) if (!invoiceByPo.has(po)) invoiceByPo.set(po, inv);
        }
        const paid = await tx.payment.findMany({
          where: { method: 'SCHOLARSHIP_EMA', externalReference: { in: allBatchPos } },
          select: { externalReference: true },
        });
        for (const p of paid) alreadyPaidPos.add(p.externalReference);
      }

      // How far into each student's session list this batch has already read.
      // Batch-wide because two groups can resolve to the same student (one
      // keyed by Step Up ID, one by name) and a meeting must not be reported
      // twice in the same submission.
      const sessionCursor = new Map();

      for (const g of groups) {
        const matchedStudent = matchedByGroup.get(g) || null;
        const familyId = matchedStudent?.familyMembers?.[0]?.familyId || null;
        const total = Number(g.total) || 0;
        const rows = g.rows || [];

        // ── Dates ────────────────────────────────────────────────────────
        const rowDates = {};
        if (matchedStudent) {
          const available = sessionsByStudent.get(matchedStudent.id) || [];
          let cursor = sessionCursor.get(matchedStudent.id) || 0;
          // Rows past the student's last completed meeting are the scholarship
          // paying ahead of what's been taught; that surplus lands as account
          // credit on reconcile. Step Up still wants a date, so carry on one
          // day at a time from the last real meeting — never reaching today,
          // and never invented out of nothing when there was no meeting to
          // anchor to.
          let filler = null;
          for (const row of rows) {
            if (cursor < available.length) {
              const date = available[cursor++];
              filler = date;
              rowDates[row.poNumber] = date.toISOString().split('T')[0];
              continue;
            }
            if (!filler) { rowDates[row.poNumber] = null; continue; }
            const next = academyDayOffset(filler, 1);
            if (next >= today) { rowDates[row.poNumber] = null; continue; }
            filler = next;
            rowDates[row.poNumber] = next.toISOString().split('T')[0];
          }
          sessionCursor.set(matchedStudent.id, cursor);
        } else {
          for (const row of rows) rowDates[row.poNumber] = null;
        }

        // ── Which invoice these PO numbers belong to ─────────────────────
        const studentOpen = matchedStudent ? (openByStudent.get(matchedStudent.id) || []) : [];
        const familyOpen = familyId ? (openByFamily.get(familyId) || []) : [];
        const candidates = studentOpen.length > 0 ? studentOpen : familyOpen;

        let invoiceNumber = null;
        let reusedInvoice = false;
        let ambiguousInvoice = false;
        let targetInvoice = null;

        // A number already written in the uploaded file was submitted to Step
        // Up under that number — by hand before the app could do this, or by an
        // earlier run. The state's records say so, so it wins outright: pick
        // our own instead and the two sets of books stop agreeing about which
        // invoice a scholarship paid.
        // Already filed: some invoice carries these POs. That invoice IS this
        // submission, whatever number the file now suggests, so go back to it
        // rather than raising a second one for the same service orders.
        const filedUnder = (g.poNumbers || []).map((po) => invoiceByPo.get(po)).find(Boolean);

        const pinned = (g.csvInvoiceNumber || '').trim();
        if (filedUnder) {
          targetInvoice = filedUnder;
          invoiceNumber = filedUnder.invoiceNumber;
          reusedInvoice = true;
          // The file names a different invoice than the one these POs are on.
          // Not something to fix by writing more rows — say so and let an
          // admin decide (the renumbering is a deliberate act).
          if (pinned && pinned !== filedUnder.invoiceNumber) ambiguousInvoice = true;
        } else if (pinned && matchedStudent) {
          const existing = await tx.invoice.findUnique({
            where: { invoiceNumber: pinned },
            select: {
              id: true, invoiceNumber: true, studentId: true, familyId: true, poNumbers: true,
              totalAmount: true, amountPaid: true,
            },
          });
          // A mistyped number could name a real invoice belonging to somebody
          // else, and honouring it would move a scholarship onto another
          // family's bill. Only accept one that is already this student's, or
          // their household's.
          const belongsToStudent = existing && (
            existing.studentId === matchedStudent.id
            || (existing.studentId === null && familyId && existing.familyId === familyId)
          );

          if (existing && !belongsToStudent) {
            ambiguousInvoice = true;
          } else if (existing) {
            targetInvoice = existing;
            const merged = [...new Set([...(existing.poNumbers || []), ...(g.poNumbers || [])])];
            if (merged.length !== (existing.poNumbers || []).length) {
              await tx.invoice.update({ where: { id: existing.id }, data: { poNumbers: merged } });
            }
          } else {
            // Numbers filed by hand ran ahead of ours (they continued WAVE's
            // sequence). Creating it under the submitted number both keeps the
            // books aligned and pulls our sequence up past it.
            const created = await tx.invoice.create({
              data: {
                invoiceNumber: pinned,
                familyId,
                studentId: matchedStudent.id,
                source: 'EMA',
                poNumbers: g.poNumbers || [],
                subtotal: total,
                totalAmount: total,
                status: 'DRAFT',
                dateRange: 'EMA Step Up Batch',
                lines: rows.length > 0
                  ? { create: rows.map((r) => ({ description: `EMA session — PO ${r.poNumber}`, amount: Number(r.amount) || 0 })) }
                  : undefined,
              },
              select: {
                id: true, invoiceNumber: true, studentId: true, familyId: true, poNumbers: true,
                totalAmount: true, amountPaid: true,
              },
            });
            targetInvoice = created;
          }
          invoiceNumber = targetInvoice ? targetInvoice.invoiceNumber : null;
          reusedInvoice = !!targetInvoice && !!existing;
        } else if (candidates.length === 1) {
          const target = candidates[0];
          invoiceNumber = target.invoiceNumber;
          targetInvoice = target;
          reusedInvoice = true;
          // The remittance references PO numbers, so the invoice has to carry
          // them or reconcileEmaRemittance can't find it when the block
          // payment arrives weeks later.
          const merged = [...new Set([...(target.poNumbers || []), ...(g.poNumbers || [])])];
          if (merged.length !== (target.poNumbers || []).length) {
            await tx.invoice.update({ where: { id: target.id }, data: { poNumbers: merged } });
            target.poNumbers = merged;
          }
        } else if (candidates.length > 1) {
          // Several open invoices and nothing in the CSV says which one the
          // scholarship is paying. Guessing would attach real money to the
          // wrong invoice, so leave the column blank — Step Up accepts that —
          // and tell the admin to pick.
          ambiguousInvoice = true;
        } else if (matchedStudent) {
          // Nothing open to attach to: this student's work isn't billed in the
          // app yet, so the batch is the only record of it. Raise an invoice.
          const created = await tx.invoice.create({
            data: {
              invoiceNumber: `LC-${nextNum++}`,
              familyId,
              studentId: matchedStudent.id,
              source: 'EMA',
              poNumbers: g.poNumbers || [],
              subtotal: total,
              totalAmount: total,
              status: 'DRAFT',
              dateRange: 'EMA Step Up Batch',
              lines: rows.length > 0
                ? { create: rows.map((r) => ({ description: `EMA session — PO ${r.poNumber}`, amount: Number(r.amount) || 0 })) }
                : undefined,
            },
          });
          invoiceNumber = created.invoiceNumber;
          if (familyId && total > 0) {
            await applyAvailableCredit(tx, { familyId, studentId: matchedStudent.id, invoiceId: created.id, invoiceTotal: total });
          }
          // Re-read: applyAvailableCredit may have moved amountPaid.
          targetInvoice = await tx.invoice.findUnique({
            where: { id: created.id },
            select: {
              id: true, invoiceNumber: true, studentId: true, familyId: true, poNumbers: true,
              totalAmount: true, amountPaid: true,
            },
          });
        }

        // ── Record what Step Up has committed to pay ─────────────────────
        // The CSV going back to Step Up is the claim; the block payment lands
        // days later. Recording it now is what makes the family's balance stop
        // showing money the scholarship has already approved — but the Payment
        // is left PENDING, because no money has actually arrived. That status
        // is what the portal reads to show it as a pending scholarship, and
        // what reconcileEmaRemittance promotes to COMPLETED on receipt.
        let recordedPayments = 0;
        let scholarshipPending = 0;
        if (targetInvoice && rows.length > 0) {
          const invoiceTotal = Number(targetInvoice.totalAmount);
          let paidSoFar = Number(targetInvoice.amountPaid);
          const ledgerRows = [];
          const disbursements = [];

          for (const row of rows) {
            const amount = Number(row.amount) || 0;
            if (amount <= 0) continue;

            // Skip a PO already recorded by an earlier submission. Checked
            // against every EMA payment, not just this invoice's: one PO is
            // one service order and is payable exactly once, so if it has been
            // recorded anywhere it must not be recorded again here.
            if (alreadyPaidPos.has(row.poNumber)) continue;
            alreadyPaidPos.add(row.poNumber);

            // Same capping rule the reconciler uses: what exceeds the invoice
            // becomes family credit rather than inflating amountPaid.
            const applied = Math.min(amount, Math.max(0, invoiceTotal - paidSoFar));
            const excess = amount - applied;
            paidSoFar += applied;

            const payment = await tx.payment.create({
              data: {
                familyId: targetInvoice.familyId,
                invoiceId: targetInvoice.id,
                amount,
                netAmount: amount,
                method: 'SCHOLARSHIP_EMA',
                status: 'PENDING',
                externalReference: row.poNumber,
                recordedById: req.user?.id || null,
                notes: `EMA Step Up submitted — PO ${row.poNumber} (awaiting remittance)`,
              },
              select: { id: true },
            });
            recordedPayments++;
            scholarshipPending += amount;

            if (targetInvoice.familyId) {
              if (applied > 0) {
                ledgerRows.push({
                  studentId: targetInvoice.studentId || null,
                  familyId: targetInvoice.familyId,
                  amount: applied,
                  type: 'PAYMENT',
                  description: `EMA Step Up — PO ${row.poNumber} (pending)`,
                  invoiceId: targetInvoice.id,
                  paymentId: payment.id,
                });
              }
              if (excess > 0) {
                ledgerRows.push({
                  studentId: targetInvoice.studentId || null,
                  familyId: targetInvoice.familyId,
                  amount: excess,
                  type: 'CREDIT',
                  description: `EMA Step Up overpayment — PO ${row.poNumber} (account credit)`,
                  paymentId: payment.id,
                });
              }
            }

            disbursements.push({
              familyId: targetInvoice.familyId,
              studentId: targetInvoice.studentId || null,
              program: 'EMA',
              amount,
              period: 'EMA Step Up Batch',
              status: 'PENDING',
              paymentId: payment.id,
            });
          }

          if (ledgerRows.length > 0) await tx.transaction.createMany({ data: ledgerRows });
          if (disbursements.length > 0) await tx.scholarshipDisbursement.createMany({ data: disbursements });

          if (recordedPayments > 0) {
            await tx.invoice.update({
              where: { id: targetInvoice.id },
              data: { amountPaid: paidSoFar, status: paidSoFar >= invoiceTotal ? 'PAID' : targetInvoice.status || 'DRAFT' },
            });
          }
        }

        out.push({
          ...g,
          invoiceNumber,
          familyId,
          matched: !!matchedStudent,
          reusedInvoice,
          ambiguousInvoice,
          recordedPayments,
          scholarshipPending,
          rowDates,
          unmatchedRowCount: Object.values(rowDates).filter((d) => d === null).length,
          // Only present for a brand-new invoice this batch raised — carried
          // through so the caller can fire its Wave sync without re-querying.
          newInvoiceId: !reusedInvoice ? (targetInvoice?.id ?? null) : null,
        });
      }
      return out;
    }, { timeout: 120000, maxWait: 20000 });
    queueWaveSync(results.map((g) => g.newInvoiceId).filter(Boolean));

    console.log(
      `[Billing] ${req.user.email} filed an EMA batch: ${results.length} group(s), `
      + `${results.reduce((sum, g) => sum + g.recordedPayments, 0)} payment(s) pending `
      + `$${results.reduce((sum, g) => sum + g.scholarshipPending, 0).toFixed(2)}`
    );

    res.json({ groups: results.map(({ newInvoiceId, ...g }) => g) });
  } catch (error) {
    next(error);
  }
};

// Shared by the real reconcile and its dry-run preview — `db` is either the
// plain prisma client (dryRun, read-only) or a `tx` inside a transaction
// (real run). When dryRun, every write is skipped so the preview can show
// exactly what WOULD happen without touching any data.
const runReconciliation = async (db, lines, { dryRun, recordedById = null }) => {
  const r = { matched: [], unmatched: [], alreadyReconciled: [], totalMatched: 0, invoicesPaid: [] };
  const touched = new Map();

  for (const line of lines) {
    const amount = Number(line.amount) || 0;
    const invoice = await db.invoice.findFirst({
      where: {
        OR: [
          line.poNumber ? { poNumbers: { has: line.poNumber } } : undefined,
          line.poNumber ? { invoiceNumber: line.poNumber } : undefined,
        ].filter(Boolean),
      },
    });

    if (!invoice) { r.unmatched.push(line); continue; }

    // A payment for this PO may already exist, and what to do depends on why.
    //
    // PENDING means the batch recorded it when the CSV went to Step Up: the
    // amount is already on the invoice and the ledger, and the only thing the
    // remittance adds is proof the money arrived. Promote it to COMPLETED and
    // move on — re-applying it here would pay the invoice twice.
    //
    // COMPLETED means this line has genuinely been reconciled before (the same
    // remittance pasted twice), so skip it.
    const existingPayment = await db.payment.findFirst({
      where: {
        invoiceId: invoice.id,
        method: 'SCHOLARSHIP_EMA',
        externalReference: line.poNumber || invoice.invoiceNumber,
        amount,
      },
    });

    if (existingPayment && existingPayment.status === 'COMPLETED') {
      r.alreadyReconciled.push({ ...line, invoiceNumber: invoice.invoiceNumber });
      continue;
    }

    if (existingPayment) {
      if (!dryRun) {
        await db.payment.update({
          where: { id: existingPayment.id },
          data: {
            status: 'COMPLETED',
            paidAt: new Date(),
            notes: `EMA Step Up remittance — ${line.poNumber || invoice.invoiceNumber}`,
          },
        });
        await db.scholarshipDisbursement.updateMany({
          where: { paymentId: existingPayment.id },
          data: { status: 'RECEIVED', receivedAt: new Date() },
        });
        // Update in place rather than delete-and-recreate: these ledger rows
        // are what the family's balance is built from.
        await db.transaction.updateMany({
          where: { paymentId: existingPayment.id, type: 'PAYMENT' },
          data: { description: `EMA Step Up — ${line.poNumber || invoice.invoiceNumber}` },
        });
      }
      r.matched.push({
        ...line, invoiceNumber: invoice.invoiceNumber, familyId: invoice.familyId,
        creditApplied: 0, confirmedPending: true,
      });
      r.totalMatched += amount;
      continue;
    }

    // Cap what's applied to THIS invoice at its total — a remittance line
    // that overpays (common with EMA's block payments) shouldn't inflate
    // amountPaid past totalAmount; the excess becomes family credit instead.
    const totalAmount = Number(invoice.totalAmount);
    const appliedToInvoice = Math.min(amount, Math.max(0, totalAmount - Number(invoice.amountPaid)));
    const excess = amount - appliedToInvoice;
    const newPaid = Number(invoice.amountPaid) + appliedToInvoice;

    if (!dryRun) {
      await db.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid } });

      // Payment records the full amount actually received from the remittance.
      await db.payment.create({
        data: {
          familyId: invoice.familyId,
          invoiceId: invoice.id,
          amount,
          netAmount: amount,
          method: 'SCHOLARSHIP_EMA',
          status: 'COMPLETED',
          externalReference: line.poNumber || invoice.invoiceNumber,
          recordedById: recordedById || null,
          notes: `EMA Step Up remittance — ${line.poNumber || invoice.invoiceNumber}`,
        },
      });

      if (invoice.familyId) {
        if (appliedToInvoice > 0) {
          await db.transaction.create({
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
          await db.transaction.create({
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
    }

    r.matched.push({ ...line, invoiceNumber: invoice.invoiceNumber, familyId: invoice.familyId, creditApplied: excess });
    r.totalMatched += amount;
    touched.set(invoice.id, { total: totalAmount, paid: newPaid, number: invoice.invoiceNumber, currentStatus: invoice.status });
  }

  for (const [id, info] of touched) {
    const status = info.paid >= info.total ? 'PAID' : info.currentStatus;
    if (!dryRun) {
      await db.invoice.update({ where: { id }, data: { status } });
    }
    if (status === 'PAID') r.invoicesPaid.push(info.number);
  }

  return r;
};

// POST /api/billing/ema/reconcile
// Body: { lines: [{ poNumber, studentName, amount }], dryRun?: boolean }
// Matches each remittance line to the invoice covering that PO #, records a
// scholarship payment, and marks fully-paid invoices PAID. With dryRun: true,
// runs the exact same matching logic read-only — this is what the "preview"
// step in the reconcile modal calls, so what the admin sees is guaranteed to
// match what confirming will actually do (previously the preview re-matched
// client-side against data it didn't have, and always showed "no match").
export const reconcileEmaRemittance = async (req, res, next) => {
  try {
    const { lines, dryRun } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: 'lines array is required.' });
    }

    const report = dryRun
      ? await runReconciliation(prisma, lines, { dryRun: true })
      : await prisma.$transaction((tx) => runReconciliation(tx, lines, { dryRun: false, recordedById: req.user?.id || null }));

    // Money arriving from Step Up, same as any other money: on the record with
    // a name against it. A dry run moves nothing, so it says nothing.
    if (!dryRun) {
      console.log(
        `[Billing] ${req.user.email} reconciled ${report.matched.length} EMA remittance line(s) `
        + `totalling $${report.totalMatched.toFixed(2)} across ${report.invoicesPaid.length} invoice(s)`
      );
    }

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
                status: newPaid <= 0 ? (invoice.sentAt ? 'SENT' : 'DRAFT') : (newPaid >= Number(invoice.totalAmount) ? 'PAID' : invoice.status),
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
        // Durable copy for the admin bell — this is a must-not-miss reconciliation task.
        await notifyAdmins({
          type: 'BILLING',
          title: 'Refund needs manual reconciliation',
          message: `Stripe refund ${stripeRefundId} for payment ${payment.id} (${payment.familyId || 'unknown family'}) succeeded, but recording it in the ledger failed. Check the payment and Stripe dashboard manually.`,
          referenceType: 'payment',
          referenceId: payment.id,
        });
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

/**
 * GET /api/billing/session-charges?from=&to=
 * What the priced meetings in a date range would charge. Read-only — this is
 * the sheet an admin checks before any money is committed.
 */
export const previewSessionCharges = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const range = parseChargeRange(from, to);
    if (range.error) {
      return res.status(400).json({ error: 'Validation Error', message: range.error });
    }
    res.json(await buildSessionCharges(range));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/session-charges
 * Body: { from?, to?, sessionIds?: string[] }
 * Raises the priced meetings as Transactions, which the invoicing screen then
 * bundles onto an invoice.
 *
 * Recomputed here rather than trusting amounts posted by the client: the browser
 * must not be able to name the price. Re-running is safe — the unique index on
 * (studentId, sessionId) refuses a second charge for the same meeting, so a
 * double click or a retry after a timeout cannot bill twice.
 *
 * `sessionIds` narrows the commit to particular meetings, for the admin who
 * wants to raise this week's workshop without also releasing everything else
 * sitting in the range.
 */
export const generateSessionCharges = async (req, res, next) => {
  try {
    const { from, to, sessionIds, includeJoinedLate } = req.body;
    const range = parseChargeRange(from, to);
    if (range.error) {
      return res.status(400).json({ error: 'Validation Error', message: range.error });
    }

    const wanted = Array.isArray(sessionIds) && sessionIds.length > 0
      ? new Set(sessionIds)
      : null;

    // Billing somebody for a class they joined after it happened is a decision,
    // never a default — and only ever for named meetings. Allowing it on a
    // whole range would put it one careless click away from the retroactive
    // sweep this flag exists to stop.
    if (includeJoinedLate && !wanted) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Charging students who enrolled after the meeting has to name the meetings — pick them individually.',
      });
    }

    const { lines } = await buildSessionCharges(range);
    const allowJoinedLate = Boolean(includeJoinedLate);
    const billable = lines.filter((l) => isBillable(l, { allowJoinedLate }) && (!wanted || wanted.has(l.sessionId)));

    if (billable.length === 0) {
      return res.json({
        message: 'Nothing to charge — every priced meeting in that range is already billed.',
        created: 0,
        skipped: lines.length,
      });
    }

    const created = await prisma.transaction.createMany({
      data: billable.map((l) => ({
        studentId: l.studentId,
        familyId: l.familyId,
        amount: l.amount,
        type: 'CHARGE',
        // Carries the student's name onto the charge itself, not just the
        // meeting's name — a sibling pair in the same class raises two
        // otherwise-identical lines, and this is what tells them apart on the
        // invoice a family actually reads.
        description: `${l.description} — ${l.studentName}`,
        date: l.date,
        sessionId: l.sessionId,
      })),
      // Belt and braces alongside the unique index: a concurrent second run
      // skips what it finds rather than failing the whole batch.
      skipDuplicates: true,
    });

    // Approving a batch raises the charges and stops there — no invoice.
    //
    // It used to raise one invoice per family per run, which sounds right
    // until you approve two batches: the same family gets a second document
    // for the same week, and neither is the bill they were expecting. The
    // invoice is a statement of a *period*, not of whatever an admin happened
    // to tick in one sitting, so it is raised from Billing → the family →
    // "Bill a period" once the period's charges are all on the ledger.
    //
    // Until then the family sees the money in their portal balance, which
    // counts uninvoiced charges; what they cannot do is pay it by card, since
    // the portal's checkout runs off an invoice.
    const late = billable.filter((l) => l.joinedLate);
    console.log(
      `[Billing] ${req.user.email} raised ${created.count} session charge(s) `
      + `totalling $${billable.reduce((sum, l) => sum + l.amount, 0).toFixed(2)}`
      // Named individually: this is the one path that bills a student for a
      // meeting predating their enrollment, so who did it has to be on record.
      + (late.length > 0
        ? ` — including ${late.length} for students enrolled after the meeting: `
          + late.map((l) => `${l.studentName} ($${l.amount})`).join(', ')
        : '')
    );

    res.json({
      message: created.count === 0
        ? 'Nothing new to charge — those meetings are already billed.'
        : `Raised ${created.count} charge${created.count === 1 ? '' : 's'}. `
          + 'Bill them from the family\'s Invoices tab when the period is complete.',
      created: created.count,
      skipped: lines.length - billable.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * The from/to pair as Dates, or an error message.
 *
 * Both are optional — no range means "every priced meeting there has ever
 * been", which is what an admin wants the first time they open the screen and
 * harmless because anything already billed comes back flagged rather than
 * raised again.
 */
const parseChargeRange = (from, to) => {
  const parse = (value, label) => {
    if (!value) return { value: undefined };
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
      ? { error: `${label} must be a valid date.` }
      : { value: date };
  };

  const start = parse(from, 'from');
  if (start.error) return { error: start.error };
  const end = parse(to, 'to');
  if (end.error) return { error: end.error };
  if (start.value && end.value && end.value < start.value) {
    return { error: 'from must be on or before to.' };
  }
  return { from: start.value, to: end.value };
};

/**
 * PUT /api/billing/session-charges/override
 * What one student pays for one meeting, when it isn't the meeting's price.
 *
 * The price on a calendar entry is a single number for the whole roster, which
 * stops being right the moment somebody's fee already covers the room they are
 * sitting in — an 8th grader on a $2,000 full-day programme is inside the same
 * cove everyone else pays $400 for, and billing them again is charging twice for
 * one seat.
 *
 * An amount rather than a flag: "free for her" and "reduced to $50" are the same
 * decision at different numbers. Send `amount: null` to drop the override and
 * put the student back on the meeting's own price.
 *
 * Body: { sessionId, studentIds: string[], amount: number|null, reason?: string }
 * Takes a list of students because the reason for exempting one is almost always
 * the reason for exempting the others.
 */
export const setSessionChargeOverride = async (req, res, next) => {
  try {
    const { sessionId, studentIds, amount, reason } = req.body;

    if (!sessionId || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send a sessionId and the students it applies to in studentIds.',
      });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      return res.status(404).json({ error: 'Not Found', message: 'That session does not exist.' });
    }

    // Clearing: the students go back to whatever the meeting charges.
    if (amount === null || amount === undefined || amount === '') {
      const { count } = await prisma.sessionChargeOverride.deleteMany({
        where: { sessionId, studentId: { in: studentIds } },
      });
      return res.json({
        message: count === 0
          ? 'Those students were already on the meeting’s own price.'
          : `${count} student${count === 1 ? '' : 's'} back on the meeting’s price.`,
        cleared: count,
      });
    }

    const n = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'Validation Error', message: 'The amount must be a number.' });
    if (n < 0) return res.status(400).json({ error: 'Validation Error', message: 'The amount cannot be negative.' });
    if (n > 99999999.99) return res.status(400).json({ error: 'Validation Error', message: 'That amount is implausibly large.' });
    const value = Math.round(n * 100) / 100;

    // Upsert per student rather than deleteMany+createMany: re-pricing somebody
    // who already had an override must not briefly leave them on the full price
    // if the second half of the write fails.
    await prisma.$transaction(
      studentIds.map((studentId) =>
        prisma.sessionChargeOverride.upsert({
          where: { sessionId_studentId: { sessionId, studentId } },
          create: {
            sessionId,
            studentId,
            amount: value,
            reason: reason?.trim()?.slice(0, 255) || null,
            createdById: req.user.id,
          },
          update: {
            amount: value,
            reason: reason?.trim()?.slice(0, 255) || null,
            createdById: req.user.id,
          },
        })
      )
    );

    // The log is the only trace of who priced somebody differently, and by how
    // much, until this is ever questioned.
    console.log(
      `[Billing] ${req.user.email} priced ${studentIds.length} student(s) at $${value.toFixed(2)} `
      + `on session ${sessionId}${reason ? ` (${reason})` : ''}`
    );

    res.json({
      message: value === 0
        ? `${studentIds.length} student${studentIds.length === 1 ? '' : 's'} won’t be charged for this meeting.`
        : `${studentIds.length} student${studentIds.length === 1 ? '' : 's'} priced at $${value.toFixed(2)} for this meeting.`,
      updated: studentIds.length,
    });
  } catch (error) {
    next(error);
  }
};

/* ────────────────── BILLING A BLOCK OF MEETINGS UP FRONT ──────────────────
 *
 * The calendar sweep (previewSessionCharges) only surfaces meetings that
 * already carry a price, which is the right shape for "release what the term
 * has run so far". It cannot answer the other question an admin has: *these
 * families want to pay for the next eight weeks now*. Those meetings exist on
 * the calendar but are deliberately priceless — see sessionCharges.service.js
 * on why nothing auto-prices October — so they are invisible to that screen.
 *
 * Everything below bills them anyway, before they are taught, with each charge
 * carrying its `sessionId`. That link is the whole point of doing this here
 * rather than as typed invoice lines: the unique index on
 * (studentId, sessionId) means the sweep, when those weeks finally arrive,
 * finds them already billed and skips them. Prepaying cannot double-charge.
 *
 * Two entry points, one set of rules: one student's block from their family's
 * ledger, and the same block across a whole class roster.
 */

const readBlockMoney = (value, label) => {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
  if (n <= 0) return { error: `${label} must be greater than zero.` };
  if (n > 99999999.99) return { error: `${label} is implausibly large.` };
  return { value: round2(n) };
};

/**
 * The two prices an admin may name for a block, validated together.
 * They are alternatives, not a pair: one number per meeting, or one number for
 * the run. Sending both is a contradiction rather than a preference, so it is
 * refused instead of silently picking a winner.
 */
const readBlockPricing = ({ unitAmount, blockAmount }) => {
  const unit = readBlockMoney(unitAmount, 'The amount per meeting');
  if (unit.error) return { error: unit.error };
  const block = readBlockMoney(blockAmount, 'The block total');
  if (block.error) return { error: block.error };
  if (unit.value != null && block.value != null) {
    return { error: 'Price the block either per meeting or as one total, not both.' };
  }
  return { unit: unit.value, block: block.value };
};

/** What one meeting charges this student today; null if nobody has priced it. */
const meetingPrice = (session, studentId) => {
  const override = (session.chargeOverrides || []).find((o) => o.studentId === studentId);
  if (override) return round2(Number(override.amount));
  return session.chargeAmount == null ? null : round2(Number(session.chargeAmount));
};

/**
 * A block total split across its meetings, to the cent, remainder on the first.
 * The lines have to add up to the number the admin typed — a plain division
 * leaves a few cents adrift, and a family's invoice that ends in a total nobody
 * asked for is a phone call.
 */
const spreadBlock = (total, count) => {
  const each = Math.floor((total * 100) / count) / 100;
  const remainder = round2(total - each * count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? round2(each + remainder) : each));
};

const blockLineDescription = (session) => {
  const day = session.date.toISOString().slice(0, 10);
  const name = session.class?.name ?? 'Class';
  return session.chargeNote?.trim() ? `${name} — ${session.chargeNote.trim()} (${day})` : `${name} — ${day}`;
};

/**
 * What one student's block would cost, given the meetings picked and the price
 * named. Pure — it reads nothing and writes nothing, so the bulk run can price
 * forty students without forty round trips.
 *
 * Returns `{ error }` rather than throwing: in the bulk run one student's
 * missing price is a row to report, not a reason to abandon the other thirty-
 * nine.
 */
const planBlock = ({ sessions, studentId, unit, block, alreadyBilled }) => {
  const billable = sessions.filter((s) => !alreadyBilled.has(s.id));
  if (billable.length === 0) {
    return { error: 'Every meeting in that block has already been charged to this student.' };
  }

  const spread = block != null ? spreadBlock(block, billable.length) : null;
  const priced = billable.map((session, i) => ({
    session,
    amount: unit ?? spread?.[i] ?? meetingPrice(session, studentId),
  }));

  const unpriced = priced.filter((p) => p.amount == null || p.amount <= 0).length;
  if (unpriced > 0) {
    return { error: `${unpriced} of those meetings have no price. Name an amount for the block, or price them on the calendar first.` };
  }

  return { priced, subtotal: round2(priced.reduce((sum, p) => sum + p.amount, 0)) };
};

/** Writes one block invoice inside an already-open transaction. */
const writeBlockInvoice = async (tx, { familyId, studentId, priced, subtotal, label, due }) => {
  const invoiceNumber = `LC-${await nextLcNumber(tx)}`;
  const created = await tx.invoice.create({
    data: {
      invoiceNumber,
      familyId,
      studentId,
      subtotal,
      totalAmount: subtotal,
      status: 'DRAFT',
      dateRange: label.slice(0, 100),
      dueDate: due,
    },
  });

  for (const { session, amount } of priced) {
    const description = blockLineDescription(session);
    const charge = await tx.transaction.create({
      data: {
        familyId,
        studentId,
        invoiceId: created.id,
        sessionId: session.id,
        // Dated to the meeting it pays for, not to today: a charge for a
        // November class belongs in November on the ledger, however early it
        // was raised.
        date: session.date,
        amount,
        type: 'CHARGE',
        description,
      },
    });
    await tx.invoiceLine.create({
      data: { invoiceId: created.id, description, amount, transactionId: charge.id },
    });
  }

  const { applied } = await applyAvailableCredit(tx, { familyId, invoiceId: created.id, invoiceTotal: subtotal });
  return applied > 0
    ? { ...created, amountPaid: applied, status: applied >= subtotal ? 'PAID' : 'DRAFT' }
    : created;
};

const shapeBlockInvoice = (invoice) => ({
  id: invoice.invoiceNumber,
  dbId: invoice.id,
  familyId: invoice.familyId,
  studentId: invoice.studentId,
  date: invoice.date.toISOString().split('T')[0],
  dateRange: invoice.dateRange,
  amount: Number(invoice.totalAmount),
  amountPaid: Number(invoice.amountPaid),
  status: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).toLowerCase(),
});

const blockLabel = (description, sessions, count) => (
  description?.trim()
  || `${[...new Set(sessions.map((s) => s.class?.name ?? 'Class'))].join(', ')} — block of ${count}`
);

const blockDueDate = (dueDate) => {
  const due = dueDate ? new Date(`${String(dueDate).slice(0, 10)}T00:00:00.000Z`) : new Date(Date.now() + 30 * 86400000);
  return Number.isNaN(due.getTime()) ? { error: 'dueDate must be a valid date.' } : { due };
};

/**
 * A student's scheduled meetings in a window, priced or not, with the ones
 * already charged flagged. Read-only — the price for the block is named by the
 * admin at invoice time.
 *
 * GET /api/billing/block-sessions?studentId=&classId=&from=&to=
 */
export const listBlockSessions = async (req, res, next) => {
  try {
    const { studentId, classId, from, to } = req.query;
    if (!studentId) {
      return res.status(400).json({ error: 'Validation Error', message: 'Send the studentId whose block you are pricing.' });
    }

    const range = parseChargeRange(from, to);
    if (range.error) return res.status(400).json({ error: 'Validation Error', message: range.error });
    // Defaults to "from today forward" rather than the sweep's last-30-days:
    // this screen exists for the meetings that have not happened yet.
    const start = range.from ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const end = range.to ?? new Date(start.getTime() + 180 * 86400000);

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true, fullName: true, role: true,
        familyMembers: { select: { familyId: true }, take: 1 },
        enrollments: {
          where: { status: 'active' },
          select: { class: { select: { id: true, name: true } } },
        },
      },
    });
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ error: 'Not Found', message: 'That student does not exist.' });
    }

    const classes = student.enrollments.map((e) => e.class);
    const classIds = classId
      ? classes.filter((c) => c.id === classId).map((c) => c.id)
      : classes.map((c) => c.id);
    if (classIds.length === 0) {
      return res.json({
        student: { id: student.id, name: student.fullName, familyId: student.familyMembers[0]?.familyId ?? null },
        classes,
        sessions: [],
      });
    }

    const sessions = await prisma.session.findMany({
      where: {
        classId: { in: classIds },
        status: { not: 'CANCELLED' },
        date: { gte: start, lte: end },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true, classId: true, date: true, startTime: true,
        chargeAmount: true, chargeNote: true,
        class: { select: { name: true } },
        chargeOverrides: { where: { studentId }, select: { studentId: true, amount: true } },
      },
    });

    // What this student has already been billed for these meetings. The unique
    // index on (studentId, sessionId) is what will refuse a second charge, but
    // an admin should see it here rather than meet it as an error.
    const charged = await prisma.transaction.findMany({
      where: { studentId, sessionId: { in: sessions.map((s) => s.id) } },
      select: { sessionId: true, amount: true, invoice: { select: { invoiceNumber: true } } },
    });
    const chargedBy = new Map(charged.map((t) => [t.sessionId, t]));

    res.json({
      student: { id: student.id, name: student.fullName, familyId: student.familyMembers[0]?.familyId ?? null },
      classes,
      sessions: sessions.map((s) => {
        const done = chargedBy.get(s.id);
        return {
          id: s.id,
          classId: s.classId,
          className: s.class?.name ?? 'Class',
          date: s.date.toISOString().slice(0, 10),
          startTime: s.startTime.toISOString().slice(11, 16),
          note: s.chargeNote ?? null,
          // The number this meeting would charge today. Null means nobody has
          // priced it — the ordinary case for a term's later weeks, and exactly
          // what the admin is here to put a number on.
          price: meetingPrice(s, studentId),
          priceSource: s.chargeOverrides.length ? 'override' : (s.chargeAmount == null ? null : 'session'),
          alreadyCharged: Boolean(done),
          chargedAmount: done ? round2(Number(done.amount)) : null,
          chargedInvoice: done?.invoice?.invoiceNumber ?? null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/block-invoice
 * Body: { studentId, sessionIds: string[], unitAmount?, blockAmount?, description?, dueDate? }
 *
 * One invoice for one student's block of meetings, raised before they are
 * taught. See the section header for why the charges carry their sessionId.
 */
export const createBlockInvoice = async (req, res, next) => {
  try {
    const { studentId, sessionIds, unitAmount, blockAmount, description, dueDate } = req.body;

    if (!studentId || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send the studentId and the meetings the block covers in sessionIds.',
      });
    }

    const pricing = readBlockPricing({ unitAmount, blockAmount });
    if (pricing.error) return res.status(400).json({ error: 'Validation Error', message: pricing.error });

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true, fullName: true, role: true,
        familyMembers: { select: { familyId: true }, take: 1 },
        enrollments: { where: { status: 'active' }, select: { classId: true } },
      },
    });
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ error: 'Not Found', message: 'That student does not exist.' });
    }
    if (student.familyMembers.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: `${student.fullName} is not attached to a family yet, so there is no account to bill. Add them to a family first.`,
      });
    }
    const familyId = student.familyMembers[0].familyId;

    const sessions = await prisma.session.findMany({
      where: { id: { in: sessionIds }, status: { not: 'CANCELLED' } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true, classId: true, date: true, chargeAmount: true, chargeNote: true,
        class: { select: { name: true } },
        chargeOverrides: { where: { studentId }, select: { studentId: true, amount: true } },
      },
    });
    if (sessions.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'None of those meetings exist, or they are all cancelled.' });
    }

    // A block bills the classes this student is actually in. Billing them for a
    // room they are not enrolled in is never the intent, and would show up on
    // the parent's invoice as a class they have never heard of.
    const enrolledIn = new Set(student.enrollments.map((e) => e.classId));
    const foreign = sessions.filter((s) => !enrolledIn.has(s.classId));
    if (foreign.length > 0) {
      const names = [...new Set(foreign.map((s) => s.class?.name ?? 'that class'))].join(', ');
      return res.status(409).json({
        error: 'Conflict',
        message: `${student.fullName} is not actively enrolled in ${names}.`,
      });
    }

    // Already-billed meetings are dropped rather than refused: an admin who
    // re-submits, or who selected a week a sweep picked up in between, should
    // still get the rest of the block invoiced — and be told which ones were
    // left out, so nothing looks silently skipped.
    const existing = await prisma.transaction.findMany({
      where: { studentId, sessionId: { in: sessions.map((s) => s.id) } },
      select: { sessionId: true, invoice: { select: { invoiceNumber: true } } },
    });
    const already = new Map(existing.map((t) => [t.sessionId, t.invoice?.invoiceNumber ?? null]));

    const plan = planBlock({ sessions, studentId, unit: pricing.unit, block: pricing.block, alreadyBilled: already });
    if (plan.error) {
      // "All of it is already billed" is a conflict; "you never named a price"
      // is the admin not having finished the form.
      const status = already.size === sessions.length ? 409 : 400;
      return res.status(status).json({ error: status === 409 ? 'Conflict' : 'Validation Error', message: plan.error });
    }

    const label = blockLabel(description, plan.priced.map((p) => p.session), plan.priced.length);
    const dueParsed = blockDueDate(dueDate);
    if (dueParsed.error) return res.status(400).json({ error: 'Validation Error', message: dueParsed.error });

    const invoice = await prisma.$transaction((tx) => writeBlockInvoice(tx, {
      familyId, studentId, priced: plan.priced, subtotal: plan.subtotal, label, due: dueParsed.due,
    }));
    queueWaveSync(invoice.id);

    console.log(
      `[Billing] ${req.user.email} raised block invoice ${invoice.invoiceNumber} for ${student.fullName} `
      + `($${plan.subtotal.toFixed(2)}, ${plan.priced.length} meetings, ${already.size} already billed)`
    );

    res.status(201).json({
      invoice: shapeBlockInvoice(invoice),
      billed: plan.priced.length,
      skipped: [...already.entries()].map(([sessionId, invoiceNumber]) => ({ sessionId, invoiceNumber })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/billing/block-roster?classIds=a,b&from=&to=
 *
 * The same block, seen across a whole roster: every actively enrolled student
 * in the chosen classes, the meetings in the window, and what each of them has
 * already been billed for.
 *
 * This is the shape a term is actually sold in — a cove runs for eight weeks
 * and thirty families are on it, and billing them one ledger at a time is
 * thirty passes over the same decision. Splitting the preview from the run is
 * the same rule the rest of this file follows: money that reaches real families
 * is looked at as a sheet first.
 *
 * Students with no family come back listed and flagged rather than filtered
 * out — there is nothing to bill, and an admin who cannot see them has no way
 * to know why the count is short.
 */
export const listBlockRoster = async (req, res, next) => {
  try {
    const { classIds, from, to } = req.query;
    const ids = String(classIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'Send the classes to bill in classIds.' });
    }

    const range = parseChargeRange(from, to);
    if (range.error) return res.status(400).json({ error: 'Validation Error', message: range.error });
    const start = range.from ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const end = range.to ?? new Date(start.getTime() + 180 * 86400000);

    const [classes, sessions, enrollments] = await Promise.all([
      prisma.class.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      prisma.session.findMany({
        where: { classId: { in: ids }, status: { not: 'CANCELLED' }, date: { gte: start, lte: end } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        select: {
          id: true, classId: true, date: true, startTime: true,
          chargeAmount: true, chargeNote: true,
          class: { select: { name: true } },
          chargeOverrides: { select: { studentId: true, amount: true } },
        },
      }),
      // The roster as it stands now, not as it stood when the term was sold —
      // the same rule the calendar sweep follows.
      prisma.classEnrollment.findMany({
        where: { classId: { in: ids }, status: 'active' },
        select: {
          classId: true,
          student: {
            select: {
              id: true, fullName: true,
              familyMembers: {
                select: { familyId: true, family: { select: { name: true } } },
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    if (classes.length !== ids.length) {
      return res.status(404).json({ error: 'Not Found', message: 'One of those classes does not exist.' });
    }

    const charged = await prisma.transaction.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: { studentId: true, sessionId: true, invoice: { select: { invoiceNumber: true } } },
    });
    const chargedBy = new Map(charged.map((t) => [`${t.studentId}:${t.sessionId}`, t.invoice?.invoiceNumber ?? null]));

    // One row per student even when they are on two of the chosen classes: they
    // get one invoice, so they are one line on the sheet.
    const byStudent = new Map();
    for (const e of enrollments) {
      const s = e.student;
      if (!byStudent.has(s.id)) {
        byStudent.set(s.id, {
          studentId: s.id,
          name: s.fullName,
          familyId: s.familyMembers[0]?.familyId ?? null,
          familyName: s.familyMembers[0]?.family?.name ?? null,
          classIds: [],
        });
      }
      byStudent.get(s.id).classIds.push(e.classId);
    }

    const students = [...byStudent.values()]
      .map((student) => {
        const theirs = sessions.filter((s) => student.classIds.includes(s.classId));
        return {
          ...student,
          sessions: theirs.map((s) => {
            const key = `${student.studentId}:${s.id}`;
            return {
              sessionId: s.id,
              classId: s.classId,
              className: s.class?.name ?? 'Class',
              date: s.date.toISOString().slice(0, 10),
              price: meetingPrice(s, student.studentId),
              alreadyCharged: chargedBy.has(key),
              chargedInvoice: chargedBy.get(key) ?? null,
            };
          }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      classes,
      sessions: sessions.map((s) => ({
        id: s.id,
        classId: s.classId,
        className: s.class?.name ?? 'Class',
        date: s.date.toISOString().slice(0, 10),
        startTime: s.startTime.toISOString().slice(11, 16),
        note: s.chargeNote ?? null,
        price: s.chargeAmount == null ? null : round2(Number(s.chargeAmount)),
      })),
      students,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/block-invoices
 * Body: { students: [{ studentId, sessionIds }], unitAmount?, blockAmount?,
 *         description?, dueDate? }
 *
 * The same block billed across a roster: one invoice per student, each one
 * built by exactly the rules of the single-student path above.
 *
 * The whole run is one database transaction. Half a roster billed is worse
 * than none — the families that went through would be chasing invoices for a
 * block the rest were never asked about, and no screen would show which half
 * had happened. A student whose block cannot be priced is reported as a
 * skipped row and the rest still go, because that is a decision the admin can
 * see and act on before pressing the button; a failure mid-write is not.
 *
 * Note the price named applies PER STUDENT, not to the roster: `blockAmount`
 * of $980 across eight meetings is $980 for each family, the same way a price
 * typed on a calendar entry is what one family pays. Billing thirty families
 * one thirtieth of a total each has never been how anything here is sold.
 */
export const createBlockInvoices = async (req, res, next) => {
  try {
    const { students, unitAmount, blockAmount, description, dueDate } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Send the students to bill, each with the meetings their block covers.',
      });
    }
    if (students.some((s) => !s?.studentId || !Array.isArray(s.sessionIds) || s.sessionIds.length === 0)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Every student in the run needs a studentId and at least one meeting in sessionIds.',
      });
    }

    const pricing = readBlockPricing({ unitAmount, blockAmount });
    if (pricing.error) return res.status(400).json({ error: 'Validation Error', message: pricing.error });

    const dueParsed = blockDueDate(dueDate);
    if (dueParsed.error) return res.status(400).json({ error: 'Validation Error', message: dueParsed.error });

    const studentIds = [...new Set(students.map((s) => s.studentId))];
    const allSessionIds = [...new Set(students.flatMap((s) => s.sessionIds))];

    // Three reads for the whole run, however many students it covers — the
    // per-student work below is pure arithmetic over what these return.
    const [people, sessions, existing] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true, fullName: true, role: true,
          familyMembers: { select: { familyId: true }, take: 1 },
          enrollments: { where: { status: 'active' }, select: { classId: true } },
        },
      }),
      prisma.session.findMany({
        where: { id: { in: allSessionIds }, status: { not: 'CANCELLED' } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        select: {
          id: true, classId: true, date: true, chargeAmount: true, chargeNote: true,
          class: { select: { name: true } },
          chargeOverrides: { where: { studentId: { in: studentIds } }, select: { studentId: true, amount: true } },
        },
      }),
      prisma.transaction.findMany({
        where: { studentId: { in: studentIds }, sessionId: { in: allSessionIds } },
        select: { studentId: true, sessionId: true },
      }),
    ]);

    const peopleById = new Map(people.map((p) => [p.id, p]));
    const sessionsById = new Map(sessions.map((s) => [s.id, s]));
    const billedAlready = new Map(); // studentId -> Set(sessionId)
    for (const t of existing) {
      if (!billedAlready.has(t.studentId)) billedAlready.set(t.studentId, new Set());
      billedAlready.get(t.studentId).add(t.sessionId);
    }

    const plans = [];
    const skipped = [];
    for (const row of students) {
      const student = peopleById.get(row.studentId);
      const name = student?.fullName ?? 'That student';
      const skip = (reason) => skipped.push({ studentId: row.studentId, name, reason });

      if (!student || student.role !== 'STUDENT') { skip('No such student.'); continue; }
      if (student.familyMembers.length === 0) {
        skip('Not attached to a family yet, so there is no account to bill.');
        continue;
      }

      const theirs = row.sessionIds.map((id) => sessionsById.get(id)).filter(Boolean);
      if (theirs.length === 0) { skip('None of their meetings exist, or they are all cancelled.'); continue; }

      const enrolledIn = new Set(student.enrollments.map((e) => e.classId));
      const foreign = theirs.filter((s) => !enrolledIn.has(s.classId));
      if (foreign.length > 0) {
        const names = [...new Set(foreign.map((s) => s.class?.name ?? 'that class'))].join(', ');
        skip(`No longer actively enrolled in ${names}.`);
        continue;
      }

      const plan = planBlock({
        sessions: theirs,
        studentId: student.id,
        unit: pricing.unit,
        block: pricing.block,
        alreadyBilled: billedAlready.get(student.id) ?? new Set(),
      });
      if (plan.error) { skip(plan.error); continue; }

      plans.push({
        studentId: student.id,
        name: student.fullName,
        familyId: student.familyMembers[0].familyId,
        priced: plan.priced,
        subtotal: plan.subtotal,
        label: blockLabel(description, plan.priced.map((p) => p.session), plan.priced.length),
      });
    }

    if (plans.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'None of those students could be billed for this block.',
        skipped,
      });
    }

    // The default 5s interactive-transaction budget is not enough for a term's
    // roster: each invoice is several writes and the run is deliberately
    // sequential so the LC-#### numbers come out in order.
    const invoices = await prisma.$transaction(
      async (tx) => {
        const out = [];
        for (const plan of plans) {
          const invoice = await writeBlockInvoice(tx, {
            familyId: plan.familyId,
            studentId: plan.studentId,
            priced: plan.priced,
            subtotal: plan.subtotal,
            label: plan.label,
            due: dueParsed.due,
          });
          out.push({ invoice, plan });
        }
        return out;
      },
      { timeout: 120000, maxWait: 20000 }
    );
    queueWaveSync(invoices.map(({ invoice }) => invoice.id));

    const total = round2(plans.reduce((sum, p) => sum + p.subtotal, 0));
    console.log(
      `[Billing] ${req.user.email} raised ${invoices.length} block invoices ($${total.toFixed(2)} across `
      + `${new Set(plans.map((p) => p.familyId)).size} families, ${skipped.length} skipped)`
    );

    res.status(201).json({
      invoices: invoices.map(({ invoice, plan }) => ({
        ...shapeBlockInvoice(invoice),
        studentName: plan.name,
        meetings: plan.priced.length,
      })),
      billed: invoices.length,
      total,
      skipped,
    });
  } catch (error) {
    next(error);
  }
};
