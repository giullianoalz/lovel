import prisma from '../config/database.js';
import { firebaseAuth } from '../config/firebase-admin.js';

/**
 * POST /api/auth/sync
 * Syncs a Firebase-authenticated user to our PostgreSQL database.
 * Called after Firebase login/signup on the frontend.
 */
export const syncUser = async (req, res, next) => {
  try {
    const { uid, email, name } = req.firebaseUser;
    const { role = 'PARENT', phone, fullName } = req.body;

    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { firebaseUid: uid },
      include: {
        familyMembers: { include: { family: true } },
      },
    });

    if (user) {
      // Update last login timestamp
      user = await prisma.user.update({
        where: { id: user.id },
        data: { updatedAt: new Date() },
        include: {
          familyMembers: { include: { family: true } },
        },
      });

      return res.json({
        message: 'User synced successfully.',
        user,
        isNew: false,
      });
    }

    // Create new user
    const validRoles = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];
    const userRole = validRoles.includes(role.toUpperCase()) ? role.toUpperCase() : 'PARENT';

    user = await prisma.user.create({
      data: {
        firebaseUid: uid,
        email: email || req.body.email,
        fullName: fullName || name || 'New User',
        role: userRole,
        phone: phone || null,
      },
      include: {
        familyMembers: { include: { family: true } },
      },
    });

    // Create default notification preferences for the new user
    const categories = [
      'class_reminders',
      'snack_alerts',
      'attendance_alerts',
      'payment_reminders',
      'announcements',
      'session_reports',
      'prize_updates',
      'registration_updates',
    ];

    await prisma.notificationPreference.createMany({
      data: categories.map((category) => ({
        userId: user.id,
        category,
        inApp: true,
        email: ['class_reminders', 'snack_alerts', 'attendance_alerts', 'payment_reminders', 'announcements', 'registration_updates'].includes(category),
        push: false,
        sms: false,
      })),
    });

    res.status(201).json({
      message: 'User created successfully.',
      user,
      isNew: true,
    });
  } catch (error) {
    next(error);
  }
};

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
  try {
    const { email, password, fullName, role, phone } = req.body;

    if (!email || !password || !fullName || !role) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'email, password, fullName, and role are required.',
      });
    }

    // Create user in Firebase
    const firebaseUser = await firebaseAuth.createUser({
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
