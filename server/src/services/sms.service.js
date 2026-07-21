/**
 * SMS delivery.
 *
 * The provider is not chosen yet, so this module is deliberately a thin,
 * provider-agnostic seam: everything upstream (the notification dispatcher)
 * only ever calls `sendSms` and reads `{ ok, error }`. Swapping in Twilio,
 * AWS SNS, or anything else means implementing `deliver` below and adding the
 * credentials — no caller changes.
 *
 * Until then `isSmsConfigured()` is false and every send is a logged no-op, so
 * turning the SMS channel on in the admin UI is safe: it simply won't deliver
 * and the in-app notification still lands.
 */

// Set SMS_PROVIDER (e.g. 'twilio') once a provider is wired up in `deliver`.
const PROVIDER = process.env.SMS_PROVIDER || null;

export const isSmsConfigured = () => PROVIDER !== null;

/**
 * Normalizes a stored phone number to E.164, which every provider expects.
 * The academy is US-based and numbers are entered as 10 digits, so a bare
 * 10-digit number gets +1; anything already carrying a country code is passed
 * through. Returns null when there aren't enough digits to be a real number.
 */
export const toE164 = (raw) => {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
};

// Provider-specific transport. Add the real implementation here.
const deliver = async (/* { to, body } */) => {
  throw new Error(`SMS_PROVIDER "${PROVIDER}" has no transport implemented yet`);
};

/**
 * Sends one text message. Never throws — returns { ok, error } so a failed
 * text can never take down the flow that triggered the notification.
 *
 * @param {object} opts
 * @param {string} opts.to   - recipient phone, any format (normalized here)
 * @param {string} opts.body - message text; keep it under ~160 chars
 */
export const sendSms = async ({ to, body }) => {
  const phone = toE164(to);
  if (!phone) return { ok: false, error: 'No valid phone number' };

  if (!isSmsConfigured()) {
    console.log(`[SMS] (not configured — skipped) to=${phone}: ${body}`);
    return { ok: false, error: 'SMS provider not configured' };
  }

  try {
    await deliver({ to: phone, body });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
