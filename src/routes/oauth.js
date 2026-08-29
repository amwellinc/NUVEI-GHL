const express = require('express');
const router = express.Router();
const { exchangeCodeForTokens } = require('../services/ghlOAuthClient');

router.get('/callback', async (req, res) => {
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
