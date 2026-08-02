import crypto from 'crypto';
import { ingestFormResponse } from '../services/formIntake.service.js';
import { sendAccountInvite, isPlaceholderEmail, hasSignInAccount } from '../services/invite.service.js';
import prisma from '../config/database.js';
import { notifyAdmins } from '../jobs/notification.helper.js';

/**
 * Shared-secret check for the Apps Script trigger.
 *
 * Google doesn't sign these the way Stripe does, so the secret in the header is
 * the whole of the authentication — compared in constant time so the endpoint
 * can't be used as an oracle to guess it a byte at a time.
 */
const secretMatches = (provided) => {
  const expected = process.env.FORM_INTAKE_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * POST /api/intake/form-response
 *
 * Called by the Google Form's Apps Script trigger, once per submitted response.
 * Creates the family/student/application, and optionally prepares a sign-in
 * invite whose link the script includes in its own welcome email.
 *
 * Body: { email, parentName, parentPhone, address, studentName, birthday,
 *         submittedAt, ixl, responses: { "<question>": "<answer>" },
 *         wantInviteLink?: boolean }
 */
export const receiveFormResponse = async (req, res, next) => {
  try {
    if (!process.env.FORM_INTAKE_SECRET) {
      console.error('[Intake] FORM_INTAKE_SECRET is not configured — refusing the request.');
      return res.status(503).json({ ok: false, message: 'Form intake is not configured on this server.' });
    }
    if (!secretMatches(req.get('x-intake-secret'))) {
      return res.status(401).json({ ok: false, message: 'Bad or missing intake secret.' });
    }

    const result = await ingestFormResponse(req.body || {});
    if (!result.ok) return res.status(400).json(result);

    // A re-fired trigger or a parent submitting twice lands here. Nothing was
    // written the second time, and the script uses this flag to stay quiet
    // rather than welcoming the same family again.
    if (result.duplicate) {
      return res.json({ ...result, invite: null });
    }

    let invite = null;
    if (req.body?.wantInviteLink) {
      invite = await prepareInvite(result.parent.id);
    }

    // The application only matters if somebody looks at it, and the whole point
    // of the automation is that nobody is watching the sheet any more.
    notifyAdmins({
      type: 'REGISTRATION',
      title: 'New registration from the form',
      message: `${result.student.fullName} (${result.family.name}) submitted a registration — placement is pending review.`,
      referenceType: 'enrollmentApplication',
      referenceId: result.application.id,
    }).catch((err) => console.error('[Intake] admin notification failed:', err.message));

    res.status(201).json({ ...result, invite });
  } catch (error) {
    next(error);
  }
};

/**
 * Builds a set-password link for the parent without emailing it — the script
 * delivers it inside the welcome message.
 *
 * Never fails the request: the family is already saved by this point, and
 * losing a registration because Firebase hiccuped would be far worse than a
 * welcome email that arrives without a login link.
 */
const prepareInvite = async (parentId) => {
  try {
    const parent = await prisma.user.findUnique({ where: { id: parentId } });
    if (!parent) return null;
    if (isPlaceholderEmail(parent.email)) return null;
    // Already has a real login — re-inviting would send them a password reset
    // they didn't ask for.
    if (hasSignInAccount(parent)) return { alreadyHasAccount: true, link: null };

    const result = await sendAccountInvite(parentId, { deliver: false });
    return result.ok ? { link: result.link } : { error: result.message, link: null };
  } catch (error) {
    console.error('[Intake] could not prepare the invite:', error.message);
    return { error: error.message, link: null };
  }
};

/**
 * GET /api/intake/ping — lets whoever installs the Apps Script confirm the URL
 * and the secret before wiring up a live trigger.
 */
export const pingIntake = async (req, res) => {
  if (!secretMatches(req.get('x-intake-secret'))) {
    return res.status(401).json({ ok: false, message: 'Bad or missing intake secret.' });
  }
  res.json({ ok: true, message: 'Intake endpoint reachable and the secret matches.' });
};
