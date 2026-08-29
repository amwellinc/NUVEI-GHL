const express = require('express');
const router = express.Router();
const GHLClient = require('../services/ghlClient');
const NuveiClient = require('../services/nuveiClient');
const { redactErrorDetails, createRateLimiter } = require('../lib/security');

const paymentRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

// Initialize GHL client (v2 Custom App / Private Integration)
const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

// Initialize NUVEI client (BaseCommerce/BaseX — username+password+securityKey auth)
const nuveiClient = new NuveiClient({
  username: process.env.NUVEI_SDK_USERNAME,
  password: process.env.NUVEI_SDK_PASSWORD,
  securityKey: process.env.NUVEI_SDK_KEY,
  production: process.env.NUVEI_SANDBOX_MODE !== 'true',
  apiEndpoint: process.env.NUVEI_API_ENDPOINT
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
    const response = await ghlClient.getLocation();
    const locationData = response.location || response;

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
    // GHL v2 Contacts API uses cursor-based pagination (startAfterId/startAfter),
    // not offset — sending offset gets a 422 "property offset should not exist".
    const filters = { limit: req.query.limit || 100 };
    if (req.query.startAfterId) filters.startAfterId = req.query.startAfterId;
    if (req.query.startAfter) filters.startAfter = req.query.startAfter;

    const contactsResponse = await ghlClient.getContacts(filters);

    res.status(200).json({
      success: true,
      contacts: contactsResponse.contacts || [],
      totalCount: contactsResponse.totalCount || contactsResponse.contacts?.length || 0
    });
  } catch (error) {
    console.error('GHL contacts fetch error:', error.message, redactErrorDetails(error.details));
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: redactErrorDetails(error.details)
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

module.exports = router;
