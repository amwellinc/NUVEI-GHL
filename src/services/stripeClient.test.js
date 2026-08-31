jest.mock('stripe');

describe('stripeClient', () => {
  const OLD_ENV = process.env;
  let Stripe;
  let mockSessionsCreate;
  let mockConstructEvent;

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
    Stripe.mockImplementation(() => ({
      checkout: { sessions: { create: mockSessionsCreate } },
      webhooks: { constructEvent: mockConstructEvent }
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
