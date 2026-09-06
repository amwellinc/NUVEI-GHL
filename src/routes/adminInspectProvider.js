const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getValidAccessToken } = require('../services/ghlOAuthClient');
const { timingSafeEqual } = require('../lib/security');

/**
 * TEMPORARY, diagnostic-only route — fetches this location's custom
 * payment provider config directly from GHL's own API, to see it from
 * GHL's side rather than trusting our own registration response. Must run
 * server-side since the OAuth token only lives on this container's
 * persistent volume. Delete this file and its mount in server.js once the
 * "Marketplace payment config not found" investigation is resolved.
 */
router.get('/', async (req, res) => {
  const suppliedSecret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_INSPECT_SECRET || !timingSafeEqual(suppliedSecret, process.env.ADMIN_INSPECT_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = await getValidAccessToken(process.env.GHL_LOCATION_ID);
  const results = {};

  for (const path of ['/payments/custom-provider/provider', '/payments/custom-provider/connect']) {
    try {
      const response = await axios.get(`https://services.leadconnectorhq.com${path}`, {
        params: { locationId: process.env.GHL_LOCATION_ID },
        headers: { Authorization: `Bearer ${token}`, Version: 'v3' }
      });
      results[path] = { status: response.status, data: response.data };
    } catch (error) {
      results[path] = { status: error.response?.status, data: error.response?.data, message: error.message };
    }
  }

  res.status(200).json(results);
});

module.exports = router;
