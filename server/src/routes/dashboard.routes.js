import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDashboard } from '../controllers/dashboard.controller.js';

const router = Router();

// GET /api/dashboard — Consolidated dashboard data (All auth users)
router.get('/', authenticate, getDashboard);

export default router;
