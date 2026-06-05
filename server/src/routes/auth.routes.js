import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { syncUser, getMe, registerUser } from '../controllers/auth.controller.js';

const router = Router();

// POST /api/auth/sync — Sync Firebase user to DB (called after frontend login)
router.post('/sync', authenticate, syncUser);

// GET /api/auth/me — Get current user profile
router.get('/me', authenticate, getMe);

// POST /api/auth/register — Admin creates a new user account
router.post('/register', authLimiter, authenticate, requireRole('ADMIN'), registerUser);

export default router;
