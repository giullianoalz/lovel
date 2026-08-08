import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { formatCurrency } from '../utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The same logo the signed waiver PDFs carry, so paper and inbox match.
// Read once at module load: it never changes at runtime and every email
// attaches it.
const logoBytes = await readFile(path.join(__dirname, '..', 'assets', 'waiver-logo.png'));

// Referenced as <img src="cid:…"> and attached inline, rather than linked to a
// hosted file. A remote URL would break the day the frontend moves or the host
// blocks hotlinking, and it would leak who opened the email; the attachment
// travels with the message and renders offline.
const LOGO_CID = 'lovelearning-logo';
const logoAttachment = { filename: 'love-learning-explorers.png', content: logoBytes, cid: LOGO_CID };

// A browser rendering a preview has no attachment to resolve `cid:` against —
// swap it for a data URI so the admin's review modal shows the real logo
// instead of a broken image. Never used for the actual send.
const logoDataUri = `data:image/png;base64,${logoBytes.toString('base64')}`;
export const toPreviewHtml = (html) => html.replaceAll(`cid:${LOGO_CID}`, logoDataUri);

// The app's own tokens (src/index.css), so an email and the portal it links to
// don't look like two different organisations.
const BRAND = {
  green: '#15803d',
  greenDark: '#166534',
  greenTint: '#f0fdf4',
  text: '#064e3b',
  muted: '#64748b',
  page: '#f8fafc',
  border: '#dcfce7',
};

// Inter first to match the app, then the system stack every mail client can
// actually resolve — webfonts are stripped by most of them.
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Wraps message content in the academy's letterhead.
 *
 * Tables and inline styles throughout, deliberately: Outlook renders with Word,
 * which supports neither flexbox nor grid nor a <style> block, and a layout
 * that collapses in one client is worse than a plain one everywhere.
 *
 * @param {string} title   Shown as the heading above the content.
 * @param {string} content Inner HTML — already-escaped, caller's responsibility.
 * @param {string} [footer] Small print under the divider.
 */
const layout = ({ title, content, footer }) => `
<div style="margin:0;padding:0;background:${BRAND.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td align="center" style="background:${BRAND.greenTint};padding:28px 24px 22px;">
              <img src="cid:${LOGO_CID}" width="180" alt="Love Learning Explorers" style="display:block;width:180px;max-width:70%;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;font-family:${FONT};">
              <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.text};">${title}</h1>
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 30px;font-family:${FONT};">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0 16px;" />
              <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
                <strong style="color:${BRAND.text};">Love Learning Explorers</strong><br />
                ${footer || 'Questions? Just reply to this email and the front desk will help.'}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>
`;

/** A paragraph in the shared body style. */
const p = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.text};font-family:${FONT};">${html}</p>`;

const escapeHtml = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The one call-to-action button, bulletproof enough for Outlook. */
const button = (href, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
    <tr>
      <td align="center" bgcolor="${BRAND.green}" style="border-radius:10px;">
        <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
      </td>
    </tr>
  </table>
`;

// Turns admin-edited plain text into safe HTML paragraphs — escaped first so
// nothing typed into the editor can inject markup, blank lines become
// paragraph breaks so it still reads naturally.
const textToHtmlParagraphs = (text) =>
  escapeHtml(text)
    .split(/\n{2,}/)
    .map((para) => p(para.replace(/\n/g, '<br>')))
    .join('');

// Resend needs a verified sending domain, which is stuck behind Wix's DNS
// editor (no NS/MX-subdomain access — see the invite service's own notes).
// Gmail SMTP with an App Password sidesteps that entirely: the academy already
// owns the mailbox, so there's no domain to verify.
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const transporter = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      // Without these, a failed SMTP connection hangs forever and Render's
      // load balancer drops the HTTP request with no status code ("- -").
      connectionTimeout: 10_000,  // 10 s to open the TCP connection
      greetingTimeout:   10_000,  // 10 s to receive the server greeting
      socketTimeout:     15_000,  // 15 s of inactivity before giving up
    })
  : null;

/**
 * Sends one email. Never throws — every caller here turns a failure into
 * { ok: false, error } instead of losing the record of what happened.
 */
const send = async ({ to, subject, html, attachments }) => {
  if (!transporter) return { ok: false, error: 'GMAIL_USER/GMAIL_APP_PASSWORD not configured' };
  if (!to) return { ok: false, error: 'No recipient email' };

  try {
    await transporter.sendMail({
      from: `"Love Learning Explorers" <${GMAIL_USER}>`,
      to,
      subject,
      html,
      // The logo rides along on every message — `layout` always references it.
      attachments: [logoAttachment, ...(attachments || [])],
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

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

// One line of the billing breakdown. `emphasis` marks the two rows that carry
// the numbers a parent actually acts on.
const billingRow = (label, amount, emphasis) => `
  <tr>
    <td style="padding:9px 0;font-family:${FONT};font-size:14px;color:${emphasis ? BRAND.text : BRAND.muted};${emphasis ? 'font-weight:700;border-top:1px solid #e2e8f0;' : ''}">${label}</td>
    <td align="right" style="padding:9px 0;font-family:${FONT};font-size:14px;color:${BRAND.text};font-weight:${emphasis ? '700' : '600'};${emphasis ? 'border-top:1px solid #e2e8f0;' : ''}">${amount}</td>
  </tr>
`;

// Like the invite, an admin can reword the subject and the opening paragraph
// before this goes out. The figures below them are not copy — they are what the
// family owes — so they are built from the request and stay fixed.
export const defaultBillingSubject = (term) => `Registration & Billing Confirmation — ${term.name}`;

export const defaultBillingMessage = (studentName, className) =>
  `Here is the billing breakdown for ${studentName}${className ? ` (${className})` : ''}.`;

// The three builders are exported so the templates can be rendered and
// reviewed without sending anything — the only other way to see a change is to
// mail it to somebody, and these go to real families.
export const buildBillingEmailHtml = ({ studentName, className, electiveNames, request, term, message }) => layout({
  title: `Registration confirmed — ${term.name}`,
  content: `
    ${textToHtmlParagraphs(message || defaultBillingMessage(studentName, className))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tbody>
        ${billingRow('Base rate', formatCurrency(request.baseRate))}
        ${billingRow(`Electives${electiveNames.length ? ` (${electiveNames.join(', ')})` : ''}`, formatCurrency(request.electivesTotal))}
        ${billingRow(`IXL Plan (${IXL_LABELS[request.ixlPlan] || 'None'})`, formatCurrency(request.ixlTotal))}
        ${billingRow('Quarterly total', formatCurrency(request.totalQuarterly), true)}
      </tbody>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenTint};border:1px solid ${BRAND.border};border-radius:12px;margin:0 0 18px;">
      <tr>
        <td style="padding:16px 18px;font-family:${FONT};">
          <div style="font-size:13px;color:${BRAND.muted};margin-bottom:3px;">Deposit required (15%)</div>
          <div style="font-size:24px;font-weight:700;color:${BRAND.green};">${formatCurrency(request.depositAmount)}</div>
          <div style="font-size:13px;color:${BRAND.muted};margin-top:6px;">Due by <strong style="color:${BRAND.text};">${formatDate(request.depositDueDate)}</strong></div>
        </td>
      </tr>
    </table>
    ${term.calendarAssetUrl ? p('The 2026 academic calendar is attached to this email.') : ''}
  `,
});

/**
 * Sends the registration billing confirmation email.
 * Never throws — returns { ok, error } so the caller can persist emailStatus without
 * rolling back the enrollment that already happened.
 */
export const sendRegistrationBillingEmail = async ({ to, studentName, className, electiveNames = [], request, term, subject, message }) => {
  const attachments = [];
  if (term.calendarAssetUrl) {
    attachments.push({ path: term.calendarAssetUrl, filename: 'Academic-Calendar-2026.pdf' });
  }

  return send({
    to,
    subject: subject || defaultBillingSubject(term),
    html: buildBillingEmailHtml({ studentName, className, electiveNames, request, term, message }),
    attachments,
  });
};

export const isEmailConfigured = () => transporter !== null;

export const buildNotificationEmailHtml = ({ title, message, actionUrl }) => layout({
  title,
  content: `${p(message)}${actionUrl ? button(actionUrl, 'Open in the app') : ''}`,
  footer: "You're receiving this because of your notification preferences. You can change them in your account settings.",
});

// The admin can edit the subject and this intro paragraph before an invite
// goes out (see invite.service.js). Everything else — the button, the
// expiry note, the "ignore if unexpected" line — stays fixed: those aren't
// copy, they're the parts that make the link actually work and stay safe to
// send unsolicited.
export const defaultInviteSubject = (isReminder) =>
  isReminder
    ? 'Reminder: set up your Love Learning Explorers account'
    : 'Welcome to Love Learning Explorers — set your password';

export const defaultInviteMessage = () =>
  "Your family's account is ready. Choose a password to sign in and see your children's schedule, reports, invoices and messages with their teachers.";

export const buildInviteEmailHtml = ({ fullName, link, isReminder, message }) => layout({
  title: `${isReminder ? 'Reminder: set up' : 'Welcome to'} your Love Learning Explorers account`,
  content: `
    ${p(`Hi ${escapeHtml(fullName)},`)}
    ${textToHtmlParagraphs(message || defaultInviteMessage())}
    ${button(link, 'Set my password')}
    ${p(`<span style="font-size:13px;color:${BRAND.muted};">This link expires in a few days. If it stops working, ask the front desk to send a new one.</span>`)}
  `,
  footer: "If you weren't expecting this email, you can ignore it — no account is active until a password is set.",
});

/**
 * Emails one person their "set your password" invite.
 *
 * Never throws — returns { ok, error } so a mail outage can't lose the invite
 * record; the admin sees the failure and can retry or hand over the link.
 */
export const sendInviteEmail = async ({ to, fullName, link, isReminder = false, subject, message }) => {
  return send({
    to,
    subject: subject || defaultInviteSubject(isReminder),
    html: buildInviteEmailHtml({ fullName, link, isReminder, message }),
  });
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
  return send({ to, subject: title, html: buildNotificationEmailHtml({ title, message, actionUrl }) });
};
