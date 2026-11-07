const request = require('supertest');
const express = require('express');
const { verifyLink, createSignedLink } = require('../lib/paymentLinks');

function buildApp() {
  const posRoutes = require('./pos');
  const app = express();
  app.use(express.json());
  app.use('/pos/links', posRoutes);
  return app;
}

describe('POST /pos/links', () => {
  beforeEach(() => {
    process.env.GATEWAY_API_KEY = 'k1';
    process.env.PAYMENT_LINK_SECRET = 'secret';
    process.env.APP_URL = 'https://gw.example';
    process.env.POS_RETURN_ORIGIN = 'https://admin.example';
  });
  const body = { ref: 'charge-1', amount: 25.5, currency: 'USD', description: 'Invoice 100', successUrl: 'https://admin.example/admin/orders/charge?done=1', failureUrl: 'https://admin.example/admin/orders/charge?failed=1' };
  const auth = (r) => r.set('Authorization', 'Bearer k1');

  it('refuses a call without the key', async () => {
    await request(buildApp()).post('/pos/links').send(body).expect(401);
  });
  it('returns a signed page for that exact amount and reference', async () => {
    const res = await auth(request(buildApp()).post('/pos/links')).send(body).expect(200);
    const query = Object.fromEntries(new URL(res.body.url).searchParams);
    expect(query.ref).toBe('charge-1');
    expect(query.amount).toBe('25.50');
    expect(verifyLink(query).valid).toBe(true);
  });
  it('a changed reference breaks the signature', async () => {
    const res = await auth(request(buildApp()).post('/pos/links')).send(body).expect(200);
    const query = Object.fromEntries(new URL(res.body.url).searchParams);
    expect(verifyLink({ ...query, ref: 'other' }).valid).toBe(false);
    expect(verifyLink({ ...query, amount: '1.00' }).valid).toBe(false);
  });
  it('the link lasts 30 minutes, not a day', async () => {
    const res = await auth(request(buildApp()).post('/pos/links')).send(body).expect(200);
    const exp = Number(new URL(res.body.url).searchParams.get('exp'));
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(1800);
  });
  it('refuses a missing reference, a bad amount and an unknown return address', async () => {
    await auth(request(buildApp()).post('/pos/links')).send({ ...body, ref: '' }).expect(400);
    await auth(request(buildApp()).post('/pos/links')).send({ ...body, amount: -1 }).expect(400);
    await auth(request(buildApp()).post('/pos/links')).send({ ...body, successUrl: 'https://evil.example/x' }).expect(400);
  });
});

describe('website links are unaffected', () => {
  it('a link with no reference signs and verifies exactly as before', () => {
    process.env.PAYMENT_LINK_SECRET = 'secret';
    const url = createSignedLink('https://gw.example/pay', { amount: 10 });
    const query = Object.fromEntries(new URL(url).searchParams);
    expect(query.ref).toBeUndefined();
    expect(verifyLink(query).valid).toBe(true);
  });
});

describe('the server locks this route', () => {
  it('refuses a call with no key', async () => {
    const app = require('../server');
    await request(app).post('/pos/links').send({}).expect(401);
  });
});
