const express = require('express');
const router = express.Router();
const cors = require('cors');
const { createSignedLink } = require('../lib/paymentLinks');
const { createRateLimiter, isAllowedRedirect, getAllowedRedirectOrigins } = require('../lib/security');
const GHLClient = require('../services/ghlClient');

const ALLOWED_ORIGINS = getAllowedRedirectOrigins();
const MAX_DESCRIPTION_LENGTH = 200;

// Public and cross-origin by design — a storefront's own cart JS calls this
// directly from the browser. Gate it to the storefront origin(s) rather
// than leaving it open to any site, since nothing else about this endpoint
// requires the caller to prove who it is.
const corsOptions = {
  origin(origin, callback) {
    // No Origin header at all means a non-browser caller (curl, a server,
    // Postman) — those aren't subject to CORS in the first place, so let
    // them through; the browser-enforced check only matters for fetch()
    // calls made from a page running on some other origin.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['POST']
};

const createLinkRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

/**
 * Best-effort: resolves a checkout email (+ optional name) to a GHL contact
 * id via upsert, so the eventual payment can be tied to the right CRM
 * contact even though the cart never has a contactId to hand. Returns ''
 * (never throws) on any failure — a CRM hiccup must never block checkout,
 * and the payment link is still fully valid without a contactId.
 */
async function resolveContactId(email, firstName, lastName) {
  if (!email || !process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) return '';
  try {
    const result = await ghlClient.upsertContact({ email, firstName, lastName });
    return result?.contact?.id || result?.id || '';
  } catch (error) {
    console.warn('[Checkout Link] Contact resolution failed:', error.message);
    return '';
  }
}

router.use(cors(corsOptions));

/**
 * POST /pay/create-link
 * Called directly from a storefront's cart at checkout time to mint a
 * fresh signed /pay link for whatever the cart total is at that moment —
 * the storefront never talks to Nuvei/Stripe/GHL itself, it only ever
 * receives a signed URL to send the customer to.
 */
router.post('/', createLinkRateLimiter, async (req, res) => {
  const { amount, currency, description, email, firstName, lastName, successUrl, failureUrl } = req.body || {};

  if (description !== undefined && String(description).length > MAX_DESCRIPTION_LENGTH) {
    return res.status(400).json({ error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
  }
  if (successUrl && !isAllowedRedirect(successUrl, ALLOWED_ORIGINS)) {
    return res.status(400).json({ error: 'successUrl is not on an allowed origin' });
  }
  if (failureUrl && !isAllowedRedirect(failureUrl, ALLOWED_ORIGINS)) {
    return res.status(400).json({ error: 'failureUrl is not on an allowed origin' });
  }
  if (!process.env.APP_URL) {
    return res.status(500).json({ error: 'APP_URL is not configured' });
  }

  const contactId = await resolveContactId(email, firstName, lastName);

  try {
    const url = createSignedLink(`${process.env.APP_URL}/pay`, {
      amount,
      currency,
      description,
      successUrl,
      failureUrl,
      contactId
    });
    return res.status(200).json({ url });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
});

// Turns the cors package's origin-rejection into a clean JSON 403 instead
// of falling through to Express's default HTML error page.
router.use((err, req, res, next) => {
  if (err && err.message === 'Origin not allowed') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next(err);
});

module.exports = router;
