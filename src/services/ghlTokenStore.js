const store = new Map();

function saveTokens({ locationId, accessToken, refreshToken, expiresAt }) {
  store.set(locationId, { accessToken, refreshToken, expiresAt });
}

function getTokens(locationId) {
  return store.get(locationId) || null;
}

function isExpired(tokens) {
  return Date.now() >= tokens.expiresAt - 60000;
}

module.exports = { saveTokens, getTokens, isExpired };
