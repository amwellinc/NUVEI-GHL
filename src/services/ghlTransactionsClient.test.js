jest.mock('axios');
jest.mock('./ghlOAuthClient');

const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');
const { getTransactionAmount } = require('./ghlTransactionsClient');

describe('getTransactionAmount', () => {
  afterEach(() => jest.clearAllMocks());

  test('fetches the transaction with a bearer token and v3 version header, returns the amount', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { amount: 149.99, entityId: 'order-1', entityType: 'order' } });

    const amount = await getTransactionAmount('loc-1', 'txn-1');

    expect(getValidAccessToken).toHaveBeenCalledWith('loc-1');
    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/payments/transactions/txn-1');
    expect(options.params).toEqual({ altId: 'loc-1', altType: 'location', locationId: 'loc-1' });
    expect(options.headers.Authorization).toBe('Bearer bearer-token-123');
    expect(options.headers.Version).toBe('v3');
    expect(amount).toBe(149.99);
  });

  test('URL-encodes the transactionId so it cannot inject extra query parameters or path segments', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { amount: 10 } });

    await getTransactionAmount('loc-1', 'txn-1?locationId=OTHER_LOCATION');

    const [url] = axios.get.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/payments/transactions/txn-1%3FlocationId%3DOTHER_LOCATION');
    expect(url).not.toContain('?locationId=OTHER_LOCATION');
  });

  test('rejects with a clean 502 when the GHL request fails', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockRejectedValueOnce({ message: 'Request failed', response: { status: 404, data: { message: 'not found' } } });

    await expect(getTransactionAmount('loc-1', 'missing-txn')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Failed to verify transaction with GHL'
    });
  });

  test('rejects with a clean 502 when the response has no valid numeric amount', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { amount: undefined } });

    await expect(getTransactionAmount('loc-1', 'txn-1')).rejects.toMatchObject({
      statusCode: 502,
      message: 'GHL transaction response missing a valid amount'
    });
  });

  test('propagates a rejection from getValidAccessToken (e.g. never-authorized location) without calling axios', async () => {
    getValidAccessToken.mockRejectedValueOnce({ statusCode: 401, message: 'No stored GHL OAuth tokens for location loc-2 — re-authorize' });

    await expect(getTransactionAmount('loc-2', 'txn-1')).rejects.toMatchObject({ statusCode: 401 });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
