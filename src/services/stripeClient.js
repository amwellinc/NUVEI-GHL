const Stripe = require('stripe');

let stripeInstance = null;

/**
 * Lazily constructs the Stripe SDK client — lazy so a missing
 * STRIPE_SECRET_KEY only breaks the Stripe (international) checkout leg,
 * never module load for the whole app (the Nuvei/US-Canada leg must keep
 * working even if Stripe isn't configured yet).
 */
function getStripe() {
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw { statusCode: 500, message: 'STRIPE_SECRET_KEY is not configured' };
  }
  stripeInstance = new Stripe(key);
  return stripeInstance;
}

/**
 * Creates a Stripe Checkout Session (hosted page) for a fixed amount —
 * mirrors the trust boundary already used for Nuvei links: amount/currency
 * come from the caller's already-verified signed-link session, never from
 * anything a browser could resubmit later.
 * @param {{amount: number|string, currency: string, description?: string, successUrl: string, cancelUrl: string, metadata?: object}} params
 * @returns {Promise<{id: string, url: string}>}
 */
async function createCheckoutSession({ amount, currency, description, successUrl, cancelUrl, metadata }) {
  const stripe = getStripe();
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: description || 'Payment' },
          unit_amount: Math.round(Number(amount) * 100)
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata
  });
}

/**
 * Verifies a webhook request's Stripe-Signature header against the raw
 * request body and returns the parsed event — throws on any mismatch, so a
 * forged webhook (no valid signature) can never trigger a GHL push-back.
 * @param {Buffer} rawBody
 * @param {string} signature
 * @returns {import('stripe').Stripe.Event}
 */
function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw { statusCode: 500, message: 'STRIPE_WEBHOOK_SECRET is not configured' };
  }
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = { createCheckoutSession, constructWebhookEvent };
