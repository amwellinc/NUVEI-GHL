const express = require('express');
const router = express.Router();
const GHLClient = require('../services/ghlClient');
const NuveiClient = require('../services/nuveiClient');

// Initialize GHL client
const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://rest.gohighlevel.com/v1'
});

// Initialize NUVEI client
const nuveiClient = new NuveiClient({
  merchantId: process.env.NUVEI_MERCHANT_ID,
  secretKey: process.env.NUVEI_SECRET_KEY,
  apiEndpoint: process.env.NUVEI_API_ENDPOINT || 'https://secure.safecharge.com/api/v1',
  sandboxMode: process.env.NUVEI_SANDBOX_MODE === 'true',
  sdkUsername: process.env.NUVEI_SDK_USERNAME,
  sdkPassword: process.env.NUVEI_SDK_PASSWORD,
  sdkKey: process.env.NUVEI_SDK_KEY
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
router.get('/status', validateGHLConfig, async (req, res) => {
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
router.post('/payment/create', validateGHLConfig, async (req, res) => {
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
    console.error('GHL payment creation error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

/**
 * POST /api/ghl/payment/refund
 * Refund a payment and update GHL contact
 */
router.post('/payment/refund', validateGHLConfig, async (req, res) => {
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
    console.error('GHL refund error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
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

    const contactData = await ghlClient.makeRequest('GET', `/locations/${process.env.GHL_LOCATION_ID}/contacts/${contactId}`);

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
router.post('/webhook/payment-status', async (req, res) => {
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

module.exports = router;
