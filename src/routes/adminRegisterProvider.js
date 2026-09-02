const express = require('express');
const router = express.Router();
const { registerProvider } = require('../services/ghlProviderConfig');
const { timingSafeEqual } = require('../lib/security');

/**
 * TEMPORARY, one-time-use route — registers this app as a GHL Custom
 * Payment Provider using the OAuth token already stored on this container's
 * persistent volume (why this must run server-side rather than from a local
 * machine, which has no access to that volume). Delete this file and its
 * mount in server.js once registration succeeds; it has no purpose after
 * that beyond re-registration, which regenerates and invalidates the live
 * API keys, so it should not be left reachable indefinitely.
 */
router.post('/', async (req, res) => {
  const suppliedSecret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_REGISTER_SECRET || !timingSafeEqual(suppliedSecret, process.env.ADMIN_REGISTER_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await registerProvider({
      locationId: process.env.GHL_LOCATION_ID,
      paymentsUrl: `${process.env.APP_URL}/ghl-provider/checkout`,
      queryUrl: `${process.env.APP_URL}/ghl-provider/query`,
      imageUrl: `${process.env.APP_URL}/static/nuvei-logo.png`,
      name: 'Wellness111 Dual Payment System',
      description: 'Dual-gateway payment processing (Nuvei/BaseCommerce for US/Canada, Stripe internationally) for wellness111.com'
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Admin Register Provider] Failed:', error.message, error.response?.data);
    return res.status(error.statusCode || 500).json({ error: error.message, details: error.response?.data });
  }
});

module.exports = router;
