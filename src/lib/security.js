const crypto = require('crypto');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes a value for safe interpolation into HTML text or attribute context.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Matches key names for anything that could carry cardholder data or a
// credential, regardless of which gateway's naming convention is in use
// (this integration has changed gateways more than once).
const SENSITIVE_KEY_PATTERN = /cc.?number|card.?number|cvv|cvc|csc|security.?(code|key)|secret|password|api.?key|ssn/i;

/**
 * Strips an upstream gateway/API error payload down to fields safe to
 * return to a client or write to logs, by dropping any key that looks like
 * it could carry cardholder data or a credential (recursively) rather than
 * allowlisting exact field names — gateway responses vary by provider and a
 * hardcoded allowlist silently drops useful fields (or worse, silently
 * admits a new sensitive field) whenever the upstream shape changes.
 */
function redactErrorDetails(details, depth = 0) {
  if (!details || typeof details !== 'object' || depth > 4) return details;
  if (Array.isArray(details)) return details.map((item) => redactErrorDetails(item, depth + 1));

  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, value]) => [key, redactErrorDetails(value, depth + 1)])
  );
}

/**
 * Constant-time comparison of a request-supplied secret against the
 * configured shared secret. Returns false (never throws) on any mismatch,
 * including missing/malformed input.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates a redirect target is an absolute URL on one of the allowed
 * origins, to prevent open-redirect via attacker-supplied successUrl/failureUrl.
 */
function isAllowedRedirect(url, allowedOrigins) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * Minimal in-memory sliding-window rate limiter (no external dependency).
 * Not suitable for multi-instance deployments — swap for a shared store
 * (Redis, etc.) if the app scales beyond a single Railway instance.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  return function rateLimiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (hits.get(key) || []).filter((t) => t > windowStart);
    if (timestamps.length >= max) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded, please retry later'
      });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

module.exports = { escapeHtml, redactErrorDetails, timingSafeEqual, isAllowedRedirect, createRateLimiter };
