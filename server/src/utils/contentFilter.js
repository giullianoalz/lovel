const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Matches common US phone formats: 305-555-1234, (305) 555-1234, 305.555.1234,
// 3055551234, +1 305 555 1234 — with optional country code.
const PHONE_RE = /(\+?\d{1,2}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|(?<!\d)\d{10}(?!\d)/;

/**
 * Checks a chat message for email addresses or phone numbers so contact
 * exchange stays inside the app instead of moving to outside channels.
 * Returns { blocked, reason } — reason is 'email' or 'phone'.
 */
export function findContactInfo(text) {
  if (!text) return { blocked: false };
  if (EMAIL_RE.test(text)) return { blocked: true, reason: 'email' };
  if (PHONE_RE.test(text)) return { blocked: true, reason: 'phone' };
  return { blocked: false };
}
