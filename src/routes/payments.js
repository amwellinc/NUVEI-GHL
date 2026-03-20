const express = require('express');
const router = express.Router();
const NuveiClient = require('../services/nuveiClient');

// Initialize NUVEI client
const nuveiClient = new NuveiClient({
  merchantId: process.env.NUVEI_MERCHANT_ID,
  secretKey: process.env.NUVEI_SECRET_KEY,
  apiEndpoint: process.env.NUVEI_API_ENDPOINT || 'https://secure.safecharge.com/api/v1',
  sandboxMode: process.env.NUVEI_SANDBOX_MODE === 'true'
});

// Middleware to validate NUVEI credentials
const validateNuveiConfig = (req, res, next) => {
  if (!process.env.NUVEI_MERCHANT_ID || !process.env.NUVEI_SECRET_KEY) {
    return res.status(500).json({
      error: 'NUVEI credentials not configured',
      message: 'NUVEI_MERCHANT_ID and NUVEI_SECRET_KEY environment variables must be set'
    });
  }
  next();
};

// POST /api/payments/create - Create a new payment
router.post('/create', validateNuveiConfig, async (req, res) => {
  try {
    const paymentData = {
      amount: req.body.amount,
      currency: req.body.currency || 'USD',
      clientUniqueId: req.body.clientUniqueId || `client-${Date.now()}`,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone,
      userTokenId: req.body.userTokenId,
      ccNumber: req.body.ccNumber,
      ccExpMonth: req.body.ccExpMonth,
      ccExpYear: req.body.ccExpYear,
      ccCvv: req.body.ccCvv,
      deviceIdentifier: req.body.deviceIdentifier,
      billingAddress: req.body.billingAddress,
      description: req.body.description
    };

    // Validate required fields
    if (!paymentData.amount || !paymentData.firstName || !paymentData.lastName || !paymentData.email) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'amount, firstName, lastName, and email are required'
      });
    }

    if (!paymentData.ccNumber || !paymentData.ccExpMonth || !paymentData.ccExpYear || !paymentData.ccCvv) {
      return res.status(400).json({
        error: 'Missing card details',
        message: 'ccNumber, ccExpMonth, ccExpYear, and ccCvv are required'
      });
    }

    const response = await nuveiClient.createPayment(paymentData);

    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

// GET /api/payments/:transactionId - Get payment details
router.get('/:transactionId', validateNuveiConfig, async (req, res) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({
        error: 'Missing transactionId',
        message: 'Transaction ID is required in the URL path'
      });
    }

    const response = await nuveiClient.getPaymentDetails(transactionId);

    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

// POST /api/payments/refund - Refund a payment
router.post('/refund', validateNuveiConfig, async (req, res) => {
  try {
    const refundData = {
      transactionId: req.body.transactionId,
      clientUniqueId: req.body.clientUniqueId,
      amount: req.body.amount,
      currency: req.body.currency || 'USD',
      description: req.body.description
    };

    if (!refundData.transactionId || !refundData.amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'transactionId and amount are required'
      });
    }

    const response = await nuveiClient.refundPayment(refundData);

    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Refund error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

// POST /api/payments/void - Void a payment
router.post('/void', validateNuveiConfig, async (req, res) => {
  try {
    const voidData = {
      transactionId: req.body.transactionId,
      clientUniqueId: req.body.clientUniqueId
    };

    if (!voidData.transactionId) {
      return res.status(400).json({
        error: 'Missing transactionId',
        message: 'Transaction ID is required'
      });
    }

    const response = await nuveiClient.voidPayment(voidData);

    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Void payment error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

module.exports = router;
