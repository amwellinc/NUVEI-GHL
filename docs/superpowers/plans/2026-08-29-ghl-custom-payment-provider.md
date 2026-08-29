# GHL Custom Payment Provider (Phase 1: One-Time Payments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the previous (spec-mismatched) GHL checkout routes with a real GHL Custom Payment Provider integration: OAuth token handling, provider registration, an iframe checkout page, and a `queryUrl` that verifies one-time payments — end to end, testable against real GHL traffic.

**Architecture:** Four new modules (`ghlOAuthClient`, `ghlTokenStore`, `ghlProviderConfig`, plus route files `oauth.js` and `ghlProvider.js`) sit alongside the existing `nuveiClient`/`ghlClient` services. The iframe checkout page is a static-ish HTML+JS page served by Express (same hand-rolled-template pattern the app already uses for its hosted card page, not a new frontend framework). BaseCommerce charging reuses the existing `NuveiClient.createPayment()` unchanged — only the GHL-facing transport layer is new.

**Tech Stack:** Node/Express (existing), `axios` (existing dependency, no new ones needed), `crypto` (Node builtin, for apiKey generation and constant-time comparison), Jest (existing test runner).

**Spec:** `docs/superpowers/plans/2026-08-29-ghl-custom-payment-provider-spec.md` — read it before starting; this plan argues from it and does not restate the verified endpoint/field details it documents.

## Global Constraints

- All new GHL-facing routes are mounted under `/ghl-provider` (e.g. `/ghl-provider/checkout`, `/ghl-provider/query`) — kept separate from the existing `/api/ghl/*` routes (contacts/notes) and the old `/checkout`/`/pay/*` routes being removed, so there is no path collision during the transition.
- Every new module gets Jest unit tests with network calls mocked (`jest.mock('axios')`), matching the existing pattern in `src/services/nuveiClient.test.js` and `src/lib/security.test.js`. No live network calls in the automated test suite.
- Reuse `src/lib/security.js`'s `timingSafeEqual`, `escapeHtml`, `createRateLimiter`, `redactErrorDetails` — do not reimplement.
- Card data collected in the iframe checkout page is submitted to this app's own backend, never to GHL — GHL only receives `chargeId`/success-or-failure, matching the spec.
- OAuth Client ID/Secret and the marketplace app's Redirect URL come from the user — do not fabricate placeholder values and do not proceed past Task 3's live-call steps without them.

---

### Task 1: Provider config secrets + apiKey store

**Files:**
- Create: `src/services/ghlProviderConfig.js`
- Test: `src/services/ghlProviderConfig.test.js`

**Interfaces:**
- Produces: `generateProviderSecrets()` → `{ live: { apiKey, publishableKey }, test: { apiKey, publishableKey } }`; `verifyApiKey(suppliedKey, mode)` → `boolean`, where `mode` is `'live'` or `'test'`; reads expected keys from `process.env.GHL_PROVIDER_LIVE_API_KEY` / `GHL_PROVIDER_LIVE_PUBLISHABLE_KEY` / `GHL_PROVIDER_TEST_API_KEY` / `GHL_PROVIDER_TEST_PUBLISHABLE_KEY`.

- [ ] **Step 1: Write the failing test**

```js
// src/services/ghlProviderConfig.test.js
const { generateProviderSecrets, verifyApiKey } = require('./ghlProviderConfig');

describe('generateProviderSecrets', () => {
  test('returns distinct 64-char hex apiKey and publishableKey for both live and test modes', () => {
    const secrets = generateProviderSecrets();
    for (const mode of ['live', 'test']) {
      expect(secrets[mode].apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(secrets[mode].publishableKey).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(secrets.live.apiKey).not.toBe(secrets.test.apiKey);
    expect(secrets.live.apiKey).not.toBe(secrets.live.publishableKey);
  });
});

describe('verifyApiKey', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, GHL_PROVIDER_LIVE_API_KEY: 'live-key-abc', GHL_PROVIDER_TEST_API_KEY: 'test-key-xyz' };
  });
  afterEach(() => { process.env = OLD_ENV; });

  test('true when the supplied key matches the configured key for that mode', () => {
    expect(verifyApiKey('live-key-abc', 'live')).toBe(true);
    expect(verifyApiKey('test-key-xyz', 'test')).toBe(true);
  });

  test('false on mismatch, wrong mode, or missing configuration, without throwing', () => {
    expect(verifyApiKey('wrong', 'live')).toBe(false);
    expect(verifyApiKey('live-key-abc', 'test')).toBe(false);
    expect(verifyApiKey(undefined, 'live')).toBe(false);
    expect(verifyApiKey('anything', 'nonexistent-mode')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/jest src/services/ghlProviderConfig.test.js`
Expected: FAIL — `Cannot find module './ghlProviderConfig'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/ghlProviderConfig.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/jest src/services/ghlProviderConfig.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/ghlProviderConfig.js src/services/ghlProviderConfig.test.js
git commit -m "feat: add GHL provider apiKey generation and verification"
```

---

### Task 2: OAuth token store

**Files:**
- Create: `src/services/ghlTokenStore.js`
- Test: `src/services/ghlTokenStore.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `saveTokens({ locationId, accessToken, refreshToken, expiresAt })`, `getTokens(locationId)` → `{ accessToken, refreshToken, expiresAt } | null`, `isExpired(tokens)` → `boolean` (true if `Date.now() >= tokens.expiresAt - 60000`, i.e. treats a token as expired 60s before its real expiry to leave margin for in-flight requests). Task 3 (`ghlOAuthClient`) consumes all three.

- [ ] **Step 1: Write the failing test**

```js
// src/services/ghlTokenStore.test.js
const { saveTokens, getTokens, isExpired } = require('./ghlTokenStore');

describe('ghlTokenStore', () => {
  test('saveTokens then getTokens round-trips for a given locationId', () => {
    saveTokens({ locationId: 'loc-1', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 3600000 });
    const tokens = getTokens('loc-1');
    expect(tokens.accessToken).toBe('a1');
    expect(tokens.refreshToken).toBe('r1');
  });

  test('getTokens returns null for an unknown locationId', () => {
    expect(getTokens('never-saved')).toBeNull();
  });

  test('saving again for the same locationId overwrites the prior value', () => {
    saveTokens({ locationId: 'loc-2', accessToken: 'first', refreshToken: 'r', expiresAt: Date.now() + 1000 });
    saveTokens({ locationId: 'loc-2', accessToken: 'second', refreshToken: 'r', expiresAt: Date.now() + 1000 });
    expect(getTokens('loc-2').accessToken).toBe('second');
  });
});

describe('isExpired', () => {
  test('true once within 60s of expiresAt or past it', () => {
    expect(isExpired({ expiresAt: Date.now() - 1 })).toBe(true);
    expect(isExpired({ expiresAt: Date.now() + 30000 })).toBe(true);
  });

  test('false when comfortably before expiresAt', () => {
    expect(isExpired({ expiresAt: Date.now() + 3600000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/jest src/services/ghlTokenStore.test.js`
Expected: FAIL — `Cannot find module './ghlTokenStore'`

- [ ] **Step 3: Write minimal implementation**

In-memory store only for Phase 1 — Railway's filesystem is ephemeral across deploys/restarts, so tokens will need re-authorization after every deploy until a real persistence layer (e.g. a database) exists. This is a known, documented Phase 1 limitation, not an oversight — flag it to the user rather than silently building a file-based store that would give false confidence.

```js
// src/services/ghlTokenStore.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/jest src/services/ghlTokenStore.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/ghlTokenStore.js src/services/ghlTokenStore.test.js
git commit -m "feat: add in-memory GHL OAuth token store (Phase 1 — no persistence across restarts yet)"
```

---

### Task 3: OAuth token exchange client

**Files:**
- Create: `src/services/ghlOAuthClient.js`
- Test: `src/services/ghlOAuthClient.test.js`

**Interfaces:**
- Consumes: `saveTokens`, `getTokens`, `isExpired` from `src/services/ghlTokenStore.js` (Task 2).
- Produces: `exchangeCodeForTokens(code)` → `Promise<{accessToken, refreshToken, locationId}>` (also saves via `saveTokens`); `refreshAccessToken(locationId)` → `Promise<string>` (returns fresh access token, refreshes+saves if needed, throws `{statusCode, message}` if no stored tokens or refresh fails); `getValidAccessToken(locationId)` → `Promise<string>` (returns cached token if not expired, otherwise calls `refreshAccessToken`). Task 4 (`oauth.js` route) calls `exchangeCodeForTokens`. Task 5 (`ghlProviderConfig` registration call) and Task 6 (`ghlProvider.js` route) call `getValidAccessToken`.

- [ ] **Step 1: Write the failing test**

```js
// src/services/ghlOAuthClient.test.js
jest.mock('axios');
const axios = require('axios');
const tokenStore = require('./ghlTokenStore');
const { exchangeCodeForTokens, refreshAccessToken, getValidAccessToken } = require('./ghlOAuthClient');

const config = { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'https://example.com/oauth/callback' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GHL_MARKETPLACE_CLIENT_ID = config.clientId;
  process.env.GHL_MARKETPLACE_CLIENT_SECRET = config.clientSecret;
  process.env.GHL_OAUTH_REDIRECT_URI = config.redirectUri;
});

describe('exchangeCodeForTokens', () => {
  test('posts grant_type=authorization_code with the code, and saves the returned tokens', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, locationId: 'loc-9' }
    });

    const result = await exchangeCodeForTokens('the-code');

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/oauth/token');
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('client_id')).toBe('client-1');
    expect(params.get('user_type')).toBe('Location');

    expect(result.accessToken).toBe('a1');
    expect(tokenStore.getTokens('loc-9').accessToken).toBe('a1');
  });
});

describe('getValidAccessToken', () => {
  test('returns the stored token directly when not expired', async () => {
    tokenStore.saveTokens({ locationId: 'loc-fresh', accessToken: 'still-good', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
    const token = await getValidAccessToken('loc-fresh');
    expect(token).toBe('still-good');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('refreshes when the stored token is expired', async () => {
    tokenStore.saveTokens({ locationId: 'loc-stale', accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000 });
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 }
    });

    const token = await getValidAccessToken('loc-stale');

    expect(token).toBe('new-token');
    const params = new URLSearchParams(axios.post.mock.calls[0][1]);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('r-old');
  });

  test('throws a clean 401 when there are no stored tokens for that location', async () => {
    await expect(getValidAccessToken('never-authorized')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('refreshAccessToken', () => {
  test('throws a clean error when the store has no tokens to refresh', async () => {
    await expect(refreshAccessToken('unknown-location')).rejects.toMatchObject({ statusCode: 401 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/jest src/services/ghlOAuthClient.test.js`
Expected: FAIL — `Cannot find module './ghlOAuthClient'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/ghlOAuthClient.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/jest src/services/ghlOAuthClient.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/ghlOAuthClient.js src/services/ghlOAuthClient.test.js
git commit -m "feat: add GHL OAuth token exchange/refresh client"
```

---

### Task 4: OAuth callback route

**Files:**
- Create: `src/routes/oauth.js`
- Modify: `src/server.js` (mount the new router)
- Test: manual (see Step 4 below — no automated test; this route's only job is delegating to the already-unit-tested `ghlOAuthClient`, and exercising it requires a real GHL install redirect, which cannot be simulated meaningfully in Jest without re-testing Task 3's mocks)

**Interfaces:**
- Consumes: `exchangeCodeForTokens` from `src/services/ghlOAuthClient.js` (Task 3).
- Produces: `GET /oauth/callback` — this is the URL to configure as the Marketplace App's Redirect URL.

- [ ] **Step 1: Write the route**

```js
// src/routes/oauth.js
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
```

- [ ] **Step 2: Mount it in server.js**

In `src/server.js`, alongside the existing route mounts:

```js
const oauthRoutes = require('./routes/oauth');
// ...
app.use('/oauth', oauthRoutes);
```

- [ ] **Step 3: Run the existing full test suite to confirm nothing broke**

Run: `node_modules/.bin/jest`
Expected: PASS, all existing tests plus Tasks 1–3's new tests

- [ ] **Step 4: Manual verification (needs Client ID/Secret + Redirect URL from the user first — see plan header)**

This step cannot run until the user provides the Marketplace App's real Client ID/Secret and confirms/sets its Redirect URL to point at this deployment's `/oauth/callback`. Once available:
1. Set `GHL_MARKETPLACE_CLIENT_ID`, `GHL_MARKETPLACE_CLIENT_SECRET`, `GHL_OAUTH_REDIRECT_URI` in `.env` and on Railway.
2. From the GHL Marketplace App's install link (or the app's listing page), install it on the AMWELL USA location.
3. Confirm the browser lands on the "App installed successfully" page, and `[GHL OAuth] Installed for location RbHDcK8ndpcPpcny4nga` appears in server logs.

- [ ] **Step 5: Commit**

```bash
git add src/routes/oauth.js src/server.js
git commit -m "feat: add GHL OAuth callback route"
```

---

### Task 5: Provider registration call

**Files:**
- Modify: `src/services/ghlProviderConfig.js` (add the registration function)
- Test: Modify `src/services/ghlProviderConfig.test.js`

**Interfaces:**
- Consumes: `getValidAccessToken` from `src/services/ghlOAuthClient.js` (Task 3); `generateProviderSecrets` (Task 1, already in this file).
- Produces: `registerProvider({ locationId, paymentsUrl, queryUrl, imageUrl, name, description })` → `Promise<object>` (the connect API's response body). Task 4's manual step and a one-off registration script (Step 4 below) call this.

- [ ] **Step 1: Write the failing test**

Add to `src/services/ghlProviderConfig.test.js`:

```js
jest.mock('axios');
jest.mock('./ghlOAuthClient');
const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');
const { registerProvider } = require('./ghlProviderConfig');

describe('registerProvider', () => {
  afterEach(() => jest.clearAllMocks());

  test('posts to the connect endpoint with a bearer token and v3 version header', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.post.mockResolvedValueOnce({ data: { _id: 'provider-1', locationId: 'loc-1' } });

    const result = await registerProvider({
      locationId: 'loc-1',
      paymentsUrl: 'https://example.com/ghl-provider/checkout',
      queryUrl: 'https://example.com/ghl-provider/query',
      imageUrl: 'https://example.com/logo.png',
      name: 'NUVEI-Payments',
      description: 'AMWELL USA payment processing'
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/payments/custom-provider/connect?locationId=loc-1');
    expect(body.paymentsUrl).toBe('https://example.com/ghl-provider/checkout');
    expect(body.queryUrl).toBe('https://example.com/ghl-provider/query');
    expect(body.live.apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.test.apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(options.headers.Authorization).toBe('Bearer bearer-token-123');
    expect(options.headers.Version).toBe('v3');

    expect(result).toEqual({ _id: 'provider-1', locationId: 'loc-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/jest src/services/ghlProviderConfig.test.js`
Expected: FAIL — `registerProvider is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/services/ghlProviderConfig.js`:

```js
const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/jest src/services/ghlProviderConfig.test.js`
Expected: PASS

- [ ] **Step 5: One-off registration script + manual run (needs Task 4's OAuth install completed first)**

Create `scripts/register-ghl-provider.js`:

```js
require('dotenv').config();
const { registerProvider } = require('../src/services/ghlProviderConfig');

registerProvider({
  locationId: process.env.GHL_LOCATION_ID,
  paymentsUrl: `${process.env.APP_URL}/ghl-provider/checkout`,
  queryUrl: `${process.env.APP_URL}/ghl-provider/query`,
  imageUrl: `${process.env.APP_URL}/static/nuvei-logo.png`,
  name: 'NUVEI-Payments',
  description: 'AMWELL USA payment processing'
}).then((r) => {
  console.log('Registered:', JSON.stringify(r, null, 2));
  process.exit(0);
}).catch((e) => {
  console.error('Registration failed:', e);
  process.exit(1);
});
```

Run once, manually, after OAuth install: `node scripts/register-ghl-provider.js`. Copy the printed `GHL_PROVIDER_*_API_KEY`/`GHL_PROVIDER_*_PUBLISHABLE_KEY` values into `.env` and Railway — they are generated fresh each run and not retrievable from GHL afterward, so re-running this script rotates them (only do so intentionally).

- [ ] **Step 6: Commit**

```bash
git add src/services/ghlProviderConfig.js src/services/ghlProviderConfig.test.js scripts/register-ghl-provider.js
git commit -m "feat: add GHL custom provider registration call and one-off setup script"
```

---

### Task 6: Checkout iframe page + queryUrl + charge endpoint

**Files:**
- Create: `src/routes/ghlProvider.js`
- Modify: `src/server.js` (mount the new router)
- Test: `src/routes/ghlProvider.test.js`

**Interfaces:**
- Consumes: `verifyApiKey` (Task 1), `NuveiClient.createPayment` (existing, unchanged), `escapeHtml`/`createRateLimiter`/`redactErrorDetails` from `src/lib/security.js` (existing).
- Produces: `GET /ghl-provider/checkout` (the `paymentsUrl`), `POST /ghl-provider/charge` (called by the iframe's own JS, not by GHL), `POST /ghl-provider/query` (the `queryUrl`).

- [ ] **Step 1: Write the failing tests**

```js
// src/routes/ghlProvider.test.js
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

jest.mock('../services/ghlProviderConfig', () => ({ verifyApiKey: jest.fn() }));
jest.mock('../services/nuveiClient');

const { verifyApiKey } = require('../services/ghlProviderConfig');
const NuveiClient = require('../services/nuveiClient');
const ghlProviderRoutes = require('./ghlProvider');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use('/ghl-provider', ghlProviderRoutes);
  return app;
}

describe('GET /ghl-provider/checkout', () => {
  test('serves an HTML page containing the postMessage ready handshake', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.status).toBe(200);
    expect(res.text).toContain('custom_provider_ready');
    expect(res.text).toContain('payment_initiate_props');
  });
});

describe('POST /ghl-provider/query', () => {
  test('type=verify returns {success:true} when the apiKey matches and a charge with that id is known', async () => {
    verifyApiKey.mockReturnValue(true);
    const app = buildApp();

    // First, create a charge via /charge so the query route has something to verify against.
    NuveiClient.mockImplementation(() => ({
      createPayment: jest.fn().mockResolvedValue({ transactionId: 'txn-1', status: 'CAPTURED' })
    }));
    const chargeRes = await request(app).post('/ghl-provider/charge').send({
      mode: 'test', amount: 10, firstName: 'A', lastName: 'B',
      ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });
    expect(chargeRes.status).toBe(200);
    const { chargeId } = chargeRes.body;

    const res = await request(app).post('/ghl-provider/query').send({
      type: 'verify', transactionId: 'ghl-txn-1', apiKey: 'whatever-verifyApiKey-mock-accepts', chargeId
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('rejects with 401 when apiKey does not verify', async () => {
    verifyApiKey.mockReturnValue(false);
    const res = await request(buildApp()).post('/ghl-provider/query').send({ type: 'verify', apiKey: 'bad', chargeId: 'x' });
    expect(res.status).toBe(401);
  });

  test('type=verify for an unknown chargeId returns {success:false} (pending/unrecognized), not an error', async () => {
    verifyApiKey.mockReturnValue(true);
    const res = await request(buildApp()).post('/ghl-provider/query').send({ type: 'verify', apiKey: 'ok', chargeId: 'never-created' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false });
  });

  test('an out-of-scope type (e.g. charge_payment) is cleanly rejected with 501, not silently mishandled', async () => {
    verifyApiKey.mockReturnValue(true);
    const res = await request(buildApp()).post('/ghl-provider/query').send({ type: 'charge_payment', apiKey: 'ok' });
    expect(res.status).toBe(501);
  });
});

describe('POST /ghl-provider/charge', () => {
  test('runs a real BaseCommerce sale via NuveiClient and returns a chargeId on success', async () => {
    const createPayment = jest.fn().mockResolvedValue({ transactionId: 'txn-42', status: 'CAPTURED' });
    NuveiClient.mockImplementation(() => ({ createPayment }));

    const res = await request(buildApp()).post('/ghl-provider/charge').send({
      mode: 'test', amount: 25, firstName: 'Jane', lastName: 'Doe',
      ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(res.body.chargeId).toEqual(expect.any(String));
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 25, ccNumber: '4111111111111111' }));
  });

  test('returns a 402 with a clean error message when NuveiClient rejects (decline)', async () => {
    const createPayment = jest.fn().mockRejectedValue({ statusCode: 402, message: 'No such Issuer' });
    NuveiClient.mockImplementation(() => ({ createPayment }));

    const res = await request(buildApp()).post('/ghl-provider/charge').send({
      mode: 'test', amount: 25, firstName: 'Jane', lastName: 'Doe',
      ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('No such Issuer');
  });
});
```

This introduces `supertest` as a new dev dependency (not currently in `package.json`) for exercising the routes without a live server — install it in Step 2.

- [ ] **Step 2: Install supertest and run test to verify it fails**

```bash
npm install --save-dev supertest
node_modules/.bin/jest src/routes/ghlProvider.test.js
```

Expected: FAIL — `Cannot find module './ghlProvider'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/routes/ghlProvider.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const NuveiClient = require('../services/nuveiClient');
const { verifyApiKey } = require('../services/ghlProviderConfig');
const { escapeHtml, createRateLimiter, redactErrorDetails } = require('../lib/security');

const chargeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

// Phase 1: in-memory charge record so /query can verify what /charge created.
// Same ephemeral-across-restarts caveat as the OAuth token store (Task 2).
const charges = new Map();

function nuveiConfigForMode(mode) {
  const production = mode !== 'test';
  return {
    username: process.env.NUVEI_SDK_USERNAME,
    password: process.env.NUVEI_SDK_PASSWORD,
    securityKey: process.env.NUVEI_SDK_KEY,
    production
  };
}

router.get('/checkout', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Secure Payment</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
    label{display:block;font-size:13px;font-weight:600;margin-top:12px}
    input{width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;margin-top:4px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    button{width:100%;margin-top:20px;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:15px}
    button:disabled{background:#a78bfa}
  </style>
</head>
<body>
  <div id="summary"></div>
  <form id="pf">
    <label>Cardholder Name</label><input id="cardName" required/>
    <label>Card Number</label><input id="ccNumber" required inputmode="numeric" maxlength="19"/>
    <div class="row">
      <div><label>Expiry Month</label><input id="ccExpMonth" required inputmode="numeric" maxlength="2"/></div>
      <div><label>Expiry Year</label><input id="ccExpYear" required inputmode="numeric" maxlength="4"/></div>
    </div>
    <label>CVV</label><input id="ccCvv" required inputmode="numeric" maxlength="4"/>
    <button type="submit" id="pb">Pay</button>
  </form>
  <script>
    let paymentProps = null;

    window.addEventListener('message', function (event) {
      const data = event.data || {};
      if (data.type === 'payment_initiate_props') {
        paymentProps = data;
        document.getElementById('summary').textContent = data.currency + ' ' + data.amount;
      }
    });

    window.parent.postMessage({ type: 'custom_provider_ready', loaded: true }, '*');

    document.getElementById('pf').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!paymentProps) return;
      document.getElementById('pb').disabled = true;

      const nameParts = document.getElementById('cardName').value.trim().split(' ');
      try {
        const res = await fetch('/ghl-provider/charge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: paymentProps.mode === 'live' ? 'live' : 'test',
            amount: paymentProps.amount,
            firstName: nameParts[0] || 'Customer',
            lastName: nameParts.slice(1).join(' ') || 'N/A',
            ccNumber: document.getElementById('ccNumber').value.replace(/\\s/g, ''),
            ccExpMonth: document.getElementById('ccExpMonth').value,
            ccExpYear: document.getElementById('ccExpYear').value,
            ccCvv: document.getElementById('ccCvv').value
          })
        });
        const body = await res.json();
        if (res.ok) {
          window.parent.postMessage({ type: 'custom_element_success_response', chargeId: body.chargeId }, '*');
        } else {
          window.parent.postMessage({ type: 'custom_element_error_response', error: { description: body.error || 'Payment failed' } }, '*');
          document.getElementById('pb').disabled = false;
        }
      } catch (err) {
        window.parent.postMessage({ type: 'custom_element_error_response', error: { description: 'Network error' } }, '*');
        document.getElementById('pb').disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

router.post('/charge', chargeRateLimiter, async (req, res) => {
  const { mode, amount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv } = req.body;

  if (!amount || !ccNumber || !ccExpMonth || !ccExpYear || !ccCvv) {
    return res.status(400).json({ error: 'Missing required payment fields' });
  }

  const nuvei = new NuveiClient(nuveiConfigForMode(mode));

  try {
    const result = await nuvei.createPayment({ amount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv });
    const chargeId = crypto.randomUUID();
    charges.set(chargeId, { status: 'success', transactionId: result.transactionId, createdAt: Date.now() });
    res.status(200).json({ chargeId });
  } catch (error) {
    console.error('[GHL Provider Charge] Failed:', error.message, redactErrorDetails(error.details));
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/query', (req, res) => {
  const { type, apiKey, chargeId } = req.body;
  const mode = verifyApiKey(apiKey, 'live') ? 'live' : verifyApiKey(apiKey, 'test') ? 'test' : null;

  if (!mode) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (type !== 'verify') {
    return res.status(501).json({ error: `queryUrl type "${type}" is not implemented in Phase 1` });
  }

  const charge = charges.get(chargeId);
  if (charge && charge.status === 'success') {
    return res.status(200).json({ success: true });
  }
  return res.status(200).json({ success: false });
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/jest src/routes/ghlProvider.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Mount the router in server.js**

In `src/server.js`:

```js
const ghlProviderRoutes = require('./routes/ghlProvider');
// ...
app.use('/ghl-provider', ghlProviderRoutes);
```

- [ ] **Step 6: Run the full suite**

Run: `node_modules/.bin/jest`
Expected: PASS, all tests across all files

- [ ] **Step 7: Commit**

```bash
git add src/routes/ghlProvider.js src/routes/ghlProvider.test.js src/server.js package.json package-lock.json
git commit -m "feat: add GHL checkout iframe page, charge endpoint, and queryUrl verify handler"
```

---

### Task 7: Remove the old spec-mismatched checkout routes

**Files:**
- Modify: `src/routes/ghl.js` — remove the entire "GHL Custom Payment Provider endpoints" section (`checkoutSessions` Map, `cleanExpiredSessions`, `verifyProviderAuth`, `ALLOWED_REDIRECT_ORIGINS`, the `/checkout`, `/query/:transactionId`, `/pay/:sessionId`, `/pay/:sessionId/process` routes) — none of this corresponds to anything in GHL's real contract (see spec doc) and leaving it in place is actively misleading.
- Modify: `src/server.js` — remove the `app.use('/', ghlRoutes)` and `app.use('/api', ghlRoutes)` mounts that only existed to expose the now-removed `/checkout`, `/query`, `/pay/*` paths; keep `app.use('/api/ghl', ghlRoutes)` for the contacts/notes endpoints that remain in `ghl.js`.
- Modify: `.env`, `.env.example` — remove `PAYMENT_PROVIDER_SHARED_SECRET` (the invented mechanism this replaces).
- Test: existing `src/services/nuveiClient.test.js` and `src/lib/security.test.js` must still pass unchanged (they don't touch these routes).

- [ ] **Step 1: Remove the routes**

Delete from `src/routes/ghl.js`: the `checkoutSessions`/`cleanExpiredSessions`/`setInterval` block, `ALLOWED_REDIRECT_ORIGINS`, `verifyProviderAuth`, `paymentRateLimiter` (if now unused elsewhere in the file — check first, `/payment/create` and `/payment/refund` still use it, so keep it, just drop the routes that used `verifyProviderAuth`), and the `// ─── GHL Custom Payment Provider endpoints ───` section through the end of the file (`/checkout`, `/query/:transactionId`, `/pay/:sessionId`, `/pay/:sessionId/process`).

- [ ] **Step 2: Update server.js mounts**

```js
// Before:
app.use('/api', ghlRoutes);  // → /api/checkout, /api/query, /api/webhook
app.use('/', ghlRoutes);     // → /pay/:sessionId, /pay/:sessionId/process
// After: both lines removed — ghlRoutes only needs the /api/ghl mount.
```

- [ ] **Step 3: Remove PAYMENT_PROVIDER_SHARED_SECRET references**

Remove the `PAYMENT_PROVIDER_SHARED_SECRET` block from `.env` and `.env.example`.

- [ ] **Step 4: Run the full suite and boot the server**

```bash
node_modules/.bin/jest
(node src/server.js &) && sleep 1.5 && curl -s http://localhost:3000/api/health && curl -s http://localhost:3000/ghl-provider/checkout | head -5; pkill -f "node src/server.js"
```

Expected: all tests pass; health check 200; `/ghl-provider/checkout` returns the iframe HTML.

- [ ] **Step 5: Commit**

```bash
git add src/routes/ghl.js src/server.js .env.example
git commit -m "refactor: remove spec-mismatched checkout routes, replaced by /ghl-provider/*"
```

(`.env` is gitignored — edit it locally but it won't be part of this commit; update the same variables on Railway via `railway variable delete PAYMENT_PROVIDER_SHARED_SECRET`.)

---

## After Task 7

Phase 1 is code-complete and unit-tested, but **cannot be verified against real GHL traffic until**:
1. The user provides the Marketplace App's Client ID/Secret and confirms its Redirect URL (blocks Task 4 Step 4, Task 5 Step 5).
2. `APP_URL`, `GHL_MARKETPLACE_CLIENT_ID`, `GHL_MARKETPLACE_CLIENT_SECRET`, `GHL_OAUTH_REDIRECT_URI` are set on Railway and the app is deployed.
3. OAuth install is completed once (Task 4 Step 4), then `scripts/register-ghl-provider.js` is run once (Task 5 Step 5) to register the provider and obtain `GHL_PROVIDER_*_API_KEY`/`GHL_PROVIDER_*_PUBLISHABLE_KEY`, which then get set on Railway too and the app redeployed again.
4. A real test transaction is initiated from inside GHL's UI (a test invoice/funnel checkout using this payment provider) to confirm the iframe loads, the charge posts, and `queryUrl` verification succeeds — this is the step that finally proves the whole chain end-to-end, the same way the BaseCommerce protocol was proven by one real test transaction rather than assumed correct from reading docs alone.
