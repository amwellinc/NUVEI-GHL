const express = require('express');
const router = express.Router();
const { constructWebhookEvent } = require('../services/stripeClient');
const { notifyGHL } = require('../lib/ghlNotify');
const { resolveContactId } = require('../lib/ghlContact');

// Stripe retries webhook delivery on any non-2xx response or timeout — this
// is expected, documented behavior, not a failure — so a duplicate delivery
// of an already-handled event must not create a second GHL note. Bounded by
// a TTL sweep (same pattern as the session store in routes/pay.js); losing
// a very old entry only risks one duplicate note in the rare case Stripe
// retries after the entry has aged out, not a correctness requirement.
const processedEvents = new Map();
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function cleanExpiredEvents() {
  const cutoff = Date.now() - DEDUPE_TTL_MS;
  for (const [id, seenAt] of processedEvents) {
    if (seenAt < cutoff) processedEvents.delete(id);
  }
}
setInterval(cleanExpiredEvents, DEDUPE_SWEEP_INTERVAL_MS).unref();

/**
 * POST /pay/stripe/webhook
 * The authoritative confirmation for international Stripe Checkout
 * payments — success_url is only a browser redirect and isn't guaranteed
 * to fire (closed tab, network drop), so the GHL push-back (note, custom
 * field, tag) happens here, gated on a verified Stripe signature, not on
 * the customer's browser returning to our site.
 * Mounted in server.js with express.raw() so req.body is the untouched
 * Buffer signature verification requires — it must never pass through the
 * app's global JSON body parser.
 */
router.post('/', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = constructWebhookEvent(req.body, signature);
  } catch (error) {
    console.warn('[Stripe Webhook] Signature verification failed:', error.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (processedEvents.has(event.id)) {
    return res.status(200).json({ received: true, duplicate: true });
  }
  processedEvents.set(event.id, Date.now());

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      // Prefixed with the gateway name — see the matching Nuvei-leg comment
      // in routes/pay.js — so this reference is unambiguous wherever it
      // ends up (the GHL contact note, wellness111.com's own receipt).
      const transactionId = `Stripe/${session.payment_intent || session.id}`;
      const amount = (session.amount_total / 100).toFixed(2);
      const currency = (session.currency || 'usd').toUpperCase();
      const description = session.metadata?.description || '';

      // The signed link's own contactId (set at link-creation time) wins
      // when present; Stripe's own hosted page always collects an email
      // even for a fully anonymous "Buy Now" link, so fall back to
      // resolving a contact from that rather than losing the order/GHL
      // tie-in entirely.
      let contactId = session.metadata?.contactId || '';
      if (!contactId && session.customer_details?.email) {
        const [firstName, ...rest] = (session.customer_details.name || '').split(' ');
        contactId = await resolveContactId(session.customer_details.email, firstName, rest.join(' '));
      }

      await notifyGHL(contactId, { transactionId, amount, currency, description });
      console.log(`[Stripe Webhook] Payment confirmed — session=${session.id} amount=${amount} ${currency}`);
    }
  }

  res.status(200).json({ received: true });
});

module.exports = router;
