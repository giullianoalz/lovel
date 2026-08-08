import { buildInviteEmailHtml, buildBillingEmailHtml, toPreviewHtml } from '../services/email.service.js';

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
