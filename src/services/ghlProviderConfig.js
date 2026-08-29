const crypto = require('crypto');
const { timingSafeEqual } = require('../lib/security');

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

module.exports = { generateProviderSecrets, verifyApiKey };
