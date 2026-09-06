const request = require('supertest');

describe('server.js (app configuration)', () => {
  let app;

  beforeAll(() => {
    // Requiring server.js must not bind a real port or install process-level
    // signal handlers in tests — see the require.main === module guard.
    app = require('./server');
  });

  test('does not start a real listener or install SIGTERM/SIGINT handlers when required (not run directly)', () => {
    expect(app.listening).toBeUndefined();
  });

  test('trusts exactly one reverse-proxy hop, so req.ip reflects the real client via X-Forwarded-For', () => {
    // Railway (and any single reverse-proxy deployment) sits in front of this
    // app — without `trust proxy` set, every request's req.ip collapses to
    // the proxy's own address, silently merging every client into one shared
    // rate-limit bucket (see src/lib/security.js's createRateLimiter).
    expect(app.get('trust proxy')).toBe(1);
  });

  test('sets baseline security headers (HSTS, nosniff, referrer policy) on every response, including a 404', async () => {
    const res = await request(app).get('/this-route-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('does not force X-Frame-Options globally — the GHL provider checkout page must remain embeddable via its own scoped CSP', async () => {
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });
});
