const { generateProviderSecrets, verifyApiKey } = require('./ghlProviderConfig');

describe('generateProviderSecrets', () => {
  test('returns distinct 64-char hex apiKey and publishableKey for both live and test modes', () => {
    const secrets = generateProviderSecrets();
    for (const mode of ['live', 'test']) {
      expect(secrets[mode].apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(secrets[mode].publishableKey).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(secrets.live.apiKey).not.toBe(secrets.test.apiKey);
    expect(secrets.live.apiKey).not.toBe(secrets.live.publishableKey);
  });
});

describe('verifyApiKey', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, GHL_PROVIDER_LIVE_API_KEY: 'live-key-abc', GHL_PROVIDER_TEST_API_KEY: 'test-key-xyz' };
  });
  afterEach(() => { process.env = OLD_ENV; });

  test('true when the supplied key matches the configured key for that mode', () => {
    expect(verifyApiKey('live-key-abc', 'live')).toBe(true);
    expect(verifyApiKey('test-key-xyz', 'test')).toBe(true);
  });

  test('false on mismatch, wrong mode, or missing configuration, without throwing', () => {
    expect(verifyApiKey('wrong', 'live')).toBe(false);
    expect(verifyApiKey('live-key-abc', 'test')).toBe(false);
    expect(verifyApiKey(undefined, 'live')).toBe(false);
    expect(verifyApiKey('anything', 'nonexistent-mode')).toBe(false);
  });
});

jest.mock('axios');
jest.mock('./ghlOAuthClient');
const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');
const { registerProvider, createProviderIntegration } = require('./ghlProviderConfig');

describe('createProviderIntegration', () => {
  afterEach(() => jest.clearAllMocks());

  test('posts to the provider (base config) endpoint with a bearer token and v3 version header', async () => {
    axios.post.mockResolvedValueOnce({ data: { _id: 'integration-1', locationId: 'loc-1' } });

    const result = await createProviderIntegration({
      locationId: 'loc-1',
      accessToken: 'bearer-token-123',
      paymentsUrl: 'https://example.com/ghl-provider/checkout',
      queryUrl: 'https://example.com/ghl-provider/query',
      imageUrl: 'https://example.com/logo.png',
      name: 'Wellness111 Dual Payment System',
      description: 'AMWELL USA payment processing'
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/payments/custom-provider/provider?locationId=loc-1');
    expect(body).toEqual({
      name: 'Wellness111 Dual Payment System',
      description: 'AMWELL USA payment processing',
      paymentsUrl: 'https://example.com/ghl-provider/checkout',
      queryUrl: 'https://example.com/ghl-provider/query',
      imageUrl: 'https://example.com/logo.png',
      supportsSubscriptionSchedule: false
    });
    expect(options.headers.Authorization).toBe('Bearer bearer-token-123');
    expect(options.headers.Version).toBe('v3');
    expect(result).toEqual({ _id: 'integration-1', locationId: 'loc-1' });
  });
});

describe('registerProvider', () => {
  afterEach(() => jest.clearAllMocks());

  test('creates the base integration first, then connects with generated live/test keys', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.post
      .mockResolvedValueOnce({ data: { _id: 'integration-1' } }) // create-integration (step 1)
      .mockResolvedValueOnce({ data: { _id: 'provider-1', locationId: 'loc-1' } }); // connect (step 2)

    const result = await registerProvider({
      locationId: 'loc-1',
      paymentsUrl: 'https://example.com/ghl-provider/checkout',
      queryUrl: 'https://example.com/ghl-provider/query',
      imageUrl: 'https://example.com/logo.png',
      name: 'NUVEI-Payments',
      description: 'AMWELL USA payment processing'
    });

    expect(axios.post).toHaveBeenCalledTimes(2);

    const [step1Url] = axios.post.mock.calls[0];
    expect(step1Url).toBe('https://services.leadconnectorhq.com/payments/custom-provider/provider?locationId=loc-1');

    const [step2Url, step2Body, step2Options] = axios.post.mock.calls[1];
    expect(step2Url).toBe('https://services.leadconnectorhq.com/payments/custom-provider/connect?locationId=loc-1');
    expect(step2Body.paymentsUrl).toBe('https://example.com/ghl-provider/checkout');
    expect(step2Body.queryUrl).toBe('https://example.com/ghl-provider/query');
    expect(step2Body.live.apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(step2Body.test.apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(step2Options.headers.Authorization).toBe('Bearer bearer-token-123');
    expect(step2Options.headers.Version).toBe('v3');

    expect(result).toMatchObject({ _id: 'provider-1', locationId: 'loc-1' });
    expect(result.secrets.live.apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.secrets.test.apiKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test('does not attempt to connect if creating the base integration fails', async () => {
    getValidAccessToken.mockResolvedValueOnce('bearer-token-123');
    axios.post.mockRejectedValueOnce(new Error('GHL 422: Base config already exists'));

    await expect(
      registerProvider({
        locationId: 'loc-1',
        paymentsUrl: 'https://example.com/ghl-provider/checkout',
        queryUrl: 'https://example.com/ghl-provider/query',
        imageUrl: 'https://example.com/logo.png',
        name: 'NUVEI-Payments',
        description: 'AMWELL USA payment processing'
      })
    ).rejects.toThrow('GHL 422: Base config already exists');

    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
