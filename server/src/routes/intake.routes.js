import { Router } from 'express';
import { receiveFormResponse, pingIntake } from '../controllers/intake.controller.js';

const router = Router();

// Both routes authenticate with the FORM_INTAKE_SECRET header instead of a
// Firebase token — Apps Script runs as a Google account, not as a user of this
// app, so it has no way to present one.

// GET /api/intake/ping — verify the URL and secret while installing the script
router.get('/ping', pingIntake);

// POST /api/intake/form-response — one Google Form submission
router.post('/form-response', receiveFormResponse);

export default router;
