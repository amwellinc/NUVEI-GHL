const express = require('express');
const router = express.Router();
const { createSignedLink } = require('../lib/paymentLinks');
const { requireApiKey, isAllowedRedirect, getAllowedRedirectOrigins } = require('../lib/security');

const POS_LINK_TTL_SECONDS = 30 * 60;
const REF_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const MAX_DESCRIPTION_LENGTH = 200;

/**
 * POST /pos/links — Admin asks for a payment page for one staff charge. The amount and reference are
 * signed into the link, so staff can't change them on the page.
 */
router.post('/', requireApiKey, (req, res) => {
  const { ref, amount, currency, description, successUrl, failureUrl } = req.body || {};
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return res.status(400).json({ error: 'Invalid reference' });
  const allowed = getAllowedRedirectOrigins();
  if (!isAllowedRedirect(successUrl, allowed) || !isAllowedRedirect(failureUrl, allowed)) {
    return res.status(400).json({ error: 'Return address is not allowed' });
  }
  if (!process.env.APP_URL) return res.status(500).json({ error: 'APP_URL is not configured' });
  try {
    const url = createSignedLink(`${process.env.APP_URL}/pay`, {
      amount,
      currency,
      description: String(description || '').slice(0, MAX_DESCRIPTION_LENGTH),
      successUrl,
      failureUrl,
      ref,
      ttlSeconds: POS_LINK_TTL_SECONDS
    });
    return res.status(200).json({ url });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
});

module.exports = router;
