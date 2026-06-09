import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  getCalendarData,
  requestPTO,
  listSharedSpaces,
  reserveSpace
} from '../controllers/calendar.controller.js';

const router = Router();

// GET /api/calendar
router.get('/', authenticate, getCalendarData);

// POST /api/calendar/pto
router.post('/pto', authenticate, requireRole('TEACHER', 'ADMIN'), requestPTO);

// GET /api/calendar/spaces
router.get('/spaces', authenticate, listSharedSpaces);

// POST /api/calendar/spaces/reserve
router.post('/spaces/reserve', authenticate, reserveSpace);

export default router;
