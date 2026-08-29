const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

jest.mock('../services/ghlProviderConfig', () => ({ verifyApiKey: jest.fn() }));
jest.mock('../services/nuveiClient');

// Re-required fresh per test (see beforeEach) so each test gets its own
// charges Map and its own rate-limiter window instead of sharing module state.
let verifyApiKey;
let NuveiClient;
let ghlProviderRoutes;

const LIVE_PUB_KEY = 'live-pub-key';
const TEST_PUB_KEY = 'test-pub-key';

const ENV_KEYS = [
  'GHL_PROVIDER_LIVE_PUBLISHABLE_KEY',
  'GHL_PROVIDER_TEST_PUBLISHABLE_KEY',
  'NUVEI_SANDBOX_MODE',
  'NUVEI_SDK_USERNAME',
  'NUVEI_SDK_PASSWORD',
  'NUVEI_SDK_KEY',
  'NUVEI_SDK_USERNAME_TEST',
  'NUVEI_SDK_PASSWORD_TEST',
  'NUVEI_SDK_KEY_TEST'
];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  process.env.GHL_PROVIDER_LIVE_PUBLISHABLE_KEY = LIVE_PUB_KEY;
  process.env.GHL_PROVIDER_TEST_PUBLISHABLE_KEY = TEST_PUB_KEY;
  delete process.env.NUVEI_SANDBOX_MODE;

  process.env.NUVEI_SDK_USERNAME = 'live-user';
  process.env.NUVEI_SDK_PASSWORD = 'live-pass';
  process.env.NUVEI_SDK_KEY = 'live-key';
  process.env.NUVEI_SDK_USERNAME_TEST = 'test-user';
  process.env.NUVEI_SDK_PASSWORD_TEST = 'test-pass';
  process.env.NUVEI_SDK_KEY_TEST = 'test-key';

  jest.resetModules();
  verifyApiKey = require('../services/ghlProviderConfig').verifyApiKey;
  NuveiClient = require('../services/nuveiClient');
  ghlProviderRoutes = require('./ghlProvider');
  NuveiClient.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use('/ghl-provider', ghlProviderRoutes);
  return app;
}

function cardPayload(overrides = {}) {
  return {
    publishableKey: TEST_PUB_KEY,
    transactionId: 'ghl-txn-1',
    amount: 25,
    firstName: 'Jane',
    lastName: 'Doe',
    ccNumber: '4111111111111111',
    ccExpMonth: '12',
    ccExpYear: '2027',
    ccCvv: '123',
    ...overrides
  };
}

function mockSuccessfulSale(transactionId = 'txn-1') {
  const createPayment = jest.fn().mockResolvedValue({ transactionId, status: 'CAPTURED' });
  NuveiClient.mockImplementation(() => ({ createPayment }));
  return createPayment;
}

describe('GET /ghl-provider/checkout', () => {
  test('serves an HTML page containing the postMessage ready handshake', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.status).toBe(200);
    expect(res.text).toContain('custom_provider_ready');
    expect(res.text).toContain('payment_initiate_props');
  });

  test('sets a CSP that lets GHL frame the page but blocks every other embedder', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('frame-ancestors https://*.gohighlevel.com https://*.leadconnectorhq.com');
    expect(csp).toContain("default-src 'self'");
    // X-Frame-Options cannot express a multi-origin allowlist and would
    // conflict with frame-ancestors, so it must NOT be set here.
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  test('forwards the GHL publishableKey and transactionId to /charge instead of a client-asserted mode', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('publishableKey: paymentProps.publishableKey');
    expect(res.text).toContain('transactionId: paymentProps.transactionId');
    // The old (broken) live/test signal must be gone: GHL's `mode` is
    // "payment", not "live"/"test".
    expect(res.text).not.toContain("paymentProps.mode === 'live'");
  });
});

describe('POST /ghl-provider/query', () => {
  test('type=verify returns {success:true} when the apiKey matches and a charge with that id and transactionId is known', async () => {
    verifyApiKey.mockReturnValue(true);
    const app = buildApp();

    // First, create a charge via /charge so the query route has something to verify against.
    mockSuccessfulSale();
    const chargeRes = await request(app)
      .post('/ghl-provider/charge')
      .send(cardPayload({ transactionId: 'ghl-txn-1', amount: 10 }));
    expect(chargeRes.status).toBe(200);
    const { chargeId } = chargeRes.body;

    const res = await request(app).post('/ghl-provider/query').send({
      type: 'verify', transactionId: 'ghl-txn-1', apiKey: 'whatever-verifyApiKey-mock-accepts', chargeId
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('type=verify returns {success:false} when the chargeId is real but the transactionId does not match it', async () => {
    verifyApiKey.mockReturnValue(true);
    const app = buildApp();

    mockSuccessfulSale();
    const chargeRes = await request(app)
      .post('/ghl-provider/charge')
      .send(cardPayload({ transactionId: 'attacker-own-txn', amount: 0.01 }));
    expect(chargeRes.status).toBe(200);
    const { chargeId } = chargeRes.body;

    // The order-substitution attack: a cheap charge the attacker really made,
    // replayed as the success response for a different, larger GHL transaction.
    const res = await request(app).post('/ghl-provider/query').send({
      type: 'verify', transactionId: 'victims-large-order-txn', apiKey: 'ok', chargeId
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false });
  });

  test('a verify with no transactionId at all does not confirm a charge', async () => {
    verifyApiKey.mockReturnValue(true);
    const app = buildApp();

    mockSuccessfulSale();
    const chargeRes = await request(app).post('/ghl-provider/charge').send(cardPayload());
    const { chargeId } = chargeRes.body;

    const res = await request(app).post('/ghl-provider/query').send({ type: 'verify', apiKey: 'ok', chargeId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false });
  });

  test('rejects with 401 when apiKey does not verify', async () => {
    verifyApiKey.mockReturnValue(false);
    const res = await request(buildApp()).post('/ghl-provider/query').send({ type: 'verify', apiKey: 'bad', chargeId: 'x' });
    expect(res.status).toBe(401);
  });

  test('type=verify for an unknown chargeId returns {success:false} (pending/unrecognized), not an error', async () => {
    verifyApiKey.mockReturnValue(true);
    const res = await request(buildApp()).post('/ghl-provider/query').send({
      type: 'verify', apiKey: 'ok', chargeId: 'never-created', transactionId: 'ghl-txn-1'
    });
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
    const createPayment = mockSuccessfulSale('txn-42');

    const res = await request(buildApp()).post('/ghl-provider/charge').send(cardPayload());

    expect(res.status).toBe(200);
    expect(res.body.chargeId).toEqual(expect.any(String));
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 25, ccNumber: '4111111111111111' }));
  });

  test('returns a 402 with a clean error message when NuveiClient rejects (decline)', async () => {
    const createPayment = jest.fn().mockRejectedValue({ statusCode: 402, message: 'No such Issuer' });
    NuveiClient.mockImplementation(() => ({ createPayment }));

    const res = await request(buildApp()).post('/ghl-provider/charge').send(cardPayload());

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('No such Issuer');
  });

  test('returns 400 when transactionId is missing, without touching the gateway', async () => {
    const createPayment = mockSuccessfulSale();

    const payload = cardPayload();
    delete payload.transactionId;
    const res = await request(buildApp()).post('/ghl-provider/charge').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/transactionId/);
    expect(createPayment).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -5],
    ['non-numeric', 'not-a-number']
  ])('returns 400 when amount is %s', async (_label, amount) => {
    const createPayment = mockSuccessfulSale('txn-x');

    const payload = cardPayload();
    if (amount === undefined) delete payload.amount;
    else payload.amount = amount;

    const res = await request(buildApp()).post('/ghl-provider/charge').send(payload);

    expect(res.status).toBe(400);
    expect(createPayment).not.toHaveBeenCalled();
  });

  describe('mode resolution from the GHL publishableKey', () => {
    test('the test publishableKey selects the sandbox host and the _TEST credential set', async () => {
      mockSuccessfulSale('txn-test');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: TEST_PUB_KEY }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith({
        username: 'test-user', password: 'test-pass', securityKey: 'test-key', production: false
      });
    });

    test('the live publishableKey selects production and the live credential set', async () => {
      mockSuccessfulSale('txn-live');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: LIVE_PUB_KEY }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith({
        username: 'live-user', password: 'live-pass', securityKey: 'live-key', production: true
      });
    });

    test('an unrecognised publishableKey fails closed to the sandbox, not production', async () => {
      mockSuccessfulSale('txn-unknown');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: 'totally-bogus-key' }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: false, username: 'test-user' }));
    });

    test('a missing publishableKey fails closed to the sandbox', async () => {
      mockSuccessfulSale('txn-nokey');

      const payload = cardPayload();
      delete payload.publishableKey;
      const res = await request(buildApp()).post('/ghl-provider/charge').send(payload);

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: false }));
    });

    test('a client-asserted mode field is ignored — only the publishableKey decides', async () => {
      mockSuccessfulSale('txn-spoof');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: TEST_PUB_KEY, mode: 'live' }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: false }));
    });

    test('GHL\'s literal mode:"payment" does not route anywhere near production', async () => {
      mockSuccessfulSale('txn-payment-mode');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: TEST_PUB_KEY, mode: 'payment' }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: false }));
    });

    test('NUVEI_SANDBOX_MODE=true overrides even a valid live publishableKey', async () => {
      process.env.NUVEI_SANDBOX_MODE = 'true';
      mockSuccessfulSale('txn-override');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: LIVE_PUB_KEY }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: false, username: 'test-user' }));
    });

    test('NUVEI_SANDBOX_MODE=false leaves the live publishableKey routing to production', async () => {
      process.env.NUVEI_SANDBOX_MODE = 'false';
      mockSuccessfulSale('txn-nooverride');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: LIVE_PUB_KEY }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: true }));
    });

    test('an unset GHL_PROVIDER_LIVE_PUBLISHABLE_KEY cannot be matched by an empty supplied key', async () => {
      delete process.env.GHL_PROVIDER_LIVE_PUBLISHABLE_KEY;
      mockSuccessfulSale('txn-unset');

      const res = await request(buildApp())
        .post('/ghl-provider/charge')
        .send(cardPayload({ publishableKey: '' }));

      expect(res.status).toBe(200);
      expect(NuveiClient).toHaveBeenCalledWith(expect.objectContaining({ production: false }));
    });
  });

  test('the resolved mode is recorded on the charge so /query and logs can report it', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockSuccessfulSale('gateway-txn-77');

    const res = await request(buildApp())
      .post('/ghl-provider/charge')
      .send(cardPayload({ publishableKey: LIVE_PUB_KEY, transactionId: 'ghl-txn-log', orderId: 'ord-9', locationId: 'loc-9' }));

    expect(res.status).toBe(200);
    const line = logSpy.mock.calls.map((args) => args.join(' ')).find((l) => l.includes('[GHL Provider Charge]'));
    expect(line).toContain('transactionId=ghl-txn-log');
    expect(line).toContain(`chargeId=${res.body.chargeId}`);
    expect(line).toContain('gatewayTransactionId=gateway-txn-77');
    expect(line).toContain('amount=25');
    expect(line).toContain('mode=live');
    expect(line).toContain('orderId=ord-9');
    logSpy.mockRestore();
  });
});
