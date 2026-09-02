const fs = require('fs');
const os = require('os');
const path = require('path');

const OLD_ENV = process.env;
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-token-store-test-'));
  process.env = { ...OLD_ENV, GHL_TOKEN_STORE_PATH: path.join(tmpDir, 'tokens.json') };
  jest.resetModules();
});

afterEach(() => {
  process.env = OLD_ENV;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ghlTokenStore', () => {
  test('saveTokens then getTokens round-trips for a given locationId', () => {
    const { saveTokens, getTokens } = require('./ghlTokenStore');
    saveTokens({ locationId: 'loc-1', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 3600000 });
    const tokens = getTokens('loc-1');
    expect(tokens.accessToken).toBe('a1');
    expect(tokens.refreshToken).toBe('r1');
  });

  test('getTokens returns null for an unknown locationId', () => {
    const { getTokens } = require('./ghlTokenStore');
    expect(getTokens('never-saved')).toBeNull();
  });

  test('saving again for the same locationId overwrites the prior value', () => {
    const { saveTokens, getTokens } = require('./ghlTokenStore');
    saveTokens({ locationId: 'loc-2', accessToken: 'first', refreshToken: 'r', expiresAt: Date.now() + 1000 });
    saveTokens({ locationId: 'loc-2', accessToken: 'second', refreshToken: 'r', expiresAt: Date.now() + 1000 });
    expect(getTokens('loc-2').accessToken).toBe('second');
  });

  test('tokens survive a process restart when the store path is writable (Railway volume)', () => {
    const { saveTokens } = require('./ghlTokenStore');
    saveTokens({ locationId: 'loc-3', accessToken: 'persisted', refreshToken: 'r3', expiresAt: Date.now() + 3600000 });

    jest.resetModules();
    const { getTokens: getTokensAfterRestart } = require('./ghlTokenStore');
    expect(getTokensAfterRestart('loc-3').accessToken).toBe('persisted');
  });

  test('falls back to in-memory-only, without throwing, when the store path is not writable', () => {
    process.env.GHL_TOKEN_STORE_PATH = '/this/path/cannot/possibly/be/created/tokens.json';
    jest.resetModules();
    const { saveTokens, getTokens } = require('./ghlTokenStore');

    expect(() =>
      saveTokens({ locationId: 'loc-4', accessToken: 'a4', refreshToken: 'r4', expiresAt: Date.now() + 3600000 })
    ).not.toThrow();
    // Still round-trips in-memory within the same process, even though it
    // won't survive a restart.
    expect(getTokens('loc-4').accessToken).toBe('a4');
  });

  test('starts empty rather than throwing when the store file exists but is malformed', () => {
    fs.writeFileSync(process.env.GHL_TOKEN_STORE_PATH, 'not valid json{{{');
    jest.resetModules();
    const { getTokens } = require('./ghlTokenStore');

    expect(getTokens('anything')).toBeNull();
  });
});

describe('isExpired', () => {
  test('true once within 60s of expiresAt or past it', () => {
    const { isExpired } = require('./ghlTokenStore');
    expect(isExpired({ expiresAt: Date.now() - 1 })).toBe(true);
    expect(isExpired({ expiresAt: Date.now() + 30000 })).toBe(true);
  });

  test('false when comfortably before expiresAt', () => {
    const { isExpired } = require('./ghlTokenStore');
    expect(isExpired({ expiresAt: Date.now() + 3600000 })).toBe(false);
  });
});
