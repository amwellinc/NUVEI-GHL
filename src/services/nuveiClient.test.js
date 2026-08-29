const crypto = require('crypto');

jest.mock('axios');
const axios = require('axios');

const NuveiClient = require('./nuveiClient');

const baseConfig = {
  merchantId: 'merchant-1',
  merchantSiteId: 'site-1',
  secretKey: 'shh-secret'
};

describe('NuveiClient#calculateChecksum', () => {
  test('hashes ordered fields with secretKey appended, matching Nuvei\'s documented formula', () => {
    const client = new NuveiClient(baseConfig);
    const fields = ['merchant-1', 'site-1', 'req-1', '10.00', 'USD', '20260829120000'];

    const expected = crypto
      .createHash('sha256')
      .update(fields.join('') + baseConfig.secretKey)
      .digest('hex');

    expect(client.calculateChecksum(fields)).toBe(expected);
  });

  test('treats null/undefined fields as empty strings rather than the literal text', () => {
    const client = new NuveiClient(baseConfig);
    const withNulls = client.calculateChecksum(['a', null, undefined, 'b']);
    const withEmpties = client.calculateChecksum(['a', '', '', 'b']);
    expect(withNulls).toBe(withEmpties);
  });
});

describe('NuveiClient#generateTimeStamp', () => {
  test('returns a 14-digit YYYYMMDDHHmmss string', () => {
    const client = new NuveiClient(baseConfig);
    expect(client.generateTimeStamp()).toMatch(/^\d{14}$/);
  });
});

describe('NuveiClient host selection', () => {
  test('defaults to the sandbox host when sandboxMode is not explicitly false', () => {
    const client = new NuveiClient(baseConfig);
    expect(client.apiEndpoint).toBe('https://ppp-test.nuvei.com/ppp/api/v1');
  });

  test('uses the production host when sandboxMode is false', () => {
    const client = new NuveiClient({ ...baseConfig, sandboxMode: false });
    expect(client.apiEndpoint).toBe('https://secure.safecharge.com/ppp/api/v1');
  });

  test('respects an explicit apiEndpoint override', () => {
    const client = new NuveiClient({ ...baseConfig, apiEndpoint: 'https://custom.example.com/api' });
    expect(client.apiEndpoint).toBe('https://custom.example.com/api');
  });
});

describe('NuveiClient#assertConfigured', () => {
  test('does not throw when merchantId, merchantSiteId, and secretKey are all present', () => {
    const client = new NuveiClient(baseConfig);
    expect(() => client.assertConfigured()).not.toThrow();
  });

  test.each([
    ['merchantId', { ...baseConfig, merchantId: undefined }],
    ['merchantSiteId', { ...baseConfig, merchantSiteId: undefined }],
    ['secretKey', { ...baseConfig, secretKey: undefined }]
  ])('throws a 500-shaped error when %s is missing', (_field, config) => {
    const client = new NuveiClient(config);
    expect.assertions(2);
    try {
      client.assertConfigured();
    } catch (err) {
      expect(err.statusCode).toBe(500);
      expect(err.message).toMatch(/merchantId, merchantSiteId, and secretKey/);
    }
  });

  test('the app does not crash on require when credentials are incomplete — validation is deferred to call time', () => {
    expect(() => new NuveiClient({})).not.toThrow();
  });
});

describe('NuveiClient request flow (network mocked)', () => {
  afterEach(() => jest.clearAllMocks());

  test('createPayment fetches a session token before calling /payment, and both calls carry a checksum', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { sessionToken: 'session-abc' } })
      .mockResolvedValueOnce({ data: { transactionId: 'txn-1', status: 'APPROVED' } });

    const client = new NuveiClient(baseConfig);
    const result = await client.createPayment({
      amount: 10,
      currency: 'USD',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      ccNumber: '4111111111111111',
      ccExpMonth: '12',
      ccExpYear: '2027',
      ccCvv: '123'
    });

    expect(axios.post).toHaveBeenCalledTimes(2);

    const [sessionUrl, sessionPayload] = axios.post.mock.calls[0];
    expect(sessionUrl).toBe('https://ppp-test.nuvei.com/ppp/api/v1/getSessionToken');
    expect(sessionPayload.checksum).toEqual(expect.any(String));
    expect(sessionPayload.merchantId).toBe('merchant-1');
    expect(sessionPayload.merchantSiteId).toBe('site-1');

    const [paymentUrl, paymentPayload] = axios.post.mock.calls[1];
    expect(paymentUrl).toBe('https://ppp-test.nuvei.com/ppp/api/v1/payment');
    expect(paymentPayload.sessionToken).toBe('session-abc');
    expect(paymentPayload.amount).toBe('10.00');
    expect(paymentPayload.paymentOption.card.cardNumber).toBe('4111111111111111');
    expect(paymentPayload.checksum).toEqual(expect.any(String));

    expect(result).toEqual({ transactionId: 'txn-1', status: 'APPROVED' });
  });

  test('createPayment surfaces a clear error when session token acquisition fails to return a token', async () => {
    axios.post.mockResolvedValueOnce({ data: { errorCode: 1, reason: 'Invalid merchant' } });

    const client = new NuveiClient(baseConfig);
    await expect(
      client.createPayment({ amount: 10, currency: 'USD', email: 'a@b.com' })
    ).rejects.toMatchObject({ statusCode: 502 });

    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('refundPayment posts relatedTransactionId and a checksum without a prior session call', async () => {
    axios.post.mockResolvedValueOnce({ data: { status: 'SUCCESS' } });

    const client = new NuveiClient(baseConfig);
    await client.refundPayment({ transactionId: 'txn-1', amount: 5, currency: 'USD' });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toBe('https://ppp-test.nuvei.com/ppp/api/v1/refundTransaction');
    expect(payload.relatedTransactionId).toBe('txn-1');
    expect(payload.amount).toBe('5.00');
    expect(payload.checksum).toEqual(expect.any(String));
  });

  test('a request made without full credentials rejects with a clean 500 instead of throwing synchronously', async () => {
    const client = new NuveiClient({ merchantId: 'merchant-1' });
    await expect(client.refundPayment({ transactionId: 'txn-1', amount: 5, currency: 'USD' })).rejects.toMatchObject({
      statusCode: 500
    });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
