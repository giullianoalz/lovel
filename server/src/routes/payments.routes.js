import { Router } from 'express';
import { handleStripeWebhook } from '../controllers/payments.controller.js';

const router = Router();

// POST /api/payments/stripe/webhook — Stripe calls this directly (no auth, verified via signature)
router.post('/stripe/webhook', handleStripeWebhook);

export default router;
