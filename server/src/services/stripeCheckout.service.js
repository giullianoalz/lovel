import prisma from '../config/database.js';
import stripe from '../config/stripe.js';

/**
 * The Stripe Checkout URL for paying an invoice's remaining balance —
 * reused rather than re-created every time it's asked for, since Stripe
 * treats each `checkout.sessions.create` as a distinct session.
 *
 * Shared between the parent portal's "Pay" button and the admin's "email this
 * invoice" flow, which is why family membership is not checked here — the
 * caller is responsible for authorizing who may ask for this invoice's link.
 *
 * A cached link is only reused if it hasn't expired AND still reflects the
 * current amount owed — a partial Zelle/cash payment made after the link was
 * created would otherwise leave the family paying the stale (higher) amount,
 * or hitting an already-expired link.
 *
 * Returns null when Stripe isn't configured or the invoice is already paid —
 * both are legitimate "there is no card link" outcomes, not errors.
 */
export const getOrCreateInvoiceCheckoutUrl = async (invoice) => {
  if (!stripe) return null;

  const amountDue = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  if (amountDue <= 0) return null;

  if (invoice.stripePaymentLink && invoice.stripePaymentLinkId) {
    const existingSession = await stripe.checkout.sessions.retrieve(invoice.stripePaymentLinkId).catch(() => null);
    const stillValid = existingSession
      && existingSession.status === 'open'
      && existingSession.expires_at * 1000 > Date.now()
      && existingSession.amount_total === Math.round(amountDue * 100);
    if (stillValid) return invoice.stripePaymentLink;
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(amountDue * 100),
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description: invoice.dateRange || 'Lovelearning Academy',
        },
      },
      quantity: 1,
    }],
    metadata: { invoiceId: invoice.id, familyId: invoice.familyId },
    success_url: `${frontendUrl}/portal/parent?payment=success`,
    cancel_url: `${frontendUrl}/portal/parent?payment=cancelled`,
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { stripePaymentLink: session.url, stripePaymentLinkId: session.id },
  });

  return session.url;
};
