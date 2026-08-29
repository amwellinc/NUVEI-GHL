const express = require('express');
const router = express.Router();
const { exchangeCodeForTokens } = require('../services/ghlOAuthClient');
const { createRateLimiter } = require('../lib/security');

// Purely abuse protection: a real install hits this once, so a low ceiling
// costs legitimate users nothing while capping how fast an attacker can
// grind codes against GHL's token endpoint through us.
//
// NOTE: no OAuth `state` CSRF parameter is validated here, deliberately. This
// flow is initiated inside GHL ("install" in the marketplace UI redirects to
// GHL's own authorize endpoint and back here); this app never generates the
// authorize link, so it has nowhere to mint or store a state value. Standard
// state-parameter CSRF protection assumes the relying party controls flow
// initiation, which is not the case for a GHL marketplace app.
const callbackRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

router.get('/callback', callbackRateLimiter, async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing OAuth code');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    console.log(`[GHL OAuth] Installed for location ${tokens.locationId}`);
    res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">App installed successfully. You can close this window.</h2>');
  } catch (error) {
    console.error('[GHL OAuth] Token exchange failed:', error.message);
    res.status(error.statusCode || 500).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">Installation failed. Check server logs.</h2>');
  }
});

module.exports = router;
