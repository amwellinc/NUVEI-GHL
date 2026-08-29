const { escapeHtml, redactErrorDetails, timingSafeEqual, isAllowedRedirect, createRateLimiter } = require('./security');

describe('escapeHtml', () => {
  test('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('neutralizes a script-tag breakout attempt', () => {
    const input = '"><script>alert(1)</script>';
    const escaped = escapeHtml(input);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toBe('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('coerces null/undefined to an empty string instead of the literal text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('redactErrorDetails', () => {
  test('keeps only the known-safe fields, dropping anything else including echoed input', () => {
    const raw = {
      errorCode: 1021,
      reason: 'Invalid card number',
      status: 'ERROR',
      ccNumber: '4111111111111111',
      rawRequestEcho: { ccCvv: '123' }
    };
    expect(redactErrorDetails(raw)).toEqual({
      errorCode: 1021,
      reason: 'Invalid card number',
      status: 'ERROR',
      gwErrorCode: undefined,
      gwErrorReason: undefined
    });
  });

  test('returns undefined for non-object input', () => {
    expect(redactErrorDetails(undefined)).toBeUndefined();
    expect(redactErrorDetails('a string')).toBeUndefined();
  });
});

describe('timingSafeEqual', () => {
  test('true only for an exact match', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
    expect(timingSafeEqual('secret', 'wrong')).toBe(false);
  });

  test('false for length mismatch or non-string input, without throwing', () => {
    expect(timingSafeEqual('secret', 'sec')).toBe(false);
    expect(timingSafeEqual(undefined, 'secret')).toBe(false);
    expect(timingSafeEqual(null, null)).toBe(false);
  });
});

describe('isAllowedRedirect', () => {
  const allowed = ['https://am333-nuvei-production.up.railway.app', 'https://app.gohighlevel.com'];

  test('allows a URL whose origin is in the allowlist', () => {
    expect(isAllowedRedirect('https://app.gohighlevel.com/funnel/thank-you?x=1', allowed)).toBe(true);
  });

  test('rejects an attacker-controlled origin', () => {
    expect(isAllowedRedirect('https://evil.example.com/phish', allowed)).toBe(false);
  });

  test('rejects malformed URLs and empty input rather than throwing', () => {
    expect(isAllowedRedirect('not a url', allowed)).toBe(false);
    expect(isAllowedRedirect('', allowed)).toBe(false);
    expect(isAllowedRedirect(undefined, allowed)).toBe(false);
  });
});

describe('createRateLimiter', () => {
  function mockReqRes(ip) {
    const req = { ip };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    return { req, res };
  }

  test('allows requests under the limit and blocks once the window fills', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    const next = jest.fn();

    const { req, res } = mockReqRes('1.2.3.4');
    limiter(req, res, next);
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
  });

  test('tracks separate IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
    const next = jest.fn();

    const a = mockReqRes('1.1.1.1');
    const b = mockReqRes('2.2.2.2');
    limiter(a.req, a.res, next);
    limiter(b.req, b.res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(a.res.statusCode).toBeNull();
    expect(b.res.statusCode).toBeNull();
  });
});
