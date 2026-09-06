jest.mock('stripe');

describe('stripeClient', () => {
  const OLD_ENV = process.env;
  let Stripe;
  let mockSessionsCreate;
  let mockConstructEvent;
  let mockPaymentIntentsCreate;
  let mockPaymentIntentsRetrieve;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_123' };

    // 'stripe' must be re-required after resetModules() — the mock
    // implementation is set on this fresh reference, not the one captured
    // at file-load time, since stripeClient.js's own require('stripe') (run
    // when each test requires './stripeClient' below) resolves against the
    // same post-reset module registry.
    Stripe = require('stripe');
    mockSessionsCreate = jest.fn();
    mockConstructEvent = jest.fn();
    mockPaymentIntentsCreate = jest.fn();
    mockPaymentIntentsRetrieve = jest.fn();
    Stripe.mockImplementation(() => ({
      checkout: { sessions: { create: mockSessionsCreate } },
      webhooks: { constructEvent: mockConstructEvent },
      paymentIntents: { create: mockPaymentIntentsCreate, retrieve: mockPaymentIntentsRetrieve }
    }));
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.clearAllMocks();
  });

  describe('createCheckoutSession', () => {
    test('prices a single line item in cents and passes success/cancel URLs + metadata through', async () => {
      const { createCheckoutSession } = require('./stripeClient');
      mockSessionsCreate.mockResolvedValueOnce({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' });

      const result = await createCheckoutSession({
        amount: '49.99',
        currency: 'USD',
        description: 'Consultation',
        successUrl: 'https://wellness111.com/thanks',
        cancelUrl: 'https://wellness111.com/cancelled',
        metadata: { contactId: 'contact-1' }
      });

      expect(mockSessionsCreate).toHaveBeenCalledWith({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Consultation' },
              unit_amount: 4999
            },
            quantity: 1
          }
        ],
        success_url: 'https://wellness111.com/thanks',
        cancel_url: 'https://wellness111.com/cancelled',
        metadata: { contactId: 'contact-1' }
      });
      expect(result).toEqual({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' });
    });

    test('falls back to a generic product name when no description is given', async () => {
      const { createCheckoutSession } = require('./stripeClient');
      mockSessionsCreate.mockResolvedValueOnce({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' });

      await createCheckoutSession({ amount: 10, currency: 'USD', successUrl: 'https://a.com/s', cancelUrl: 'https://a.com/c' });

      expect(mockSessionsCreate.mock.calls[0][0].line_items[0].price_data.product_data).toEqual({ name: 'Payment' });
    });

    test('throws a clean error when STRIPE_SECRET_KEY is not configured', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { createCheckoutSession } = require('./stripeClient');

      await expect(
        createCheckoutSession({ amount: 10, currency: 'USD', successUrl: 'https://a.com/s', cancelUrl: 'https://a.com/c' })
      ).rejects.toMatchObject({ statusCode: 500, message: 'STRIPE_SECRET_KEY is not configured' });
      expect(mockSessionsCreate).not.toHaveBeenCalled();
    });
  });

  describe('createPaymentIntent', () => {
    test('prices in cents and restricts to card only (no Link/wallet auto-detection)', async () => {
      const { createPaymentIntent } = require('./stripeClient');
      mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'pi_1_secret_abc' });

      const result = await createPaymentIntent({
        amount: '49.99',
        currency: 'USD',
        description: 'Order W111-1',
        metadata: { chargeId: 'charge-1' }
      });

      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
        amount: 4999,
        currency: 'usd',
        description: 'Order W111-1',
        metadata: { chargeId: 'charge-1' },
        payment_method_types: ['card']
      });
      expect(result).toEqual({ id: 'pi_1', client_secret: 'pi_1_secret_abc' });
    });

    test('uses a distinct Stripe client when an explicit secretKey is supplied (GHL test/live mode)', async () => {
      const { createPaymentIntent } = require('./stripeClient');
      mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_test_1' });

      await createPaymentIntent({ amount: 10, currency: 'USD', secretKey: 'sk_test_override' });

      expect(Stripe).toHaveBeenCalledWith('sk_test_override');
    });

    test('throws a clean error when no secret key is available at all', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { createPaymentIntent } = require('./stripeClient');

      await expect(createPaymentIntent({ amount: 10, currency: 'USD' })).rejects.toMatchObject({
        statusCode: 500,
        message: 'STRIPE_SECRET_KEY is not configured'
      });
    });
  });

  describe('retrievePaymentIntent', () => {
    test('retrieves by id using the active key by default', async () => {
      const { retrievePaymentIntent } = require('./stripeClient');
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({ id: 'pi_1', status: 'succeeded' });

      const result = await retrievePaymentIntent('pi_1');

      expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith('pi_1');
      expect(result).toEqual({ id: 'pi_1', status: 'succeeded' });
    });

    test('uses the explicit secretKey when supplied, matching the key used to create the intent', async () => {
      const { retrievePaymentIntent } = require('./stripeClient');
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({ id: 'pi_test_1', status: 'succeeded' });

      await retrievePaymentIntent('pi_test_1', 'sk_test_override');

      expect(Stripe).toHaveBeenCalledWith('sk_test_override');
    });
  });

  describe('constructWebhookEvent', () => {
    test('verifies the signature against the raw body and returns the parsed event', () => {
      const { constructWebhookEvent } = require('./stripeClient');
      const rawBody = Buffer.from('{"id":"evt_1"}');
      mockConstructEvent.mockReturnValueOnce({ id: 'evt_1', type: 'checkout.session.completed' });

      const event = constructWebhookEvent(rawBody, 'sig_abc');

      expect(mockConstructEvent).toHaveBeenCalledWith(rawBody, 'sig_abc', 'whsec_123');
      expect(event).toEqual({ id: 'evt_1', type: 'checkout.session.completed' });
    });

    test('propagates a signature-verification failure from the SDK', () => {
      const { constructWebhookEvent } = require('./stripeClient');
      mockConstructEvent.mockImplementationOnce(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      expect(() => constructWebhookEvent(Buffer.from('{}'), 'bad-sig')).toThrow(/signatures/);
    });

    test('throws a clean error when STRIPE_WEBHOOK_SECRET is not configured', () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const { constructWebhookEvent } = require('./stripeClient');

      expect(() => constructWebhookEvent(Buffer.from('{}'), 'sig')).toThrow(/STRIPE_WEBHOOK_SECRET/);
      expect(mockConstructEvent).not.toHaveBeenCalled();
    });
  });
});
