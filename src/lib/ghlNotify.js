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
 *
 * This is the sole CRM record of a completed order (no pipeline/Opportunity
 * involved — GHL has no public API to create a native "Order", and the
 * Opportunity-pipeline workaround formerly used here was removed once the
 * pipeline backing it was deleted). It's deliberately pipeline-independent:
 * a contact always exists, so this can never 404 the way a deleted pipeline
 * did.
 * @param {string} contactId
 * @param {{transactionId: string, amount: string|number, currency: string, description?: string}} payment
 */
async function notifyGHL(contactId, { transactionId, amount, currency, description }) {
  if (!contactId || !process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) return;

  try {
    await ghlClient.createNote(contactId, {
      body: `Order received: ${description || 'N/A'}\nAmount: ${currency} ${amount}\nTransaction ID: ${transactionId}\nTime: ${new Date().toISOString()}`
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

/**
 * Records an abandoned cart on its GHL contact (note + tag) — the
 * pipeline-free counterpart to notifyGHL, used when a checkout session with
 * a known contact expires without ever completing a charge. Same
 * never-throws, independent-side-effects posture as notifyGHL.
 * @param {string} contactId
 * @param {{description?: string, amount: string|number}} cart
 */
async function notifyAbandonedCart(contactId, { description, amount }) {
  if (!contactId || !process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) return;

  try {
    await ghlClient.createNote(contactId, {
      body: `Abandoned cart: ${description || 'N/A'}\nAmount: ${amount}\nTime: ${new Date().toISOString()}`
    });
  } catch (error) {
    console.warn('[Pay Link] Failed to create GHL abandoned-cart note:', error.message);
  }

  try {
    await ghlClient.addTags(contactId, ['abandoned-cart']);
  } catch (error) {
    console.warn('[Pay Link] Failed to add GHL abandoned-cart tag:', error.message);
  }
}

module.exports = { notifyGHL, notifyAbandonedCart };
