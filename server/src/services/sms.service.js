import twilio from 'twilio';

/**
 * SMS delivery.
 *
 * This module is a thin, provider-agnostic seam: everything upstream (the
 * notification dispatcher) only ever calls `sendSms` and reads
 * `{ ok, error }`. Twilio is wired up below; swapping in AWS SNS or anything
 * else means implementing another branch in `deliver` — no caller changes.
 *
 * With SMS_PROVIDER unset, `isSmsConfigured()` is false and every send is a
 * logged no-op, so turning the SMS channel on in the admin UI is safe before
 * a provider is configured: it simply won't deliver and the in-app
 * notification still lands.
 */

// Set SMS_PROVIDER=twilio (plus the TWILIO_* env vars below) to enable delivery.
const PROVIDER = process.env.SMS_PROVIDER || null;

export const isSmsConfigured = () => {
  if (PROVIDER === 'twilio') {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  }
  return false;
};

// Created once and reused — Twilio's client opens its own connection pool,
// so a fresh one per send would leak sockets under load.
let twilioClient = null;
const getTwilioClient = () => {
  if (!twilioClient) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
};

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

// Provider-specific transport.
const deliver = async ({ to, body }) => {
  if (PROVIDER === 'twilio') {
    await getTwilioClient().messages.create({
      to,
      from: process.env.TWILIO_FROM_NUMBER,
      body,
    });
    return;
  }
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
