import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  waveStatus,
  waveConnect,
  waveCallback,
  waveSaveAccounts,
  waveDisconnect,
  waveSyncPreview,
  waveSyncRun,
} from '../controllers/integrations.controller.js';

const router = Router();

// OAuth callback is hit by Wave's redirect (a top-level browser navigation), so
// it cannot carry our auth header — it is secured by the signed `state` param.
router.get('/wave/callback', waveCallback);

// Everything else is admin-only.
router.get('/wave', authenticate, requireRole('ADMIN'), waveStatus);
router.get('/wave/connect', authenticate, requireRole('ADMIN'), waveConnect);
router.put('/wave/accounts', authenticate, requireRole('ADMIN'), waveSaveAccounts);
router.post('/wave/disconnect', authenticate, requireRole('ADMIN'), waveDisconnect);
router.post('/wave/sync/preview', authenticate, requireRole('ADMIN'), waveSyncPreview);
router.post('/wave/sync', authenticate, requireRole('ADMIN'), waveSyncRun);

export default router;
