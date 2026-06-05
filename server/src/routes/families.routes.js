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

// GET /api/families — List all families (Admin/Teacher)
router.get('/', authenticate, requireRole('ADMIN', 'TEACHER'), listFamilies);

// GET /api/families/:id — Get family detail (Admin/Teacher)
router.get('/:id', authenticate, requireRole('ADMIN', 'TEACHER'), getFamily);

// POST /api/families — Create family (Admin)
router.post('/', authenticate, requireRole('ADMIN'), createFamily);

// PUT /api/families/:id — Update family (Admin)
router.put('/:id', authenticate, requireRole('ADMIN'), updateFamily);

// POST /api/families/:id/members — Add member to family (Admin)
router.post('/:id/members', authenticate, requireRole('ADMIN'), addFamilyMember);

// DELETE /api/families/:id/members/:memberId — Remove member (Admin)
router.delete('/:id/members/:memberId', authenticate, requireRole('ADMIN'), removeFamilyMember);

export default router;
