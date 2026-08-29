const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/**
 * Fetches a transaction's authoritative amount from GHL, keyed on
 * transactionId — the one identifier GHL's real queryUrl "verify" call
 * actually sends (see the spec: no orderId, no amount). Verifying against a
 * client-supplied orderId instead would let a caller bind an unrelated,
 * cheaper order's amount to a victim's real transactionId; keying on
 * transactionId itself closes that, since it's the same value GHL later
 * uses to confirm the charge.
 * @param {string} locationId
 * @param {string} transactionId
 * @returns {Promise<number>}
 */
async function getTransactionAmount(locationId, transactionId) {
  const accessToken = await getValidAccessToken(locationId);

  let response;
  try {
    response = await axios.get(`${GHL_API_BASE}/payments/transactions/${encodeURIComponent(transactionId)}`, {
      params: { altId: locationId, altType: 'location', locationId },
      headers: { Authorization: `Bearer ${accessToken}`, Version: 'v3' },
      timeout: 15000
    });
  } catch (error) {
    console.error(`GHL transaction lookup failed: ${error.message}`);
    throw {
      statusCode: 502,
      message: 'Failed to verify transaction with GHL',
      details: error.response?.data
    };
  }

  const amount = Number(response.data?.amount);
  if (!Number.isFinite(amount)) {
    throw { statusCode: 502, message: 'GHL transaction response missing a valid amount' };
  }
  return amount;
}

module.exports = { getTransactionAmount };
