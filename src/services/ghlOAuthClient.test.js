jest.mock('axios');
const axios = require('axios');
const tokenStore = require('./ghlTokenStore');
const { exchangeCodeForTokens, refreshAccessToken, getValidAccessToken } = require('./ghlOAuthClient');

const config = { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'https://example.com/oauth/callback' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GHL_MARKETPLACE_CLIENT_ID = config.clientId;
  process.env.GHL_MARKETPLACE_CLIENT_SECRET = config.clientSecret;
  process.env.GHL_OAUTH_REDIRECT_URI = config.redirectUri;
});

describe('exchangeCodeForTokens', () => {
  test('posts grant_type=authorization_code with the code, and saves the returned tokens', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, locationId: 'loc-9' }
    });

    const result = await exchangeCodeForTokens('the-code');

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/oauth/token');
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('client_id')).toBe('client-1');
    expect(params.get('user_type')).toBe('Location');

    expect(result.accessToken).toBe('a1');
    expect(tokenStore.getTokens('loc-9').accessToken).toBe('a1');
  });

  test('rejects with a normalized error when the token request fails at the network level', async () => {
    axios.post.mockRejectedValueOnce(new Error('network timeout'));

    await expect(exchangeCodeForTokens('the-code')).rejects.toMatchObject({
      statusCode: 500,
      message: 'GHL OAuth token request failed'
    });
  });

  test('rejects when the GHL response is missing access_token', async () => {
    axios.post.mockResolvedValueOnce({
      data: { refresh_token: 'r1', expires_in: 3600, locationId: 'loc-missing-token' }
    });

    await expect(exchangeCodeForTokens('the-code')).rejects.toMatchObject({
      statusCode: 502,
      message: 'GHL OAuth response missing required fields'
    });
    expect(tokenStore.getTokens('loc-missing-token')).toBeNull();
  });

  test('rejects when the GHL response is missing expires_in', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'a1', refresh_token: 'r1', locationId: 'loc-missing-expiry' }
    });

    await expect(exchangeCodeForTokens('the-code')).rejects.toMatchObject({
      statusCode: 502,
      message: 'GHL OAuth response missing required fields'
    });
    expect(tokenStore.getTokens('loc-missing-expiry')).toBeNull();
  });

  test('rejects when the GHL response is missing locationId', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }
    });

    await expect(exchangeCodeForTokens('the-code')).rejects.toMatchObject({
      statusCode: 502,
      message: 'GHL OAuth response missing required fields'
    });
  });

  test('rejects with a clear config error when GHL_MARKETPLACE_CLIENT_ID is unset', async () => {
    delete process.env.GHL_MARKETPLACE_CLIENT_ID;

    await expect(exchangeCodeForTokens('the-code')).rejects.toMatchObject({ statusCode: 500 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects with a clear config error when GHL_MARKETPLACE_CLIENT_SECRET is unset', async () => {
    delete process.env.GHL_MARKETPLACE_CLIENT_SECRET;

    await expect(exchangeCodeForTokens('the-code')).rejects.toMatchObject({ statusCode: 500 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('getValidAccessToken', () => {
  test('returns the stored token directly when not expired', async () => {
    tokenStore.saveTokens({ locationId: 'loc-fresh', accessToken: 'still-good', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
    const token = await getValidAccessToken('loc-fresh');
    expect(token).toBe('still-good');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('refreshes when the stored token is expired', async () => {
    tokenStore.saveTokens({ locationId: 'loc-stale', accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000 });
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 }
    });

    const token = await getValidAccessToken('loc-stale');

    expect(token).toBe('new-token');
    const params = new URLSearchParams(axios.post.mock.calls[0][1]);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('r-old');
  });

  test('throws a clean 401 when there are no stored tokens for that location', async () => {
    await expect(getValidAccessToken('never-authorized')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('refreshAccessToken', () => {
  test('throws a clean error when the store has no tokens to refresh', async () => {
    await expect(refreshAccessToken('unknown-location')).rejects.toMatchObject({ statusCode: 401 });
  });

  test('rejects with a normalized error when the refresh request fails at the network level', async () => {
    tokenStore.saveTokens({ locationId: 'loc-net', accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000 });
    axios.post.mockRejectedValueOnce(new Error('network timeout'));

    await expect(refreshAccessToken('loc-net')).rejects.toMatchObject({
      statusCode: 500,
      message: 'GHL OAuth token request failed'
    });
  });

  test('rejects when the refresh response is missing required fields', async () => {
    tokenStore.saveTokens({ locationId: 'loc-bad', accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000 });
    axios.post.mockResolvedValueOnce({ data: { refresh_token: 'new-refresh' } });

    await expect(refreshAccessToken('loc-bad')).rejects.toMatchObject({
      statusCode: 502,
      message: 'GHL OAuth response missing required fields'
    });
  });

  test('rejects with a clear config error when credentials are unset', async () => {
    tokenStore.saveTokens({ locationId: 'loc-cfg', accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() - 1000 });
    delete process.env.GHL_MARKETPLACE_CLIENT_ID;

    await expect(refreshAccessToken('loc-cfg')).rejects.toMatchObject({ statusCode: 500 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
