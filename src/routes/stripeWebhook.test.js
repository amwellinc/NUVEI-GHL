const request = require('supertest');
const express = require('express');

jest.mock('../services/stripeClient');
jest.mock('../lib/ghlNotify');
jest.mock('../lib/ghlContact');

let stripeClient;
let ghlNotify;
let ghlContact;
let stripeWebhookRoutes;

beforeEach(() => {
  jest.resetModules();
  stripeClient = require('../services/stripeClient');
  ghlNotify = require('../lib/ghlNotify');
  ghlNotify.notifyGHL.mockResolvedValue(undefined);
  ghlContact = require('../lib/ghlContact');
  ghlContact.resolveContactId.mockResolvedValue('');
  stripeWebhookRoutes = require('./stripeWebhook');
});

function buildApp() {
  const app = express();
  // Mirrors the exact mounting used in server.js — signature verification
  // depends on getting the untouched raw body, not JSON-parsed.
  app.use(express.raw({ type: 'application/json' }));
  app.use('/pay/stripe/webhook', stripeWebhookRoutes);
  return app;
}

function post(app) {
  return request(app)
    .post('/pay/stripe/webhook')
    .set('stripe-signature', 'sig_test')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ ignored: 'raw body is stubbed via constructWebhookEvent mock' }));
}

function checkoutCompletedEvent(overrides = {}) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        payment_intent: 'pi_123',
        payment_status: 'paid',
        amount_total: 4999,
        currency: 'usd',
        metadata: { contactId: 'contact-1' },
        ...overrides
      }
    }
  };
}

describe('POST /pay/stripe/webhook', () => {
  test('rejects a request with an invalid or missing signature, without notifying GHL', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await post(app);

    expect(res.status).toBe(400);
    expect(ghlNotify.notifyGHL).not.toHaveBeenCalled();
  });

  test('on checkout.session.completed with payment_status paid, notifies GHL with the confirmed amount/currency/contact', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(checkoutCompletedEvent());

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(ghlNotify.notifyGHL).toHaveBeenCalledWith('contact-1', {
      transactionId: 'Stripe/pi_123',
      amount: '49.99',
      currency: 'USD',
      description: ''
    });
  });

  test('ignores event types other than checkout.session.completed', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue({ id: 'evt_2', type: 'payment_intent.created', data: { object: {} } });

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(ghlNotify.notifyGHL).not.toHaveBeenCalled();
  });

  test('does not notify GHL when payment_status is not paid (e.g. an async payment method still pending)', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(checkoutCompletedEvent({ payment_status: 'unpaid' }));

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(ghlNotify.notifyGHL).not.toHaveBeenCalled();
  });

  test('a redelivered event (same event id) is acknowledged but not processed a second time', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(checkoutCompletedEvent());

    const first = await post(app);
    const second = await post(app);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(ghlNotify.notifyGHL).toHaveBeenCalledTimes(1);
  });

  test('falls back to the Checkout Session id as the transaction id when there is no payment_intent', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(checkoutCompletedEvent({ payment_intent: undefined, id: 'cs_test_2' }));

    await post(app);

    expect(ghlNotify.notifyGHL).toHaveBeenCalledWith('contact-1', expect.objectContaining({ transactionId: 'Stripe/cs_test_2' }));
  });

  test('a payment with no contactId in metadata and no customer email still acknowledges 200 (notifyGHL is a no-op without a contactId)', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(checkoutCompletedEvent({ metadata: {} }));

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(ghlContact.resolveContactId).not.toHaveBeenCalled();
    expect(ghlNotify.notifyGHL).toHaveBeenCalledWith('', expect.any(Object));
  });

  test('resolves a contact from Stripe-collected customer details when the link had no contactId', async () => {
    const app = buildApp();
    ghlContact.resolveContactId.mockResolvedValueOnce('resolved-contact');
    stripeClient.constructWebhookEvent.mockReturnValue(
      checkoutCompletedEvent({ metadata: {}, customer_details: { email: 'shopper@example.com', name: 'Ada Lovelace' } })
    );

    await post(app);

    expect(ghlContact.resolveContactId).toHaveBeenCalledWith('shopper@example.com', 'Ada', 'Lovelace');
    expect(ghlNotify.notifyGHL).toHaveBeenCalledWith('resolved-contact', expect.any(Object));
  });

  test('passes the cart description through to the GHL contact note for a confirmed payment', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(
      checkoutCompletedEvent({ metadata: { contactId: 'contact-1', description: 'Cart total (2 items)' } })
    );

    await post(app);

    expect(ghlNotify.notifyGHL).toHaveBeenCalledWith('contact-1', {
      transactionId: 'Stripe/pi_123',
      amount: '49.99',
      currency: 'USD',
      description: 'Cart total (2 items)'
    });
  });

  test('never notifies GHL for an abandoned or unconfirmed payment', async () => {
    const app = buildApp();
    stripeClient.constructWebhookEvent.mockReturnValue(checkoutCompletedEvent({ payment_status: 'unpaid' }));

    await post(app);

    expect(ghlNotify.notifyGHL).not.toHaveBeenCalled();
  });
});

describe('a staff charge paid by Stripe', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.AMWELLINC_CARD_RESULT_URL; });

  test('reports to Admin and adds nothing to the CRM', async () => {
    process.env.AMWELLINC_CARD_RESULT_URL = 'https://admin.example/api/webhooks/gateway-card';
    const sent = [];
    global.fetch = jest.fn(async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; });
    const event = checkoutCompletedEvent();
    event.id = 'evt_pos_1';
    event.data.object.metadata = { ...event.data.object.metadata, posRef: 'charge-ref-3' };
    stripeClient.constructWebhookEvent.mockReturnValue(event);
    const res = await post(buildApp());
    expect(res.status).toBe(200);
    expect(sent[0]).toMatchObject({ ref: 'charge-ref-3', status: 'paid', gateway: 'Stripe' });
    expect(ghlNotify.notifyGHL).not.toHaveBeenCalled();
  });
});
