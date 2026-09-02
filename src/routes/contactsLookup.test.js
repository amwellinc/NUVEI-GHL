const request = require('supertest');
const express = require('express');

jest.mock('../services/ghlClient');

let GHLClient;
let contactsLookupRoutes;
let getContacts;

const ENV_KEYS = ['GHL_API_TOKEN', 'GHL_LOCATION_ID', 'PAYMENT_LINK_ALLOWED_REDIRECT_ORIGINS', 'APP_URL'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GHL_API_TOKEN = 'pit-test-token';
  process.env.GHL_LOCATION_ID = 'loc-ghl-1';
  process.env.PAYMENT_LINK_ALLOWED_REDIRECT_ORIGINS = 'https://www.wellness111.com,https://wellness111.com';
  delete process.env.APP_URL;

  jest.resetModules();
  GHLClient = require('../services/ghlClient');
  // GHLClient.mockImplementation must be set before requiring the route —
  // it constructs its GHLClient singleton once at module load.
  getContacts = jest.fn().mockResolvedValue({ contacts: [] });
  GHLClient.mockImplementation(() => ({ getContacts }));
  contactsLookupRoutes = require('./contactsLookup');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function buildApp() {
  const app = express();
  app.use('/contacts/lookup', contactsLookupRoutes);
  return app;
}

function realContact(overrides = {}) {
  return {
    id: 'contact-1',
    email: 'shopper@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+15551234567',
    address1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62704',
    country: 'US',
    ...overrides
  };
}

describe('GET /contacts/lookup', () => {
  test('returns found:true with the mapped contact fields when a matching contact exists', async () => {
    getContacts.mockResolvedValueOnce({ contacts: [realContact()] });
    const app = buildApp();

    const res = await request(app)
      .get('/contacts/lookup')
      .query({ email: 'shopper@example.com' })
      .set('Origin', 'https://www.wellness111.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      found: true,
      contact: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+15551234567',
        address1: '123 Main St',
        address2: '',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62704',
        country: 'US',
        email: 'shopper@example.com'
      }
    });
    expect(getContacts).toHaveBeenCalledWith({ query: 'shopper@example.com' });
  });

  test('returns found:false when GHL returns no matching contact', async () => {
    getContacts.mockResolvedValueOnce({ contacts: [] });
    const app = buildApp();

    const res = await request(app)
      .get('/contacts/lookup')
      .query({ email: 'nobody@example.com' })
      .set('Origin', 'https://www.wellness111.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false });
  });

  test('only treats a literal, case-insensitive email match as found among fuzzy search results', async () => {
    getContacts.mockResolvedValueOnce({
      contacts: [realContact({ email: 'someoneelse@example.com' }), realContact({ email: 'Shopper@Example.com' })]
    });
    const app = buildApp();

    const res = await request(app)
      .get('/contacts/lookup')
      .query({ email: 'shopper@example.com' })
      .set('Origin', 'https://www.wellness111.com');

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.contact.email).toBe('Shopper@Example.com');
  });

  test('rejects a missing or malformed email with 400, without calling GHL', async () => {
    const app = buildApp();

    const missing = await request(app).get('/contacts/lookup').set('Origin', 'https://www.wellness111.com');
    expect(missing.status).toBe(400);

    const malformed = await request(app)
      .get('/contacts/lookup')
      .query({ email: 'not-an-email' })
      .set('Origin', 'https://www.wellness111.com');
    expect(malformed.status).toBe(400);

    expect(getContacts).not.toHaveBeenCalled();
  });

  test('rejects a call from an origin that is not on the allowlist', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/contacts/lookup')
      .query({ email: 'shopper@example.com' })
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
    expect(getContacts).not.toHaveBeenCalled();
  });

  test('allows a call with no Origin header at all (server-to-server, not a browser)', async () => {
    getContacts.mockResolvedValueOnce({ contacts: [] });
    const app = buildApp();

    const res = await request(app).get('/contacts/lookup').query({ email: 'shopper@example.com' });

    expect(res.status).toBe(200);
  });

  test('returns a clean 502 rather than leaking GHL error details when the CRM request fails', async () => {
    getContacts.mockRejectedValueOnce({ statusCode: 500, message: 'GHL internal error', details: { secret: 'leak' } });
    const app = buildApp();

    const res = await request(app)
      .get('/contacts/lookup')
      .query({ email: 'shopper@example.com' })
      .set('Origin', 'https://www.wellness111.com');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Unable to reach CRM' });
  });
});
