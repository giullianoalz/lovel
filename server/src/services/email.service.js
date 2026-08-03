import { Resend } from 'resend';
import { formatCurrency } from '../utils/helpers.js';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const IXL_LABELS = {
  NONE: 'None',
  CORE: 'IXL Core',
  CORE_SPANISH: 'IXL Core + Spanish',
};

// mm/dd/yy — US school, dates are always numeric US format.
// Read in UTC: the callers pass @db.Date columns, which Prisma hands back as
// midnight UTC. Local getters would render the day before anywhere west of
// Greenwich — including the academy's own timezone.
const formatDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(-2)}`;
};

const buildBillingEmailHtml = ({ studentName, className, electiveNames, request, term }) => `
  <div style="font-family: Arial, sans-serif; color: #222; max-width: 560px;">
    <h2>Registration Confirmation — ${term.name}</h2>
    <p>Hello, here is the billing breakdown for <strong>${studentName}</strong> (${className}).</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tbody>
        <tr><td style="padding: 6px 0;">Base rate</td><td style="text-align: right;">${formatCurrency(request.baseRate)}</td></tr>
        <tr><td style="padding: 6px 0;">Electives${electiveNames.length ? ` (${electiveNames.join(', ')})` : ''}</td><td style="text-align: right;">${formatCurrency(request.electivesTotal)}</td></tr>
        <tr><td style="padding: 6px 0;">IXL Plan (${IXL_LABELS[request.ixlPlan] || 'None'})</td><td style="text-align: right;">${formatCurrency(request.ixlTotal)}</td></tr>
        <tr style="border-top: 1px solid #ccc; font-weight: bold;"><td style="padding: 6px 0;">Quarterly total</td><td style="text-align: right;">${formatCurrency(request.totalQuarterly)}</td></tr>
        <tr style="color: #b45309; font-weight: bold;"><td style="padding: 6px 0;">Deposit required (15%)</td><td style="text-align: right;">${formatCurrency(request.depositAmount)}</td></tr>
      </tbody>
    </table>
    <p>Deposit due date: <strong>${formatDate(request.depositDueDate)}</strong>.</p>
    <p>The 2026 academic calendar is attached.</p>
  </div>
`;

/**
 * Sends the registration billing confirmation email.
 * Never throws — returns { ok, error } so the caller can persist emailStatus without
 * rolling back the enrollment that already happened.
 */
export const sendRegistrationBillingEmail = async ({ to, studentName, className, electiveNames = [], request, term }) => {
  if (!resend) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const attachments = [];
    if (term.calendarAssetUrl) {
      attachments.push({ path: term.calendarAssetUrl, filename: 'Academic-Calendar-2026.pdf' });
    }

    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@lovelearning.app',
      to,
      subject: `Registration & Billing Confirmation — ${term.name}`,
      html: buildBillingEmailHtml({ studentName, className, electiveNames, request, term }),
      attachments,
    });
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export const isEmailConfigured = () => resend !== null;

const buildNotificationEmailHtml = ({ title, message, actionUrl }) => `
  <div style="font-family: Arial, sans-serif; color: #222; max-width: 560px;">
    <h2 style="margin: 0 0 12px;">${title}</h2>
    <p style="font-size: 15px; line-height: 1.5;">${message}</p>
    ${actionUrl
      ? `<p style="margin-top: 20px;"><a href="${actionUrl}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; display: inline-block;">Open in Lovelearning</a></p>`
      : ''}
    <p style="margin-top: 28px; font-size: 12px; color: #777;">
      You're receiving this because of your notification preferences. You can change them in your account settings.
    </p>
  </div>
`;

const buildInviteEmailHtml = ({ fullName, link, isReminder }) => `
  <div style="font-family: Arial, sans-serif; color: #222; max-width: 560px;">
    <h2 style="margin: 0 0 12px;">${isReminder ? 'Reminder: set up' : 'Welcome to'} your Love Learning Explorers account</h2>
    <p style="font-size: 15px; line-height: 1.5;">Hi ${fullName},</p>
    <p style="font-size: 15px; line-height: 1.5;">
      Your family's account is ready. Choose a password to sign in and see your children's
      schedule, reports, invoices and messages with their teachers.
    </p>
    <p style="margin: 24px 0;">
      <a href="${link}" style="background: #2563eb; color: #fff; padding: 12px 22px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">Set my password</a>
    </p>
    <p style="font-size: 13px; color: #555;">
      This link expires in a few days. If it stops working, ask the front desk to send a new one.
    </p>
    <p style="margin-top: 28px; font-size: 12px; color: #777;">
      If you weren't expecting this email, you can ignore it — no account is active until a password is set.
    </p>
  </div>
`;

/**
 * Emails one person their "set your password" invite.
 *
 * Never throws — returns { ok, error } so a mail outage can't lose the invite
 * record; the admin sees the failure and can retry or hand over the link.
 */
export const sendInviteEmail = async ({ to, fullName, link, isReminder = false }) => {
  if (!resend) return { ok: false, error: 'RESEND_API_KEY not configured' };
  if (!to) return { ok: false, error: 'No recipient email' };

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@lovelearning.app',
      to,
      subject: isReminder
        ? 'Reminder: set up your Love Learning Explorers account'
        : 'Welcome to Love Learning Explorers — set your password',
      html: buildInviteEmailHtml({ fullName, link, isReminder }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

/**
 * Emails a single notification — the EMAIL channel of the notification
 * dispatcher. Generic on purpose: same title/message the in-app row carries,
 * so an event never needs a bespoke template to gain an email copy.
 *
 * Never throws — returns { ok, error } so a failed email can't break the flow
 * that triggered the notification.
 */
export const sendNotificationEmail = async ({ to, title, message, actionUrl = null }) => {
  if (!resend) return { ok: false, error: 'RESEND_API_KEY not configured' };
  if (!to) return { ok: false, error: 'No recipient email' };

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@lovelearning.app',
      to,
      subject: title,
      html: buildNotificationEmailHtml({ title, message, actionUrl }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
