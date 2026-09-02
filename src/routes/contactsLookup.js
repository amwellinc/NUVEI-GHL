const express = require('express');
const router = express.Router();
const cors = require('cors');
const GHLClient = require('../services/ghlClient');
const { createRateLimiter, getAllowedRedirectOrigins } = require('../lib/security');

const ALLOWED_ORIGINS = getAllowedRedirectOrigins();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public and cross-origin by design — the storefront's checkout page calls
// this directly from the browser to recognize a returning customer.
const corsOptions = {
  origin(origin, callback) {
    // No Origin header at all means a non-browser caller (curl, a server) —
    // not subject to CORS in the first place.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET']
};

// This endpoint returns PII (name/phone/address) for any email that
// resolves to a real contact, gated only by CORS (which stops other
// websites' browser JS from reading the response, not a direct curl/script
// caller) — rate limiting plus requiring a syntactically complete email
// (GHL's underlying search is a fuzzy/substring match, never trusted as an
// exact filter on its own — see the .find() below) keeps this from
// becoming an open CRM enumeration tool, but a caller who already has a
// real customer's exact email can still confirm it's registered. Accepted
// tradeoff for the "recognize a returning customer at checkout" UX this
// exists for — the same category of risk as any site's "email already
// registered" check.
const lookupRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

router.use(cors(corsOptions));

/**
 * GET /contacts/lookup?email=...
 * Lets the storefront check whether a shopper is a known GHL contact before
 * checkout, so the checkout form can be prefilled instead of asking a
 * returning customer to retype their address.
 */
router.get('/', lookupRateLimiter, async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const response = await ghlClient.getContacts({ query: email });
    // GHL's query param is a fuzzy search, not an exact-match filter — it
    // can return other contacts whose name/phone/etc. happen to match the
    // string. Only ever treat this as "found" for a literal email match.
    const contact = (response.contacts || []).find(
      (c) => (c.email || '').toLowerCase() === email.toLowerCase()
    );

    if (!contact) {
      return res.status(200).json({ found: false });
    }

    return res.status(200).json({
      found: true,
      contact: {
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        phone: contact.phone || '',
        address1: contact.address1 || '',
        address2: contact.address2 || '',
        city: contact.city || '',
        state: contact.state || '',
        postalCode: contact.postalCode || '',
        country: contact.country || '',
        email: contact.email || email
      }
    });
  } catch (error) {
    console.error('[Contacts Lookup] GHL request failed:', error.message);
    return res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 502).json({ error: 'Unable to reach CRM' });
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
