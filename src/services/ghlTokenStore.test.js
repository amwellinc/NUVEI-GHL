const { saveTokens, getTokens, isExpired } = require('./ghlTokenStore');

describe('ghlTokenStore', () => {
  test('saveTokens then getTokens round-trips for a given locationId', () => {
    saveTokens({ locationId: 'loc-1', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 3600000 });
    const tokens = getTokens('loc-1');
    expect(tokens.accessToken).toBe('a1');
    expect(tokens.refreshToken).toBe('r1');
  });

  test('getTokens returns null for an unknown locationId', () => {
    expect(getTokens('never-saved')).toBeNull();
  });

  test('saving again for the same locationId overwrites the prior value', () => {
    saveTokens({ locationId: 'loc-2', accessToken: 'first', refreshToken: 'r', expiresAt: Date.now() + 1000 });
    saveTokens({ locationId: 'loc-2', accessToken: 'second', refreshToken: 'r', expiresAt: Date.now() + 1000 });
    expect(getTokens('loc-2').accessToken).toBe('second');
  });
});

describe('isExpired', () => {
  test('true once within 60s of expiresAt or past it', () => {
    expect(isExpired({ expiresAt: Date.now() - 1 })).toBe(true);
    expect(isExpired({ expiresAt: Date.now() + 30000 })).toBe(true);
  });

  test('false when comfortably before expiresAt', () => {
    expect(isExpired({ expiresAt: Date.now() + 3600000 })).toBe(false);
  });
});
