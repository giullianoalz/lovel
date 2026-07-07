import prisma from '../config/database.js';
import stripe from '../config/stripe.js';

// POST /api/payments/stripe/webhook
// Confirms Checkout Sessions started from the parent portal (createPaymentSession)
// and settles the invoice: marks it PAID/PARTIAL, records a Payment, and logs
// the ledger Transaction. Mounted with express.raw() so req.body is a Buffer.
export const handleStripeWebhook = async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe not configured.');

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET is not configured — refusing unverified event.');
    return res.status(503).send('Webhook not configured.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    console.error('[Stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await settleCheckoutSession(session);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('[Stripe webhook] handler error:', error);
    res.status(500).send('Webhook handler failed.');
  }
};

const settleCheckoutSession = async (session) => {
  const { invoiceId, familyId } = session.metadata || {};
  if (!invoiceId) return;

  // Idempotency: Stripe may redeliver the same event.
  const existing = await prisma.payment.findFirst({
    where: { stripePaymentIntentId: session.payment_intent },
  });
  if (existing) return;

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return;

  const amount = (session.amount_total ?? 0) / 100;

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        familyId: familyId || invoice.familyId,
        invoiceId: invoice.id,
        amount,
        netAmount: amount,
        method: 'STRIPE_CARD',
        status: 'COMPLETED',
        stripePaymentIntentId: session.payment_intent,
        externalReference: session.id,
        paidAt: new Date(),
      },
    });

    const newPaid = Number(invoice.amountPaid) + amount;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: newPaid,
        status: newPaid >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL',
      },
    });

    await tx.transaction.create({
      data: {
        familyId: familyId || invoice.familyId,
        amount,
        type: 'PAYMENT',
        description: `Stripe card payment — Invoice ${invoice.invoiceNumber}`,
        invoiceId: invoice.id,
        paymentId: payment.id,
      },
    });
  });
};
