const express = require('express');
const request = require('supertest');
const { requireApiKey } = require('./security');

function appWith(key) {
  if (key === undefined) delete process.env.GATEWAY_API_KEY; else process.env.GATEWAY_API_KEY = key;
  const app = express();
  app.use('/private', requireApiKey, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireApiKey', () => {
  afterEach(() => { delete process.env.GATEWAY_API_KEY; });

  it('lets the right key through', async () => {
    await request(appWith('secret-key-123')).get('/private').set('Authorization', 'Bearer secret-key-123').expect(200);
  });
  it('refuses no key', async () => {
    await request(appWith('secret-key-123')).get('/private').expect(401);
  });
  it('refuses a wrong key', async () => {
    await request(appWith('secret-key-123')).get('/private').set('Authorization', 'Bearer nope').expect(401);
  });
  it('refuses everyone when the service has no key set, rather than leaving the door open', async () => {
    await request(appWith(undefined)).get('/private').expect(401);
    await request(appWith(undefined)).get('/private').set('Authorization', 'Bearer ').expect(401);
    await request(appWith('')).get('/private').set('Authorization', 'Bearer ').expect(401);
  });
  it('never echoes the key', async () => {
    const res = await request(appWith('secret-key-123')).get('/private').set('Authorization', 'Bearer nope');
    expect(JSON.stringify(res.body)).not.toContain('secret-key-123');
  });
});
