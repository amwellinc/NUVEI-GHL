const crypto = require('crypto');
const axios = require('axios');
const { timingSafeEqual } = require('../lib/security');
const { getValidAccessToken } = require('./ghlOAuthClient');

function generateProviderSecrets() {
  const forMode = () => ({
    apiKey: crypto.randomBytes(32).toString('hex'),
    publishableKey: crypto.randomBytes(32).toString('hex')
  });
  return { live: forMode(), test: forMode() };
}

function verifyApiKey(suppliedKey, mode) {
  const envKey = mode === 'live' ? process.env.GHL_PROVIDER_LIVE_API_KEY
    : mode === 'test' ? process.env.GHL_PROVIDER_TEST_API_KEY
    : undefined;
  if (!envKey) return false;
  return timingSafeEqual(suppliedKey, envKey);
}

async function registerProvider({ locationId, paymentsUrl, queryUrl, imageUrl, name, description }) {
  const accessToken = await getValidAccessToken(locationId);
  const secrets = generateProviderSecrets();

  const response = await axios.post(
    `https://services.leadconnectorhq.com/payments/custom-provider/connect?locationId=${locationId}`,
    { name, description, imageUrl, queryUrl, paymentsUrl, live: secrets.live, test: secrets.test },
    { headers: { Authorization: `Bearer ${accessToken}`, Version: 'v3', 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  console.log('[GHL Provider] Registered. Store these securely — they are not retrievable from GHL again:');
  console.log(`  GHL_PROVIDER_LIVE_API_KEY=${secrets.live.apiKey}`);
  console.log(`  GHL_PROVIDER_LIVE_PUBLISHABLE_KEY=${secrets.live.publishableKey}`);
  console.log(`  GHL_PROVIDER_TEST_API_KEY=${secrets.test.apiKey}`);
  console.log(`  GHL_PROVIDER_TEST_PUBLISHABLE_KEY=${secrets.test.publishableKey}`);

  return response.data;
}

module.exports = { generateProviderSecrets, verifyApiKey, registerProvider };
