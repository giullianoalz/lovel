import { buildInviteEmailHtml, buildBillingEmailHtml, buildInvoiceEmailHtml, toPreviewHtml } from '../services/email.service.js';
import prisma from '../config/database.js';

/**
 * POST /api/email/preview/invite
 * Renders the invite email exactly as it would be sent, for the
 * review-before-sending modal (Admin only). Never sends anything — the link
 * is a placeholder since a real one only exists once Firebase issues it at
 * send time, and the modal has no address to send yet either.
 */
export const previewInviteEmail = (req, res) => {
  const { subject = '', message, fullName, isReminder = false } = req.body || {};
  const html = toPreviewHtml(buildInviteEmailHtml({
    fullName: fullName || 'there',
    link: '#',
    isReminder,
    message,
  }));
  res.json({ subject, html });
};

/**
 * POST /api/email/preview/billing
 * Renders the registration billing email exactly as it would be sent (Admin
 * only). `request` and `term` are the same shapes the real send takes —
 * the figures are never editable, only the opening message is.
 */
export const previewBillingEmail = (req, res) => {
  const { subject = '', message, studentName, className, electiveNames = [], request, term } = req.body || {};
  const html = toPreviewHtml(buildBillingEmailHtml({
    studentName: studentName || 'the student',
    className,
    electiveNames,
    request,
    term,
    message,
  }));
  res.json({ subject, html });
};

/**
 * POST /api/email/preview/invoice
 * Body: { invoiceId, subject, message }
 * Renders the invoice email exactly as it would be sent (Admin only).
 *
 * Unlike the other two previews, the figures are read from the database rather
 * than taken from the request: this email states what a family owes, and a
 * preview built from numbers the browser supplied could show an admin one
 * total while the send delivers another.
 */
export const previewInvoiceEmail = async (req, res, next) => {
  try {
    const { invoiceId, subject = '', message } = req.body || {};
    if (!invoiceId) {
      return res.status(400).json({ error: 'Validation Error', message: 'invoiceId is required.' });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true },
    });
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'That invoice does not exist.' });
    }

    // A placeholder, not a live Stripe link: this fires on every debounced
    // keystroke in the review modal, and minting a real Checkout session that
    // often would spam Stripe for no reason — the real one is created once,
    // at actual send time. The sandboxed preview iframe can't navigate it
    // anyway, so the placeholder looks identical to the family's real email.
    const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid);
    res.json({
      subject,
      html: toPreviewHtml(buildInvoiceEmailHtml({ invoice, message, checkoutUrl: balance > 0 ? '#' : null })),
    });
  } catch (error) {
    next(error);
  }
};
