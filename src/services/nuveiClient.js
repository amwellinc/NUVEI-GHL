const crypto = require('crypto');
const axios = require('axios');

// This merchant's credentials are BaseCommerce (BaseX) credentials, confirmed
// 2026-08-29 against the merchant's own "Merchant Information" panel
// (Organization ID / SDK Username / SDK Password / SDK Key — this exact
// field set) and against BaseCommerce's own protocol as reimplemented in the
// open-source PHP port at github.com/greenlystinc/basecommerce-php, whose
// README states it reimplements "the SDK provided by BaseCommerce" with the
// same wire protocol. Two earlier guesses (Nuvei's REST 1.0 checksum API,
// then NMI's Direct Post API) were both dead ends — this merchant's Nuvei
// relationship is actually processed through BaseCommerce underneath.
//
// Protocol: POST a JSON body {gateway_username, gateway_password, payload}
// to gateway.basecommerce.com (production) or gateway.basecommercesandbox.com
// (sandbox), where payload is Triple DES (DES-EDE3, ECB, PKCS7 padding)
// encrypted JSON, hex-encoded, using a key derived from hex-decoding the SDK
// Key. The raw HTTP response body is the same hex-encoded ciphertext,
// decrypted the same way, then JSON-parsed.
//
// CONFIRMED LIVE 2026-08-29 against the real production gateway, end to
// end: a SALE with a well-known non-issuable test card number (4111...1111)
// was correctly built, transmitted, and evaluated by the real card network,
// coming back DECLINED with response_code 2006 "No such Issuer" — the
// expected, safe outcome for that card number. This confirms auth, the 3DES
// protocol, the endpoint, and every SALE field name, including
// bank_card_transaction_card_cvv2 (found by trial against the live
// validation error, not documented anywhere in the reference PHP port
// above, which doesn't expose a CVV field at all). VOID's shape is still
// inferred by analogy with refund (the reference implementation defines the
// constant but never exercises it) — verify with a real test transaction
// before relying on it.

const PRODUCTION_URL = 'https://gateway.basecommerce.com';
const SANDBOX_URL = 'https://gateway.basecommercesandbox.com';
const URI_PING = '/pcms/?f=API_PingPong';
const URI_CARD_TRANSACTION = '/pcms/?f=API_processBankCardTransactionV4';

const TRANSACTION_TYPE = { SALE: 'SALE', REFUND: 'REFUND', VOID: 'VOID' };
const FAILED_STATUSES = new Set(['FAILED', 'DECLINED']);

function clearObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

class NuveiClient {
  constructor(config = {}) {
    this.username = config.username;
    this.password = config.password;
    this.securityKey = config.securityKey;
    this.production = config.production === true;
    this.apiEndpoint = config.apiEndpoint || (this.production ? PRODUCTION_URL : SANDBOX_URL);
  }

  /**
   * Deferred to call time (rather than the constructor) so the app can boot
   * and serve unrelated routes even before credentials are configured.
   */
  assertConfigured() {
    if (!this.username || !this.password || !this.securityKey) {
      throw {
        statusCode: 500,
        message: 'NUVEI (BaseCommerce) configuration error: username, password, and securityKey are all required'
      };
    }
  }

  get cipherKey() {
    return Buffer.from(this.securityKey, 'hex');
  }

  encrypt(plaintext) {
    const cipher = crypto.createCipheriv('des-ede3', this.cipherKey, '');
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return encrypted.toString('hex');
  }

  decrypt(hexCiphertext) {
    const buf = Buffer.from(hexCiphertext, 'hex');
    const decipher = crypto.createDecipheriv('des-ede3', this.cipherKey, '');
    const decrypted = Buffer.concat([decipher.update(buf), decipher.final()]);
    // eslint-disable-next-line no-control-regex
    return decrypted.toString('utf8').replace(/[\x00-\x1F]+$/, '');
  }

  async post(uri, data) {
    this.assertConfigured();

    const body = {
      gateway_username: this.username,
      gateway_password: this.password,
      payload: this.encrypt(JSON.stringify(data))
    };

    let response;
    try {
      response = await axios.post(`${this.apiEndpoint}${uri}`, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: () => true,
        transformResponse: [(raw) => raw]
      });
    } catch (error) {
      console.error(`BaseCommerce API Error: ${error.message}`);
      throw { statusCode: 500, message: error.message };
    }

    if (response.status === 403) {
      throw { statusCode: 401, message: 'Invalid BaseCommerce credentials' };
    }
    if (response.status === 404) {
      throw { statusCode: 502, message: 'Invalid BaseCommerce URL/host' };
    }
    if (response.status !== 200) {
      console.error(`BaseCommerce API Error: HTTP ${response.status}`);
      throw {
        statusCode: 502,
        message: `BaseCommerce gateway error (HTTP ${response.status})`,
        details: typeof response.data === 'string' ? response.data.slice(0, 500) : undefined
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(this.decrypt(response.data));
    } catch (err) {
      throw { statusCode: 502, message: 'Failed to decrypt/parse BaseCommerce response', details: err.message };
    }

    if (parsed.exception) {
      throw { statusCode: 402, message: Object.values(parsed.exception).join('; '), details: parsed };
    }

    return parsed;
  }

  async ping() {
    return this.post(URI_PING, { PING: 'Ping Ping' });
  }

  /**
   * Create a sale transaction.
   * @param {Object} paymentData - Payment information
   * @returns {Promise<Object>} - { transactionId, status, raw }
   */
  async createPayment(paymentData) {
    const { amount, firstName, lastName, ccNumber, ccExpMonth, ccExpYear, ccCvv, billingAddress } = paymentData;

    const name = `${firstName || ''} ${lastName || ''}`.trim();
    const fields = clearObject({
      bank_card_transaction_name: name,
      bank_card_transaction_card_number: ccNumber,
      bank_card_transaction_expiration_month: String(ccExpMonth).padStart(2, '0'),
      bank_card_transaction_expiration_year: String(ccExpYear),
      bank_card_transaction_card_cvv2: ccCvv,
      bank_card_transaction_billing_address: billingAddress
        ? clearObject({
            address_name: name,
            address_line1: billingAddress.address1,
            address_line2: billingAddress.address2,
            address_city: billingAddress.city,
            address_state: billingAddress.state,
            address_zipcode: billingAddress.zip,
            address_country: billingAddress.country
          })
        : undefined,
      bank_card_transaction_type: TRANSACTION_TYPE.SALE,
      bank_card_transaction_amount: Number(amount).toFixed(2)
    });

    const response = await this.post(URI_CARD_TRANSACTION, fields);
    return this.parseTransactionResponse(response);
  }

  /**
   * Refund a settled transaction (full or partial).
   * @param {Object} refundData - Refund information
   * @returns {Promise<Object>} - { transactionId, status, raw }
   */
  async refundPayment(refundData) {
    const { transactionId, amount } = refundData;
    const fields = clearObject({
      bank_card_transaction_id: transactionId,
      bank_card_transaction_amount: Number(amount).toFixed(2),
      bank_card_transaction_type: TRANSACTION_TYPE.REFUND
    });

    const response = await this.post(URI_CARD_TRANSACTION, fields);
    return this.parseTransactionResponse(response);
  }

  /**
   * Void an un-settled transaction.
   * NOTE: lower confidence than createPayment/refund — the reference
   * implementation above defines the VOID transaction-type constant but
   * never exercises it, so this shape is inferred by analogy with refund,
   * not directly observed. Verify against a real test transaction.
   * @param {Object} voidData - Void information
   * @returns {Promise<Object>} - { transactionId, status, raw }
   */
  async voidPayment(voidData) {
    const { transactionId } = voidData;
    const fields = clearObject({
      bank_card_transaction_id: transactionId,
      bank_card_transaction_type: TRANSACTION_TYPE.VOID
    });

    const response = await this.post(URI_CARD_TRANSACTION, fields);
    return this.parseTransactionResponse(response);
  }

  parseTransactionResponse(response) {
    const txn = response.bank_card_transaction || {};
    const statusName = txn.bank_card_transaction_status?.bank_card_transaction_status_name || txn.bank_card_transaction_status;

    if (FAILED_STATUSES.has(statusName)) {
      throw {
        statusCode: 402,
        message: txn.bank_card_transaction_response_message || `Transaction ${statusName}`,
        details: txn
      };
    }

    return {
      transactionId: txn.bank_card_transaction_id,
      status: statusName,
      responseCode: txn.bank_card_transaction_response_code,
      raw: txn
    };
  }

  /**
   * Transaction lookup by ID is not exposed anywhere in the reference
   * protocol this was verified against — BaseCommerce transaction status
   * is normally checked via their reporting/back-office, not this API.
   * Confirm with BaseCommerce/Nuvei support whether a lookup endpoint
   * exists before relying on this.
   */
  async getPaymentDetails() {
    throw {
      statusCode: 501,
      message: 'Transaction lookup by ID is not implemented — not exposed in the verified BaseCommerce protocol. Confirm with BaseCommerce/Nuvei support.'
    };
  }
}

module.exports = NuveiClient;
