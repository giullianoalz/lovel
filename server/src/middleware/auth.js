import { firebaseAuth } from '../config/firebase-admin.js';
import prisma from '../config/database.js';

// ── Dev bypass control ──────────────────────────────────────────────────────
// Test login lets the frontend skip Firebase by sending x-dev-user-email.
// In development it is always on; in production it requires the explicit env
// var AND every request must also carry x-dev-secret matching DEV_SECRET.
const TEST_LOGIN_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_TEST_LOGIN === 'true';

const DEV_SECRET = process.env.DEV_SECRET || null;

if (TEST_LOGIN_ENABLED && process.env.NODE_ENV === 'production') {
  console.warn('');
  console.warn('⚠️  ────────────────────────────────────────────────────────');
  console.warn('⚠️  TEST LOGIN IS ENABLED IN PRODUCTION');
  console.warn('⚠️  Anyone with the dev-secret can impersonate any user.');
  console.warn('⚠️  Set ENABLE_TEST_LOGIN to false when done testing.');
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
      if (TEST_LOGIN_ENABLED) {
        // In production, also require the secret header to prevent open access.
        if (process.env.NODE_ENV === 'production' && req.headers['x-dev-secret'] !== DEV_SECRET) {
          // Silently fall through to the 401 below — don't reveal that test
          // login exists at all.
        } else {
          const devUserEmail = req.headers['x-dev-user-email'];
          let devUser;
          if (devUserEmail) {
            devUser = await prisma.user.findUnique({
              where: { email: devUserEmail },
              include: {
                familyMembers: {
                  include: { family: true },
                },
              },
            });
          } else {
            devUser = await prisma.user.findFirst({
              where: { role: 'ADMIN' },
              include: {
                familyMembers: {
                  include: { family: true },
                },
              },
            });
          }
          if (devUser) {
            req.user = devUser;
            req.firebaseUser = { uid: devUser.firebaseUid, email: devUser.email, name: devUser.fullName };
            return next();
          }
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
