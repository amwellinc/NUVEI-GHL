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
