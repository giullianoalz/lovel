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
 * Where the app lives, for links that have to work in someone else's inbox.
 *
 * The production address is a constant rather than a required env var on
 * purpose. It used to read FRONTEND_URL, Render's dashboard held
 * "http://localhost:5173", and every invite quietly pointed at the recipient's
 * own machine — a dead link that nothing on the sending side could reveal. This
 * is a public, single, stable address; keeping it in the repo means a deploy is
 * enough to fix it and no dashboard can silently break it again.
 *
 * FRONTEND_URL still wins when it names a real host, so staging or a renamed
 * domain needs no code change. It is ignored only when it points at localhost
 * while we are running in production, which can only ever be a mistake.
 */
const PRODUCTION_APP_ORIGIN = 'https://lovelearning-three.vercel.app';

export const resolveAppOrigin = () => {
  const configured = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  const isLocal = !configured || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(configured);

  if (process.env.NODE_ENV === 'production' && isLocal) {
    console.warn(
      `[Invite] FRONTEND_URL is "${configured || '(unset)'}" in production — ` +
      `using ${PRODUCTION_APP_ORIGIN} instead so invite links reach their recipients.`
    );
    return PRODUCTION_APP_ORIGIN;
  }

  return configured || PRODUCTION_APP_ORIGIN;
};

/**
 * Builds a "set your password" link pointing at OUR page.
 *
 * We ask Firebase for a reset link only to obtain the one-time `oobCode` inside
 * it, then throw the rest away: the URL Firebase builds points at
 * <project>.firebaseapp.com/__/auth/action, and this project has no Firebase
 * Hosting site, so that address answers "Site Not Found" and its form can never
 * load a config — every link sent through it died with "API key not valid".
 *
 * Our /reset-password page redeems the same code with the web SDK, so the
 * password still goes straight from the browser to Firebase and never touches
 * this server.
 *
 * Short-lived by construction: the code expires in an hour and Firebase offers
 * no way to change that. Nothing should put one in an email — see
 * `buildInviteLink`.
 */
const firebaseResetLink = async (email) => {
  const firebaseUrl = await firebaseAuth.generatePasswordResetLink(email);
  const code = new URL(firebaseUrl).searchParams.get('oobCode');
  if (!code) throw new Error('Firebase returned a reset link with no oobCode.');

  return `${resolveAppOrigin()}/reset-password?oobCode=${encodeURIComponent(code)}`;
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
 * `subject`/`message` let an admin edit the wording before it goes out (see
 * the invite-preview modal); omitted, `sendInviteEmail` falls back to the
 * standard copy.
 *
 * @returns {Promise<{ok: boolean, message?: string, emailed?: boolean, link?: string, user?: object}>}
 */
export const sendAccountInvite = async (userId, { deliver = true, subject, message } = {}) => {
  console.log(`[Invite] Starting invite for userId=${userId}`);
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
    console.log(`[Invite] Step 1: ensuring Firebase account for ${user.email}`);
    firebaseUser = await ensureFirebaseAccount(user);
    console.log(`[Invite] Step 1 done: uid=${firebaseUser.uid}`);
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
    console.log(`[Invite] Step 2: building invite link`);
    link = await buildInviteLink(user);
    console.log(`[Invite] Step 2 done`);
  } catch (error) {
    console.error('[Invite] Could not generate the password link:', error);
    return { ok: false, message: `Could not generate an invite link: ${error.message}` };
  }

  const isReminder = Boolean(user.invitedAt);
  console.log(`[Invite] Step 3: sending email to ${user.email}`);
  const delivery = deliver
    ? await sendInviteEmail({ to: user.email, fullName: user.fullName, link, isReminder, subject, message })
    : { ok: false, skipped: true };
  console.log(`[Invite] Step 3 done: ok=${delivery.ok}${delivery.error ? ` error=${delivery.error}` : ''}`);

  // invitedAt means "a family was told this account exists" — it must stay
  // untouched when that never happened. A failed send used to set it anyway,
  // so the directory showed people as invited while nobody had heard from us;
  // that's what let two real families sit invisible until they said something.
  // `deliver: false` is not a failure: the caller (the Google Form intake)
  // sends its own welcome email using the link this returns, so the account
  // genuinely was announced, just not by us.
  const wasAnnounced = delivery.ok || !deliver;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      firebaseUid: firebaseUser.uid,
      ...(wasAnnounced ? { invitedAt: new Date() } : {}),
    },
  });

  console.log(`[Invite] Complete: emailed=${delivery.ok}`);
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
