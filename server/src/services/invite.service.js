/**
 * Account invites.
 *
 * Sign-in accounts are created by staff, never by the public: an admin adds or
 * imports the family, then invites the parent. The invite is a Firebase
 * password-reset link, so the password is chosen by the recipient on Firebase's
 * own page and never travels through us.
 *
 * That ordering is what keeps roles trustworthy — the role lives on the User row
 * an admin created, so signing in can never be a way to *become* something.
 */

import crypto from 'crypto';
import prisma from '../config/database.js';
import { firebaseAuth } from '../config/firebase-admin.js';
import { sendInviteEmail } from './email.service.js';

// The CSV importer and the old self-registration flow synthesise addresses for
// people who never gave one. They're not deliverable, so inviting one would
// look like it worked and silently reach nobody.
const PLACEHOLDER_EMAIL_DOMAINS = ['@import.local', '@selfreg.local'];

// Placeholder uids from the same sources: a row carrying one has no Firebase
// account behind it, so its owner cannot sign in yet.
//
// Mint them through `placeholderUid` rather than by hand. The Google Form
// intake minted its own `form_` uids without registering the prefix here, so
// every family it created read as "can sign in" — the directory showed them a
// green tick and the intake skipped their invite, leaving them with no way in.
const PLACEHOLDER_UID_PREFIXES = ['import_', 'selfreg_', 'form_'];

/**
 * Builds a placeholder uid for `source` (e.g. 'form'), failing loudly if that
 * source isn't recognised above — a new intake path finds out at its first
 * write, not weeks later when nobody can log in.
 */
export const placeholderUid = (source) => {
  if (!PLACEHOLDER_UID_PREFIXES.includes(`${source}_`)) {
    throw new Error(`Unknown placeholder uid source "${source}" — add it to PLACEHOLDER_UID_PREFIXES.`);
  }
  return `${source}_${crypto.randomUUID()}`;
};

export const isPlaceholderEmail = (email) =>
  !email || PLACEHOLDER_EMAIL_DOMAINS.some((domain) => email.toLowerCase().endsWith(domain));

/** Whether this row is already backed by a real Firebase account. */
export const hasSignInAccount = (user) =>
  Boolean(user?.firebaseUid) && !PLACEHOLDER_UID_PREFIXES.some((p) => user.firebaseUid.startsWith(p));

/**
 * Resolves the Firebase account for this person, creating one if needed.
 * The generated password is throwaway and never leaves this function — the
 * invite link is what lets them set a real one.
 */
const ensureFirebaseAccount = async (user) => {
  try {
    return await firebaseAuth.getUserByEmail(user.email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }

  return firebaseAuth.createUser({
    email: user.email,
    displayName: user.fullName,
    password: `${crypto.randomUUID()}Aa1!`,
  });
};

/**
 * Builds a Firebase "set your password" link. The continue URL sends them back
 * to our login page once Firebase accepts the new password; if that domain
 * isn't in the project's authorized list Firebase rejects the whole call, so
 * fall back to a plain link rather than leaving the admin with no invite at all.
 *
 * Short-lived by construction: Firebase expires these after an hour and offers
 * no way to change that. Nothing should put one in an email — see
 * `buildInviteLink`.
 */
const firebaseResetLink = async (email) => {
  const url = `${process.env.FRONTEND_URL || ''}/login`;
  try {
    return await firebaseAuth.generatePasswordResetLink(email, { url, handleCodeInApp: false });
  } catch (error) {
    console.warn(`[Invite] Continue URL rejected (${error.message}) — falling back to a plain link.`);
    return firebaseAuth.generatePasswordResetLink(email);
  }
};

/** How long an issued invite stays good. Long enough to survive a weekend. */
const INVITE_TTL_DAYS = 7;

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Issues a fresh invite handle, replacing any outstanding one — re-inviting
 * someone is how an admin says "the last link is no good".
 *
 * Only the digest is stored: a leaked database backup shouldn't hand out
 * working invites. The raw token is returned once and never again.
 */
const issueInviteToken = async (userId) => {
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.user.update({
    where: { id: userId },
    data: {
      inviteTokenHash: hashToken(raw),
      inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return raw;
};

/**
 * Builds the link that actually goes in the invitation email.
 *
 * It points at our own redeem endpoint rather than at Firebase, because the
 * Firebase link's one-hour life can't be extended and an invitation has to
 * survive the gap between writing the email and the recipient reading it.
 * Opening ours mints the Firebase link on the spot, so the password is still
 * typed on Firebase's page and still never travels through us.
 *
 * Needs PUBLIC_API_URL (this service's own public origin) — the process has no
 * other way to know the URL the outside world reaches it on. Without it, fall
 * back to the old short-lived link: an invite that expires quickly beats no
 * invite, and the warning says which one the admin is holding.
 */
const buildInviteLink = async (user) => {
  // Render's `fromService` fills this with a bare hostname, a hand-typed value
  // usually has the scheme. Normalise rather than care: a link missing its
  // scheme is a relative path, and relative paths in an email go nowhere.
  const configured = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  const apiOrigin = configured && !/^https?:\/\//i.test(configured) ? `https://${configured}` : configured;

  if (!apiOrigin) {
    console.warn('[Invite] PUBLIC_API_URL is not set — falling back to a Firebase link that expires in an hour.');
    return firebaseResetLink(user.email);
  }

  const token = await issueInviteToken(user.id);
  return `${apiOrigin}/api/auth/activate/${token}`;
};

/**
 * Redeems an invite handle for a fresh Firebase set-password link.
 *
 * Deliberately NOT single-use. Corporate mail scanners follow links in incoming
 * mail, and burning the token on that first automated fetch would lock out the
 * very people the invite is for. The expiry is what bounds it, and redeeming
 * hands out a password link rather than a session — the same exposure as the
 * "Forgot your password?" button anyone can already press.
 *
 * @returns {Promise<{ok: true, link: string} | {ok: false, reason: 'invalid'|'expired'|'blocked'}>}
 */
export const redeemInviteToken = async (rawToken) => {
  if (!rawToken || typeof rawToken !== 'string') return { ok: false, reason: 'invalid' };

  const user = await prisma.user.findUnique({ where: { inviteTokenHash: hashToken(rawToken) } });
  if (!user) return { ok: false, reason: 'invalid' };
  if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // Re-checked here, not just at issue time: a week is long enough for someone
  // to be suspended after being invited.
  if (user.status === 'SUSPENDED' || isPlaceholderEmail(user.email)) return { ok: false, reason: 'blocked' };

  const firebaseUser = await ensureFirebaseAccount(user);
  if (firebaseUser.uid !== user.firebaseUid) {
    const clash = await prisma.user.findUnique({ where: { firebaseUid: firebaseUser.uid } });
    if (clash && clash.id !== user.id) return { ok: false, reason: 'blocked' };
    await prisma.user.update({ where: { id: user.id }, data: { firebaseUid: firebaseUser.uid } });
  }

  return { ok: true, link: await firebaseResetLink(user.email) };
};

/**
 * Invites (or re-invites) one user.
 *
 * Never throws for expected problems — returns { ok: false, message } so the
 * caller can turn it into a 4xx the admin can act on.
 *
 * `deliver: false` prepares the invite without emailing it and always returns
 * the link, for callers that deliver it themselves — the Google Form intake
 * sends its own welcome message from the school's Gmail account and puts the
 * link inside it, so a second email from us would be noise.
 *
 * @returns {Promise<{ok: boolean, message?: string, emailed?: boolean, link?: string, user?: object}>}
 */
export const sendAccountInvite = async (userId, { deliver = true } = {}) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: 'User not found.' };

  if (isPlaceholderEmail(user.email)) {
    return {
      ok: false,
      message: `${user.fullName} has no real email address on file (${user.email}). Add one before inviting them.`,
    };
  }

  if (user.status === 'SUSPENDED') {
    return { ok: false, message: `${user.fullName}'s account is suspended. Reactivate it before inviting them.` };
  }

  let firebaseUser;
  try {
    firebaseUser = await ensureFirebaseAccount(user);
  } catch (error) {
    console.error('[Invite] Could not create the Firebase account:', error);
    return { ok: false, message: `Could not create a sign-in account for ${user.email}: ${error.message}` };
  }

  // Adopt the Firebase uid so the login lands on this exact row. Guarded because
  // firebaseUid is unique — if another row already claims it, silently rebinding
  // would hand this person someone else's account.
  if (firebaseUser.uid !== user.firebaseUid) {
    const clash = await prisma.user.findUnique({ where: { firebaseUid: firebaseUser.uid } });
    if (clash && clash.id !== user.id) {
      return {
        ok: false,
        message: `That email already signs in as ${clash.fullName} (${clash.email}). Merge the duplicate records first.`,
      };
    }
  }

  let link;
  try {
    link = await buildInviteLink(user);
  } catch (error) {
    console.error('[Invite] Could not generate the password link:', error);
    return { ok: false, message: `Could not generate an invite link: ${error.message}` };
  }

  const isReminder = Boolean(user.invitedAt);
  const delivery = deliver
    ? await sendInviteEmail({ to: user.email, fullName: user.fullName, link, isReminder })
    : { ok: false, skipped: true };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { firebaseUid: firebaseUser.uid, invitedAt: new Date() },
  });

  return {
    ok: true,
    emailed: delivery.ok,
    // Surfaced when we didn't deliver it ourselves — either delivery failed and
    // an admin passes it on by hand, or the caller asked to deliver it. It sets
    // a password — treat it like one.
    ...(delivery.ok ? {} : { link, ...(delivery.skipped ? {} : { deliveryError: delivery.error }) }),
    user: updated,
  };
};
