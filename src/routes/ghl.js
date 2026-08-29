const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const GHLClient = require('../services/ghlClient');
const NuveiClient = require('../services/nuveiClient');
const { escapeHtml, redactErrorDetails, timingSafeEqual, isAllowedRedirect, createRateLimiter } = require('../lib/security');

// ─── GHL Custom Payment Provider checkout session store ───────────────────────
// Sessions expire after 30 minutes
const checkoutSessions = new Map();

function cleanExpiredSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of checkoutSessions) {
    if (s.createdAt < cutoff) checkoutSessions.delete(id);
  }
}
setInterval(cleanExpiredSessions, 5 * 60 * 1000).unref();

// Only redirect customers back to our own hosted domain or a GHL funnel domain.
const ALLOWED_REDIRECT_ORIGINS = [process.env.APP_URL, 'https://app.gohighlevel.com'].filter(Boolean);

// Requests claiming to come from GHL's Custom Payment Provider flow must carry
// this shared secret (configured on both sides: here via env, and in the GHL
// marketplace app's provider settings) — closes the unauthenticated /checkout,
// /query, and /webhook endpoints.
const verifyProviderAuth = (req, res, next) => {
  const configured = process.env.PAYMENT_PROVIDER_SHARED_SECRET;
  if (!configured) {
    console.error('PAYMENT_PROVIDER_SHARED_SECRET is not set — rejecting provider request for safety');
    return res.status(500).json({ error: 'Payment provider auth not configured' });
  }
  const supplied = req.headers['x-provider-secret'];
  if (!timingSafeEqual(supplied, configured)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

const paymentRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

// Initialize GHL client (v2 Custom App / Private Integration)
const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

// Initialize NUVEI client (REST 1.0 checksum-based auth)
const nuveiClient = new NuveiClient({
  merchantId: process.env.NUVEI_MERCHANT_ID,
  merchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID,
  secretKey: process.env.NUVEI_SECRET_KEY,
  apiEndpoint: process.env.NUVEI_API_ENDPOINT,
  sandboxMode: process.env.NUVEI_SANDBOX_MODE !== 'false'
});

// Middleware to validate GHL credentials
const validateGHLConfig = (req, res, next) => {
  if (!process.env.GHL_LOCATION_ID || !process.env.GHL_API_TOKEN) {
    return res.status(500).json({
      error: 'GHL credentials not configured',
      message: 'GHL_LOCATION_ID and GHL_API_TOKEN environment variables must be set'
    });
  }
  next();
};

/**
 * GET /api/ghl/status
 * Check integration status with GHL
 */
router.get('/status', validateGHLConfig, async (_req, res) => {
  try {
    const locationData = await ghlClient.getLocation();
    
    res.status(200).json({
      success: true,
      message: 'GHL integration active',
      location: {
        id: locationData.id,
        name: locationData.name,
        email: locationData.email
      }
    });
  } catch (error) {
    console.error('GHL status check error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: 'Failed to connect to GHL',
      details: error.message
    });
  }
});

/**
 * POST /api/ghl/payment/create
 * Create a payment and associate with GHL contact
 */
router.post('/payment/create', paymentRateLimiter, validateGHLConfig, async (req, res) => {
  try {
    const {
      contactId,
      amount,
      currency,
      description,
      ccNumber,
      ccExpMonth,
      ccExpYear,
      ccCvv,
      firstName,
      lastName,
      email,
      phone
    } = req.body;

    // Validate required fields
    if (!amount || !email || !contactId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'amount, email, and contactId are required'
      });
    }

    if (!ccNumber || !ccExpMonth || !ccExpYear || !ccCvv) {
      return res.status(400).json({
        error: 'Missing card details',
        message: 'Credit card information is required'
      });
    }

    // Create payment with NUVEI
    const paymentData = {
      amount,
      currency: currency || 'USD',
      clientUniqueId: `ghl-${contactId}-${Date.now()}`,
      firstName: firstName || 'GHL Customer',
      lastName: lastName || '',
      email,
      phone: phone || '',
      ccNumber,
      ccExpMonth,
      ccExpYear,
      ccCvv,
      description: description || `Payment from GHL Contact: ${contactId}`
    };

    const paymentResponse = await nuveiClient.createPayment(paymentData);

    // Store payment info in GHL contact
    const paymentNote = `Payment processed: $${amount} ${currency || 'USD'} 
Transaction ID: ${paymentResponse.transactionId || 'N/A'}
Status: ${paymentResponse.status || 'pending'}
Time: ${new Date().toISOString()}`;

    try {
      await ghlClient.createNote(contactId, {
        body: paymentNote,
        type: 'payment'
      });
    } catch (noteError) {
      console.warn('Failed to create note in GHL:', noteError.message);
      // Continue - payment was still created
    }

    // Try to update custom field with transaction ID
    try {
      await ghlClient.setCustomField(
        contactId,
        'nuvei_transaction_id',
        paymentResponse.transactionId || 'pending'
      );
    } catch (fieldError) {
      console.warn('Failed to update custom field:', fieldError.message);
    }

    res.status(200).json({
      success: true,
      message: 'Payment processed and linked to GHL contact',
      payment: {
        transactionId: paymentResponse.transactionId,
        status: paymentResponse.status,
        amount,
        currency,
        ghlContactId: contactId
      },
      data: paymentResponse
    });
  } catch (error) {
    console.error('GHL payment creation error:', error.message, redactErrorDetails(error.details));
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: redactErrorDetails(error.details)
    });
  }
});

/**
 * POST /api/ghl/payment/refund
 * Refund a payment and update GHL contact
 */
router.post('/payment/refund', paymentRateLimiter, validateGHLConfig, async (req, res) => {
  try {
    const {
      transactionId,
      contactId,
      amount,
      currency,
      description
    } = req.body;

    if (!transactionId || !amount || !contactId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'transactionId, amount, and contactId are required'
      });
    }

    // Process refund with NUVEI
    const refundData = {
      transactionId,
      clientUniqueId: `ghl-refund-${contactId}-${Date.now()}`,
      amount,
      currency: currency || 'USD',
      description: description || `Refund for GHL Contact: ${contactId}`
    };

    const refundResponse = await nuveiClient.refundPayment(refundData);

    // Record refund in GHL contact
    const refundNote = `Refund processed: $${amount} ${currency || 'USD'}
Original Transaction: ${transactionId}
Refund Status: ${refundResponse.status || 'pending'}
Time: ${new Date().toISOString()}`;

    try {
      await ghlClient.createNote(contactId, {
        body: refundNote,
        type: 'refund'
      });
    } catch (noteError) {
      console.warn('Failed to create refund note in GHL:', noteError.message);
    }

    res.status(200).json({
      success: true,
      message: 'Refund processed and recorded in GHL',
      refund: {
        transactionId,
        refundStatus: refundResponse.status,
        amount,
        ghlContactId: contactId
      },
      data: refundResponse
    });
  } catch (error) {
    console.error('GHL refund error:', error.message, redactErrorDetails(error.details));
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: redactErrorDetails(error.details)
    });
  }
});

/**
 * GET /api/ghl/contacts
 * Get all contacts from GHL location
 */
router.get('/contacts', validateGHLConfig, async (req, res) => {
  try {
    const filters = {
      limit: req.query.limit || 100,
      offset: req.query.offset || 0
    };

    const contactsResponse = await ghlClient.getContacts(filters);

    res.status(200).json({
      success: true,
      contacts: contactsResponse.contacts || [],
      totalCount: contactsResponse.totalCount || 0
    });
  } catch (error) {
    console.error('GHL contacts fetch error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

/**
 * POST /api/ghl/company/associate
 * Associate one company to many contacts (one-to-many)
 */
router.post('/company/associate', validateGHLConfig, async (req, res) => {
  try {
    const { companyId, contactIds, subAccountId } = req.body;

    if (!companyId || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'companyId and non-empty contactIds array are required'
      });
    }

    if (subAccountId && subAccountId !== process.env.SUB_ACCOUNT_ID) {
      console.warn('Sub-account mismatch', subAccountId, process.env.SUB_ACCOUNT_ID);
      // We do not reject here because we still want to attempt if this app is configured for AM333.
    }

    const associations = await ghlClient.associateContactsToCompany(companyId, contactIds);

    res.status(200).json({
      success: true,
      message: 'Company associated with contacts successfully',
      companyId,
      contactCount: contactIds.length,
      associations
    });
  } catch (error) {
    console.error('GHL company/associate error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to associate company and contacts',
      details: error.details
    });
  }
});

/**
 * GET /api/ghl/contacts/:contactId
 * Get specific contact details
 */
router.get('/contacts/:contactId', validateGHLConfig, async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!contactId) {
      return res.status(400).json({
        error: 'Missing contactId',
        message: 'Contact ID is required'
      });
    }

    const contactData = await ghlClient.makeRequest('GET', `/contacts/${contactId}`);

    res.status(200).json({
      success: true,
      contact: contactData
    });
  } catch (error) {
    console.error('GHL contact fetch error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

/**
 * POST /api/ghl/webhook/payment-status
 * Handle webhooks from NUVEI/GHL for payment status updates
 */
router.post('/webhook/payment-status', verifyProviderAuth, async (req, res) => {
  try {
    const { transactionId, status, contactId, amount } = req.body;

    if (!transactionId || !status) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'transactionId and status are required'
      });
    }

    console.log(`Payment webhook received: ${transactionId} - ${status}`);

    // Update GHL contact if contactId provided
    if (contactId) {
      try {
        const statusMessage = `Payment Status Update: ${status.toUpperCase()}
Transaction: ${transactionId}
Amount: $${amount || 'N/A'}
Updated: ${new Date().toISOString()}`;

        await ghlClient.createNote(contactId, {
          body: statusMessage,
          type: 'status_update'
        });
      } catch (noteError) {
        console.warn('Failed to update GHL contact:', noteError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Webhook processed',
      transactionId,
      status
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

// ─── GHL Custom Payment Provider endpoints ────────────────────────────────────

/**
 * POST /api/ghl/checkout
 * GHL calls this when a customer reaches the payment step.
 * Returns a paymentUrl to redirect the customer to our hosted payment form.
 */
router.post('/checkout', paymentRateLimiter, verifyProviderAuth, (req, res) => {
  cleanExpiredSessions();

  const {
    amount, currency, description, orderId, contactId, locationId,
    customer, successUrl, failureUrl, liveMode, uniqueId
  } = req.body;

  if (!amount || Number(amount) <= 0 || !Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // successUrl/failureUrl are only used later as redirect targets — reject
  // anything off our own domain / GHL now, rather than trusting it at redirect time.
  if ((successUrl && !isAllowedRedirect(successUrl, ALLOWED_REDIRECT_ORIGINS)) ||
      (failureUrl && !isAllowedRedirect(failureUrl, ALLOWED_REDIRECT_ORIGINS))) {
    return res.status(400).json({ error: 'successUrl/failureUrl must be on an allowed domain' });
  }

  console.log(`[GHL Checkout] Order: ${orderId}, Amount: ${amount} ${currency || 'USD'}`);

  const sessionId = crypto.randomUUID();
  checkoutSessions.set(sessionId, {
    amount,
    currency: currency || 'USD',
    description,
    orderId,
    contactId,
    locationId,
    customer,
    successUrl,
    failureUrl,
    liveMode,
    uniqueId,
    status: 'pending',
    transactionId: null,
    createdAt: Date.now()
  });

  const appUrl = process.env.APP_URL || 'https://am333-nuvei-production.up.railway.app';
  res.json({ status: 'new', paymentUrl: `${appUrl}/pay/${sessionId}` });
});

/**
 * GET /api/ghl/query/:transactionId
 * GHL calls this to verify payment status after redirect.
 */
router.get('/query/:transactionId', verifyProviderAuth, (_req, res) => {
  const { transactionId } = _req.params;
  for (const [, session] of checkoutSessions) {
    if (session.transactionId === transactionId) {
      return res.json({ status: session.status, transactionId });
    }
  }
  res.status(404).json({ status: 'not_found', transactionId });
});

/**
 * GET /pay/:sessionId
 * Hosted payment form served to the customer.
 * (Mounted at /pay in server.js)
 */
router.get('/pay/:sessionId', (req, res) => {
  const session = checkoutSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">Payment session not found or expired.<br><br><a href="javascript:history.back()">Go back</a></h2>');
  }

  const amount = escapeHtml(parseFloat(session.amount).toFixed(2));
  const currency = escapeHtml(/^[A-Za-z]{3}$/.test(session.currency || '') ? session.currency : 'USD');
  const description = escapeHtml(session.description || 'Order Payment');
  const customerName = escapeHtml(session.customer?.name || '');
  const customerEmail = escapeHtml(session.customer?.email || '');
  const appUrl = process.env.APP_URL || 'https://am333-nuvei-production.up.railway.app';

  // Prevent this card-entry page from being framed for a clickjacking/UI-redress attack.
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Secure Payment — NUVEI-Payments</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:460px;width:100%;padding:36px}
    .logo{text-align:center;margin-bottom:24px}
    .logo h1{font-size:22px;color:#1a1a2e;font-weight:700}
    .logo span{color:#7c3aed}
    .summary{background:#f8f7ff;border-radius:8px;padding:14px 18px;margin-bottom:24px}
    .summary p{font-size:13px;color:#666;margin-bottom:4px}
    .summary .amount{font-size:26px;font-weight:700;color:#1a1a2e}
    .summary .desc{font-size:13px;color:#888;margin-top:4px}
    label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;margin-top:16px}
    input{width:100%;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:15px;transition:border .2s;outline:none}
    input:focus{border-color:#7c3aed}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .btn{width:100%;margin-top:24px;padding:14px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:background .2s}
    .btn:hover{background:#6d28d9}
    .btn:disabled{background:#a78bfa;cursor:not-allowed}
    .secure{text-align:center;margin-top:14px;font-size:12px;color:#9ca3af}
  </style>
</head>
<body>
<div class="card">
  <div class="logo"><h1>NUVEI<span>-Payments</span></h1></div>
  <div class="summary">
    <p>Order Total</p>
    <div class="amount">${currency} ${amount}</div>
    <div class="desc">${description}</div>
  </div>
  <form id="pf" method="POST" action="${appUrl}/pay/${req.params.sessionId}/process">
    <label>Cardholder Name</label>
    <input type="text" name="cardName" value="${customerName}" placeholder="Name on card" required/>
    <label>Card Number</label>
    <input type="text" name="ccNumber" placeholder="1234 5678 9012 3456" maxlength="19" required inputmode="numeric"/>
    <div class="row">
      <div><label>Expiry Month</label><input type="text" name="ccExpMonth" placeholder="MM" maxlength="2" required inputmode="numeric"/></div>
      <div><label>Expiry Year</label><input type="text" name="ccExpYear" placeholder="YYYY" maxlength="4" required inputmode="numeric"/></div>
    </div>
    <label>CVV</label>
    <input type="text" name="ccCvv" placeholder="123" maxlength="4" required inputmode="numeric"/>
    <input type="hidden" name="email" value="${customerEmail}"/>
    <button type="submit" class="btn" id="pb">Pay ${currency} ${amount}</button>
  </form>
  <p class="secure">🔒 256-bit SSL Encrypted &amp; Secure</p>
</div>
<script>
  document.querySelector('[name=ccNumber]').addEventListener('input',function(){
    this.value=this.value.replace(/\D/g,'').replace(/(.{4})/g,'$1 ').trim();
  });
  document.getElementById('pf').addEventListener('submit',function(){
    document.querySelector('[name=ccNumber]').value=document.querySelector('[name=ccNumber]').value.replace(/\s/g,'');
    document.getElementById('pb').disabled=true;
    document.getElementById('pb').textContent='Processing...';
  });
</script>
</body>
</html>`);
});

/**
 * POST /pay/:sessionId/process
 * Handles card submission from the hosted payment form.
 * (Mounted at /pay in server.js)
 */
router.post('/pay/:sessionId/process', paymentRateLimiter, async (req, res) => {
  const session = checkoutSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">Session expired. Please go back and retry.</h2>');
  }

  const { ccNumber, ccExpMonth, ccExpYear, ccCvv, cardName, email } = req.body;
  if (!ccNumber || !ccExpMonth || !ccExpYear || !ccCvv) {
    return res.status(400).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:60px">Missing card details. Please go back and retry.</h2>');
  }
  const nameParts = (cardName || session.customer?.name || 'Customer').trim().split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || 'N/A';

  const nuvei = new NuveiClient({
    merchantId: process.env.NUVEI_MERCHANT_ID,
    merchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID,
    secretKey: process.env.NUVEI_SECRET_KEY,
    apiEndpoint: process.env.NUVEI_API_ENDPOINT,
    sandboxMode: process.env.NUVEI_SANDBOX_MODE !== 'false'
  });

  try {
    const response = await nuvei.createPayment({
      amount: session.amount,
      currency: session.currency,
      clientUniqueId: session.uniqueId || session.orderId || `ghl-${Date.now()}`,
      firstName,
      lastName,
      email: email || session.customer?.email || '',
      phone: session.customer?.phone || '',
      description: session.description,
      ccNumber: ccNumber.replace(/\s/g, ''),
      ccExpMonth,
      ccExpYear,
      ccCvv
    });

    const transactionId = response.transactionId || response.gwTransactionId || response.ppTransactionID || `txn-${Date.now()}`;
    session.status = 'success';
    session.transactionId = transactionId;
    checkoutSessions.set(req.params.sessionId, session);

    console.log(`[GHL Checkout] Success. Order: ${session.orderId}, TxnID: ${transactionId}`);

    const base = isAllowedRedirect(session.successUrl, ALLOWED_REDIRECT_ORIGINS) ? session.successUrl : '/';
    res.redirect(base.includes('?') ? `${base}&transactionId=${transactionId}` : `${base}?transactionId=${transactionId}`);
  } catch (error) {
    session.status = 'failed';
    checkoutSessions.set(req.params.sessionId, session);
    console.error(`[GHL Checkout] Failed. Order: ${session.orderId}`, error.message, redactErrorDetails(error.details));
    const failBase = isAllowedRedirect(session.failureUrl, ALLOWED_REDIRECT_ORIGINS) ? session.failureUrl : '/';
    res.redirect(failBase);
  }
});

module.exports = router;
