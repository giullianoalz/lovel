import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { getMe, registerUser } from '../controllers/auth.controller.js';

const router = Router();

// There is deliberately no self-service account creation endpoint. /auth/sync
// used to create a User row from a Firebase token, taking `role` straight from
// the request body — so anyone who signed themselves up could ask to be an
// ADMIN. Accounts are now created by staff and activated by invite
// (POST /api/users/:id/invite), which keeps the role out of the caller's hands.

// GET /api/auth/me — Get current user profile
router.get('/me', authenticate, getMe);

// POST /api/auth/register — Admin creates a new user account
router.post('/register', authLimiter, authenticate, requireRole('ADMIN'), registerUser);

export default router;
