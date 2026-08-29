const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const NuveiClient = require('../services/nuveiClient');
const { verifyApiKey } = require('../services/ghlProviderConfig');
const { getTransactionAmount } = require('../services/ghlTransactionsClient');
const { createRateLimiter, redactErrorDetails, timingSafeEqual } = require('../lib/security');

const chargeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

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

router.get('/checkout', (_req, res) => {
  // GHL legitimately iframes this page, so X-Frame-Options (single-origin only)
  // is unusable here; CSP frame-ancestors allowlists GHL's origins instead.
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://*.gohighlevel.com https://*.leadconnectorhq.com; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  );
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Secure Payment</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
    label{display:block;font-size:13px;font-weight:600;margin-top:12px}
    input{width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;margin-top:4px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    button{width:100%;margin-top:20px;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:15px}
    button:disabled{background:#a78bfa}
  </style>
</head>
<body>
  <div id="summary"></div>
  <form id="pf">
    <label>Cardholder Name</label><input id="cardName" required/>
    <label>Card Number</label><input id="ccNumber" required inputmode="numeric" maxlength="19"/>
    <div class="row">
      <div><label>Expiry Month</label><input id="ccExpMonth" required inputmode="numeric" maxlength="2"/></div>
      <div><label>Expiry Year</label><input id="ccExpYear" required inputmode="numeric" maxlength="4"/></div>
    </div>
    <label>CVV</label><input id="ccCvv" required inputmode="numeric" maxlength="4"/>
    <button type="submit" id="pb">Pay</button>
  </form>
  <script>
    let paymentProps = null;

    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return;
      const data = event.data || {};
      if (data.type === 'payment_initiate_props') {
        paymentProps = data;
        document.getElementById('summary').textContent = data.currency + ' ' + data.amount;
      }
    });

    window.parent.postMessage({ type: 'custom_provider_ready', loaded: true }, '*');

    document.getElementById('pf').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!paymentProps) return;
      document.getElementById('pb').disabled = true;

      const nameParts = document.getElementById('cardName').value.trim().split(' ');
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
            ccExpMonth: document.getElementById('ccExpMonth').value,
            ccExpYear: document.getElementById('ccExpYear').value,
            ccCvv: document.getElementById('ccCvv').value
          })
        });
        const body = await res.json();
        if (res.ok) {
          window.parent.postMessage({ type: 'custom_element_success_response', chargeId: body.chargeId }, '*');
        } else {
          window.parent.postMessage({ type: 'custom_element_error_response', error: { description: body.error || 'Payment failed' } }, '*');
          document.getElementById('pb').disabled = false;
        }
      } catch (err) {
        window.parent.postMessage({ type: 'custom_element_error_response', error: { description: 'Network error' } }, '*');
        document.getElementById('pb').disabled = false;
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
        `[GHL Provider Charge] Amount mismatch — requested=${numericAmount} ghlTransactionAmount=${transactionAmount} ` +
        `transactionId=${transactionId}`
      );
      return res.status(400).json({ error: 'Amount does not match GHL transaction' });
    }
  } catch (error) {
    console.error('[GHL Provider Charge] Transaction verification failed:', error.message);
    return res.status(error.statusCode || 502).json({ error: 'Unable to verify transaction with GHL' });
  }

  const mode = resolveChargeMode(publishableKey);
  const nuvei = new NuveiClient(nuveiConfigForMode(mode));

  try {
    const result = await nuvei.createPayment({ amount: numericAmount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv });
    const chargeId = crypto.randomUUID();
    charges.set(chargeId, {
      status: 'success',
      mode,
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
