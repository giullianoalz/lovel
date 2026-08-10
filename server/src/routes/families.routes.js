import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  listFamilies,
  getFamily,
  createFamily,
  updateFamily,
  addFamilyMember,
  removeFamilyMember,
} from '../controllers/families.controller.js';

const router = Router();

// Admin-only, both of them. These return every family member's name, email and
// phone — exactly the guardian details a teacher must not hold (the rest of the
// app now shows them "Ana's Parent"; see utils/parentPrivacy.js). No teacher
// screen reads these endpoints, so the roster views lose nothing.

// GET /api/families — List all families (Admin)
router.get('/', authenticate, requireRole('ADMIN'), listFamilies);

// GET /api/families/:id — Get family detail (Admin)
router.get('/:id', authenticate, requireRole('ADMIN'), getFamily);

// POST /api/families — Create family (Admin)
router.post('/', authenticate, requireRole('ADMIN'), createFamily);

// PUT /api/families/:id — Update family (Admin)
router.put('/:id', authenticate, requireRole('ADMIN'), updateFamily);

// POST /api/families/:id/members — Add member to family (Admin)
router.post('/:id/members', authenticate, requireRole('ADMIN'), addFamilyMember);

// DELETE /api/families/:id/members/:memberId — Remove member (Admin)
router.delete('/:id/members/:memberId', authenticate, requireRole('ADMIN'), removeFamilyMember);

export default router;
