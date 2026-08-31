const GHLClient = require('../services/ghlClient');

const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

/**
 * Records a successful payment on its GHL contact (note, custom field, tag)
 * so a workflow can react to it (fulfillment, follow-up, etc.) — best
 * effort: a GHL-side failure here must never fail the payment response,
 * since the charge already succeeded at the gateway (or, for Stripe, is
 * being reported by Stripe's own webhook as confirmed). Each side effect is
 * independent so one failing doesn't block the others.
 * @param {string} contactId
 * @param {{transactionId: string, amount: string|number, currency: string}} payment
 */
async function notifyGHL(contactId, { transactionId, amount, currency }) {
  if (!contactId || !process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) return;

  try {
    await ghlClient.createNote(contactId, {
      body: `Payment received: ${currency} ${amount}\nTransaction ID: ${transactionId}\nTime: ${new Date().toISOString()}`
    });
  } catch (error) {
    console.warn('[Pay Link] Failed to create GHL note:', error.message);
  }

  try {
    await ghlClient.setCustomField(contactId, 'nuvei_transaction_id', transactionId);
  } catch (error) {
    console.warn('[Pay Link] Failed to set GHL custom field:', error.message);
  }

  try {
    await ghlClient.addTags(contactId, ['payment-completed']);
  } catch (error) {
    console.warn('[Pay Link] Failed to add GHL tag:', error.message);
  }
}

module.exports = { notifyGHL };
