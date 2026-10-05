const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

jest.mock('../services/nuveiClient');
jest.mock('../services/ghlClient');
jest.mock('../services/stripeClient');

let NuveiClient;
let GHLClient;
let stripeClient;
let createSignedLink;
let payRoutes;
let ghlMocks;

const ENV_KEYS = [
  'PAYMENT_LINK_SECRET',
  'PAYMENT_LINK_ALLOWED_REDIRECT_ORIGINS',
  'APP_URL',
  'NUVEI_SDK_USERNAME',
  'NUVEI_SDK_PASSWORD',
  'NUVEI_SDK_KEY',
  'NUVEI_SANDBOX_MODE',
  'GHL_API_TOKEN',
  'GHL_LOCATION_ID'
];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.PAYMENT_LINK_SECRET = 'test-link-secret';
  process.env.PAYMENT_LINK_ALLOWED_REDIRECT_ORIGINS = 'https://amwellinc.com';
  process.env.APP_URL = 'https://am333-nuvei-production.up.railway.app';
  process.env.NUVEI_SDK_USERNAME = 'user';
  process.env.NUVEI_SDK_PASSWORD = 'pass';
  process.env.NUVEI_SDK_KEY = 'key';
  process.env.GHL_API_TOKEN = 'pit-test-token';
  process.env.GHL_LOCATION_ID = 'loc-ghl-1';
  delete process.env.NUVEI_SANDBOX_MODE;

  jest.resetModules();
  NuveiClient = require('../services/nuveiClient');
  GHLClient = require('../services/ghlClient');
  createSignedLink = require('../lib/paymentLinks').createSignedLink;

  // pay.js constructs its GHLClient once at module load (same pattern as
  // ghl.js — GHLClient's config is static env vars, unlike NuveiClient
  // which is constructed per-request because its config varies by resolved
  // mode). The mock implementation must therefore be set up BEFORE
  // require('./pay') runs, or the module-level instance is built from
  // whatever the default auto-mock returns and never picks up per-test
  // overrides made afterward — tests customize behavior via
  // ghlMocks.*.mockResolvedValueOnce/mockRejectedValueOnce instead.
  ghlMocks = mockGHLClient();
  payRoutes = require('./pay');
  NuveiClient.mockClear();

  stripeClient = require('../services/stripeClient');
  stripeClient.createCheckoutSession.mockReset();
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
  app.use('/pay', payRoutes);
  return app;
}

function mockSuccessfulSale(transactionId = 'txn-1') {
  const createPayment = jest.fn().mockResolvedValue({ transactionId, status: 'CAPTURED' });
  NuveiClient.mockImplementation(() => ({ createPayment }));
  return createPayment;
}

function mockGHLClient() {
  const createNote = jest.fn().mockResolvedValue({});
  const setCustomField = jest.fn().mockResolvedValue({});
  const addTags = jest.fn().mockResolvedValue({});
  const upsertContact = jest.fn().mockResolvedValue({ contact: { id: 'resolved-contact' } });
  // lib/ghlNotify and lib/ghlContact each construct their own GHLClient
  // singleton at module load — both land on this one shared mock
  // implementation, so a single set of jest.fn()s here covers every call
  // site regardless of which module made it.
  GHLClient.mockImplementation(() => ({ createNote, setCustomField, addTags, upsertContact }));
  return { createNote, setCustomField, addTags, upsertContact };
}

function signedQuery(overrides = {}) {
  const url = createSignedLink('https://x/pay', { amount: 25, currency: 'USD', description: 'Test item', ...overrides });
  return new URL(url).search;
}

describe('GET /pay', () => {
  test('renders the checkout form when the link signature is valid', async () => {
    const res = await request(buildApp()).get('/pay' + signedQuery());
    expect(res.status).toBe(200);
    expect(res.text).toContain('USD 25.00');
    expect(res.text).toContain('Test item');
    expect(res.text).toContain('ccExpiry');
  });

  test('renders a country selector offering the Nuvei form for US/Canada and a Stripe option for elsewhere', async () => {
    const res = await request(buildApp()).get('/pay' + signedQuery());
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="region"');
    expect(res.text).toContain('value="us_ca"');
    expect(res.text).toContain('value="intl"');
    expect(res.text).toContain('id="stripeBox"');
    expect(res.text).toContain('/stripe-checkout');
  });

  test('requires an explicit region choice — neither the card form nor the Stripe option is shown by default', async () => {
    const res = await request(buildApp()).get('/pay' + signedQuery());
    expect(res.status).toBe(200);
    // Both start hidden; only becomes visible via the JS 'change' handler
    // once the shopper picks one, so neither radio is pre-checked below.
    expect(res.text).toMatch(/<form id="pf" hidden>/);
    expect(res.text).toMatch(/<div id="stripeBox" hidden>/);
    expect(res.text).not.toMatch(/<input type="radio"[^>]*checked/);
  });

  test('escapes a description containing HTML rather than reflecting it raw', async () => {
    const res = await request(buildApp()).get('/pay' + signedQuery({ description: '<script>alert(1)</script>' }));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  test('rejects with 400 when the amount has been tampered with in the URL', async () => {
    const query = signedQuery();
    const tampered = query.replace('amount=25.00', 'amount=0.01');
    const res = await request(buildApp()).get('/pay' + tampered);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid/i);
  });

  test('rejects with 400 when there is no signature at all', async () => {
    const res = await request(buildApp()).get('/pay?amount=25.00&currency=USD');
    expect(res.status).toBe(400);
  });

  test('sets a restrictive CSP and X-Frame-Options DENY (this page is not meant to be iframed)', async () => {
    const res = await request(buildApp()).get('/pay' + signedQuery());
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('POST /pay/:sessionId/charge', () => {
  async function createSession(app, overrides = {}) {
    const getRes = await request(app).get('/pay' + signedQuery(overrides));
    const match = getRes.text.match(/'\/([0-9a-f-]{36})\/charge'/);
    return match[1];
  }

  test('charges the amount fixed by the link, not anything the client submits', async () => {
    const app = buildApp();
    const createPayment = mockSuccessfulSale('txn-42');
    const sessionId = await createSession(app, { amount: 25 });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '25.00', currency: 'USD' }));
  });

  test('ignores any amount the client tries to submit in the charge request body — only the signed link amount is ever charged', async () => {
    const app = buildApp();
    const createPayment = mockSuccessfulSale('txn-tamper');
    const sessionId = await createSession(app, { amount: 25 });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123',
      amount: 0.01 // attacker-supplied — must be ignored entirely
    });

    expect(res.status).toBe(200);
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '25.00' }));
  });

  test('returns 404 for an unknown or already-expired sessionId, without calling the gateway', async () => {
    const app = buildApp();
    const createPayment = mockSuccessfulSale();

    const res = await request(app).post('/pay/00000000-0000-0000-0000-000000000000/charge').send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(404);
    expect(createPayment).not.toHaveBeenCalled();
  });

  test('redirects to successUrl with a transactionId when it is on the allowed origin', async () => {
    const app = buildApp();
    mockSuccessfulSale('txn-redirect');
    const sessionId = await createSession(app, { successUrl: 'https://amwellinc.com/thanks' });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toBe('https://amwellinc.com/thanks?transactionId=Nuvei/txn-redirect');
  });

  test('does not redirect to a successUrl outside the allowed origins, falls back to the built-in confirmation page', async () => {
    const app = buildApp();
    mockSuccessfulSale('txn-nofollow');
    const sessionId = await createSession(app, { successUrl: 'https://evil.example.com/steal' });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toBe('https://am333-nuvei-production.up.railway.app/pay/return?status=success&transactionId=Nuvei/txn-nofollow');
  });

  test('a session cannot be charged twice — a successful charge consumes it', async () => {
    const app = buildApp();
    const createPayment = mockSuccessfulSale('txn-once');
    const sessionId = await createSession(app);
    const payload = { email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123' };

    const first = await request(app).post(`/pay/${sessionId}/charge`).send(payload);
    expect(first.status).toBe(200);
    expect(createPayment).toHaveBeenCalledTimes(1);

    const second = await request(app).post(`/pay/${sessionId}/charge`).send({ ...payload, ccNumber: '5555555555554444' });
    expect(second.status).toBe(404);
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  test('a session is also consumed after a declined charge — cannot be retried with a different card', async () => {
    const app = buildApp();
    const createPayment = jest.fn().mockRejectedValue({ statusCode: 402, message: 'No such Issuer' });
    NuveiClient.mockImplementation(() => ({ createPayment }));
    const sessionId = await createSession(app);
    const payload = { email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123' };

    const first = await request(app).post(`/pay/${sessionId}/charge`).send(payload);
    expect(first.status).toBe(200);
    expect(first.body.redirectUrl).toBe('https://am333-nuvei-production.up.railway.app/pay/return?status=failed');

    const second = await request(app).post(`/pay/${sessionId}/charge`).send({ ...payload, ccNumber: '5555555555554444' });
    expect(second.status).toBe(404);
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when required fields are missing, without touching the gateway', async () => {
    const app = buildApp();
    const createPayment = mockSuccessfulSale();
    const sessionId = await createSession(app);

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(createPayment).not.toHaveBeenCalled();
  });

  describe('field format validation — rejected before the gateway is ever called', () => {
    const basePayload = { email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123' };

    test.each([
      ['a malformed email', { email: 'not-an-email' }, /email/i],
      ['a non-numeric card number', { ccNumber: '4111-1111-1111-1111' }, /card number/i],
      ['a too-short card number', { ccNumber: '12345' }, /card number/i],
      ['a card number sent as a non-string (object)', { ccNumber: { toString: () => '4111111111111111' } }, /card number/i],
      ['an out-of-range expiry month', { ccExpMonth: '13' }, /expiry month/i],
      ['a non-4-digit expiry year', { ccExpYear: '27' }, /expiry year/i],
      ['a non-numeric CVV', { ccCvv: 'abc' }, /verification code/i],
      ['a too-long CVV', { ccCvv: '12345' }, /verification code/i]
    ])('rejects %s with a 400 and never calls the gateway', async (_label, overrides, messagePattern) => {
      const app = buildApp();
      const createPayment = mockSuccessfulSale();
      const sessionId = await createSession(app);

      const res = await request(app).post(`/pay/${sessionId}/charge`).send({ ...basePayload, ...overrides });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(messagePattern);
      expect(createPayment).not.toHaveBeenCalled();
    });

    test('a validation failure does not consume the session — the shopper can correct a typo and resubmit', async () => {
      const app = buildApp();
      const createPayment = mockSuccessfulSale('txn-retry');
      const sessionId = await createSession(app);

      const bad = await request(app).post(`/pay/${sessionId}/charge`).send({ ...basePayload, ccCvv: 'abc' });
      expect(bad.status).toBe(400);

      const good = await request(app).post(`/pay/${sessionId}/charge`).send(basePayload);
      expect(good.status).toBe(200);
      expect(createPayment).toHaveBeenCalledTimes(1);
    });

    test('accepts well-formed fields (control case for the table above)', async () => {
      const app = buildApp();
      const createPayment = mockSuccessfulSale('txn-valid');
      const sessionId = await createSession(app);

      const res = await request(app).post(`/pay/${sessionId}/charge`).send(basePayload);

      expect(res.status).toBe(200);
      expect(createPayment).toHaveBeenCalledTimes(1);
    });
  });

  test('a decline redirects to failureUrl when allowed', async () => {
    const app = buildApp();
    const createPayment = jest.fn().mockRejectedValue({ statusCode: 402, message: 'No such Issuer' });
    NuveiClient.mockImplementation(() => ({ createPayment }));
    const sessionId = await createSession(app, { failureUrl: 'https://amwellinc.com/failed' });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toBe('https://amwellinc.com/failed?status=failed');
  });

  test('a decline falls back to the built-in confirmation page when no allowed failureUrl is configured', async () => {
    const app = buildApp();
    const createPayment = jest.fn().mockRejectedValue({ statusCode: 402, message: 'No such Issuer' });
    NuveiClient.mockImplementation(() => ({ createPayment }));
    const sessionId = await createSession(app);

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toBe('https://am333-nuvei-production.up.railway.app/pay/return?status=failed');
  });

  test('a successful charge with a contactId on the link records a note, custom field, and tag on that GHL contact', async () => {
    const app = buildApp();
    mockSuccessfulSale('txn-ghl');
    const sessionId = await createSession(app, { contactId: 'contact-123' });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(ghlMocks.createNote).toHaveBeenCalledWith('contact-123', expect.objectContaining({ body: expect.stringContaining('txn-ghl') }));
    expect(ghlMocks.setCustomField).toHaveBeenCalledWith('contact-123', 'nuvei_transaction_id', 'Nuvei/txn-ghl');
    expect(ghlMocks.addTags).toHaveBeenCalledWith('contact-123', ['payment-completed']);
  });

  test('a successful charge with no contactId on the link resolves one from the email collected on the card form', async () => {
    const app = buildApp();
    mockSuccessfulSale('txn-no-contact');
    const sessionId = await createSession(app); // no contactId override

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      firstName: 'Ada', lastName: 'Lovelace',
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(ghlMocks.upsertContact).toHaveBeenCalledWith({ email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace' });
    expect(ghlMocks.createNote).toHaveBeenCalledWith('resolved-contact', expect.objectContaining({ body: expect.stringContaining('txn-no-contact') }));
  });

  test('a successful charge never touches GHL beyond the failed lookup when contact resolution itself fails', async () => {
    const app = buildApp();
    mockSuccessfulSale('txn-no-resolve');
    ghlMocks.upsertContact.mockRejectedValueOnce(new Error('GHL down'));
    const sessionId = await createSession(app); // no contactId override

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(ghlMocks.createNote).not.toHaveBeenCalled();
    expect(ghlMocks.setCustomField).not.toHaveBeenCalled();
    expect(ghlMocks.addTags).not.toHaveBeenCalled();
  });

  test('a GHL-side failure (e.g. note creation fails) does not fail the payment response — the charge already succeeded', async () => {
    const app = buildApp();
    mockSuccessfulSale('txn-ghl-fail');
    ghlMocks.createNote.mockRejectedValueOnce(new Error('GHL down'));
    const sessionId = await createSession(app, { contactId: 'contact-456' });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toContain('transactionId=Nuvei/txn-ghl-fail');
    // The independently-failing note creation must not have blocked the
    // other two GHL side effects from still being attempted.
    expect(ghlMocks.setCustomField).toHaveBeenCalled();
    expect(ghlMocks.addTags).toHaveBeenCalled();
  });

  test('a successful charge records the order description on the GHL contact note for fulfillment', async () => {
    // No Opportunity/pipeline involved — GHL has no public API to create a
    // native "Order", so the order's details live entirely on the contact's
    // note. This also means the record can't 404 the way the old
    // pipeline-based tracking did when a pipeline was renamed or deleted.
    const app = buildApp();
    mockSuccessfulSale('txn-order');
    const sessionId = await createSession(app, { contactId: 'contact-789', description: 'Alka H2 Bottle x1' });

    const res = await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    expect(res.status).toBe(200);
    expect(ghlMocks.createNote).toHaveBeenCalledWith('contact-789', expect.objectContaining({
      body: expect.stringContaining('Alka H2 Bottle x1')
    }));
  });
});

describe('POST /pay/:sessionId/stripe-checkout', () => {
  async function createSession(app, overrides = {}) {
    const getRes = await request(app).get('/pay' + signedQuery(overrides));
    const match = getRes.text.match(/'\/([0-9a-f-]{36})\/charge'/);
    return match[1];
  }

  test('creates a Stripe Checkout Session for the amount fixed by the link and returns its URL', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });
    const sessionId = await createSession(app, { amount: 25, currency: 'USD', description: 'Test item' });

    const res = await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/cs_1');
    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '25.00', currency: 'USD', description: 'Test item' })
    );
  });

  test('returns 404 for an unknown or expired sessionId, without calling Stripe', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });

    const res = await request(app).post('/pay/00000000-0000-0000-0000-000000000000/stripe-checkout');

    expect(res.status).toBe(404);
    expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
  });

  test('is not single-use like the Nuvei charge endpoint — creating a Checkout Session is not itself a completed payment', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });
    const sessionId = await createSession(app);

    const first = await request(app).post(`/pay/${sessionId}/stripe-checkout`);
    const second = await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stripeClient.createCheckoutSession).toHaveBeenCalledTimes(2);
  });

  test('passes the link contactId through as Stripe session metadata for the webhook to pick up', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });
    const sessionId = await createSession(app, { contactId: 'contact-789' });

    await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { contactId: 'contact-789', description: 'Test item' } })
    );
  });

  test('appends the Stripe session-id placeholder to an allowed successUrl', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });
    const sessionId = await createSession(app, { successUrl: 'https://amwellinc.com/thanks' });

    await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ successUrl: 'https://amwellinc.com/thanks?transactionId=Stripe/{CHECKOUT_SESSION_ID}' })
    );
  });

  test('appends status=cancelled to an allowed failureUrl — reaching this page always means abandonment, since a declined card is handled inline on Stripe\'s own page', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });
    const sessionId = await createSession(app, { failureUrl: 'https://amwellinc.com/cancelled' });

    await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ cancelUrl: 'https://amwellinc.com/cancelled?status=cancelled' })
    );
  });

  test('falls back to the built-in /pay/return page when no allowed successUrl/failureUrl is configured', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });
    const sessionId = await createSession(app);

    await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: 'https://am333-nuvei-production.up.railway.app/pay/return?status=success',
        cancelUrl: 'https://am333-nuvei-production.up.railway.app/pay/return?status=cancelled'
      })
    );
  });

  test('propagates a Stripe configuration error as JSON rather than crashing', async () => {
    const app = buildApp();
    stripeClient.createCheckoutSession.mockRejectedValue({ statusCode: 500, message: 'STRIPE_SECRET_KEY is not configured' });
    const sessionId = await createSession(app);

    const res = await request(app).post(`/pay/${sessionId}/stripe-checkout`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('STRIPE_SECRET_KEY is not configured');
  });
});

describe('GET /pay/return', () => {
  test('shows a success message when status=success', async () => {
    const res = await request(buildApp()).get('/pay/return?status=success');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Payment Successful/);
  });

  test('shows the order number when a transactionId is present', async () => {
    const res = await request(buildApp()).get('/pay/return?status=success&transactionId=txn-order-99');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Order #txn-order-99');
  });

  test('escapes a transactionId rather than reflecting it raw', async () => {
    const res = await request(buildApp()).get('/pay/return?status=success&transactionId=' + encodeURIComponent('<script>alert(1)</script>'));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
  });

  test('shows a cancelled message for status=cancelled, with no order number', async () => {
    const res = await request(buildApp()).get('/pay/return?status=cancelled');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Payment Cancelled/);
    expect(res.text).not.toContain('Order #');
  });

  test('shows a distinct failed message for status=failed — a gateway decline, not a shopper-initiated cancellation', async () => {
    const res = await request(buildApp()).get('/pay/return?status=failed');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Payment Failed/);
    expect(res.text).toMatch(/declined/i);
    expect(res.text).not.toContain('Order #');
  });

  test('falls back to the cancelled message for any unrecognized status value', async () => {
    const res = await request(buildApp()).get('/pay/return?status=something-unexpected');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Payment Cancelled/);
  });
});

describe('abandoned cart tracking', () => {
  const SESSION_TTL_MS = 30 * 60 * 1000;

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a session with a known contact that expires without ever charging records an abandoned-cart note and tag', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const app = buildApp();

    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await request(app).get('/pay' + signedQuery({ contactId: 'contact-abandoned', description: 'Cart total', amount: 40 }));

    // Past the session TTL — the next GET /pay sweeps expired sessions
    // before creating its own, which is what actually fires the check.
    jest.setSystemTime(new Date(Date.now() + SESSION_TTL_MS + 60 * 1000));
    await request(app).get('/pay' + signedQuery());

    expect(ghlMocks.createNote).toHaveBeenCalledWith('contact-abandoned', expect.objectContaining({
      body: expect.stringContaining('Cart total')
    }));
    expect(ghlMocks.addTags).toHaveBeenCalledWith('contact-abandoned', ['abandoned-cart']);
  });

  test('a session with no known contact that expires unused does not record an abandoned-cart note', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const app = buildApp();

    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await request(app).get('/pay' + signedQuery()); // no contactId

    jest.setSystemTime(new Date(Date.now() + SESSION_TTL_MS + 60 * 1000));
    await request(app).get('/pay' + signedQuery());

    expect(ghlMocks.createNote).not.toHaveBeenCalled();
    expect(ghlMocks.addTags).not.toHaveBeenCalled();
  });

  test('a session that successfully charges before expiring does not also record an abandoned-cart tag', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const app = buildApp();
    mockSuccessfulSale('txn-charged');

    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const getRes = await request(app).get('/pay' + signedQuery({ contactId: 'contact-charged' }));
    const sessionId = getRes.text.match(/'\/([0-9a-f-]{36})\/charge'/)[1];

    await request(app).post(`/pay/${sessionId}/charge`).send({
      email: 'a@b.com', ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
    });

    jest.setSystemTime(new Date(Date.now() + SESSION_TTL_MS + 60 * 1000));
    await request(app).get('/pay' + signedQuery());

    // Only the completed-order tag from the successful charge exists — the
    // already-consumed (deleted) session can't also be swept as abandoned.
    expect(ghlMocks.addTags).toHaveBeenCalledTimes(1);
    expect(ghlMocks.addTags).toHaveBeenCalledWith('contact-charged', ['payment-completed']);
  });
});
