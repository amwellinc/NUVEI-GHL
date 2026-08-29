const crypto = require('crypto');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes a value for safe interpolation into HTML text or attribute context.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Strips an upstream gateway/API error payload down to fields safe to
 * return to a client or write to logs. Full raw payloads can echo back
 * submitted data (card numbers, tokens) depending on what the upstream
 * service puts in its error responses.
 */
function redactErrorDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  const { errorCode, reason, status, gwErrorCode, gwErrorReason } = details;
  return { errorCode, reason, status, gwErrorCode, gwErrorReason };
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
