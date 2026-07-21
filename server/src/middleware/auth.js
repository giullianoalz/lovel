import { firebaseAuth } from '../config/firebase-admin.js';
import prisma from '../config/database.js';

// ── Dev bypass control ──────────────────────────────────────────────────────
// Test login lets a client skip Firebase by identifying itself with a plain
// x-dev-user-email header. It is OFF unless ENABLE_TEST_LOGIN is explicitly
// "true".
//
// It deliberately does NOT infer "this must be a dev box" from NODE_ENV. A
// deployment that simply never sets NODE_ENV would otherwise silently switch
// the bypass on — which is exactly how this API once ended up serving student
// and medical records to unauthenticated callers. Enabling the bypass must be
// a deliberate act, never a default.
const TEST_LOGIN_ENABLED = process.env.ENABLE_TEST_LOGIN === 'true';

const DEV_SECRET = process.env.DEV_SECRET || null;

/**
 * Whether a bypass request carrying `providedSecret` may proceed.
 *
 * When DEV_SECRET is configured every bypass request must present it, so a
 * deliberately-enabled staging demo still isn't open to the world. Leaving
 * DEV_SECRET unset is only appropriate on a local machine that isn't reachable
 * from the internet.
 */
export const isTestLoginAuthorized = (providedSecret) => {
  if (!TEST_LOGIN_ENABLED) return false;
  if (DEV_SECRET) return providedSecret === DEV_SECRET;
  return true;
};

if (TEST_LOGIN_ENABLED) {
  console.warn('');
  console.warn('⚠️  ────────────────────────────────────────────────────────');
  console.warn('⚠️  TEST LOGIN IS ENABLED — Firebase auth can be bypassed');
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  AND NODE_ENV IS "production". Unset ENABLE_TEST_LOGIN now.');
  }
  if (!DEV_SECRET) {
    console.warn('⚠️  No DEV_SECRET set: any caller may impersonate any user.');
    console.warn('⚠️  Safe only if this host is not reachable from the internet.');
  }
  console.warn('⚠️  ────────────────────────────────────────────────────────');
  console.warn('');
}

// Export so index.js Socket.IO middleware can reuse the same check.
export { TEST_LOGIN_ENABLED, DEV_SECRET };

/**
 * Authentication Middleware
 * Verifies Firebase ID token from the Authorization header
 * and attaches the user object to req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const devUserEmail = req.headers['x-dev-user-email'];

      // A caller who names no user is simply unauthenticated. There is
      // deliberately no "fall back to some admin" branch here: that fallback
      // used to authenticate *every* header-less request as the first ADMIN
      // row, turning each protected route into an open endpoint.
      //
      // Failures below fall through to the 401 rather than reporting why, so
      // the response never reveals that test login exists at all.
      if (devUserEmail && isTestLoginAuthorized(req.headers['x-dev-secret'])) {
        const devUser = await prisma.user.findUnique({
          where: { email: devUserEmail },
          include: {
            familyMembers: {
              include: { family: true },
            },
          },
        });

        // Impersonating a suspended account would sidestep the same check the
        // real Firebase path enforces below.
        if (devUser && devUser.status !== 'SUSPENDED') {
          req.user = devUser;
          req.firebaseUser = { uid: devUser.firebaseUid, email: devUser.email, name: devUser.fullName };
          return next();
        }
      }

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      });
    }

    const token = authHeader.split('Bearer ')[1];

    // Verify the Firebase token
    const decodedToken = await firebaseAuth.verifyIdToken(token);

    // Find the user in our database
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
      include: {
        familyMembers: {
          include: { family: true },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found in database. Please complete registration.',
      });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your account has been suspended. Contact the administrator.',
      });
    }

    // Attach user to request object
    req.user = user;
    req.firebaseUser = decodedToken;

    next();
  } catch (error) {
    console.error('[Auth Middleware] Token verification failed:', error.message);

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        error: 'Token Expired',
        message: 'Your session has expired. Please sign in again.',
      });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authentication token.',
    });
  }
};

/**
 * Optional authentication — doesn't block if no token provided,
 * but attaches user if token is valid
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await firebaseAuth.verifyIdToken(token);
      const user = await prisma.user.findUnique({
        where: { firebaseUid: decodedToken.uid },
      });
      req.user = user;
      req.firebaseUser = decodedToken;
    }
  } catch {
    // Silently ignore auth errors for optional auth
  }

  next();
};
