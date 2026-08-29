const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const NuveiClient = require('../services/nuveiClient');
const { verifyApiKey } = require('../services/ghlProviderConfig');
const { escapeHtml, createRateLimiter, redactErrorDetails } = require('../lib/security');

const chargeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

// Phase 1: in-memory charge record so /query can verify what /charge created.
// Same ephemeral-across-restarts caveat as the OAuth token store (Task 2).
const charges = new Map();

function nuveiConfigForMode(mode) {
  const production = mode !== 'test';
  return {
    username: process.env.NUVEI_SDK_USERNAME,
    password: process.env.NUVEI_SDK_PASSWORD,
    securityKey: process.env.NUVEI_SDK_KEY,
    production
  };
}

router.get('/checkout', (_req, res) => {
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
            mode: paymentProps.mode === 'live' ? 'live' : 'test',
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
  const { mode, amount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv } = req.body;

  if (!amount || !ccNumber || !ccExpMonth || !ccExpYear || !ccCvv) {
    return res.status(400).json({ error: 'Missing required payment fields' });
  }

  const nuvei = new NuveiClient(nuveiConfigForMode(mode));

  try {
    const result = await nuvei.createPayment({ amount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv });
    const chargeId = crypto.randomUUID();
    charges.set(chargeId, { status: 'success', transactionId: result.transactionId, createdAt: Date.now() });
    res.status(200).json({ chargeId });
  } catch (error) {
    console.error('[GHL Provider Charge] Failed:', error.message, redactErrorDetails(error.details));
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/query', (req, res) => {
  const { type, apiKey, chargeId } = req.body;
  const mode = verifyApiKey(apiKey, 'live') ? 'live' : verifyApiKey(apiKey, 'test') ? 'test' : null;

  if (!mode) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (type !== 'verify') {
    return res.status(501).json({ error: `queryUrl type "${type}" is not implemented in Phase 1` });
  }

  const charge = charges.get(chargeId);
  if (charge && charge.status === 'success') {
    return res.status(200).json({ success: true });
  }
  return res.status(200).json({ success: false });
});

module.exports = router;
