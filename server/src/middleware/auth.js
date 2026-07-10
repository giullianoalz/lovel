import { firebaseAuth } from '../config/firebase-admin.js';
import prisma from '../config/database.js';

/**
 * Authentication Middleware
 * Verifies Firebase ID token from the Authorization header
 * and attaches the user object to req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Dev-only bypass so the frontend can test APIs without Firebase. In
      // production this must be an explicit opt-in (e.g. a staging deploy) —
      // defaulting to "on" would let anyone log in as any seeded user,
      // including the admin, just by sending an x-dev-user-email header.
      const testLoginEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_TEST_LOGIN === 'true';
      if (testLoginEnabled) {
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
