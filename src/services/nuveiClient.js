const crypto = require('crypto');
const axios = require('axios');

class NuveiClient {
  constructor(config) {
    // Support both traditional API auth and SDK auth
    this.merchantId = config.merchantId;
    this.secretKey = config.secretKey;
    this.apiEndpoint = config.apiEndpoint || 'https://secure.safecharge.com/api/v1';
    this.sandboxMode = config.sandboxMode || false;
    
    // SDK authentication (alternative method)
    this.sdkUsername = config.sdkUsername;
    this.sdkPassword = config.sdkPassword;
    this.sdkKey = config.sdkKey;
    
    // Determine auth method
    this.useSDKAuth = !!(this.sdkUsername && this.sdkPassword && this.sdkKey);
    
    if (!this.merchantId && !this.useSDKAuth) {
      throw new Error('NUVEI configuration error: Either provide merchantId + secretKey or SDK credentials');
    }
  }

  /**
   * Generate authentication hash for NUVEI API
   * @param {Object} parameters - Request parameters
   * @returns {string} - Calculated checksum
   */
  /**
   * Calculate checksum for traditional API authentication
   * @param {Object} parameters - Request parameters
   * @returns {string} - Calculated checksum
   */
  calculateChecksum(parameters) {
    const concat = Object.keys(parameters)
      .sort()
      .map(key => {
        const value = parameters[key];
        if (value === null || value === undefined || value === '') {
          return '';
        }
        return String(value);
      })
      .join('');

    const withSecret = concat + this.secretKey;
    return crypto.createHash('sha256').update(withSecret).digest('hex');
  }

  /**
   * Make a request to NUVEI API
   * @param {string} endpoint - API endpoint
   * @param {Object} payload - Request payload
   * @returns {Promise<Object>} - API response
   */
  async makeRequest(endpoint, payload) {
    try {
      let requestPayload;
      
      if (this.useSDKAuth) {
        // SDK-based authentication
        requestPayload = {
          username: this.sdkUsername,
          password: this.sdkPassword,
          ...payload
        };
        // Add SDK key to headers if needed
      } else {
        // Traditional API authentication
        requestPayload = {
          merchantId: this.merchantId,
          ...payload,
          checksumforapilogin: this.calculateChecksum({
            merchantId: this.merchantId,
            ...payload
          })
        };
      }

      const response = await axios.post(`${this.apiEndpoint}${endpoint}`, requestPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-VERSION': '1.0'
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      console.error(`NUVEI API Error: ${error.message}`);
      throw {
        statusCode: error.response?.status || 500,
        message: error.response?.data?.message || error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Create a payment
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
      deviceIdentifier,
      billingAddress,
      description
    } = paymentData;

    const payload = {
      clientRequestId: `${Date.now()}-${Math.random()}`,
      amount: String(amount),
      currency,
      clientUniqueId,
      firstName,
      lastName,
      email,
      phone,
      userTokenId: userTokenId || '',
      ccNumber,
      ccExpMonth: String(ccExpMonth),
      ccExpYear: String(ccExpYear),
      ccCvv,
      deviceIdentifier: deviceIdentifier || '',
      relatedIdentifier: description || '',
      billingAddress: billingAddress ? JSON.stringify(billingAddress) : ''
    };

    return this.makeRequest('/payment', payload);
  }

  /**
   * Get payment details
   * @param {string} transactionId - Transaction ID from initial payment
   * @returns {Promise<Object>} - Payment details
   */
  async getPaymentDetails(transactionId) {
    const payload = {
      clientRequestId: `${Date.now()}-${Math.random()}`,
      transactionId
    };

    return this.makeRequest('/getPaymentDetails', payload);
  }

  /**
   * Refund a payment
   * @param {Object} refundData - Refund information
   * @returns {Promise<Object>} - Refund response
   */
  async refundPayment(refundData) {
    const {
      transactionId,
      clientUniqueId,
      amount,
      currency,
      description
    } = refundData;

    const payload = {
      clientRequestId: `${Date.now()}-${Math.random()}`,
      transactionId,
      clientUniqueId,
      amount: String(amount),
      currency,
      relatedIdentifier: description || ''
    };

    return this.makeRequest('/refundTransaction', payload);
  }

  /**
   * Void a payment (cancel if not yet processed)
   * @param {Object} voidData - Void information
   * @returns {Promise<Object>} - Void response
   */
  async voidPayment(voidData) {
    const {
      transactionId,
      clientUniqueId
    } = voidData;

    const payload = {
      clientRequestId: `${Date.now()}-${Math.random()}`,
      transactionId,
      clientUniqueId
    };

    return this.makeRequest('/voidTransaction', payload);
  }
}

module.exports = NuveiClient;
