import prisma from '../config/database.js';
import { firebaseAuth } from '../config/firebase-admin.js';

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile
 */
export const getMe = async (req, res) => {
  res.json({ user: req.user });
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
    const categories = [
      'class_reminders', 'snack_alerts', 'attendance_alerts',
      'payment_reminders', 'announcements', 'session_reports',
      'prize_updates', 'registration_updates',
    ];

    await prisma.notificationPreference.createMany({
      data: categories.map((category) => ({
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
