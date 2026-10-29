jest.mock('axios');
jest.mock('./ghlOAuthClient');

const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');
const { getPriceAmount } = require('./ghlProductsClient');

describe('getPriceAmount', () => {
  afterEach(() => jest.clearAllMocks());

  test('fetches the product\'s prices with a bearer token, returns the matching price\'s amount/currency', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({
      data: {
        prices: [
          { _id: 'price-other', amount: 5, currency: 'USD' },
          { _id: 'price-1', amount: 19.9, currency: 'USD' }
        ],
        total: 2
      }
    });

    const price = await getPriceAmount('loc-1', 'product-1', 'price-1');

    expect(getValidAccessToken).toHaveBeenCalledWith('loc-1');
    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/products/product-1/price');
    expect(options.params).toEqual({ locationId: 'loc-1' });
    expect(options.headers.Authorization).toBe('Bearer bearer-token-123');
    expect(options.headers.Version).toBe('2021-07-28');
    expect(price).toEqual({ amount: 19.9, currency: 'USD' });
  });

  test('defaults currency to USD when the price record omits it', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { prices: [{ _id: 'price-1', amount: 10 }] } });

    const price = await getPriceAmount('loc-1', 'product-1', 'price-1');
    expect(price).toEqual({ amount: 10, currency: 'USD' });
  });

  test('URL-encodes the productId so it cannot inject extra query parameters or path segments', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { prices: [{ _id: 'price-1', amount: 10 }] } });

    await getPriceAmount('loc-1', 'product-1?locationId=OTHER_LOCATION', 'price-1');

    const [url] = axios.get.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/products/product-1%3FlocationId%3DOTHER_LOCATION/price');
    expect(url).not.toContain('?locationId=OTHER_LOCATION');
  });

  test('rejects with a clean 400 when no price in the product matches the given priceId', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { prices: [{ _id: 'some-other-price', amount: 10 }] } });

    await expect(getPriceAmount('loc-1', 'product-1', 'missing-price')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Price not found for this product'
    });
  });

  test('rejects with a clean 400 when the product has no prices at all', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { prices: [] } });

    await expect(getPriceAmount('loc-1', 'product-1', 'price-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects with a clean 502 when the matched price has no valid numeric amount', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockResolvedValueOnce({ data: { prices: [{ _id: 'price-1', amount: 'not-a-number' }] } });

    await expect(getPriceAmount('loc-1', 'product-1', 'price-1')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Product price is invalid'
    });
  });

  test('rejects with a clean 502 when the request itself fails', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.get.mockRejectedValueOnce({ message: 'Request failed', response: { status: 404, data: { message: 'not found' } } });

    await expect(getPriceAmount('loc-1', 'missing-product', 'price-1')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Failed to verify product price'
    });
  });

  test('propagates a rejection from getValidAccessToken (e.g. never-authorized location) without calling axios', async () => {
    getValidAccessToken.mockRejectedValueOnce({ statusCode: 401, message: 'No stored GHL OAuth tokens for location loc-2 — re-authorize' });

    await expect(getPriceAmount('loc-2', 'product-1', 'price-1')).rejects.toMatchObject({ statusCode: 401 });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
