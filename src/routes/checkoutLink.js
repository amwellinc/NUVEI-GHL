const express = require('express');
const router = express.Router();
const cors = require('cors');
const { createSignedLink } = require('../lib/paymentLinks');
const { createRateLimiter, isAllowedRedirect, getAllowedRedirectOrigins } = require('../lib/security');
const { resolveContactId } = require('../lib/ghlContact');
const { getPriceAmount } = require('../services/ghlProductsClient');

const ALLOWED_ORIGINS = getAllowedRedirectOrigins();
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_QUANTITY = 100;

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

router.use(cors(corsOptions));

/**
 * POST /pay/create-link
 * Called directly from a storefront's cart at checkout time to mint a
 * fresh signed /pay link for whatever the cart total is at that moment —
 * the storefront never talks to Nuvei/Stripe/GHL itself, it only ever
 * receives a signed URL to send the customer to.
 *
 * Two ways to specify the amount:
 *  - productId + priceId (preferred): the price is looked up server-side
 *    from GHL's own product catalog, and any client-submitted amount/
 *    currency is ignored entirely — a shopper intercepting this request
 *    (DevTools, a proxy) cannot lower what gets signed into the link,
 *    since the number never came from them in the first place.
 *  - a raw amount (legacy): trusted as-is, for callers that don't yet pass
 *    productId/priceId — e.g. a non-catalog custom-amount link. This path
 *    carries no protection against a tampered cart total; logged whenever
 *    used so it's visible which callers still need migrating.
 */
router.post('/', createLinkRateLimiter, async (req, res) => {
  const { amount, currency, description, email, firstName, lastName, successUrl, failureUrl, productId, priceId, quantity } = req.body || {};

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

  let finalAmount = amount;
  let finalCurrency = currency;

  if (productId && priceId) {
    const qty = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1;
    if (qty > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be ${MAX_QUANTITY} or fewer` });
    }

    try {
      const price = await getPriceAmount(process.env.GHL_LOCATION_ID, productId, priceId);
      finalAmount = (price.amount * qty).toFixed(2);
      finalCurrency = price.currency;
    } catch (error) {
      return res.status(error.statusCode || 502).json({ error: error.message });
    }
  } else {
    console.warn('[Pay Link] create-link called without productId/priceId — trusting the client-submitted amount directly, unverified against any catalog price.');
  }

  const contactId = await resolveContactId(email, firstName, lastName);

  try {
    const url = createSignedLink(`${process.env.APP_URL}/pay`, {
      amount: finalAmount,
      currency: finalCurrency,
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
