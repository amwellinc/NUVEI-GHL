const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const ghlWebhookRoutes = require('./ghlWebhook');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use('/webhooks/ghl', ghlWebhookRoutes);
  return app;
}

describe('POST /webhooks/ghl', () => {
  test('acknowledges any event payload with 200', async () => {
    const res = await request(buildApp())
      .post('/webhooks/ghl')
      .send({ type: 'INSTALL', locationId: 'loc-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  test('acknowledges an empty body without crashing', async () => {
    const res = await request(buildApp()).post('/webhooks/ghl').send();
    expect(res.status).toBe(200);
  });
});
