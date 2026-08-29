const crypto = require('crypto');

jest.mock('axios');
const axios = require('axios');

const NuveiClient = require('./nuveiClient');

const config = {
  username: 'testuser',
  password: 'testpass',
  securityKey: '64E9257352B95186DC86E598ECB97F5D49FB04D58F974051'
};

function encryptForTest(client, obj) {
  return client.encrypt(JSON.stringify(obj));
}

function gatewayResponse(client, obj) {
  return { status: 200, data: client.encrypt(JSON.stringify(obj)) };
}

describe('NuveiClient encryption (Triple DES / DES-EDE3 ECB)', () => {
  test('round-trips a payload through encrypt then decrypt', () => {
    const client = new NuveiClient(config);
    const plaintext = JSON.stringify({ PING: 'Ping Ping' });
    expect(client.decrypt(client.encrypt(plaintext))).toBe(plaintext);
  });

  test('the derived cipher key is exactly 24 bytes, as DES-EDE3 requires', () => {
    const client = new NuveiClient(config);
    expect(client.cipherKey.length).toBe(24);
  });

  test('output is hex-encoded ciphertext, decryptable independently via Node crypto with the same key', () => {
    const client = new NuveiClient(config);
    const encrypted = client.encrypt('{"a":1}');
    expect(encrypted).toMatch(/^[0-9a-f]+$/);

    const decipher = crypto.createDecipheriv('des-ede3', client.cipherKey, '');
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()]);
    expect(decrypted.toString('utf8')).toBe('{"a":1}');
  });
});

describe('NuveiClient#assertConfigured', () => {
  test('does not throw when username, password, and securityKey are all present', () => {
    const client = new NuveiClient(config);
    expect(() => client.assertConfigured()).not.toThrow();
  });

  test.each([
    ['username', { ...config, username: undefined }],
    ['password', { ...config, password: undefined }],
    ['securityKey', { ...config, securityKey: undefined }]
  ])('throws a 500-shaped error when %s is missing (all three are required together)', (_field, badConfig) => {
    const client = new NuveiClient(badConfig);
    expect.assertions(2);
    try {
      client.assertConfigured();
    } catch (err) {
      expect(err.statusCode).toBe(500);
      expect(err.message).toMatch(/username, password, and securityKey/);
    }
  });

  test('the app does not crash on require when credentials are incomplete — validation is deferred to call time', () => {
    expect(() => new NuveiClient({})).not.toThrow();
  });
});

describe('NuveiClient host selection', () => {
  test('defaults to the sandbox host', () => {
    const client = new NuveiClient(config);
    expect(client.apiEndpoint).toBe('https://gateway.basecommercesandbox.com');
  });

  test('uses the production host when production: true', () => {
    const client = new NuveiClient({ ...config, production: true });
    expect(client.apiEndpoint).toBe('https://gateway.basecommerce.com');
  });

  test('respects an explicit apiEndpoint override', () => {
    const client = new NuveiClient({ ...config, apiEndpoint: 'https://custom.example.com' });
    expect(client.apiEndpoint).toBe('https://custom.example.com');
  });
});

describe('NuveiClient#post (network mocked)', () => {
  afterEach(() => jest.clearAllMocks());

  test('sends gateway_username/gateway_password and an encrypted payload, decrypts the response', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce(gatewayResponse(client, { success: 'success' }));

    const result = await client.post('/pcms/?f=API_PingPong', { PING: 'Ping Ping' });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('https://gateway.basecommercesandbox.com/pcms/?f=API_PingPong');
    expect(body.gateway_username).toBe('testuser');
    expect(body.gateway_password).toBe('testpass');
    expect(body.payload).toMatch(/^[0-9a-f]+$/);
    expect(options.headers['Content-Type']).toBe('application/json');

    expect(result).toEqual({ success: 'success' });
  });

  test('a call made without full credentials rejects with a clean 500 instead of throwing synchronously', async () => {
    const client = new NuveiClient({ username: 'onlyusername' });
    await expect(client.post('/x', {})).rejects.toMatchObject({ statusCode: 500 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('maps HTTP 403 to a 401 invalid-credentials error', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce({ status: 403, data: '' });
    await expect(client.post('/x', {})).rejects.toMatchObject({ statusCode: 401, message: 'Invalid BaseCommerce credentials' });
  });

  test('surfaces a non-200/403/404 gateway status as a 502 without crashing on a non-decryptable body', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce({ status: 500, data: '<html>Base Commerce error page</html>' });
    await expect(client.post('/x', {})).rejects.toMatchObject({ statusCode: 502 });
  });

  test('throws a 402 when the gateway returns an "exception" object', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce(gatewayResponse(client, { exception: { bank_card_transaction_card_cvv2: 'CVV Required' } }));
    await expect(client.post('/x', {})).rejects.toMatchObject({ statusCode: 402, message: 'CVV Required' });
  });
});

describe('NuveiClient#createPayment', () => {
  afterEach(() => jest.clearAllMocks());

  test('builds a SALE with bank_card_transaction_* fields including card_cvv2, and returns the parsed result on approval', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce(gatewayResponse(client, {
      bank_card_transaction: {
        bank_card_transaction_id: 171808311,
        bank_card_transaction_status: { bank_card_transaction_status_name: 'CAPTURED' },
        bank_card_transaction_response_code: '100'
      }
    }));

    const result = await client.createPayment({
      amount: 1,
      firstName: 'Test',
      lastName: 'Verify',
      ccNumber: '4111111111111111',
      ccExpMonth: '12',
      ccExpYear: '2027',
      ccCvv: '123',
      billingAddress: { city: 'Tustin', state: 'CA', zip: '92780', country: 'US' }
    });

    const [, body] = axios.post.mock.calls[0];
    const sent = JSON.parse(client.decrypt(body.payload));
    expect(sent.bank_card_transaction_name).toBe('Test Verify');
    expect(sent.bank_card_transaction_card_number).toBe('4111111111111111');
    expect(sent.bank_card_transaction_expiration_month).toBe('12');
    expect(sent.bank_card_transaction_expiration_year).toBe('2027');
    expect(sent.bank_card_transaction_card_cvv2).toBe('123');
    expect(sent.bank_card_transaction_type).toBe('SALE');
    expect(sent.bank_card_transaction_amount).toBe('1.00');
    expect(sent.bank_card_transaction_billing_address).toEqual({
      address_name: 'Test Verify',
      address_city: 'Tustin',
      address_state: 'CA',
      address_zipcode: '92780',
      address_country: 'US'
    });

    expect(result).toEqual({
      transactionId: 171808311,
      status: 'CAPTURED',
      responseCode: '100',
      raw: expect.any(Object)
    });
  });

  test('rejects with a 402 and the decline reason on a DECLINED transaction', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce(gatewayResponse(client, {
      bank_card_transaction: {
        bank_card_transaction_id: 171808295,
        bank_card_transaction_status: { bank_card_transaction_status_name: 'DECLINED' },
        bank_card_transaction_response_code: '2006',
        bank_card_transaction_response_message: 'No such Issuer'
      }
    }));

    await expect(
      client.createPayment({
        amount: 1, firstName: 'A', lastName: 'B',
        ccNumber: '4111111111111111', ccExpMonth: '12', ccExpYear: '2027', ccCvv: '123'
      })
    ).rejects.toMatchObject({ statusCode: 402, message: 'No such Issuer' });
  });
});

describe('NuveiClient#refundPayment', () => {
  afterEach(() => jest.clearAllMocks());

  test('posts bank_card_transaction_id/amount/type=REFUND', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce(gatewayResponse(client, {
      bank_card_transaction: {
        bank_card_transaction_id: 999,
        bank_card_transaction_status: { bank_card_transaction_status_name: 'SETTLED' }
      }
    }));

    const result = await client.refundPayment({ transactionId: '123', amount: 5 });
    const [, body] = axios.post.mock.calls[0];
    const sent = JSON.parse(client.decrypt(body.payload));

    expect(sent.bank_card_transaction_id).toBe('123');
    expect(sent.bank_card_transaction_amount).toBe('5.00');
    expect(sent.bank_card_transaction_type).toBe('REFUND');
    expect(result.transactionId).toBe(999);
  });
});

describe('NuveiClient#voidPayment', () => {
  afterEach(() => jest.clearAllMocks());

  test('posts bank_card_transaction_id/type=VOID with no amount', async () => {
    const client = new NuveiClient(config);
    axios.post.mockResolvedValueOnce(gatewayResponse(client, {
      bank_card_transaction: {
        bank_card_transaction_id: 456,
        bank_card_transaction_status: { bank_card_transaction_status_name: 'VOIDED' }
      }
    }));

    await client.voidPayment({ transactionId: '456' });
    const [, body] = axios.post.mock.calls[0];
    const sent = JSON.parse(client.decrypt(body.payload));

    expect(sent.bank_card_transaction_id).toBe('456');
    expect(sent.bank_card_transaction_type).toBe('VOID');
    expect(sent.bank_card_transaction_amount).toBeUndefined();
  });
});

describe('NuveiClient#getPaymentDetails', () => {
  test('is explicitly not implemented — no lookup endpoint was confirmed', async () => {
    const client = new NuveiClient(config);
    await expect(client.getPaymentDetails('123')).rejects.toMatchObject({ statusCode: 501 });
  });
});
