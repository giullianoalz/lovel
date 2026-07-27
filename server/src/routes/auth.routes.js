import { Router } from 'express';
import { authenticate, authenticateFirebaseOnly } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validate, familySignupSchema } from '../utils/validators.js';
import { getMe, registerUser, signupFamily } from '../controllers/auth.controller.js';

const router = Router();

// /auth/sync, the endpoint this replaces, took `role` straight from the request
// body — so anyone who signed themselves up could ask to be an ADMIN. Families
// can register themselves again (POST /signup), but the role is written by the
// controller and the account it creates can only ever be a PARENT whose
// children are inert until staff place them. Staff accounts are still created
// by an admin and activated by invite (POST /api/users/:id/invite).

// GET /api/auth/me — Get current user profile
router.get('/me', authenticate, getMe);

// POST /api/auth/signup — A family registers itself (public, Firebase token only)
router.post('/signup', authLimiter, authenticateFirebaseOnly, validate(familySignupSchema), signupFamily);

// POST /api/auth/register — Admin creates a new user account
router.post('/register', authLimiter, authenticate, requireRole('ADMIN'), registerUser);

export default router;
