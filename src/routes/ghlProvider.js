const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const NuveiClient = require('../services/nuveiClient');
const { verifyApiKey } = require('../services/ghlProviderConfig');
const { getTransactionAmount } = require('../services/ghlTransactionsClient');
const { createPaymentIntent, retrievePaymentIntent } = require('../services/stripeClient');
const { createRateLimiter, redactErrorDetails, timingSafeEqual } = require('../lib/security');
const { REGION_SELECTOR_STYLES } = require('../lib/checkoutStyles');

const chargeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

// GHL pages (funnels, invoices) can be served from an agency's own custom
// "white label" domain rather than *.gohighlevel.com/*.leadconnectorhq.com —
// e.g. AMWELL USA's invoices are on us.amwelltechnologies.com. CSP
// frame-ancestors has no way to allow "any GHL-hosted page" short of a
// wildcard that would defeat clickjacking protection entirely, so known
// custom domains must be added explicitly here (comma-separated).
const WHITE_LABEL_ORIGINS = (process.env.GHL_WHITE_LABEL_DOMAINS || '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => `https://${d}`);
const WHITE_LABEL_FRAME_ANCESTORS = WHITE_LABEL_ORIGINS.join(' ');

// Phase 1: in-memory charge record so /query can verify what /charge created.
// Same ephemeral-across-restarts caveat as the OAuth token store (Task 2).
const charges = new Map();

// GHL's `verify` call may not arrive immediately after the iframe reports
// success, so charge records need a much longer window than the 30-minute TTL
// the old (removed) checkout-session store used.
const CHARGE_TTL_MS = 24 * 60 * 60 * 1000;
const CHARGE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function cleanExpiredCharges() {
  const cutoff = Date.now() - CHARGE_TTL_MS;
  for (const [id, charge] of charges) {
    if (charge.createdAt < cutoff) charges.delete(id);
  }
}
setInterval(cleanExpiredCharges, CHARGE_SWEEP_INTERVAL_MS).unref();

// GHL's `payment_initiate_props.mode` is "payment" (vs. a subscription/setup
// mode) — it is NOT a live/test indicator, so it must never be used to pick a
// gateway. The real live/test signal is the publishableKey: registration
// generates a distinct one per mode (see ghlProviderConfig.generateProviderSecrets)
// and GHL echoes back the active mode's key in payment_initiate_props.
function resolveChargeMode(publishableKey) {
  // Operator safety override takes precedence over the request-derived signal:
  // NUVEI_SANDBOX_MODE=true pins every charge to the sandbox, matching how
  // src/routes/payments.js and src/routes/ghl.js already honour this flag.
  if (process.env.NUVEI_SANDBOX_MODE === 'true') return 'test';

  const liveKey = process.env.GHL_PROVIDER_LIVE_PUBLISHABLE_KEY;
  const testKey = process.env.GHL_PROVIDER_TEST_PUBLISHABLE_KEY;

  if (liveKey && timingSafeEqual(publishableKey, liveKey)) return 'live';
  if (testKey && timingSafeEqual(publishableKey, testKey)) return 'test';
  // Fail closed: an unrecognised (or absent) publishableKey never reaches
  // production credentials.
  return 'test';
}

function nuveiConfigForMode(mode) {
  // BaseCommerce's sandbox is a separate merchant account from production with
  // its own credential triple — production credentials do not authenticate
  // against the sandbox host — so the credential set is selected per mode
  // alongside the host, not shared across both.
  if (mode === 'live') {
    return {
      username: process.env.NUVEI_SDK_USERNAME,
      password: process.env.NUVEI_SDK_PASSWORD,
      securityKey: process.env.NUVEI_SDK_KEY,
      production: true
    };
  }
  return {
    username: process.env.NUVEI_SDK_USERNAME_TEST,
    password: process.env.NUVEI_SDK_PASSWORD_TEST,
    securityKey: process.env.NUVEI_SDK_KEY_TEST,
    production: false
  };
}

// Stripe has its own independent live/test key pair (unrelated to Nuvei's),
// but still selected by GHL's mode signal so /query's charge.mode === mode
// check (see below) means the same thing regardless of which gateway
// processed a given charge.
function stripeKeyForMode(mode) {
  return mode === 'live' ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_KEY_TEST;
}

/**
 * Shared by both the Nuvei and Stripe charge paths — verifies the amount a
 * client is trying to charge against GHL's own record of this transactionId
 * before any money moves. See the /charge handler below for the full
 * order-substitution rationale.
 */
async function assertAmountMatchesGHL(locationId, transactionId, numericAmount) {
  const transactionAmount = await getTransactionAmount(locationId, transactionId);
  if (Math.abs(transactionAmount - numericAmount) > 0.01) {
    console.warn(
      `[Payment Verify] Amount mismatch — requested=${numericAmount} transactionAmount=${transactionAmount} ` +
      `transactionId=${transactionId}`
    );
    throw { statusCode: 400, message: 'Amount does not match the order on file' };
  }
}

router.get('/checkout', (req, res) => {
  // GHL legitimately iframes this page, so X-Frame-Options (single-origin only)
  // is unusable here; CSP frame-ancestors allowlists GHL's origins instead.
  // script-src/frame-src/connect-src additionally allow Stripe.js and its own
  // hosted card-input iframe — needed for the international leg below, which
  // embeds Stripe Elements directly in this iframe rather than redirecting
  // (a redirect would navigate away before this page could ever postMessage
  // a result back to GHL's parent frame).
  res.setHeader(
    'Content-Security-Policy',
    `frame-ancestors https://*.gohighlevel.com https://*.leadconnectorhq.com${WHITE_LABEL_FRAME_ANCESTORS ? ' ' + WHITE_LABEL_FRAME_ANCESTORS : ''}; default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com; img-src 'self' data:`
  );
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Secure Payment</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:440px;width:100%;padding:28px}
    label{display:block;font-size:14px;font-weight:600;margin-top:14px;color:#374151}
    input{width:100%;padding:12px;border:1px solid #ccc;border-radius:6px;margin-top:4px;font-size:16px}
    input::placeholder{color:#aaa}
    .row{display:grid;grid-template-columns:2fr 1fr;gap:12px}
    ${REGION_SELECTOR_STYLES}
    .card-brands{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
    .brand{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 8px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:.4px;color:#fff}
    .brand.visa{background:#1a1f71}
    .brand.amex{background:#2e77bc}
    .brand.discover{background:#f68121;color:#1a1a2e}
    .brand.mc{background:#eee;position:relative;width:38px;padding:0}
    .mc-dot{width:15px;height:15px;border-radius:50%;position:absolute;top:4.5px}
    .mc-dot.red{background:#eb001b;left:5px}
    .mc-dot.yellow{background:#f79e1b;left:14px;mix-blend-mode:multiply}
    .stripe-brand{display:flex;justify-content:center;margin-top:10px}
    .stripe-badge{display:inline-flex;align-items:center;padding:5px 12px;border-radius:5px;background:#635bff;color:#fff;font-size:14px;font-weight:700;font-style:italic;letter-spacing:-0.02em}
    #stripe-card-element{padding:12px;border:1px solid #ccc;border-radius:6px;margin-top:4px;background:#fff}
    #stripe-card-errors,#nuvei-card-errors{color:#b91c1c;font-size:12px;margin-top:6px;min-height:14px}
    button{width:100%;margin-top:20px;padding:14px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:17px;font-weight:600;cursor:pointer}
    button:disabled{background:#a78bfa;cursor:default}
    .secure{text-align:center;margin-top:14px;font-size:13px;color:#6b7280;font-weight:500}
    [hidden]{display:none!important}
  </style>
</head>
<body>
<div class="card">
  <div id="summary"></div>

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
    <div class="card-brands">
      <span class="brand visa">VISA</span>
      <span class="brand mc"><span class="mc-dot red"></span><span class="mc-dot yellow"></span></span>
      <span class="brand amex">AMEX</span>
      <span class="brand discover">DISC</span>
    </div>
    <div class="row">
      <div>
        <label>Expiry</label>
        <input id="ccExpiry" required inputmode="numeric" maxlength="5" placeholder="MM/YY" pattern="\\d{2}/\\d{2}"/>
      </div>
      <div>
        <label>CVV</label>
        <input id="ccCvv" required inputmode="numeric" maxlength="4" placeholder="CVV"/>
      </div>
    </div>
    <div id="nuvei-card-errors"></div>
    <button type="submit" id="pb">Pay</button>
    <p class="secure">🔒 Nuvei Secure Payment</p>
  </form>

  <form id="sf" hidden>
    <div class="stripe-brand"><span class="stripe-badge">stripe</span></div>
    <label>Cardholder Name</label><input id="stripeCardName" required placeholder="Name on card"/>
    <label>Card</label>
    <div id="stripe-card-element"></div>
    <div id="stripe-card-errors"></div>
    <button type="submit" id="sb">Pay</button>
    <p class="secure">🔒 Stripe secured payment</p>
  </form>
</div>

  <script src="https://js.stripe.com/v3/"></script>
  <script>
    let paymentProps = null;
    let stripe = null;
    let cardElement = null;
    const nuveiForm = document.getElementById('pf');
    const stripeForm = document.getElementById('sf');
    const summaryEl = document.getElementById('summary');

    // GHL wildcard domains plus any configured white-label domain(s) — the
    // same trust boundary this page's own CSP frame-ancestors already uses.
    // Origin is the correct way to authenticate a postMessage sender (MDN's
    // own guidance); the previous \`event.source !== window.parent\` check
    // used strict object identity instead, which silently rejects a
    // legitimate message if GHL's actual page nests an extra iframe layer
    // between the top page and this one (invoices and funnel order forms
    // are not necessarily the same page structure).
    const whiteLabelOrigins = ${JSON.stringify(WHITE_LABEL_ORIGINS)};
    function isTrustedGHLOrigin(origin) {
      if (/^https:\\/\\/([a-z0-9-]+\\.)*(gohighlevel|leadconnectorhq)\\.com$/.test(origin)) return true;
      return whiteLabelOrigins.indexOf(origin) !== -1;
    }

    window.addEventListener('message', function (event) {
      // GHL (and this page's own retry loop, above) sends postMessage
      // payloads as JSON strings, not raw objects — parse defensively so a
      // stringified payment_initiate_props isn't missed just because
      // data.type is undefined on the un-parsed string.
      let data = event.data || {};
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { data = {}; }
      }
      const trusted = isTrustedGHLOrigin(event.origin);
      if (!trusted) return;
      if (data.type === 'payment_initiate_props') {
        paymentProps = data;
        summaryEl.textContent = data.currency + ' ' + data.amount;
        summaryEl.style.color = '';
      }
    });

    // Every outbound message this page sends — the ready handshake and the
    // final success/error report alike — goes through here: GHL's own
    // listener expects a JSON string, not a raw object (confirmed working
    // shape from GoHighLevel/highlevel-api-docs issue #308), and is sent to
    // both window.parent and window.top since GHL may nest an extra iframe
    // layer for a given surface. The success/error report was previously
    // sent as a raw, un-stringified object — the likely reason GHL never
    // called this app's queryUrl after a real, successful charge: a
    // silently-dropped, unparseable message looks identical to one that
    // never arrived at all.
    function sendToGHL(message) {
      const json = JSON.stringify(message);
      window.parent.postMessage(json, '*');
      if (window.top !== window.parent) {
        window.top.postMessage(json, '*');
      }
    }

    // GHL's own parent frame can finish loading and attach its postMessage
    // listener AFTER this iframe's one-shot "ready" event already fired and
    // was missed — a confirmed race condition in GHL's checkout frontend
    // (see issue #308 above): a single ready-fire left payment_initiate_props
    // never dispatched at all; retrying the handshake on an interval until
    // GHL actually responds resolved it.
    const readyInterval = setInterval(function () {
      if (paymentProps) {
        clearInterval(readyInterval);
        return;
      }
      sendToGHL({ type: 'custom_provider_ready', loaded: true });
    }, 500);
    // Fires immediately too, so a GHL frame that's already listening doesn't
    // wait a full 500ms for the first attempt.
    sendToGHL({ type: 'custom_provider_ready', loaded: true });

    // Without this, a GHL handshake that never arrives (or arrives after an
    // impatient click) makes the Pay button look frozen — both submit
    // handlers below silently no-op with zero feedback when paymentProps is
    // still null. Surface it instead of leaving the page looking dead. Also
    // stops the retry loop above so it doesn't keep firing forever.
    setTimeout(function () {
      clearInterval(readyInterval);
      if (!paymentProps) {
        summaryEl.textContent = 'Unable to load payment details. Please refresh this page and try again.';
        summaryEl.style.color = '#b91c1c';
      }
    }, 30000);

    document.querySelectorAll('input[name="region"]').forEach(function (input) {
      input.addEventListener('change', function () {
        const isIntl = this.value === 'intl';
        nuveiForm.hidden = isIntl;
        stripeForm.hidden = !isIntl;
        // Stripe Elements can only mount once its container is visible and
        // sized — deferred until the shopper actually picks this option,
        // rather than attempted unconditionally on page load.
        if (isIntl && !cardElement) {
          stripe = Stripe(${JSON.stringify(process.env.STRIPE_PUBLISHABLE_KEY || '')});
          const elements = stripe.elements();
          cardElement = elements.create('card');
          cardElement.mount('#stripe-card-element');
          cardElement.on('change', function (event) {
            document.getElementById('stripe-card-errors').textContent = event.error ? event.error.message : '';
          });
        }
      });
    });

    // Auto-insert the "/" as the shopper types MMYY, matching the MM/YY
    // placeholder — BaseCommerce itself wants month and a full 4-digit year
    // as separate fields (see the submit handler below), but MM/YY is the
    // format every real card form trains people to expect.
    document.getElementById('ccExpiry').addEventListener('input', function () {
      let v = this.value.replace(/\\D/g, '').slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
      this.value = v;
    });

    document.getElementById('pf').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!paymentProps) {
        alert('Payment details are still loading. Please wait a moment and try again.');
        return;
      }
      document.getElementById('pb').disabled = true;
      document.getElementById('nuvei-card-errors').textContent = '';

      const nameParts = document.getElementById('cardName').value.trim().split(' ');
      const [expMonth, expYY] = document.getElementById('ccExpiry').value.split('/');
      try {
        const res = await fetch('/ghl-provider/charge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // No client-asserted mode: the server derives live/test from the
            // publishableKey GHL supplied in payment_initiate_props.
            publishableKey: paymentProps.publishableKey,
            transactionId: paymentProps.transactionId,
            orderId: paymentProps.orderId,
            locationId: paymentProps.locationId,
            amount: paymentProps.amount,
            firstName: nameParts[0] || 'Customer',
            lastName: nameParts.slice(1).join(' ') || 'N/A',
            ccNumber: document.getElementById('ccNumber').value.replace(/\\s/g, ''),
            ccExpMonth: expMonth,
            // BaseCommerce requires the full 4-digit year — expand the
            // 2-digit year the form collects (e.g. "27" -> "2027").
            ccExpYear: expYY ? '20' + expYY : '',
            ccCvv: document.getElementById('ccCvv').value
          })
        });
        const body = await res.json();
        if (res.ok) {
          sendToGHL({ type: 'custom_element_success_response', chargeId: body.chargeId });
        } else {
          document.getElementById('nuvei-card-errors').textContent = body.error || 'Payment failed';
          sendToGHL({ type: 'custom_element_error_response', error: { description: body.error || 'Payment failed' } });
          document.getElementById('pb').disabled = false;
        }
      } catch (err) {
        document.getElementById('nuvei-card-errors').textContent = 'Network error. Please try again.';
        sendToGHL({ type: 'custom_element_error_response', error: { description: 'Network error' } });
        document.getElementById('pb').disabled = false;
      }
    });

    document.getElementById('sf').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!paymentProps || !stripe || !cardElement) {
        alert('Payment details are still loading. Please wait a moment and try again.');
        return;
      }
      document.getElementById('sb').disabled = true;
      document.getElementById('stripe-card-errors').textContent = '';

      try {
        // Step 1: server verifies the amount against GHL's own transaction
        // record and creates a PaymentIntent — mirrors /charge's trust
        // boundary for the Nuvei leg.
        const intentRes = await fetch('/ghl-provider/stripe-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publishableKey: paymentProps.publishableKey,
            transactionId: paymentProps.transactionId,
            orderId: paymentProps.orderId,
            locationId: paymentProps.locationId,
            amount: paymentProps.amount,
            currency: paymentProps.currency
          })
        });
        const intentBody = await intentRes.json();
        if (!intentRes.ok) {
          throw new Error(intentBody.error || 'Unable to start payment');
        }

        // Step 2: card details go straight to Stripe from the browser —
        // this server never sees them.
        const confirmResult = await stripe.confirmCardPayment(intentBody.clientSecret, {
          payment_method: {
            card: cardElement,
            billing_details: { name: document.getElementById('stripeCardName').value.trim() || 'Customer' }
          }
        });
        if (confirmResult.error) {
          throw new Error(confirmResult.error.message || 'Payment failed');
        }

        // Step 3: server independently re-verifies the PaymentIntent's
        // status directly with Stripe before recording the charge as paid
        // — the client's own report of success is never trusted alone.
        const confirmRes = await fetch('/ghl-provider/stripe-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chargeId: intentBody.chargeId, paymentIntentId: confirmResult.paymentIntent.id })
        });
        const confirmBody = await confirmRes.json();
        if (!confirmRes.ok) {
          throw new Error(confirmBody.error || 'Payment could not be confirmed');
        }

        sendToGHL({ type: 'custom_element_success_response', chargeId: intentBody.chargeId });
      } catch (err) {
        document.getElementById('stripe-card-errors').textContent = err.message || 'Payment failed';
        sendToGHL({ type: 'custom_element_error_response', error: { description: err.message || 'Payment failed' } });
        document.getElementById('sb').disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

router.post('/charge', chargeRateLimiter, async (req, res) => {
  const {
    publishableKey, transactionId, orderId, locationId,
    amount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv
  } = req.body;

  // transactionId binds this charge to the GHL transaction it is paying for,
  // and — critically — is the identifier the amount check below is keyed on.
  // Without it /query cannot reconcile either, so it is required up front.
  if (!transactionId) {
    return res.status(400).json({ error: 'Missing transactionId' });
  }

  // locationId is required so the charged amount can be verified against
  // GHL's own transaction record below (identifies which GHL account/OAuth
  // token to look it up with).
  if (!locationId) {
    return res.status(400).json({ error: 'Missing locationId' });
  }

  if (!amount || !ccNumber || !ccExpMonth || !ccExpYear || !ccCvv) {
    return res.status(400).json({ error: 'Missing required payment fields' });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // Verify the requested amount against GHL's own record of THIS
  // transactionId — not a client-supplied orderId. GHL's real queryUrl
  // verify call only ever sends transactionId (never orderId or amount), so
  // transactionId is the one identifier actually anchored to something GHL
  // will later check; keying the amount lookup on anything else (e.g. an
  // orderId supplied in this same untrusted request) would let a caller
  // bind an unrelated, cheaper transaction's amount to a victim's real
  // transactionId and still have it confirmed as paid in full.
  try {
    const transactionAmount = await getTransactionAmount(locationId, transactionId);
    if (Math.abs(transactionAmount - numericAmount) > 0.01) {
      console.warn(
        `[Payment Charge] Amount mismatch — requested=${numericAmount} transactionAmount=${transactionAmount} ` +
        `transactionId=${transactionId}`
      );
      return res.status(400).json({ error: 'Amount does not match the order on file' });
    }
  } catch (error) {
    console.error('[Payment Charge] Transaction verification failed:', error.message);
    return res.status(error.statusCode || 502).json({ error: 'Unable to verify this transaction. Please try again.' });
  }

  const mode = resolveChargeMode(publishableKey);
  const nuvei = new NuveiClient(nuveiConfigForMode(mode));

  try {
    const result = await nuvei.createPayment({ amount: numericAmount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv });
    const chargeId = crypto.randomUUID();
    charges.set(chargeId, {
      status: 'success',
      mode,
      gateway: 'nuvei',
      transactionId,
      orderId,
      locationId,
      amount: numericAmount,
      // BaseCommerce's own transaction id — distinct from GHL's transactionId.
      gatewayTransactionId: result.transactionId,
      createdAt: Date.now()
    });
    // Out-of-band reconciliation trail: the charges Map is in-memory only, so a
    // deploy/restart/crash between here and GHL's verify call would otherwise
    // leave a real settled charge with no record an operator could act on.
    console.log(
      `[GHL Provider Charge] Succeeded — transactionId=${transactionId} chargeId=${chargeId} ` +
      `gatewayTransactionId=${result.transactionId} amount=${numericAmount} mode=${mode} ` +
      `orderId=${orderId || 'n/a'} locationId=${locationId || 'n/a'}`
    );
    res.status(200).json({ chargeId });
  } catch (error) {
    console.error('[GHL Provider Charge] Failed:', error.message, redactErrorDetails(error.details));
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * POST /ghl-provider/stripe-intent
 * International leg, step 1: verifies the amount against GHL's own
 * transaction record (same trust boundary as /charge), then creates a
 * Stripe PaymentIntent for the iframe to confirm directly with Stripe.js.
 */
router.post('/stripe-intent', chargeRateLimiter, async (req, res) => {
  const { publishableKey, transactionId, orderId, locationId, amount, currency } = req.body;

  if (!transactionId) {
    return res.status(400).json({ error: 'Missing transactionId' });
  }
  if (!locationId) {
    return res.status(400).json({ error: 'Missing locationId' });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    await assertAmountMatchesGHL(locationId, transactionId, numericAmount);
  } catch (error) {
    console.error('[Payment Stripe] Transaction verification failed:', error.message);
    return res.status(error.statusCode || 502).json({ error: error.statusCode === 400 ? error.message : 'Unable to verify this transaction. Please try again.' });
  }

  const mode = resolveChargeMode(publishableKey);
  const secretKey = stripeKeyForMode(mode);
  if (!secretKey) {
    return res.status(500).json({ error: `Stripe is not configured for ${mode} mode` });
  }

  try {
    const chargeId = crypto.randomUUID();
    const intent = await createPaymentIntent({
      amount: numericAmount,
      currency: currency || 'USD',
      description: `Wellness111 order ${orderId || transactionId}`,
      metadata: { chargeId, transactionId, orderId: orderId || '', locationId },
      secretKey
    });

    charges.set(chargeId, {
      status: 'pending',
      gateway: 'stripe',
      mode,
      transactionId,
      orderId,
      locationId,
      amount: numericAmount,
      paymentIntentId: intent.id,
      createdAt: Date.now()
    });

    console.log(`[GHL Provider Stripe] Intent created — chargeId=${chargeId} paymentIntentId=${intent.id} amount=${numericAmount} mode=${mode}`);
    res.status(200).json({ chargeId, clientSecret: intent.client_secret });
  } catch (error) {
    console.error('[GHL Provider Stripe] Failed to create PaymentIntent:', error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Unable to start payment' });
  }
});

/**
 * POST /ghl-provider/stripe-confirm
 * International leg, step 2: called after the iframe confirms the card
 * payment directly with Stripe.js. Never trusts that report alone —
 * independently retrieves the PaymentIntent from Stripe and checks its
 * status and amount before marking the charge as paid, matching the same
 * "verify before trusting the client" posture as the amount check in
 * /charge and /stripe-intent.
 */
router.post('/stripe-confirm', chargeRateLimiter, async (req, res) => {
  const { chargeId, paymentIntentId } = req.body;
  if (!chargeId || !paymentIntentId) {
    return res.status(400).json({ error: 'Missing chargeId or paymentIntentId' });
  }

  const charge = charges.get(chargeId);
  if (!charge || charge.gateway !== 'stripe' || charge.paymentIntentId !== paymentIntentId) {
    return res.status(404).json({ error: 'Payment session not found' });
  }
  if (charge.status === 'success') {
    // Already confirmed (e.g. a retried request) — idempotent, not an error.
    return res.status(200).json({ success: true });
  }

  try {
    const intent = await retrievePaymentIntent(paymentIntentId, stripeKeyForMode(charge.mode));
    const expectedCents = Math.round(charge.amount * 100);
    if (intent.status !== 'succeeded' || intent.amount !== expectedCents) {
      console.warn(
        `[GHL Provider Stripe] Confirm rejected — chargeId=${chargeId} status=${intent.status} ` +
        `amount=${intent.amount} expected=${expectedCents}`
      );
      return res.status(402).json({ error: 'Payment was not completed' });
    }

    charges.set(chargeId, { ...charge, status: 'success' });
    console.log(`[GHL Provider Stripe] Confirmed — chargeId=${chargeId} paymentIntentId=${paymentIntentId} amount=${charge.amount} mode=${charge.mode}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[GHL Provider Stripe] Confirm failed:', error.message);
    res.status(error.statusCode || 500).json({ error: 'Unable to confirm payment' });
  }
});

router.post('/query', (req, res) => {
  const { type, apiKey, chargeId, transactionId } = req.body;
  const mode = verifyApiKey(apiKey, 'live') ? 'live' : verifyApiKey(apiKey, 'test') ? 'test' : null;

  if (!mode) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (type !== 'verify') {
    return res.status(501).json({ error: `queryUrl type "${type}" is not implemented in Phase 1` });
  }

  // Reconciliation: the chargeId is bound to the GHL transactionId recorded at
  // /charge time, and both must match before this charge is confirmed. That
  // binding, combined with the order-amount verification in /charge (which
  // fetches the order's real amount from GHL before ever calling the payment
  // gateway), is what closes the order-substitution risk — without both,
  // someone could run a cheap charge of their own and post its chargeId back
  // to GHL as the success response for an unrelated, much larger order.
  //
  // charge.mode must also match the mode the caller's apiKey authenticated
  // as: without this, a charge that correctly failed closed to the sandbox
  // (e.g. because the live/test publishableKey env vars drifted out of sync
  // with what's actually registered with GHL) could still be confirmed to
  // GHL via the live apiKey as a real, successful payment — even though no
  // real money moved.
  //
  // A transactionId or mode mismatch is deliberately reported identically to
  // an unknown chargeId, so the response never discloses which check failed.
  const charge = charges.get(chargeId);
  if (charge && charge.status === 'success' && charge.transactionId === transactionId && charge.mode === mode) {
    return res.status(200).json({ success: true });
  }
  return res.status(200).json({ success: false });
});

module.exports = router;
