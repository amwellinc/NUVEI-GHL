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
