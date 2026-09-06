const Stripe = require('stripe');

// Keyed by the actual secret key string (not just "live"/"test") so the GHL
// Custom Payment Provider flow — which picks STRIPE_SECRET_KEY or
// STRIPE_SECRET_KEY_TEST per-call based on GHL's own live/test signal, see
// routes/ghlProvider.js — can get a distinct client per key without either
// leaking a live/test mismatch into the wrong instance or reconstructing
// the SDK on every request.
const stripeInstances = new Map();

/**
 * Lazily constructs the Stripe SDK client — lazy so a missing
 * STRIPE_SECRET_KEY only breaks the Stripe (international) checkout leg,
 * never module load for the whole app (the Nuvei/US-Canada leg must keep
 * working even if Stripe isn't configured yet).
 * @param {string} [secretKey] - defaults to the active STRIPE_SECRET_KEY;
 *   pass explicitly to select a specific mode's key (e.g. STRIPE_SECRET_KEY_TEST).
 */
function getStripe(secretKey) {
  const key = secretKey || process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw { statusCode: 500, message: 'STRIPE_SECRET_KEY is not configured' };
  }
  if (!stripeInstances.has(key)) {
    stripeInstances.set(key, new Stripe(key));
  }
  return stripeInstances.get(key);
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
 * Creates a Stripe PaymentIntent — the embedded-card counterpart to
 * createCheckoutSession, used where a full-page redirect isn't possible
 * (the GHL Custom Payment Provider iframe: routes/ghlProvider.js). The
 * client confirms this directly with Stripe.js using its client_secret, so
 * raw card data still never reaches this server, matching the PCI-scope
 * property of the Checkout Session flow despite never leaving the iframe.
 * @param {{amount: number|string, currency: string, description?: string, metadata?: object, secretKey?: string}} params
 * @returns {Promise<import('stripe').Stripe.PaymentIntent>}
 */
async function createPaymentIntent({ amount, currency, description, metadata, secretKey }) {
  const stripe = getStripe(secretKey);
  return stripe.paymentIntents.create({
    amount: Math.round(Number(amount) * 100),
    currency: currency.toLowerCase(),
    description,
    metadata,
    // Explicit 'card' rather than automatic_payment_methods: the client
    // confirms via stripe.confirmCardPayment() against a manually-mounted
    // Card Element (routes/ghlProvider.js), not the newer unified Payment
    // Element — automatic detection surfaces Stripe Link's own "save your
    // info" popup on top of that element, which read as the page being
    // stuck (reported live: a confusing overlay where the card form should
    // be, no visible way forward).
    payment_method_types: ['card']
  });
}

/**
 * Retrieves a PaymentIntent directly from Stripe — used to independently
 * verify a client-reported confirmation succeeded (never trusting the
 * iframe's own success report alone) before recording a charge as paid.
 * @param {string} paymentIntentId
 * @param {string} [secretKey]
 * @returns {Promise<import('stripe').Stripe.PaymentIntent>}
 */
async function retrievePaymentIntent(paymentIntentId, secretKey) {
  const stripe = getStripe(secretKey);
  return stripe.paymentIntents.retrieve(paymentIntentId);
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

module.exports = { createCheckoutSession, createPaymentIntent, retrievePaymentIntent, constructWebhookEvent };
