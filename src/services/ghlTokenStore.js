const fs = require('fs');
const path = require('path');

// Backed by a Railway volume mounted at /data — without this, tokens lived
// only in a process-local Map and were silently wiped on every redeploy,
// breaking the payment provider until someone noticed and re-authorized.
// Falls back to in-memory-only (never throws) when the path isn't writable
// — local dev and test runs don't have this volume mounted.
const STORE_PATH = process.env.GHL_TOKEN_STORE_PATH || '/data/ghl-oauth-tokens.json';

const store = new Map();
let persistenceAvailable = true;

function loadFromDisk() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      for (const [locationId, tokens] of Object.entries(data)) {
        store.set(locationId, tokens);
      }
    }
  } catch (error) {
    console.warn('[GHL Token Store] Failed to load persisted tokens, starting empty:', error.message);
  }
}

function persistToDisk() {
  if (!persistenceAvailable) return;
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(store)), 'utf8');
  } catch (error) {
    console.warn('[GHL Token Store] Disk persistence unavailable, tokens will not survive a restart:', error.message);
    persistenceAvailable = false;
  }
}

loadFromDisk();

function saveTokens({ locationId, accessToken, refreshToken, expiresAt }) {
  store.set(locationId, { accessToken, refreshToken, expiresAt });
  persistToDisk();
}

function getTokens(locationId) {
  return store.get(locationId) || null;
}

function isExpired(tokens) {
  return Date.now() >= tokens.expiresAt - 60000;
}

module.exports = { saveTokens, getTokens, isExpired };
