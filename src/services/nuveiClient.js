const crypto = require('crypto');
const axios = require('axios');

// Nuvei REST 1.0 base hosts.
// https://docs.nuvei.com/documentation/accept-payment/server-to-server/rest-1-0/
const HOSTS = {
  sandbox: 'https://ppp-test.nuvei.com/ppp/api/v1',
  production: 'https://secure.safecharge.com/ppp/api/v1'
};

class NuveiClient {
  constructor(config = {}) {
    this.merchantId = config.merchantId;
    this.merchantSiteId = config.merchantSiteId;
    this.secretKey = config.secretKey;
    this.sandboxMode = config.sandboxMode !== false;
    this.apiEndpoint = config.apiEndpoint || (this.sandboxMode ? HOSTS.sandbox : HOSTS.production);
  }

  /**
   * Deferred to call time (rather than the constructor) so the app can boot
   * and serve unrelated routes even before NUVEI credentials are configured.
   */
  assertConfigured() {
    if (!this.merchantId || !this.merchantSiteId || !this.secretKey) {
      throw {
        statusCode: 500,
        message: 'NUVEI configuration error: merchantId, merchantSiteId, and secretKey are all required'
      };
    }
  }

  /**
   * Nuvei requires timestamps as YYYYMMDDHHmmss (UTC) for checksum + request fields.
   */
  generateTimeStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }

  generateClientRequestId() {
    return `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * SHA-256 of the given fields concatenated in order (no separators), with
   * merchantSecretKey appended last. Field order is endpoint-specific and
   * fixed by Nuvei — do not reorder or sort.
   */
  calculateChecksum(orderedValues) {
    const concat = orderedValues
      .map((v) => (v === null || v === undefined ? '' : String(v)))
      .join('');
    return crypto.createHash('sha256').update(concat + this.secretKey).digest('hex');
  }

  async request(endpoint, payload) {
    this.assertConfigured();
    try {
      const response = await axios.post(`${this.apiEndpoint}/${endpoint}`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      console.error(`NUVEI API Error [${endpoint}]: ${error.message}`);
      throw {
        statusCode: error.response?.status || 500,
        message: error.response?.data?.reason || error.response?.data?.message || error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Every payment/order call requires a sessionToken obtained first.
   * Checksum order: merchantId, merchantSiteId, clientRequestId, timeStamp, secretKey
   */
  async getSessionToken() {
    const timeStamp = this.generateTimeStamp();
    const clientRequestId = this.generateClientRequestId();
    const checksum = this.calculateChecksum([this.merchantId, this.merchantSiteId, clientRequestId, timeStamp]);

    return this.request('getSessionToken', {
      merchantId: this.merchantId,
      merchantSiteId: this.merchantSiteId,
      clientRequestId,
      timeStamp,
      checksum
    });
  }

  /**
   * Create a payment.
   * Checksum order: merchantId, merchantSiteId, clientRequestId, amount, currency, timeStamp, secretKey
   * @param {Object} paymentData - Payment information
   * @returns {Promise<Object>} - Payment response
   */
  async createPayment(paymentData) {
    const {
      amount,
      currency,
      clientUniqueId,
      firstName,
      lastName,
      email,
      phone,
      userTokenId,
      ccNumber,
      ccExpMonth,
      ccExpYear,
      ccCvv,
      ipAddress,
      country,
      description
    } = paymentData;

    const sessionResponse = await this.getSessionToken();
    if (!sessionResponse.sessionToken) {
      throw {
        statusCode: 502,
        message: 'Failed to obtain NUVEI session token',
        details: sessionResponse
      };
    }

    const timeStamp = this.generateTimeStamp();
    const clientRequestId = this.generateClientRequestId();
    const amountStr = Number(amount).toFixed(2);
    const checksum = this.calculateChecksum([
      this.merchantId,
      this.merchantSiteId,
      clientRequestId,
      amountStr,
      currency,
      timeStamp
    ]);

    const payload = {
      sessionToken: sessionResponse.sessionToken,
      merchantId: this.merchantId,
      merchantSiteId: this.merchantSiteId,
      clientRequestId,
      clientUniqueId: clientUniqueId || `txn-${Date.now()}`,
      userTokenId: userTokenId || email,
      amount: amountStr,
      currency,
      paymentOption: {
        card: {
          cardNumber: ccNumber,
          expirationMonth: String(ccExpMonth).padStart(2, '0'),
          expirationYear: String(ccExpYear).slice(-2),
          CVV: ccCvv
        }
      },
      billingAddress: {
        email,
        country: country || 'US',
        firstName,
        lastName
      },
      deviceDetails: {
        ipAddress: ipAddress || '127.0.0.1'
      },
      userDetails: { firstName, lastName, email, phone },
      relatedIdentifier: description || '',
      timeStamp,
      checksum
    };

    return this.request('payment', payload);
  }

  /**
   * Get payment/transaction status.
   * Checksum order: merchantId, merchantSiteId, clientRequestId, timeStamp, secretKey
   * @param {string} transactionId - Transaction ID from initial payment
   * @returns {Promise<Object>} - Payment details
   */
  async getPaymentDetails(transactionId) {
    const timeStamp = this.generateTimeStamp();
    const clientRequestId = this.generateClientRequestId();
    const checksum = this.calculateChecksum([this.merchantId, this.merchantSiteId, clientRequestId, timeStamp]);

    return this.request('getPaymentStatus', {
      merchantId: this.merchantId,
      merchantSiteId: this.merchantSiteId,
      clientRequestId,
      transactionId,
      timeStamp,
      checksum
    });
  }

  /**
   * Refund a settled payment.
   * Checksum order: merchantId, merchantSiteId, clientRequestId, amount, currency, timeStamp, secretKey
   * @param {Object} refundData - Refund information
   * @returns {Promise<Object>} - Refund response
   */
  async refundPayment(refundData) {
    const { transactionId, clientUniqueId, amount, currency } = refundData;
    const timeStamp = this.generateTimeStamp();
    const clientRequestId = this.generateClientRequestId();
    const amountStr = Number(amount).toFixed(2);
    const checksum = this.calculateChecksum([
      this.merchantId,
      this.merchantSiteId,
      clientRequestId,
      amountStr,
      currency,
      timeStamp
    ]);

    return this.request('refundTransaction', {
      merchantId: this.merchantId,
      merchantSiteId: this.merchantSiteId,
      clientRequestId,
      clientUniqueId: clientUniqueId || `refund-${Date.now()}`,
      relatedTransactionId: transactionId,
      amount: amountStr,
      currency: currency || 'USD',
      timeStamp,
      checksum
    });
  }

  /**
   * Void an un-settled payment.
   * Checksum order: merchantId, merchantSiteId, clientRequestId, timeStamp, secretKey
   * @param {Object} voidData - Void information
   * @returns {Promise<Object>} - Void response
   */
  async voidPayment(voidData) {
    const { transactionId, clientUniqueId } = voidData;
    const timeStamp = this.generateTimeStamp();
    const clientRequestId = this.generateClientRequestId();
    const checksum = this.calculateChecksum([this.merchantId, this.merchantSiteId, clientRequestId, timeStamp]);

    return this.request('voidTransaction', {
      merchantId: this.merchantId,
      merchantSiteId: this.merchantSiteId,
      clientRequestId,
      clientUniqueId: clientUniqueId || `void-${Date.now()}`,
      relatedTransactionId: transactionId,
      timeStamp,
      checksum
    });
  }
}

module.exports = NuveiClient;
