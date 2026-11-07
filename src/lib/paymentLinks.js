const crypto = require('crypto');
const { timingSafeEqual } = require('./security');

const SIGNED_FIELDS = ['amount', 'currency', 'description', 'successUrl', 'failureUrl', 'contactId', 'exp'];
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

// JSON.stringify over a fixed key order is an injective encoding of the
// field tuple — unlike naive "key=value&key=value" concatenation, no value
// containing the join/delimiter characters (e.g. a description with
// "&successUrl=" in it) can shift field boundaries and make two different
// tuples canonicalize to the same signed string.
function canonicalize(params) {
  const fields = SIGNED_FIELDS.map((key) => params[key] ?? '');
  // Only staff charges carry a ref: website links keep the exact signature they always had.
  return JSON.stringify(params.ref ? [...fields, params.ref] : fields);
}

function sign(params) {
  const secret = process.env.PAYMENT_LINK_SECRET;
  if (!secret) {
    throw { statusCode: 500, message: 'PAYMENT_LINK_SECRET is not configured' };
  }
  return crypto.createHmac('sha256', secret).update(canonicalize(params)).digest('hex');
}

/**
 * Builds a signed payment link. The amount/currency/description are baked
 * into the signature — a link can't be tampered with by editing the query
 * string, since the server only ever trusts the values it verifies here,
 * never anything resubmitted later by the browser.
 * @param {string} baseUrl - e.g. "https://am333-nuvei-production.up.railway.app/pay"
 * @param {{amount: number|string, currency?: string, description?: string, successUrl?: string, failureUrl?: string, contactId?: string, ttlSeconds?: number}} params
 *   contactId, if provided, is the GHL contact this payment should be
 *   recorded against (note + tag) once it succeeds — omit it for a generic
 *   link not tied to any one contact.
 * @returns {string}
 */
function createSignedLink(baseUrl, params) {
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw { statusCode: 400, message: 'amount must be a positive number' };
  }

  const signed = {
    amount: amount.toFixed(2),
    currency: params.currency || 'USD',
    description: params.description || '',
    successUrl: params.successUrl || '',
    failureUrl: params.failureUrl || '',
    contactId: params.contactId || '',
    exp: String(Math.floor(Date.now() / 1000) + (params.ttlSeconds || DEFAULT_TTL_SECONDS)),
    ...(params.ref ? { ref: params.ref } : {})
  };

  const sig = sign(signed);
  const query = new URLSearchParams({ ...signed, sig }).toString();
  return `${baseUrl}?${query}`;
}

/**
 * Verifies a payment link's query params against its signature and expiry.
 * @param {object} query - req.query from the /pay request
 * @returns {{valid: true, params: object} | {valid: false, reason: string}}
 */
function verifyLink(query) {
  const { sig } = query;
  if (!sig) return { valid: false, reason: 'Missing signature' };

  const signed = {};
  for (const key of SIGNED_FIELDS) signed[key] = query[key] ?? '';
  if (query.ref) signed.ref = query.ref;

  let expected;
  try {
    expected = sign(signed);
  } catch (error) {
    return { valid: false, reason: error.message || 'Signing not configured' };
  }

  if (!timingSafeEqual(sig, expected)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  const exp = Number(signed.exp);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: 'Link has expired' };
  }

  return { valid: true, params: signed };
}

module.exports = { createSignedLink, verifyLink };
