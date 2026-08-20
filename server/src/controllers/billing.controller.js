import prisma from '../config/database.js';
import stripe from '../config/stripe.js';
import { applyAvailableCredit } from '../services/billingCredit.service.js';
import { broadcastToManagement } from '../utils/pushNotifications.js';
import { notifyAdmins } from '../jobs/notification.helper.js';
import { round2 } from '../services/registrationPricing.service.js';
import { nextLcNumber } from '../services/invoicing.service.js';
import { buildInvoicePdf, invoicePdfFilename } from '../services/invoicePdf.service.js';
import { sendInvoiceEmail } from '../services/email.service.js';
import { getOrCreateInvoiceCheckoutUrl } from '../services/stripeCheckout.service.js';
import { buildSessionCharges, isBillable } from '../services/sessionCharges.service.js';

const MANUAL_PAYMENT_METHODS = new Set(['ZELLE', 'VENMO', 'PAYPAL', 'CASH', 'CHECK', 'OTHER']);

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
        invoice: { select: { id: true, invoiceNumber: true, _count: { select: { payments: true } } } },
        snackReload: { select: { id: true } },
      },
    });

    // Map to frontend format
    const mapped = transactions.map((t) => {
      // Money having actually moved is what locks a row — see
      // DELETE/PATCH /transactions/:id. Exposed as plain booleans rather than
      // making the UI infer them, so the one rule lives in one place.
      const locked = Boolean(t.paymentId) || (t.invoice?._count.payments ?? 0) > 0;
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
 * Payment applied to this row, or any Payment against the invoice it sits on.
 * At that point the fix is a refund or a credit, not erasing the original.
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
    if (existing.invoiceId) {
      const paymentCount = await prisma.payment.count({ where: { invoiceId: existing.invoiceId } });
      if (paymentCount > 0) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'A payment has already been made against this entry\'s invoice. Refund it instead of deleting the charge underneath it.',
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { transactionId: existing.id } });
      await tx.transaction.delete({ where: { id: existing.id } });

      if (!existing.invoiceId) return;

      const remaining = await tx.invoiceLine.findMany({
        where: { invoiceId: existing.invoiceId },
        select: { amount: true },
      });
      if (remaining.length === 0) {
        await tx.invoice.delete({ where: { id: existing.invoiceId } });
        return;
      }

      const newTotal = round2(remaining.reduce((sum, l) => sum + Number(l.amount), 0));
      const invoice = await tx.invoice.findUnique({ where: { id: existing.invoiceId } });
      const amountPaid = Number(invoice.amountPaid);
      await tx.invoice.update({
        where: { id: existing.invoiceId },
        data: {
          subtotal: newTotal,
          totalAmount: newTotal,
          status: amountPaid <= 0
            ? (invoice.status === 'OVERDUE' ? 'OVERDUE' : 'SENT')
            : (amountPaid >= newTotal ? 'PAID' : 'PARTIAL'),
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

    if (existing.invoiceId) {
      const paymentCount = await prisma.payment.count({ where: { invoiceId: existing.invoiceId } });
      if (paymentCount > 0) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'This entry is on an invoice a payment has already been made against. Refund the payment instead of editing it.',
        });
      }
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
            status: amountPaid <= 0
              ? (invoice.status === 'OVERDUE' ? 'OVERDUE' : 'SENT')
              : (amountPaid >= newTotal ? 'PAID' : 'PARTIAL'),
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
 * DELETE /api/billing/invoices/:id
 * Voids a mistaken invoice — e.g. a registration deposit raised against a
 * class whose price was wrong — along with the charge underneath it.
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

    await prisma.$transaction(async (tx) => {
      // Only charges this invoice itself raised, and only ones with no
      // payment attached (paymentCount === 0 above already guarantees that
      // for the family, but scoping the delete this way keeps the rule
      // self-evident rather than relying on the earlier check alone).
      await tx.transaction.deleteMany({ where: { invoiceId: invoice.id, paymentId: null } });
      // InvoiceLine cascades on delete (see schema.prisma).
      await tx.invoice.delete({ where: { id: invoice.id } });
    });

    console.log(`[Billing] ${req.user.email} voided invoice ${invoice.invoiceNumber} ($${invoice.totalAmount}, family ${invoice.familyId})`);

    res.json({ message: 'Invoice voided.' });
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
 * stays correct); an existing line left out of the array is removed along with
 * its Transaction; a line with no `id` raises a brand new charge on the
 * invoice. An empty `lines` array voids the whole invoice — same rule as
 * DELETE, just reached from the edit screen instead of a separate button.
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

    // No lines left after the edit is the same outcome as voiding — reuse
    // that path exactly rather than duplicating the "delete everything" logic.
    if (lines.length === 0) {
      await prisma.$transaction(async (tx) => {
        await tx.transaction.deleteMany({ where: { invoiceId: invoice.id, paymentId: null } });
        await tx.invoice.delete({ where: { id: invoice.id } });
      });
      console.log(`[Billing] ${req.user.email} emptied and voided invoice ${invoice.invoiceNumber} via edit (family ${invoice.familyId})`);
      return res.json({ message: 'Invoice had no lines left and was voided.', voided: true });
    }

    const submittedIds = new Set(lines.filter((l) => l.id).map((l) => l.id));
    const removedLines = invoice.lines.filter((l) => !submittedIds.has(l.id));

    const updated = await prisma.$transaction(async (tx) => {
      for (const removed of removedLines) {
        // Transaction.invoiceLine has onDelete: SetNull, not Cascade — deleting
        // the transaction only nulls the line's FK, it doesn't remove the line
        // itself, so both rows need an explicit delete here.
        if (removed.transactionId) {
          await tx.transaction.delete({ where: { id: removed.transactionId } });
        }
        await tx.invoiceLine.delete({ where: { id: removed.id } });
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
      const status = amountPaid <= 0
        ? (invoice.status === 'OVERDUE' ? 'OVERDUE' : 'SENT')
        : (amountPaid >= newTotal ? 'PAID' : 'PARTIAL');

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { subtotal: newTotal, totalAmount: newTotal, status },
        include: { lines: true },
      });
    });

    console.log(`[Billing] ${req.user.email} edited invoice ${invoice.invoiceNumber} (family ${invoice.familyId}) — new total $${updated.totalAmount}`);

    res.json({
      message: 'Invoice updated.',
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
            data: { amountPaid: newPaid, status: newPaid >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL' },
          });
          txAmount = appliedToInvoice;
          excess = parsedAmount - appliedToInvoice;
        }
      }

      const txDate = date ? new Date(date) : new Date();
      let created = await db.transaction.create({
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

      // A charge is money owed, so it gets its invoice — and therefore its
      // LC-#### number — the moment it's raised, matching what registration
      // deposits already do. Without this a charge sat unbilled until someone
      // remembered to run "New Invoice", which is how a family ends up owing
      // money no document ever told them about.
      let invoiceNumber = null;
      if (upperType === 'CHARGE' && !invoiceId) {
        invoiceNumber = `LC-${await nextLcNumber(db)}`;
        const invoice = await db.invoice.create({
          data: {
            invoiceNumber,
            familyId,
            studentId: studentId || null,
            date: txDate,
            subtotal: txAmount,
            totalAmount: txAmount,
            status: 'SENT',
            dateRange: description || 'Charge',
            dueDate: new Date(txDate.getTime() + 30 * 86400000),
            lines: {
              create: [{ description: description || 'Charge', amount: txAmount, transactionId: created.id }],
            },
          },
        });
        created = await db.transaction.update({ where: { id: created.id }, data: { invoiceId: invoice.id } });
        await applyAvailableCredit(db, { familyId, invoiceId: invoice.id, invoiceTotal: txAmount });
      }

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
      date: inv.date.toISOString().split('T')[0],
      dateRange: inv.dateRange || 'N/A',
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
          status: 'SENT',
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
        ? { ...created, amountPaid: applied, status: applied >= subtotal ? 'PAID' : 'PARTIAL' }
        : created;
    });

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

    const subtotal = txs.reduce((acc, t) => {
      if (t.type === 'CHARGE') return acc + Number(t.amount);
      return acc - Number(t.amount);
    }, 0);

    // Invoice creation + marking the source transactions as billed must be
    // atomic — a crash between the two steps would leave transactions free
    // to be picked up again by a second invoice (double-billing the family).
    const invoice = await prisma.$transaction(async (tx) => {
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
          // One line per transaction, each linked back by transactionId — what
          // lets an admin edit or remove a single line later without guessing
          // which ledger row it came from (createMany can't take relations, so
          // this is per-row rather than a single nested create).
          lines: {
            create: txs.map((t) => ({
              description: t.description || 'Charge',
              amount: t.amount,
              transactionId: t.id,
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

      for (const g of groups) {
        const invoiceNumber = `LC-${nextNum++}`;

        // Step Up's own student ID is stable across submissions — once we've
        // seen it for a student, it's a far more reliable match than a name
        // string (typos, "Jr."/"III" suffixes, married-name changes, etc.).
        const student = g.emaStudentId
          ? await tx.user.findFirst({
              where: { role: 'STUDENT', emaStudentId: g.emaStudentId },
              select: { id: true, emaStudentId: true, familyMembers: { select: { familyId: true }, take: 1 } },
            })
          : null;

        const matchedStudent = student || (g.studentName
          ? await tx.user.findFirst({
              where: { role: 'STUDENT', fullName: { equals: g.studentName, mode: 'insensitive' } },
              select: { id: true, emaStudentId: true, familyMembers: { select: { familyId: true }, take: 1 } },
            })
          : null);

        // Learn the Step Up ID for next time if we only matched by name.
        if (matchedStudent && g.emaStudentId && !matchedStudent.emaStudentId) {
          await tx.user.update({ where: { id: matchedStudent.id }, data: { emaStudentId: g.emaStudentId } }).catch(() => {
            // A different student already claimed this emaStudentId (data mix-up) — don't crash the whole batch over it.
          });
        }

        const familyId = matchedStudent?.familyMembers?.[0]?.familyId || null;
        const total = Number(g.total) || 0;

        // For each row (one Step Up PO# = one session/charge), find the actual
        // dated charge behind that amount so we can report its real date
        // instead of guessing. Oldest unconsumed match first (FIFO); once
        // used, link it to this invoice so a future batch can't reuse it.
        const rowDates = {};
        const lineDescriptions = [];
        // Tracks charges already claimed by an earlier row in this same
        // student's group — without this, two same-amount sessions (very
        // common: a student's weekly rate rarely changes) would both match
        // the first row's charge and get assigned the same date.
        const usedChargeIds = new Set();
        if (matchedStudent) {
          for (const row of g.rows || []) {
            const amount = Number(row.amount) || 0;
            const charge = await tx.transaction.findFirst({
              where: { studentId: matchedStudent.id, type: 'CHARGE', amount, invoiceId: null, id: { notIn: [...usedChargeIds] } },
              orderBy: { date: 'asc' },
            });
            if (charge) {
              usedChargeIds.add(charge.id);
              rowDates[row.poNumber] = charge.date.toISOString().split('T')[0];
              lineDescriptions.push({ description: charge.description || 'EMA session', amount, chargeId: charge.id });
            } else {
              rowDates[row.poNumber] = null; // no matching charge — admin must fill this date manually, never guess
              lineDescriptions.push({ description: 'EMA session (unmatched — verify date manually)', amount, chargeId: null });
            }
          }
        }

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            familyId,
            studentId: matchedStudent?.id || null,
            source: 'EMA',
            poNumbers: g.poNumbers || [],
            subtotal: total,
            totalAmount: total,
            status: 'SENT',
            dateRange: 'EMA Step Up Batch',
            lines: lineDescriptions.length > 0
              ? { create: lineDescriptions.map(l => ({ description: l.description, amount: l.amount, transactionId: l.chargeId })) }
              : undefined,
          },
        });

        // Now that the invoice exists, link the consumed charges to it so
        // they're excluded from future EMA batches and from the regular
        // (non-EMA) invoicing flow.
        const chargeIds = lineDescriptions.map(l => l.chargeId).filter(Boolean);
        if (chargeIds.length > 0) {
          await tx.transaction.updateMany({ where: { id: { in: chargeIds } }, data: { invoiceId: invoice.id } });
        }

        // Apply any existing family credit (e.g. from a prior EMA overpayment)
        // to this new invoice automatically.
        if (familyId && total > 0) {
          await applyAvailableCredit(tx, { familyId, studentId: matchedStudent?.id || null, invoiceId: invoice.id, invoiceTotal: total });
        }

        out.push({
          ...g,
          invoiceNumber: invoice.invoiceNumber,
          familyId,
          matched: !!matchedStudent,
          rowDates,
          unmatchedRowCount: Object.values(rowDates).filter(d => d === null).length,
        });
      }
      return out;
    });

    res.json({ groups: results });
  } catch (error) {
    next(error);
  }
};

// Shared by the real reconcile and its dry-run preview — `db` is either the
// plain prisma client (dryRun, read-only) or a `tx` inside a transaction
// (real run). When dryRun, every write is skipped so the preview can show
// exactly what WOULD happen without touching any data.
const runReconciliation = async (db, lines, { dryRun }) => {
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

    // A remittance line already reconciled (e.g. the same CSV/paste
    // re-submitted by mistake) must not be applied twice — that would
    // double-pay the invoice and mint duplicate account credit.
    const alreadyPaid = await db.payment.findFirst({
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
    touched.set(invoice.id, { total: totalAmount, paid: newPaid, number: invoice.invoiceNumber });
  }

  for (const [id, info] of touched) {
    const status = info.paid >= info.total ? 'PAID' : 'PARTIAL';
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
// scholarship payment, and marks invoices PAID/PARTIAL. With dryRun: true,
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
      : await prisma.$transaction((tx) => runReconciliation(tx, lines, { dryRun: false }));

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
    const { from, to, sessionIds } = req.body;
    const range = parseChargeRange(from, to);
    if (range.error) {
      return res.status(400).json({ error: 'Validation Error', message: range.error });
    }

    const { lines } = await buildSessionCharges(range);
    const wanted = Array.isArray(sessionIds) && sessionIds.length > 0
      ? new Set(sessionIds)
      : null;
    const billable = lines.filter((l) => isBillable(l) && (!wanted || wanted.has(l.sessionId)));

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
        description: l.description,
        date: l.date,
        sessionId: l.sessionId,
      })),
      // Belt and braces alongside the unique index: a concurrent second run
      // skips what it finds rather than failing the whole batch.
      skipDuplicates: true,
    });

    // A charge with no invoice is money a family owes with no document telling
    // them so — and, because the portal's card payment runs off an invoice, no
    // way to pay it either. So the approval that raises the charge also raises
    // the paperwork, the same way a manual charge already does.
    //
    // One invoice per family, not per charge: a workshop approved for six
    // families is six invoices, and a family with three priced meetings in the
    // batch gets one invoice with three lines. That is how an admin reads it
    // and what the family would expect in the post.
    //
    // Deliberately not emailed. The invoice exists and is payable from the
    // portal; sending it is a separate, reviewed step (see sendInvoice), and
    // approving a batch must never post 39 emails on its own.
    const invoices = await invoiceUnbilledSessionCharges(billable);

    console.log(
      `[Billing] ${req.user.email} raised ${created.count} session charge(s) `
      + `totalling $${billable.reduce((sum, l) => sum + l.amount, 0).toFixed(2)} `
      + `across ${invoices.length} invoice(s)`
    );

    res.json({
      message: created.count === 0
        ? 'Nothing new to charge — those meetings are already billed.'
        : `Raised ${created.count} charge${created.count === 1 ? '' : 's'} on `
          + `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}.`,
      created: created.count,
      invoices: invoices.length,
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

/**
 * Puts the just-raised session charges onto invoices, one per family.
 *
 * Read back from the ledger rather than trusting what was just written: the
 * createMany above skips duplicates silently, so the rows that actually need a
 * document are the uninvoiced ones sitting against these sessions — which is
 * also exactly the set a retry after a half-finished run should pick up.
 *
 * Each family is its own transaction. A batch is dozens of unrelated families,
 * and one of them failing (a credit application going wrong, say) must not
 * abandon the invoices for everyone else — the worst case is that family's
 * charges stay uninvoiced, which is where they would have been anyway.
 */
const invoiceUnbilledSessionCharges = async (billable) => {
  const sessionIds = [...new Set(billable.map((l) => l.sessionId))];
  const pending = await prisma.transaction.findMany({
    where: { sessionId: { in: sessionIds }, invoiceId: null, familyId: { not: null } },
    select: { id: true, familyId: true, amount: true, description: true, type: true },
  });

  const byFamily = new Map();
  for (const t of pending) {
    if (!byFamily.has(t.familyId)) byFamily.set(t.familyId, []);
    byFamily.get(t.familyId).push(t);
  }

  const invoices = [];
  for (const [familyId, txs] of byFamily) {
    const subtotal = round2(txs.reduce((sum, t) => sum + Number(t.amount), 0));
    // Nothing to bill for is not a document worth creating.
    if (subtotal <= 0) continue;

    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const invoiceNumber = `LC-${await nextLcNumber(tx)}`;
        const doc = await tx.invoice.create({
          data: {
            invoiceNumber,
            familyId,
            subtotal,
            totalAmount: subtotal,
            status: 'SENT',
            dateRange: 'Classes on the calendar',
            dueDate: new Date(Date.now() + 30 * 86400000),
            lines: {
              create: txs.map((t) => ({
                description: t.description || 'Class',
                amount: t.amount,
                transactionId: t.id,
              })),
            },
          },
        });

        await tx.transaction.updateMany({
          where: { id: { in: txs.map((t) => t.id) } },
          data: { invoiceId: doc.id },
        });

        // Credit already on the books — an EMA overpayment, a refunded class —
        // comes off this invoice rather than sitting unused while the family is
        // asked for the full amount.
        await applyAvailableCredit(tx, { familyId, invoiceId: doc.id, invoiceTotal: subtotal });
        return doc;
      });
      invoices.push(invoice);
    } catch (error) {
      // Loud, and then on to the next family: the charge is raised either way,
      // and an admin can bundle it by hand from the family's account.
      console.error(`[Billing] Could not invoice session charges for family ${familyId}:`, error);
    }
  }

  return invoices;
};
