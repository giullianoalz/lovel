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

// Placeholder uids from the same two sources: a row carrying one has no
// Firebase account behind it, so its owner cannot sign in yet.
const PLACEHOLDER_UID_PREFIXES = ['import_', 'selfreg_'];

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
 * Builds the "set your password" link. The continue URL sends them back to our
 * login page once Firebase accepts the new password; if that domain isn't in
 * the project's authorized list Firebase rejects the whole call, so fall back
 * to a plain link rather than leaving the admin with no invite at all.
 */
const buildInviteLink = async (email) => {
  const url = `${process.env.FRONTEND_URL || ''}/login`;
  try {
    return await firebaseAuth.generatePasswordResetLink(email, { url, handleCodeInApp: false });
  } catch (error) {
    console.warn(`[Invite] Continue URL rejected (${error.message}) — falling back to a plain link.`);
    return firebaseAuth.generatePasswordResetLink(email);
  }
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
    link = await buildInviteLink(user.email);
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
