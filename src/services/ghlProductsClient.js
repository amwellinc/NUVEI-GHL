const axios = require('axios');
const { getValidAccessToken } = require('./ghlOAuthClient');

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/**
 * Fetches a product's authoritative price directly from GHL's own catalog,
 * keyed on productId + priceId — the server-side source of truth for what a
 * catalog item actually costs. Used by POST /pay/create-link so a cart
 * total never has to be trusted from the browser that submitted it: when a
 * storefront passes productId/priceId instead of a raw amount, the price
 * that gets signed into the /pay link is the one GHL itself has on record,
 * not whatever the client claimed.
 * @param {string} locationId
 * @param {string} productId
 * @param {string} priceId
 * @returns {Promise<{amount: number, currency: string}>}
 */
async function getPriceAmount(locationId, productId, priceId) {
  const accessToken = await getValidAccessToken(locationId);

  let response;
  try {
    response = await axios.get(`${GHL_API_BASE}/products/${encodeURIComponent(productId)}/price`, {
      params: { locationId },
      headers: { Authorization: `Bearer ${accessToken}`, Version: '2021-07-28' },
      timeout: 15000
    });
  } catch (error) {
    console.error(`GHL product price lookup failed: ${error.message}`);
    throw {
      statusCode: 502,
      message: 'Failed to verify product price',
      details: error.response?.data
    };
  }

  const prices = response.data?.prices || [];
  const price = prices.find((p) => p._id === priceId);
  if (!price) {
    throw { statusCode: 400, message: 'Price not found for this product' };
  }

  const amount = Number(price.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw { statusCode: 502, message: 'Product price is invalid' };
  }

  return { amount, currency: price.currency || 'USD' };
}

module.exports = { getPriceAmount };
