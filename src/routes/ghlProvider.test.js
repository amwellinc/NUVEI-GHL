const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

jest.mock('../services/ghlProviderConfig', () => ({ verifyApiKey: jest.fn() }));
jest.mock('../services/nuveiClient');
jest.mock('../services/ghlTransactionsClient', () => ({ getTransactionAmount: jest.fn() }));
jest.mock('../services/stripeClient', () => ({
  createPaymentIntent: jest.fn(),
  retrievePaymentIntent: jest.fn()
}));

// Re-required fresh per test (see beforeEach) so each test gets its own
// charges Map and its own rate-limiter window instead of sharing module state.
let verifyApiKey;
let NuveiClient;
let getTransactionAmount;
let stripeClientMock;
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
  'NUVEI_SDK_KEY_TEST',
  'GHL_WHITE_LABEL_DOMAINS',
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET_KEY_TEST',
  'STRIPE_PUBLISHABLE_KEY'
];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  process.env.GHL_PROVIDER_LIVE_PUBLISHABLE_KEY = LIVE_PUB_KEY;
  process.env.GHL_PROVIDER_TEST_PUBLISHABLE_KEY = TEST_PUB_KEY;
  delete process.env.NUVEI_SANDBOX_MODE;
  delete process.env.GHL_WHITE_LABEL_DOMAINS;

  process.env.NUVEI_SDK_USERNAME = 'live-user';
  process.env.NUVEI_SDK_PASSWORD = 'live-pass';
  process.env.NUVEI_SDK_KEY = 'live-key';
  process.env.NUVEI_SDK_USERNAME_TEST = 'test-user';
  process.env.NUVEI_SDK_PASSWORD_TEST = 'test-pass';
  process.env.NUVEI_SDK_KEY_TEST = 'test-key';
  process.env.STRIPE_SECRET_KEY = 'sk_live_test';
  process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_test';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_test';

  jest.resetModules();
  verifyApiKey = require('../services/ghlProviderConfig').verifyApiKey;
  NuveiClient = require('../services/nuveiClient');
  getTransactionAmount = require('../services/ghlTransactionsClient').getTransactionAmount;
  stripeClientMock = require('../services/stripeClient');
  ghlProviderRoutes = require('./ghlProvider');
  NuveiClient.mockClear();
  getTransactionAmount.mockReset();
  stripeClientMock.createPaymentIntent.mockReset();
  stripeClientMock.retrievePaymentIntent.mockReset();
  // Default: GHL's transaction record agrees with whatever amount the test
  // charges — individual tests override this to exercise the
  // mismatch/failure paths.
  getTransactionAmount.mockResolvedValue(25);
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
    orderId: 'order-1',
    locationId: 'loc-1',
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

  test('also allows framing from a configured white-label domain (e.g. a custom invoice host)', async () => {
    process.env.GHL_WHITE_LABEL_DOMAINS = 'us.amwelltechnologies.com';
    jest.resetModules();
    verifyApiKey = require('../services/ghlProviderConfig').verifyApiKey;
    NuveiClient = require('../services/nuveiClient');
    getTransactionAmount = require('../services/ghlTransactionsClient').getTransactionAmount;
    getTransactionAmount.mockResolvedValue(25);
    ghlProviderRoutes = require('./ghlProvider');

    const res = await request(buildApp()).get('/ghl-provider/checkout');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain(
      'frame-ancestors https://*.gohighlevel.com https://*.leadconnectorhq.com https://us.amwelltechnologies.com'
    );
  });

  test('supports multiple comma-separated white-label domains', async () => {
    process.env.GHL_WHITE_LABEL_DOMAINS = 'us.amwelltechnologies.com, another-brand.example.com';
    jest.resetModules();
    getTransactionAmount = require('../services/ghlTransactionsClient').getTransactionAmount;
    getTransactionAmount.mockResolvedValue(25);
    ghlProviderRoutes = require('./ghlProvider');

    const res = await request(buildApp()).get('/ghl-provider/checkout');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('https://us.amwelltechnologies.com https://another-brand.example.com');
  });

  test('forwards the GHL publishableKey and transactionId to /charge instead of a client-asserted mode', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('publishableKey: paymentProps.publishableKey');
    expect(res.text).toContain('transactionId: paymentProps.transactionId');
    // The old (broken) live/test signal must be gone: GHL's `mode` is
    // "payment", not "live"/"test".
    expect(res.text).not.toContain("paymentProps.mode === 'live'");
  });

  test('offers a region choice with both the Nuvei and Stripe forms hidden until one is picked', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('name="region"');
    expect(res.text).toContain('value="us_ca"');
    expect(res.text).toContain('value="intl"');
    expect(res.text).toMatch(/<form id="pf" hidden>/);
    expect(res.text).toMatch(/<form id="sf" hidden>/);
    expect(res.text).not.toMatch(/<input type="radio"[^>]*checked/);
  });

  test('loads Stripe.js and embeds the configured publishable key for the international leg', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_abc123';
    jest.resetModules();
    ghlProviderRoutes = require('./ghlProvider');

    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('src="https://js.stripe.com/v3/"');
    expect(res.text).toContain("Stripe(\"pk_live_abc123\")");
  });

  test('CSP allows Stripe.js, its hosted card iframe, and its API host', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('script-src \'self\' \'unsafe-inline\' https://js.stripe.com');
    expect(csp).toContain('frame-src https://js.stripe.com https://hooks.stripe.com');
    expect(csp).toContain('connect-src \'self\' https://api.stripe.com');
  });

  test('renders a boxed, centered card layout rather than stretching full width', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:440px');
    expect(res.text).toMatch(/<body>\s*<div class="card">/);
  });

  test('shows accepted card-brand badges next to the Nuvei card number field', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('class="card-brands"');
    expect(res.text).toContain('class="brand visa"');
    expect(res.text).toContain('class="brand amex"');
    expect(res.text).toContain('class="brand discover"');
  });

  test('shows gateway-branded trust text under each payment form', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('Nuvei Secure Payment');
    expect(res.text).toContain('Stripe secured payment');
  });

  test('shows a Stripe wordmark badge only on the Stripe panel, not the Nuvei one', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    const stripeFormStart = res.text.indexOf('<form id="sf"');
    const nuveiFormText = res.text.slice(res.text.indexOf('<form id="pf"'), stripeFormStart);
    expect(res.text).toContain('class="stripe-badge"');
    expect(nuveiFormText).not.toContain('stripe-badge');
  });

  test('neither submit handler silently no-ops when GHL has not sent payment_initiate_props yet — both surface a visible message', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    // Regression guard for a reported "Pay button does nothing" freeze: a
    // bare `if (!paymentProps) return;` gives zero feedback, indistinguishable
    // from the page being broken. Both handlers must alert instead.
    expect(res.text).not.toMatch(/if \(!paymentProps\) return;/);
    expect(res.text).not.toMatch(/if \(!paymentProps \|\| !stripe \|\| !cardElement\) return;/);
    expect(res.text).toContain("alert('Payment details are still loading. Please wait a moment and try again.')");
  });

  test('warns visibly if the GHL handshake never arrives at all', async () => {
    const res = await request(buildApp()).get('/ghl-provider/checkout');
    expect(res.text).toContain('Unable to load payment details. Please refresh this page and try again.');
    expect(res.text).toContain('}, 8000);');
  });
});

describe('POST /ghl-provider/query', () => {
  test('type=verify returns {success:true} when the apiKey matches (for the charge\'s own mode) and a charge with that id and transactionId is known', async () => {
    // cardPayload() below defaults to the test publishableKey, so the charge
    // it creates is mode:'test' — the verifying apiKey must match that same
    // mode, matching /query's new charge.mode === mode requirement.
    verifyApiKey.mockImplementation((_key, mode) => mode === 'test');
    const app = buildApp();

    // First, create a charge via /charge so the query route has something to verify against.
    mockSuccessfulSale();
    getTransactionAmount.mockResolvedValueOnce(10);
    const chargeRes = await request(app)
      .post('/ghl-provider/charge')
      .send(cardPayload({ transactionId: 'ghl-txn-1', amount: 10 }));
    expect(chargeRes.status).toBe(200);
    const { chargeId } = chargeRes.body;

    const res = await request(app).post('/ghl-provider/query').send({
      type: 'verify', transactionId: 'ghl-txn-1', apiKey: 'test-apikey', chargeId
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('type=verify returns {success:false} when the chargeId is real but the transactionId does not match it', async () => {
    verifyApiKey.mockReturnValue(true);
    const app = buildApp();

    mockSuccessfulSale();
    getTransactionAmount.mockResolvedValueOnce(0.01);
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

  test('type=verify returns {success:false} when the charge is real and the transactionId matches, but it was a test-mode charge and the verifying apiKey is live', async () => {
    verifyApiKey.mockImplementation((_key, mode) => mode === 'test');
    const app = buildApp();

    mockSuccessfulSale();
    const chargeRes = await request(app)
      .post('/ghl-provider/charge')
      .send(cardPayload({ publishableKey: TEST_PUB_KEY, transactionId: 'ghl-txn-mode-mismatch' }));
    expect(chargeRes.status).toBe(200);
    const { chargeId } = chargeRes.body;

    // Simulate the live apiKey verifying this call (e.g. because the
    // publishableKey env vars drifted out of sync with GHL's registration) —
    // this must NOT confirm a charge that actually ran against the sandbox.
    verifyApiKey.mockImplementation((_key, mode) => mode === 'live');
    const res = await request(app).post('/ghl-provider/query').send({
      type: 'verify', apiKey: 'live-apikey', chargeId, transactionId: 'ghl-txn-mode-mismatch'
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

  test('returns 400 when locationId is missing, without touching the gateway or GHL', async () => {
    const createPayment = mockSuccessfulSale();

    const payload = cardPayload();
    delete payload.locationId;
    const res = await request(buildApp()).post('/ghl-provider/charge').send(payload);

    expect(res.status).toBe(400);
    expect(createPayment).not.toHaveBeenCalled();
    expect(getTransactionAmount).not.toHaveBeenCalled();
  });

  test('verifies the amount against GHL\'s transaction record keyed by transactionId — NOT by the client-supplied orderId', async () => {
    // This is the actual regression test for the order-substitution bug: an
    // orderId alone must never be trusted for the amount check, because it
    // is just as attacker-controlled as amount itself. Only transactionId —
    // the one field GHL's real queryUrl verify call actually sends back —
    // may anchor the lookup.
    const createPayment = mockSuccessfulSale();
    getTransactionAmount.mockReset();
    getTransactionAmount.mockResolvedValueOnce(25);

    const res = await request(buildApp())
      .post('/ghl-provider/charge')
      .send(cardPayload({ transactionId: 'ghl-txn-real', orderId: 'attacker-supplied-order-id', amount: 25 }));

    expect(res.status).toBe(200);
    expect(getTransactionAmount).toHaveBeenCalledWith('loc-1', 'ghl-txn-real');
    expect(getTransactionAmount).not.toHaveBeenCalledWith(expect.anything(), 'attacker-supplied-order-id');
  });

  test('rejects with 400 when the requested amount does not match GHL\'s own transaction record, without ever calling the gateway', async () => {
    const createPayment = mockSuccessfulSale();
    getTransactionAmount.mockReset();
    getTransactionAmount.mockResolvedValueOnce(5000); // the real transaction is $5,000...

    // ...but the caller (who legitimately owns this transactionId) tries to
    // pay only a fraction of it.
    const res = await request(buildApp())
      .post('/ghl-provider/charge')
      .send(cardPayload({ amount: 0.01 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/i);
    expect(createPayment).not.toHaveBeenCalled();
  });

  test('accepts a requested amount within a cent of the transaction amount (float rounding tolerance)', async () => {
    const createPayment = mockSuccessfulSale();
    getTransactionAmount.mockReset();
    getTransactionAmount.mockResolvedValueOnce(25.004); // e.g. floating point artifact from GHL's side

    const res = await request(buildApp()).post('/ghl-provider/charge').send(cardPayload({ amount: 25 }));

    expect(res.status).toBe(200);
    expect(createPayment).toHaveBeenCalled();
  });

  test('returns 502 and does not call the gateway when GHL transaction verification itself fails', async () => {
    const createPayment = mockSuccessfulSale();
    getTransactionAmount.mockReset();
    getTransactionAmount.mockRejectedValueOnce({ statusCode: 502, message: 'Failed to verify transaction with GHL' });

    const res = await request(buildApp()).post('/ghl-provider/charge').send(cardPayload());

    expect(res.status).toBe(502);
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

function stripeIntentPayload(overrides = {}) {
  return {
    publishableKey: TEST_PUB_KEY,
    transactionId: 'ghl-txn-1',
    orderId: 'order-1',
    locationId: 'loc-1',
    amount: 25,
    currency: 'USD',
    ...overrides
  };
}

describe('POST /ghl-provider/stripe-intent', () => {
  test('verifies the amount against GHL, creates a PaymentIntent with the mode-appropriate secret key, and returns its client secret', async () => {
    stripeClientMock.createPaymentIntent.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'pi_1_secret' });

    const res = await request(buildApp()).post('/ghl-provider/stripe-intent').send(stripeIntentPayload({ publishableKey: TEST_PUB_KEY }));

    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('pi_1_secret');
    expect(typeof res.body.chargeId).toBe('string');
    expect(getTransactionAmount).toHaveBeenCalledWith('loc-1', 'ghl-txn-1');
    expect(stripeClientMock.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 25, currency: 'USD', secretKey: 'sk_test_test' })
    );
  });

  test('uses the live Stripe key when GHL supplies the live publishableKey', async () => {
    stripeClientMock.createPaymentIntent.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'pi_1_secret' });

    await request(buildApp()).post('/ghl-provider/stripe-intent').send(stripeIntentPayload({ publishableKey: LIVE_PUB_KEY }));

    expect(stripeClientMock.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ secretKey: 'sk_live_test' }));
  });

  test('rejects when the amount does not match GHL\'s own transaction record, without calling Stripe', async () => {
    getTransactionAmount.mockResolvedValueOnce(999);

    const res = await request(buildApp()).post('/ghl-provider/stripe-intent').send(stripeIntentPayload({ amount: 25 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Amount does not match GHL transaction');
    expect(stripeClientMock.createPaymentIntent).not.toHaveBeenCalled();
  });

  test('returns 502 with a generic message when the GHL transaction lookup itself fails', async () => {
    getTransactionAmount.mockRejectedValueOnce({ statusCode: 502, message: 'GHL is down' });

    const res = await request(buildApp()).post('/ghl-provider/stripe-intent').send(stripeIntentPayload());

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Unable to verify transaction with GHL');
  });

  test('rejects missing transactionId, locationId, or an invalid amount before touching GHL or Stripe', async () => {
    const app = buildApp();

    const noTxn = await request(app).post('/ghl-provider/stripe-intent').send(stripeIntentPayload({ transactionId: undefined }));
    expect(noTxn.status).toBe(400);

    const noLoc = await request(app).post('/ghl-provider/stripe-intent').send(stripeIntentPayload({ locationId: undefined }));
    expect(noLoc.status).toBe(400);

    const badAmount = await request(app).post('/ghl-provider/stripe-intent').send(stripeIntentPayload({ amount: 0 }));
    expect(badAmount.status).toBe(400);

    expect(getTransactionAmount).not.toHaveBeenCalled();
    expect(stripeClientMock.createPaymentIntent).not.toHaveBeenCalled();
  });

  test('records a pending charge that /query does not yet confirm as successful', async () => {
    stripeClientMock.createPaymentIntent.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'pi_1_secret' });
    verifyApiKey.mockImplementation((key, mode) => mode === 'test' && key === 'gateway-key');

    const intentRes = await request(buildApp()).post('/ghl-provider/stripe-intent').send(stripeIntentPayload());
    const queryRes = await request(buildApp())
      .post('/ghl-provider/query')
      .send({ type: 'verify', apiKey: 'gateway-key', chargeId: intentRes.body.chargeId, transactionId: 'ghl-txn-1' });

    expect(queryRes.body).toEqual({ success: false });
  });

  test('propagates a Stripe configuration error as JSON rather than crashing', async () => {
    stripeClientMock.createPaymentIntent.mockRejectedValueOnce({ statusCode: 500, message: 'STRIPE_SECRET_KEY is not configured' });

    const res = await request(buildApp()).post('/ghl-provider/stripe-intent').send(stripeIntentPayload());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('STRIPE_SECRET_KEY is not configured');
  });
});

describe('POST /ghl-provider/stripe-confirm', () => {
  async function createPendingCharge(app, overrides = {}) {
    stripeClientMock.createPaymentIntent.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'pi_1_secret' });
    const res = await request(app).post('/ghl-provider/stripe-intent').send(stripeIntentPayload(overrides));
    return res.body.chargeId;
  }

  test('confirms and marks the charge successful when Stripe independently reports the PaymentIntent as succeeded with the right amount', async () => {
    const app = buildApp();
    const chargeId = await createPendingCharge(app);
    stripeClientMock.retrievePaymentIntent.mockResolvedValueOnce({ id: 'pi_1', status: 'succeeded', amount: 2500 });
    verifyApiKey.mockImplementation((key, mode) => mode === 'test' && key === 'gateway-key');

    const confirmRes = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId, paymentIntentId: 'pi_1' });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body).toEqual({ success: true });

    const queryRes = await request(app)
      .post('/ghl-provider/query')
      .send({ type: 'verify', apiKey: 'gateway-key', chargeId, transactionId: 'ghl-txn-1' });
    expect(queryRes.body).toEqual({ success: true });
  });

  test('rejects when Stripe reports anything other than succeeded, without marking the charge paid', async () => {
    const app = buildApp();
    const chargeId = await createPendingCharge(app);
    stripeClientMock.retrievePaymentIntent.mockResolvedValueOnce({ id: 'pi_1', status: 'requires_action', amount: 2500 });

    const res = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId, paymentIntentId: 'pi_1' });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('Payment was not completed');
  });

  test('rejects when the amount Stripe reports does not match the charge (defense in depth)', async () => {
    const app = buildApp();
    const chargeId = await createPendingCharge(app, { amount: 25 });
    stripeClientMock.retrievePaymentIntent.mockResolvedValueOnce({ id: 'pi_1', status: 'succeeded', amount: 100 });

    const res = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId, paymentIntentId: 'pi_1' });

    expect(res.status).toBe(402);
  });

  test('returns 404 for an unknown chargeId or a paymentIntentId that does not match the one on record', async () => {
    const app = buildApp();
    const chargeId = await createPendingCharge(app);

    const unknownCharge = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId: 'nonexistent', paymentIntentId: 'pi_1' });
    expect(unknownCharge.status).toBe(404);

    const mismatchedIntent = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId, paymentIntentId: 'pi_wrong' });
    expect(mismatchedIntent.status).toBe(404);

    expect(stripeClientMock.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  test('is idempotent — confirming an already-successful charge again returns success without re-verifying', async () => {
    const app = buildApp();
    const chargeId = await createPendingCharge(app);
    stripeClientMock.retrievePaymentIntent.mockResolvedValueOnce({ id: 'pi_1', status: 'succeeded', amount: 2500 });

    const first = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId, paymentIntentId: 'pi_1' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId, paymentIntentId: 'pi_1' });
    expect(second.status).toBe(200);
    expect(stripeClientMock.retrievePaymentIntent).toHaveBeenCalledTimes(1);
  });

  test('rejects a request missing chargeId or paymentIntentId', async () => {
    const app = buildApp();
    const res = await request(app).post('/ghl-provider/stripe-confirm').send({ chargeId: 'x' });
    expect(res.status).toBe(400);
  });
});
