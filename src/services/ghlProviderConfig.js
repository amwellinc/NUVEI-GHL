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

/**
 * Step 1 of 2 — creates the base provider/integration association between
 * this marketplace app and a location. Must succeed before
 * /payments/custom-provider/connect (step 2, which sets the actual
 * live/test keys) will accept anything: calling connect first fails with
 * "Base config for integration is not created yet." Confirmed live
 * 2026-09-02 against a real installed app.
 */
async function createProviderIntegration({ locationId, accessToken, paymentsUrl, queryUrl, imageUrl, name, description }) {
  const response = await axios.post(
    `https://services.leadconnectorhq.com/payments/custom-provider/provider?locationId=${locationId}`,
    { name, description, paymentsUrl, queryUrl, imageUrl, supportsSubscriptionSchedule: false },
    { headers: { Authorization: `Bearer ${accessToken}`, Version: 'v3', 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  return response.data;
}

async function registerProvider({ locationId, paymentsUrl, queryUrl, imageUrl, name, description }) {
  const accessToken = await getValidAccessToken(locationId);

  await createProviderIntegration({ locationId, accessToken, paymentsUrl, queryUrl, imageUrl, name, description });

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

  // Returned (not just logged) so a caller that isn't a human at a terminal
  // — e.g. the temporary admin HTTP route used to run this against a
  // deployed environment — can hand the generated secrets back directly,
  // since GHL's own response never echoes them.
  return { ...response.data, secrets };
}

module.exports = { generateProviderSecrets, verifyApiKey, registerProvider, createProviderIntegration };
