const request = require('supertest');
const express = require('express');

jest.mock('../services/ghlOAuthClient', () => ({ exchangeCodeForTokens: jest.fn() }));

let exchangeCodeForTokens;
let oauthRoutes;

beforeEach(() => {
  // Fresh module per test so each gets its own rate-limiter window.
  jest.resetModules();
  exchangeCodeForTokens = require('../services/ghlOAuthClient').exchangeCodeForTokens;
  oauthRoutes = require('./oauth');
});

function buildApp() {
  const app = express();
  app.use('/oauth', oauthRoutes);
  return app;
}

describe('GET /oauth/callback', () => {
  test('exchanges the code and confirms the install', async () => {
    exchangeCodeForTokens.mockResolvedValue({ locationId: 'loc-1' });

    const res = await request(buildApp()).get('/oauth/callback?code=abc');

    expect(res.status).toBe(200);
    expect(res.text).toContain('installed successfully');
    expect(exchangeCodeForTokens).toHaveBeenCalledWith('abc');
  });

  test('returns 400 when the code is missing', async () => {
    const res = await request(buildApp()).get('/oauth/callback');
    expect(res.status).toBe(400);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  test('rate-limits repeated hits so the callback cannot be ground against GHL', async () => {
    exchangeCodeForTokens.mockResolvedValue({ locationId: 'loc-1' });
    const app = buildApp();

    for (let i = 0; i < 20; i++) {
      const ok = await request(app).get('/oauth/callback?code=abc');
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).get('/oauth/callback?code=abc');
    expect(limited.status).toBe(429);
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(20);
  });
});
