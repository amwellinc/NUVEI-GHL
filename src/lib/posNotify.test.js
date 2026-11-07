const { notifyPosResult } = require('./posNotify');

describe('notifyPosResult', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.AMWELLINC_CARD_RESULT_URL = 'https://admin.example/api/webhooks/gateway-card';
    process.env.GATEWAY_API_KEY = 'k1';
  });
  afterEach(() => { global.fetch = realFetch; delete process.env.AMWELLINC_CARD_RESULT_URL; delete process.env.GATEWAY_API_KEY; });

  const result = { ref: 'r1', status: 'paid', gateway: 'Nuvei', transactionId: 'Nuvei/1', amount: '10.00', currency: 'USD' };

  it('sends the result with the key', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    await notifyPosResult(result, { retryDelayMs: 0 });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://admin.example/api/webhooks/gateway-card');
    expect(options.headers.Authorization).toBe('Bearer k1');
    expect(JSON.parse(options.body)).toEqual(result);
  });
  it('retries when Admin can\'t be reached', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ ok: true, status: 200 });
    await notifyPosResult(result, { retryDelayMs: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it('never throws, because the charge already happened', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    await expect(notifyPosResult(result, { retryDelayMs: 0 })).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
  it('does nothing when no address is set', async () => {
    delete process.env.AMWELLINC_CARD_RESULT_URL;
    global.fetch = jest.fn();
    await expect(notifyPosResult(result, { retryDelayMs: 0 })).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('orderNumberFrom', () => {
  const { orderNumberFrom } = require('./posNotify');
  it('reads the order number from the website return address', () => {
    expect(orderNumberFrom('https://wellness111.com/thank-you?order=W111-20261107-3120367616&email=a')).toBe('W111-20261107-3120367616');
  });
  it('is empty for anything else', () => {
    expect(orderNumberFrom('https://wellness111.com/thank-you')).toBe('');
    expect(orderNumberFrom('')).toBe('');
    expect(orderNumberFrom('not a url')).toBe('');
  });
});

describe('notifyWebsitePayment', () => {
  const { notifyWebsitePayment } = require('./posNotify');
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.AMWELLINC_WEBSITE_PAID_URL; });
  it('tells Admin an order was paid', async () => {
    process.env.AMWELLINC_WEBSITE_PAID_URL = 'https://admin.example/api/webhooks/gateway-website';
    const sent = [];
    global.fetch = jest.fn(async (u, o) => { sent.push([u, JSON.parse(o.body)]); return { ok: true, status: 200 }; });
    await notifyWebsitePayment({ orderNumber: 'W111-1', transactionId: 'Stripe/x', amount: '293.00', currency: 'USD', gateway: 'Stripe' }, { retryDelayMs: 0 });
    expect(sent[0][0]).toContain('gateway-website');
    expect(sent[0][1].orderNumber).toBe('W111-1');
  });
  it('does nothing without an order number or address', async () => {
    global.fetch = jest.fn();
    await notifyWebsitePayment({ orderNumber: '', transactionId: 'x', amount: '1', currency: 'USD', gateway: 'Nuvei' }, { retryDelayMs: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
