const GHLClient = require('../services/ghlClient');

const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

/**
 * Best-effort: resolves a checkout email (+ optional name) to a GHL contact
 * id via upsert. Shared by every checkout path that might need to attach an
 * order or abandoned-cart record to the right CRM contact without ever
 * trusting a client-supplied contactId directly (that would let anyone tag
 * an arbitrary existing contact). Returns '' (never throws) on any failure
 * — a CRM hiccup must never block checkout.
 * @param {string} email
 * @param {string} [firstName]
 * @param {string} [lastName]
 * @returns {Promise<string>}
 */
async function resolveContactId(email, firstName, lastName) {
  if (!email || !process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) return '';
  try {
    const result = await ghlClient.upsertContact({ email, firstName, lastName });
    return result?.contact?.id || result?.id || '';
  } catch (error) {
    console.warn('[GHL Contact] Resolution failed:', error.message);
    return '';
  }
}

module.exports = { resolveContactId };
