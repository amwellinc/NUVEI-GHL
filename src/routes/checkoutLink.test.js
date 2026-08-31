const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

jest.mock('../services/ghlClient');

let GHLClient;
let checkoutLinkRoutes;
let ghlMocks;

const ENV_KEYS = ['PAYMENT_LINK_SECRET', 'PAYMENT_LINK_ALLOWED_REDIRECT_ORIGINS', 'APP_URL', 'GHL_API_TOKEN', 'GHL_LOCATION_ID'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.PAYMENT_LINK_SECRET = 'test-link-secret';
  process.env.PAYMENT_LINK_ALLOWED_REDIRECT_ORIGINS = 'https://www.wellness111.com';
  process.env.APP_URL = 'https://am333-nuvei-production.up.railway.app';
  process.env.GHL_API_TOKEN = 'pit-test-token';
  process.env.GHL_LOCATION_ID = 'loc-ghl-1';

  jest.resetModules();
  GHLClient = require('../services/ghlClient');
  ghlMocks = mockGHLClient();
  checkoutLinkRoutes = require('./checkoutLink');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function mockGHLClient() {
  const upsertContact = jest.fn().mockResolvedValue({ contact: { id: 'contact-1' }, new: true });
  GHLClient.mockImplementation(() => ({ upsertContact }));
  return { upsertContact };
}

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use('/pay/create-link', checkoutLinkRoutes);
  return app;
}

describe('POST /pay/create-link', () => {
  test('mints a signed link for the given amount when called from an allowed storefront origin', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 123.45, currency: 'USD', description: 'Cart total' });

    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://am333-nuvei-production.up.railway.app/pay');
    expect(url.searchParams.get('amount')).toBe('123.45');
    expect(url.searchParams.get('currency')).toBe('USD');
    expect(url.searchParams.get('description')).toBe('Cart total');
  });

  test('rejects a call from an origin that is not on the allowlist', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://evil.example.com')
      .send({ amount: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Origin/);
  });

  test('allows a call with no Origin header at all (server-to-server, not a browser)', async () => {
    const app = buildApp();
    const res = await request(app).post('/pay/create-link').send({ amount: 10 });
    expect(res.status).toBe(200);
  });

  test('rejects a non-positive or non-numeric amount', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive number/);
  });

  test('rejects a description over the length cap', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 10, description: 'x'.repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200 characters/);
  });

  test('rejects a successUrl not on an allowed origin, without minting a link', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 10, successUrl: 'https://evil.example.com/steal' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/successUrl/);
  });

  test('rejects a failureUrl not on an allowed origin', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 10, failureUrl: 'https://evil.example.com/steal' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/failureUrl/);
  });

  test('resolves an email to a GHL contact id server-side and bakes it into the signed link', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 10, email: 'shopper@example.com', firstName: 'Ada' });

    expect(ghlMocks.upsertContact).toHaveBeenCalledWith({ email: 'shopper@example.com', firstName: 'Ada', lastName: undefined });
    const url = new URL(res.body.url);
    expect(url.searchParams.get('contactId')).toBe('contact-1');
  });

  test('a client-supplied contactId is not accepted — only a resolved email can set one', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 10, contactId: 'someone-elses-contact-id' });

    expect(ghlMocks.upsertContact).not.toHaveBeenCalled();
    const url = new URL(res.body.url);
    expect(url.searchParams.get('contactId')).toBe('');
  });

  test('still mints a valid link with no contactId when GHL contact resolution fails', async () => {
    const app = buildApp();
    ghlMocks.upsertContact.mockRejectedValueOnce(new Error('GHL down'));

    const res = await request(app)
      .post('/pay/create-link')
      .set('Origin', 'https://www.wellness111.com')
      .send({ amount: 10, email: 'shopper@example.com' });

    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.searchParams.get('contactId')).toBe('');
  });

  test('never calls GHL when no email is given', async () => {
    const app = buildApp();
    await request(app).post('/pay/create-link').set('Origin', 'https://www.wellness111.com').send({ amount: 10 });
    expect(ghlMocks.upsertContact).not.toHaveBeenCalled();
  });
});
