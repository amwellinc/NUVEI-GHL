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
