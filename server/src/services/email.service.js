import { readFile } from 'fs/promises';
import { setDefaultResultOrder } from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { google } from 'googleapis';
import { formatCurrency } from '../utils/helpers.js';

// Node 17+ changed the default DNS resolution order to use the OS resolver,
// which often tries IPv6 first. On cloud platforms like Render the IPv6 route
// to smtp.gmail.com silently hangs, causing "Connection timeout". Forcing
// IPv4-first makes the SMTP connection use the IPv4 address every time.
setDefaultResultOrder('ipv4first');

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

// Gmail SMTP — works locally but Render blocks outbound SMTP on all ports.
// Kept as a fallback for local development only.
const transporter = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout:   10_000,
      socketTimeout:     15_000,
    })
  : null;

// Resend HTTP API — works everywhere (HTTPS, not SMTP).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || (GMAIL_USER ? `Love Learning Explorers <${GMAIL_USER}>` : 'Love Learning Explorers <noreply@lovelearning.app>');

/**
 * Where the logo lives for transports that can't carry it inline.
 *
 * The SMTP and Gmail-API paths attach it and reference `cid:`, which renders
 * offline and leaks nothing. HTTP providers can't do that reliably, and the
 * obvious substitute — a `data:` URI — is silently dropped by Gmail and
 * Outlook, so the header would simply come out blank. A hosted https image is
 * the only thing those two render, and it is what ordinary email does.
 */
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://lovelearning-three.vercel.app/logo.png';

/** Swaps the inline reference for the hosted one. */
const withHostedLogo = (html) => html.replaceAll(`cid:${LOGO_CID}`, EMAIL_LOGO_URL);

/**
 * Encodes attachments as base64 for the HTTP providers, fetching any that are
 * given as a URL. Undownloadable ones are dropped rather than failing the
 * send: a missing calendar PDF is not worth losing the invoice it rode with.
 */
const encodeAttachments = async (attachments) => {
  const out = [];
  for (const att of attachments || []) {
    // The logo is in the HTML as a hosted URL now; attaching it too would show
    // up as a stray paperclip on the message.
    if (att.cid) continue;
    if (att.content) {
      out.push({ name: att.filename, content: Buffer.from(att.content).toString('base64') });
    } else if (att.path) {
      try {
        const resp = await fetch(att.path);
        if (resp.ok) {
          out.push({ name: att.filename, content: Buffer.from(await resp.arrayBuffer()).toString('base64') });
        }
      } catch { /* skip undownloadable attachments */ }
    }
  }
  return out;
};

/**
 * Sends one email through Brevo's HTTP API.
 *
 * Chosen because it needs no DNS: Brevo verifies the sending address itself by
 * mailing it a confirmation link, so the academy's own Gmail address can be
 * used while its domain stays locked inside Wix.
 *
 * The tradeoff is unavoidable and worth stating: the message leaves Brevo's
 * servers claiming to be from a gmail.com address, so SPF and DKIM sign for
 * Brevo's domain and can never align with gmail.com — nobody can publish DNS
 * for a domain they don't own. Some of these will land in spam. Sending as a
 * domain the academy owns, or via the Gmail API, is what fixes that for good.
 */
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const sendViaBrevo = async ({ to, subject, html, attachments }) => {
  try {
    const encoded = await encodeAttachments(attachments);

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Love Learning Explorers', email: GMAIL_USER },
        to: [{ email: to }],
        subject,
        htmlContent: withHostedLogo(html),
        ...(encoded.length && { attachment: encoded }),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Brevo puts the actionable part in `message` (e.g. sender not verified).
      return { ok: false, error: `Brevo: ${err.message || res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Brevo: ${error.message}` };
  }
};

/**
 * Gmail API over HTTPS — the only transport that satisfies every constraint at
 * once, which is why it is preferred over the two below.
 *
 * Render blocks outbound SMTP on every port, so nodemailer cannot reach Gmail
 * from production. Resend gets through (it is HTTPS) but refuses to send until
 * a domain is verified, and this academy's DNS is locked inside Wix. The Gmail
 * API is HTTPS like Resend, yet the mail leaves Google's own servers as the
 * academy's own account — no domain to verify, and the deliverability of a
 * message genuinely sent from that mailbox rather than on its behalf.
 *
 * Needs an OAuth refresh token rather than the service-account key Drive uses:
 * a service account can only impersonate a user through domain-wide
 * delegation, which is a Workspace feature a free @gmail.com account does not
 * have. Mint the token with `npm run gmail:auth`.
 */
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

const gmailOAuthClient = (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN)
  ? (() => {
      const client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
      // The library refreshes the short-lived access token off this on demand,
      // so nothing here expires as long as the refresh token stays valid.
      client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
      return client;
    })()
  : null;

/**
 * Sends one email through the Gmail API.
 *
 * The MIME is built by nodemailer's own composer rather than by hand, so the
 * inline `cid:` logo, the multipart structure and any real attachments come out
 * byte-identical to what the SMTP path produced — only the delivery changes.
 */
const sendViaGmailApi = async ({ to, subject, html, attachments }) => {
  try {
    const mime = await new MailComposer({
      from: `"Love Learning Explorers" <${GMAIL_USER}>`,
      to,
      subject,
      html,
      attachments: [logoAttachment, ...(attachments || [])],
    }).compile().build();

    const gmail = google.gmail({ version: 'v1', auth: gmailOAuthClient });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: mime.toString('base64url') },
    });
    return { ok: true };
  } catch (error) {
    // Google nests the useful part; the outer message is usually just the code.
    const detail = error?.response?.data?.error?.message || error.message;
    return { ok: false, error: `Gmail API: ${detail}` };
  }
};

/**
 * Sends one email via Resend's HTTP API. Preferred on cloud platforms like
 * Render that block outbound SMTP.
 */
const sendViaResend = async ({ to, subject, html, attachments }) => {
  // Same hosted-logo swap as Brevo, and for the same reason: this used to
  // inline a data: URI, which Gmail and Outlook drop outright — the header
  // would have arrived empty.
  const encoded = await encodeAttachments(attachments);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      html: withHostedLogo(html),
      // Resend names the field `filename`, Brevo names it `name`.
      ...(encoded.length && { attachments: encoded.map(a => ({ filename: a.name, content: a.content })) }),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.message || `Resend API ${res.status}` };
  }
  return { ok: true };
};

/**
 * Sends one email via Gmail SMTP (nodemailer). Fallback for local dev where
 * SMTP is not blocked.
 */
const sendViaSmtp = async ({ to, subject, html, attachments }) => {
  if (!transporter) return { ok: false, error: 'GMAIL_USER/GMAIL_APP_PASSWORD not configured' };
  try {
    await transporter.sendMail({
      from: `"Love Learning Explorers" <${GMAIL_USER}>`,
      to,
      subject,
      html,
      attachments: [logoAttachment, ...(attachments || [])],
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

/**
 * Sends one email. Never throws — every caller here turns a failure into
 * { ok: false, error } instead of losing the record of what happened.
 *
 * Transport order is by what actually reaches a family, not by preference:
 *   1. Gmail API   — HTTPS, sends as the academy's own mailbox, DKIM aligned.
 *   2. Brevo       — HTTPS, no DNS needed, but can never align a gmail.com From.
 *   3. Resend      — HTTPS, silently useless until a sending domain is verified.
 *   4. Gmail SMTP  — works locally, blocked outbound on Render.
 * Each is skipped unless fully configured, so a half-set transport can never
 * shadow a working one, and filling in a better one later takes over on its own.
 */
const send = async ({ to, subject, html, attachments }) => {
  if (!to) return { ok: false, error: 'No recipient email' };

  if (gmailOAuthClient) return sendViaGmailApi({ to, subject, html, attachments });
  if (BREVO_API_KEY) return sendViaBrevo({ to, subject, html, attachments });
  if (RESEND_API_KEY) return sendViaResend({ to, subject, html, attachments });
  return sendViaSmtp({ to, subject, html, attachments });
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
          <div style="font-size:13px;color:${BRAND.muted};margin-bottom:3px;">Deposit charged (15%)</div>
          <div style="font-size:24px;font-weight:700;color:${BRAND.green};">${formatCurrency(request.depositAmount)}</div>
          <div style="font-size:13px;color:${BRAND.muted};margin-top:6px;">An invoice for this deposit has been issued. The remaining balance is billed each quarter.</div>
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

export const isEmailConfigured = () =>
  gmailOAuthClient !== null || Boolean(BREVO_API_KEY) || Boolean(RESEND_API_KEY) || transporter !== null;

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
