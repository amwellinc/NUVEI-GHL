const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const NuveiClient = require('../services/nuveiClient');
const { createCheckoutSession } = require('../services/stripeClient');
const { verifyLink } = require('../lib/paymentLinks');
const { notifyGHL, notifyAbandonedCart } = require('../lib/ghlNotify');
const { resolveContactId } = require('../lib/ghlContact');
const { escapeHtml, createRateLimiter, redactErrorDetails, isAllowedRedirect, getAllowedRedirectOrigins } = require('../lib/security');
const { REGION_SELECTOR_STYLES } = require('../lib/checkoutStyles');

// Format-only checks on the card fields — not a substitute for the gateway's
// own validation, but rejecting an obviously-malformed submission here means
// it never gets encrypted and sent to BaseCommerce at all: one less way to
// spend a charge attempt (and its slice of the rate limiter budget) on
// garbage rather than an actual card-testing attempt, and one less place a
// non-string value (object/array — the JSON body has no type enforcement of
// its own) could reach the 3DES payload builder in services/nuveiClient.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD_NUMBER_PATTERN = /^\d{12,19}$/;
const EXP_MONTH_PATTERN = /^(0?[1-9]|1[0-2])$/;
const EXP_YEAR_PATTERN = /^\d{4}$/;
const CVV_PATTERN = /^\d{3,4}$/;

function validateChargeFields({ email, ccNumber, ccExpMonth, ccExpYear, ccCvv }) {
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) return 'Invalid email address';
  if (typeof ccNumber !== 'string' || !CARD_NUMBER_PATTERN.test(ccNumber)) return 'Invalid card number';
  if (typeof ccExpMonth !== 'string' || !EXP_MONTH_PATTERN.test(ccExpMonth)) return 'Invalid card expiry month';
  if (typeof ccExpYear !== 'string' || !EXP_YEAR_PATTERN.test(ccExpYear)) return 'Invalid card expiry year';
  if (typeof ccCvv !== 'string' || !CVV_PATTERN.test(ccCvv)) return 'Invalid card verification code';
  return null;
}

const chargeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
// Looser than the charge limiter, but GET /pay creates a session on every
// hit (see below), so it needs its own bound too — a static, publicly
// embedded link gets revisited far more often than it gets paid.
const pageRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60 });

// Redirect targets (successUrl/failureUrl) are only followed if they match
// one of these origins — otherwise the request that created the link could
// send a paying customer's browser anywhere after a real charge completes.
// Configure with the site(s) that actually embed these payment links.
const ALLOWED_REDIRECT_ORIGINS = getAllowedRedirectOrigins();

// Phase 1: in-memory session store, same TTL/eviction pattern already used
// for GHL provider charges — see src/routes/ghlProvider.js.
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function cleanExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      sessions.delete(id);
      // Only trackable when the session already had a known contact (set at
      // link-creation time via an email) — an anonymous session that never
      // reached a charge attempt has no one to notify a recovery workflow
      // about. notifyAbandonedCart never throws, so this can't break the
      // sweep even if GHL is down.
      if (session.contactId) {
        notifyAbandonedCart(session.contactId, {
          description: session.description,
          amount: session.amount
        });
      }
    }
  }
}
setInterval(cleanExpiredSessions, SESSION_SWEEP_INTERVAL_MS).unref();

function nuveiConfig() {
  return {
    username: process.env.NUVEI_SDK_USERNAME,
    password: process.env.NUVEI_SDK_PASSWORD,
    securityKey: process.env.NUVEI_SDK_KEY,
    production: process.env.NUVEI_SANDBOX_MODE !== 'true',
    apiEndpoint: process.env.NUVEI_API_ENDPOINT
  };
}

// Base for the built-in /pay/return fallback page — used whenever a link's
// successUrl/failureUrl is missing or not on an allowed origin, so a
// customer is never bounced toward a page that may not exist yet on the
// storefront (e.g. before it has built its own thank-you page).
function returnBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

/**
 * GET /pay
 * A standalone, GHL-independent hosted checkout page. Reached via a signed
 * link (see scripts/create-payment-link.js) — the amount/currency/
 * description are fixed by that signature and never re-read from anything
 * the browser submits later, so editing the URL or the form can't change
 * what gets charged.
 */
router.get('/', pageRateLimiter, (req, res) => {
  const verification = verifyLink(req.query);
  if (!verification.valid) {
    return res.status(400).send(`<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">Payment link invalid: ${escapeHtml(verification.reason)}</h2>`);
  }

  cleanExpiredSessions();
  const { amount, currency, description, successUrl, failureUrl, contactId } = verification.params;
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { amount, currency, description, successUrl, failureUrl, contactId, createdAt: Date.now() });

  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Secure Payment</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:420px;width:100%;padding:32px}
    .summary{background:#f8f7ff;border-radius:8px;padding:14px 18px;margin-bottom:20px}
    .summary .amount{font-size:26px;font-weight:700;color:#1a1a2e}
    .summary .desc{font-size:13px;color:#888;margin-top:4px}
    label{display:block;font-size:13px;font-weight:600;color:#374151;margin-top:12px}
    input{width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;margin-top:4px;font-size:15px}
    input::placeholder{color:#aaa}
    .row{display:grid;grid-template-columns:2fr 1fr;gap:12px}
    ${REGION_SELECTOR_STYLES}
    button{width:100%;margin-top:20px;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:15px;cursor:pointer}
    button:disabled{background:#a78bfa;cursor:default}
    .secure{text-align:center;margin-top:14px;font-size:12px;color:#9ca3af}
    .stripe-note{font-size:13px;color:#666;margin-top:14px;line-height:1.4}
    [hidden]{display:none!important}
  </style>
</head>
<body>
<div class="card">
  <div class="summary">
    <div class="amount">${escapeHtml(currency)} ${escapeHtml(amount)}</div>
    ${description ? `<div class="desc">${escapeHtml(description)}</div>` : ''}
  </div>

  <label class="region-label">Where are you located?</label>
  <div class="region-row">
    <label class="region-option">
      <input type="radio" name="region" value="us_ca"/>
      <span>🇺🇸 US / 🇨🇦 Canada</span>
    </label>
    <label class="region-option">
      <input type="radio" name="region" value="intl"/>
      <span>🌍 Other Country</span>
    </label>
  </div>

  <form id="pf" hidden>
    <label>Cardholder Name</label><input id="cardName" required placeholder="Name on card"/>
    <label>Card Number</label><input id="ccNumber" required inputmode="numeric" maxlength="19" placeholder="1234 5678 9012 3456"/>
    <div class="row">
      <div><label>Expiry</label><input id="ccExpiry" required inputmode="numeric" maxlength="5" placeholder="MM/YY" pattern="\\d{2}/\\d{2}"/></div>
      <div><label>CVV</label><input id="ccCvv" required inputmode="numeric" maxlength="4" placeholder="CVV"/></div>
    </div>
    <label>Email</label><input id="email" type="email" required placeholder="you@example.com"/>
    <button type="submit" id="pb">Pay ${escapeHtml(currency)} ${escapeHtml(amount)}</button>
  </form>

  <div id="stripeBox" hidden>
    <p class="stripe-note">You'll be securely redirected to our international payment partner to complete this purchase.</p>
    <button type="button" id="stripeBtn">Continue to Secure Checkout</button>
  </div>

  <p class="secure">🔒 256-bit SSL Encrypted &amp; Secure</p>
</div>
<script>
  const regionInputs = document.querySelectorAll('input[name="region"]');
  const nuveiForm = document.getElementById('pf');
  const stripeBox = document.getElementById('stripeBox');
  regionInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      const isIntl = this.value === 'intl';
      nuveiForm.hidden = isIntl;
      stripeBox.hidden = !isIntl;
    });
  });

  document.getElementById('stripeBtn').addEventListener('click', async function () {
    this.disabled = true;
    try {
      const res = await fetch(window.location.pathname + '/${sessionId}/stripe-checkout', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      alert(body.error || 'Unable to start checkout. Please try again.');
      this.disabled = false;
    } catch (err) {
      alert('Network error. Please try again.');
      this.disabled = false;
    }
  });

  document.getElementById('ccExpiry').addEventListener('input', function () {
    let v = this.value.replace(/\\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    this.value = v;
  });
  document.getElementById('ccNumber').addEventListener('input', function () {
    this.value = this.value.replace(/\\D/g, '').replace(/(.{4})/g, '$1 ').trim();
  });

  document.getElementById('pf').addEventListener('submit', async function (e) {
    e.preventDefault();
    document.getElementById('pb').disabled = true;

    const nameParts = document.getElementById('cardName').value.trim().split(' ');
    const [expMonth, expYY] = document.getElementById('ccExpiry').value.split('/');
    try {
      const res = await fetch(window.location.pathname + '/${sessionId}/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: nameParts[0] || 'Customer',
          lastName: nameParts.slice(1).join(' ') || 'N/A',
          email: document.getElementById('email').value,
          ccNumber: document.getElementById('ccNumber').value.replace(/\\s/g, ''),
          ccExpMonth: expMonth,
          ccExpYear: expYY ? '20' + expYY : '',
          ccCvv: document.getElementById('ccCvv').value
        })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.redirectUrl) {
        window.location.href = body.redirectUrl;
        return;
      }
      alert(body.error || 'Payment failed. Please check your details and try again.');
      document.getElementById('pb').disabled = false;
    } catch (err) {
      alert('Network error. Please try again.');
      document.getElementById('pb').disabled = false;
    }
  });
</script>
</body>
</html>`);
});

/**
 * POST /pay/:sessionId/charge
 * Charges the amount fixed by the signed link at GET /pay time — the
 * request body only ever supplies card/contact details, never amount.
 */
router.post('/:sessionId/charge', chargeRateLimiter, async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Payment session not found or expired' });
  }

  const { firstName, lastName, email, ccNumber, ccExpMonth, ccExpYear, ccCvv } = req.body || {};
  if (!email || !ccNumber || !ccExpMonth || !ccExpYear || !ccCvv) {
    return res.status(400).json({ error: 'Missing required payment fields' });
  }

  const validationError = validateChargeFields({ email, ccNumber, ccExpMonth, ccExpYear, ccCvv });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // Consume the session before attempting the charge, win or lose — a
  // sessionId is otherwise a standing "charge this fixed amount to any card
  // you like" endpoint for as long as it lives (up to 30 minutes), which
  // doubles as a card-testing oracle if the id ever leaks (Referer header,
  // logs, browser history). A declined attempt means reloading the link for
  // a fresh session, same as most real one-time payment links.
  sessions.delete(req.params.sessionId);

  const nuvei = new NuveiClient(nuveiConfig());

  try {
    const result = await nuvei.createPayment({
      amount: session.amount,
      currency: session.currency,
      firstName,
      lastName,
      email,
      ccNumber,
      ccExpMonth,
      ccExpYear,
      ccCvv,
      description: session.description
    });

    console.log(`[Pay Link] Succeeded — transactionId=${result.transactionId} amount=${session.amount} ${session.currency}`);

    // The link itself may not have had a contactId (e.g. a generic "Buy
    // Now" link) — the card form always collects an email, so resolve one
    // now if we don't already have it, rather than losing the order/GHL
    // tie-in entirely.
    const contactId = session.contactId || (await resolveContactId(email, firstName, lastName));

    // notifyGHL never throws (each GHL call is independently try/caught
    // internally) — the charge already succeeded, so a GHL-side hiccup here
    // must never turn into a failure response for a payment that went
    // through.
    await notifyGHL(contactId, {
      transactionId: result.transactionId,
      amount: session.amount,
      currency: session.currency,
      description: session.description
    });

    const successBase = isAllowedRedirect(session.successUrl, ALLOWED_REDIRECT_ORIGINS)
      ? session.successUrl
      : `${returnBaseUrl(req)}/pay/return?status=success`;
    const successUrl = successBase.includes('?') ? `${successBase}&transactionId=${result.transactionId}` : `${successBase}?transactionId=${result.transactionId}`;
    // Returned as JSON (not res.redirect) so the browser navigates via
    // window.location — fetch() would otherwise try to follow this redirect
    // itself, which fails whenever the target is a cross-origin page (e.g.
    // wellness111.com) without CORS headers, masking a successful charge as
    // a network error.
    return res.status(200).json({ redirectUrl: successUrl });
  } catch (error) {
    console.error('[Pay Link] Charge failed:', error.message, redactErrorDetails(error.details));

    const failureBase = isAllowedRedirect(session.failureUrl, ALLOWED_REDIRECT_ORIGINS)
      ? session.failureUrl
      : `${returnBaseUrl(req)}/pay/return?status=cancelled`;
    return res.status(200).json({ redirectUrl: failureBase });
  }
});

/**
 * POST /pay/:sessionId/stripe-checkout
 * The international leg — creates a Stripe-hosted Checkout Session for the
 * amount fixed by the signed link and hands back its URL for the browser to
 * navigate to. Raw card data never reaches this server for these orders;
 * Stripe collects it on its own page. The session is intentionally left in
 * the store (not consumed here) since nothing charge-relevant happens until
 * the customer completes Stripe's page — confirmation, and the GHL
 * push-back, happen in routes/stripeWebhook.js once Stripe reports the
 * payment as paid.
 */
router.post('/:sessionId/stripe-checkout', chargeRateLimiter, async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Payment session not found or expired' });
  }

  const successUrl = isAllowedRedirect(session.successUrl, ALLOWED_REDIRECT_ORIGINS)
    ? `${session.successUrl}${session.successUrl.includes('?') ? '&' : '?'}transactionId={CHECKOUT_SESSION_ID}`
    : `${returnBaseUrl(req)}/pay/return?status=success`;
  const cancelUrl = isAllowedRedirect(session.failureUrl, ALLOWED_REDIRECT_ORIGINS)
    ? session.failureUrl
    : `${returnBaseUrl(req)}/pay/return?status=cancelled`;

  try {
    const checkoutSession = await createCheckoutSession({
      amount: session.amount,
      currency: session.currency,
      description: session.description,
      successUrl,
      cancelUrl,
      metadata: { contactId: session.contactId || '', description: session.description || '' }
    });
    return res.status(200).json({ url: checkoutSession.url });
  } catch (error) {
    console.error('[Pay Link] Stripe checkout session creation failed:', error.message);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Unable to start checkout' });
  }
});

/**
 * GET /pay/return
 * Built-in fallback confirmation page — used by both the Nuvei charge path
 * and the Stripe checkout path whenever a link's successUrl/failureUrl is
 * missing or not on an allowed origin, so a customer is never redirected to
 * a storefront page that may not exist yet (e.g. before wellness111.com has
 * its own thank-you page built). Once a real successUrl/failureUrl is
 * configured and reachable, that takes priority over this page automatically
 * — nothing else needs to change.
 */
router.get('/return', pageRateLimiter, (req, res) => {
  const succeeded = req.query.status === 'success';
  const transactionId = req.query.transactionId ? escapeHtml(String(req.query.transactionId)) : '';

  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${succeeded ? 'Payment Successful' : 'Payment Cancelled'}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:420px;width:100%;padding:32px;text-align:center}
    h1{font-size:20px;margin-bottom:8px;color:#1a1a2e}
    p{font-size:14px;color:#666}
    .order-number{margin-top:16px;padding:10px;background:#f8f7ff;border-radius:6px;font-size:13px;color:#374151;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  </style>
</head>
<body>
<div class="card">
  <h1>${succeeded ? '✅ Payment Successful' : 'Payment Cancelled'}</h1>
  <p>${succeeded ? 'Thank you — your payment has been received.' : 'Your payment was not completed. You can close this page and try again.'}</p>
  ${succeeded && transactionId ? `<div class="order-number">Order #${transactionId}</div>` : ''}
</div>
</body>
</html>`);
});

module.exports = router;
