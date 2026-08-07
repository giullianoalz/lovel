/**
 * The wording the review-before-sending modal starts from.
 *
 * Mirrors `defaultInviteMessage` / `defaultBillingMessage` in
 * server/src/services/email.service.js. Duplicated rather than fetched: these
 * are only the starting point an admin edits, and the server falls back to its
 * own copy whenever the request omits them — so a drift here shows up as
 * slightly stale placeholder text, never as a wrong email.
 */

export const DEFAULT_INVITE_MESSAGE =
  "Your family's account is ready. Choose a password to sign in and see your children's schedule, reports, invoices and messages with their teachers.";

export const defaultInviteSubject = (isReminder) =>
  isReminder
    ? 'Reminder: set up your Love Learning Explorers account'
    : 'Welcome to Love Learning Explorers — set your password';

export const defaultBillingSubject = (termName) =>
  `Registration & Billing Confirmation — ${termName}`;

export const defaultBillingMessage = (studentName, className) =>
  `Here is the billing breakdown for ${studentName}${className ? ` (${className})` : ''}.`;

export const INVITE_FIXED_NOTE =
  "The academy logo, the “Set my password” button, the link-expiry note and the footer are added automatically and can't be edited here.";

export const BILLING_FIXED_NOTE =
  "The academy logo, the cost breakdown and the deposit amount are built from the registration itself and can't be edited here — only the subject and this message.";
