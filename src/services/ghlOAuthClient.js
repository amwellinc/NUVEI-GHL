const axios = require('axios');
const tokenStore = require('./ghlTokenStore');

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

function buildTokenRequestBody(extraFields) {
  return new URLSearchParams({
    client_id: process.env.GHL_MARKETPLACE_CLIENT_ID,
    client_secret: process.env.GHL_MARKETPLACE_CLIENT_SECRET,
    ...extraFields
  }).toString();
}

async function requestTokens(body) {
  try {
    const response = await axios.post(TOKEN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    console.error(`GHL OAuth token request failed: ${error.message}`);
    throw { statusCode: error.response?.status || 500, message: 'GHL OAuth token request failed', details: error.response?.data };
  }
}

async function exchangeCodeForTokens(code) {
  const data = await requestTokens(buildTokenRequestBody({
    grant_type: 'authorization_code',
    code,
    user_type: 'Location',
    redirect_uri: process.env.GHL_OAUTH_REDIRECT_URI
  }));

  const tokens = {
    locationId: data.locationId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
  tokenStore.saveTokens(tokens);
  return tokens;
}

async function refreshAccessToken(locationId) {
  const existing = tokenStore.getTokens(locationId);
  if (!existing) {
    throw { statusCode: 401, message: `No stored GHL OAuth tokens for location ${locationId} — re-authorize` };
  }

  const data = await requestTokens(buildTokenRequestBody({
    grant_type: 'refresh_token',
    refresh_token: existing.refreshToken,
    user_type: 'Location'
  }));

  const tokens = {
    locationId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || existing.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000
  };
  tokenStore.saveTokens(tokens);
  return tokens.accessToken;
}

async function getValidAccessToken(locationId) {
  const existing = tokenStore.getTokens(locationId);
  if (!existing) {
    throw { statusCode: 401, message: `No stored GHL OAuth tokens for location ${locationId} — re-authorize` };
  }
  if (!tokenStore.isExpired(existing)) {
    return existing.accessToken;
  }
  return refreshAccessToken(locationId);
}

module.exports = { exchangeCodeForTokens, refreshAccessToken, getValidAccessToken };
