jest.mock('axios');
jest.mock('./ghlOAuthClient');

const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');
const { getTransactionAmount } = require('./ghlTransactionsClient');

describe('getTransactionAmount', () => {
  afterEach(() => jest.clearAllMocks());

  test('fetches the transaction with a bearer token and v3 version header, returns the amount (bare-object response shape)', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { _id: 'txn-1', amount: 149.99, entityId: 'order-1', entityType: 'order' } });

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

  test('fetches the transaction with a bearer token and v3 version header, returns the amount (array-wrapped response shape)', async () => {
    // Confirmed live against a real pending invoice payment: this endpoint
    // has been observed returning the transaction wrapped in a single-
    // element array rather than the bare object GHL's own docs show — the
    // amount is fully populated even pre-payment, contrary to an earlier
    // assumption that it only appears once a charge completes.
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({
      data: [{ _id: 'txn-1', amount: 1.95, currency: 'USD', status: 'pending', entityType: 'invoice', entityId: 'inv-1' }]
    });

    const amount = await getTransactionAmount('loc-1', 'txn-1');

    expect(amount).toBe(1.95);
  });

  test('picks the array element whose _id matches the requested transactionId, not just index 0', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({
      data: [{ _id: 'some-other-txn', amount: 999 }, { _id: 'txn-1', amount: 1.95 }]
    });

    const amount = await getTransactionAmount('loc-1', 'txn-1');

    expect(amount).toBe(1.95);
  });

  test('URL-encodes the transactionId so it cannot inject extra query parameters or path segments', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { amount: 10 } });

    await getTransactionAmount('loc-1', 'txn-1?locationId=OTHER_LOCATION');

    const [url] = axios.get.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/payments/transactions/txn-1%3FlocationId%3DOTHER_LOCATION');
    expect(url).not.toContain('?locationId=OTHER_LOCATION');
  });

  test('rejects with a clean 502 when the request fails', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockRejectedValueOnce({ message: 'Request failed', response: { status: 404, data: { message: 'not found' } } });

    await expect(getTransactionAmount('loc-1', 'missing-txn')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Failed to verify this transaction'
    });
  });

  test('rejects with a clean 502 when the response has no valid numeric amount', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { amount: undefined } });

    await expect(getTransactionAmount('loc-1', 'txn-1')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Transaction response missing a valid amount'
    });
  });

  test('rejects with a clean 502 when an array response has no matching or usable element', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: [] });

    await expect(getTransactionAmount('loc-1', 'txn-1')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Transaction response missing a valid amount'
    });
  });

  test('propagates a rejection from getValidAccessToken (e.g. never-authorized location) without calling axios', async () => {
    getValidAccessToken.mockRejectedValueOnce({ statusCode: 401, message: 'No stored GHL OAuth tokens for location loc-2 — re-authorize' });

    await expect(getTransactionAmount('loc-2', 'txn-1')).rejects.toMatchObject({ statusCode: 401 });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
