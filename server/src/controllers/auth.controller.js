import crypto from 'crypto';
import prisma from '../config/database.js';
import { firebaseAuth } from '../config/firebase-admin.js';
import { notifyAdmins } from '../jobs/notification.helper.js';
import { redeemInviteToken, resolveAppOrigin } from '../services/invite.service.js';

// Categories every new account gets a preference row for. Shared by the admin
// path and the self-signup path so a self-registered parent isn't silently
// missing channels the settings screen expects to find.
const NOTIFICATION_CATEGORIES = [
  'class_reminders', 'snack_alerts', 'attendance_alerts',
  'payment_reminders', 'announcements', 'session_reports',
  'prize_updates', 'registration_updates',
];

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile
 */
export const getMe = async (req, res) => {
  res.json({ user: req.user });
};

/**
 * GET /api/auth/activate/:token
 *
 * The link that goes in an invitation email. Trades our long-lived handle for a
 * Firebase set-password link generated right now and redirects to it, so the
 * hour Firebase gives that link starts when the person clicks — not when the
 * admin wrote the email.
 *
 * Public by necessity: the recipient has no account yet. The token is the
 * credential, and it only ever buys a password-reset link.
 *
 * Answers are redirects, never JSON: whoever follows this is a human in a mail
 * client, and a failure should land them somewhere that explains itself. The
 * login page reads `?invite=` and says what to do next.
 */
export const activateInvite = async (req, res, next) => {
  // Same resolver the links use: a failure message that redirects to localhost
  // is as useless as the broken link that sent them here.
  const loginUrl = `${resolveAppOrigin()}/login`;
  try {
    const result = await redeemInviteToken(req.params.token);
    if (!result.ok) return res.redirect(302, `${loginUrl}?invite=${result.reason}`);
    return res.redirect(302, result.link);
  } catch (error) {
    // A broken invite link is a dead end for someone who can't sign in to
    // report it, so log loudly and still send them somewhere with a way out.
    console.error('[Invite] Redeeming a token failed:', error);
    if (res.headersSent) return next(error);
    return res.redirect(302, `${loginUrl}?invite=error`);
  }
};

/**
 * POST /api/auth/register
 * Creates a new Firebase user AND syncs them to the database.
 * Used by admins to create accounts for teachers/students.
 */
export const registerUser = async (req, res, next) => {
  // Declared at function scope so the catch block can roll it back — a `const`
  // inside the try is out of scope in catch, which silently broke the rollback
  // (it threw ReferenceError instead of deleting the orphaned Firebase user).
  let firebaseUser = null;
  try {
    const { email, password, fullName, role, phone } = req.body;

    if (!email || !password || !fullName || !role) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'email, password, fullName, and role are required.',
      });
    }

    // Create user in Firebase
    firebaseUser = await firebaseAuth.createUser({
      email,
      password,
      displayName: fullName,
    });

    // Create user in our database
    const user = await prisma.user.create({
      data: {
        firebaseUid: firebaseUser.uid,
        email,
        fullName,
        role: role.toUpperCase(),
        phone: phone || null,
      },
    });

    // Create default notification preferences
    await prisma.notificationPreference.createMany({
      data: NOTIFICATION_CATEGORIES.map((category) => ({
        userId: user.id,
        category,
        inApp: true,
        email: true,
        push: false,
        sms: false,
      })),
    });

    res.status(201).json({
      message: 'User registered successfully.',
      user,
    });
  } catch (error) {
    // Clean up Firebase user if DB creation fails — without this, the
    // Firebase account would exist without a matching DB row, trapping the
    // user in a "User not found in database" loop on every login attempt.
    if (error.code !== 'P2002' && firebaseUser?.uid) {
      try {
        await firebaseAuth.deleteUser(firebaseUser.uid);
        console.warn(`[Auth] Rolled back Firebase user ${firebaseUser.uid} after DB failure`);
      } catch (cleanupErr) {
        console.error(`[Auth] Failed to rollback Firebase user ${firebaseUser.uid}:`, cleanupErr.message);
      }
    }
    next(error);
  }
};

/**
 * Children registered by a parent have no email and no way to sign in. They
 * still need values for two unique columns, so they get the same placeholder
 * shape the CSV importer uses — which `invite.service.js` already recognises,
 * so the directory reports them as "cannot sign in yet" instead of offering to
 * email an invite into the void.
 */
const placeholderIdentity = () => {
  const token = crypto.randomUUID();
  return { firebaseUid: `selfreg_${token}`, email: `selfreg_${token}@selfreg.local` };
};

/** "Ana María Rivas Peña" → "Rivas Peña Family" is wrong; keep it to the last word. */
const familyNameFor = (fullName) => {
  const surname = fullName.trim().split(/\s+/).pop();
  return `${surname} Family`;
};

/**
 * POST /api/auth/signup
 * A family registers itself. Public — the caller has a verified Firebase token
 * but no profile yet (see `authenticateFirebaseOnly`).
 *
 * Three things make this safe to expose, and none of them should be relaxed
 * without replacing them:
 *
 *  1. Roles are written here, never read from the body. This endpoint can only
 *     ever mint a PARENT and their STUDENT children. The route it replaces took
 *     `role` from the request, which meant anyone could sign up as an ADMIN.
 *  2. An email that already belongs to a User is refused outright. Families
 *     imported from TutorBird exist in the database before they ever log in;
 *     linking on a matching email would let a stranger who guesses an address
 *     walk into an existing family's invoices, chat and children.
 *  3. The children land INACTIVE with a PENDING application. Nothing reaches a
 *     roster, an invoice or payroll until staff place them, so the worst a junk
 *     signup produces is a row in a review queue.
 */
export const signupFamily = async (req, res, next) => {
  try {
    const { uid, email, email_verified: emailVerified } = req.firebaseUser;

    if (!email) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Your sign-in account has no email address. Contact the academy.',
      });
    }

    const { parent, children, scholarship = false, notes } = req.body;

    // Retrying after a half-finished signup is fine; a second family for an
    // account that already has one is not.
    const existingByUid = await prisma.user.findUnique({ where: { firebaseUid: uid } });
    if (existingByUid) {
      return res.status(409).json({
        error: 'Already Registered',
        message: 'This account is already set up. Sign in instead.',
      });
    }

    const existingByEmail = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existingByEmail) {
      // Deliberately vague about which of the two it is: the reply is the same
      // whether the address belongs to an imported parent or to staff, so this
      // can't be used to probe who is on file.
      return res.status(409).json({
        error: 'Email In Use',
        message:
          'That email address is already on file with the academy. Use "Forgot your password?" on the sign-in page, or contact us and we will send your invite.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({
        data: { name: familyNameFor(parent.fullName) },
      });

      const parentUser = await tx.user.create({
        data: {
          firebaseUid: uid,
          email,
          fullName: parent.fullName.trim(),
          role: 'PARENT', // hardcoded — never from the request body
          phone: parent.phone?.trim() || null,
          status: 'ACTIVE',
        },
      });

      await tx.familyMember.create({
        data: {
          familyId: family.id,
          userId: parentUser.id,
          role: 'Parent',
          // The registering parent is who the first invoice goes to. Staff can
          // move it later once they know who actually pays.
          isInvoiceRecipient: true,
        },
      });

      await tx.notificationPreference.createMany({
        data: NOTIFICATION_CATEGORIES.map((category) => ({
          userId: parentUser.id,
          category,
          inApp: true,
          email: true,
          push: false,
          sms: false,
        })),
      });

      const applications = [];
      for (const child of children) {
        const student = await tx.user.create({
          data: {
            ...placeholderIdentity(),
            fullName: child.fullName.trim(),
            role: 'STUDENT', // hardcoded, same reason as above
            age: child.age ?? null,
            allergies: child.allergies?.trim() || null,
            medicalNotes: child.medicalNotes?.trim() || null,
            // Not a student of the academy until staff say so: INACTIVE keeps
            // them off rosters, billing runs and the active-student counts.
            status: 'INACTIVE',
          },
        });

        await tx.familyMember.create({
          data: { familyId: family.id, userId: student.id, role: 'Student' },
        });

        applications.push(
          await tx.enrollmentApplication.create({
            data: {
              familyId: family.id,
              studentId: student.id,
              submittedById: parentUser.id,
              interests: child.interests ?? [],
              ixlPlan: child.ixlPlan ?? 'NONE',
              scholarship,
              parentNotes: notes?.trim() || null,
            },
          })
        );
      }

      return { family, parentUser, applications };
    }, {
      // A family of several children is ~5 writes each, and the first one can
      // land on a cold Neon connection. The 5s default has no margin for that,
      // and a timeout here means a Firebase account with no profile behind it.
      timeout: 20000,
    });

    const childCount = result.applications.length;
    notifyAdmins({
      type: 'REGISTRATION',
      title: 'New family registered',
      message: `${result.parentUser.fullName} signed up with ${childCount} ${childCount === 1 ? 'child' : 'children'}. Review and place them.`,
      referenceType: 'family',
      referenceId: result.family.id,
      dedupKey: `family-signup:${result.family.id}`,
      io: req.app.get('io'),
    });

    res.status(201).json({
      message: 'Family registered successfully.',
      user: result.parentUser,
      familyId: result.family.id,
      pendingApplications: childCount,
      emailVerified: Boolean(emailVerified),
    });
  } catch (error) {
    // A race between two signups for the same account trips the unique index on
    // firebaseUid/email rather than the checks above.
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Already Registered',
        message: 'This account is already set up. Sign in instead.',
      });
    }
    next(error);
  }
};
