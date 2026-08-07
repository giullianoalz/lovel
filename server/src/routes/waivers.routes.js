import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  getWaiverDocument,
  signWaiver,
  listWaivers,
  getWaiverPdf,
} from '../controllers/waivers.controller.js';

const router = Router();

// GET /api/waivers/document — the wording to display before signing
router.get('/document', authenticate, getWaiverDocument);

// POST /api/waivers
router.post('/', authenticate, requireRole('PARENT'), signWaiver);

// GET /api/waivers
router.get('/', authenticate, requireRole('ADMIN', 'RECEPTIONIST'), listWaivers);

// GET /api/waivers/:id/pdf — parents get their own, staff get any
router.get('/:id/pdf', authenticate, getWaiverPdf);

export default router;
