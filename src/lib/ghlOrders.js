const GHLClient = require('../services/ghlClient');

const ghlClient = new GHLClient({
  locationId: process.env.GHL_LOCATION_ID,
  apiToken: process.env.GHL_API_TOKEN,
  apiEndpoint: process.env.GHL_API_ENDPOINT || 'https://services.leadconnectorhq.com'
});

// GHL has no public API to create a native Payments "Order" — Orders there
// only come from GHL's own checkout (funnel order form + an approved
// Marketplace payment provider) or a paid Invoice. An Opportunity in a
// dedicated pipeline is the externally-writable equivalent: fulfillment
// staff work it exactly like an order queue. Point these at real
// pipeline/stage ids from the location (see .env.example for how to find
// them) — unset means order/abandoned-cart tracking is silently skipped,
// never blocking checkout.
function ordersPipelineConfig() {
  return { pipelineId: process.env.GHL_ORDERS_PIPELINE_ID, pipelineStageId: process.env.GHL_ORDERS_NEW_STAGE_ID };
}

function abandonedCartPipelineConfig() {
  return { pipelineId: process.env.GHL_ABANDONED_CART_PIPELINE_ID, pipelineStageId: process.env.GHL_ABANDONED_CART_STAGE_ID };
}

/**
 * Best-effort: places a completed order into the configured "new order"
 * pipeline stage for fulfillment staff to work — never throws, since the
 * payment has already succeeded by the time this runs and a CRM hiccup
 * must not turn into a failure response for a real charge.
 * @param {{contactId: string, description?: string, amount: string|number, transactionId: string}} order
 */
async function createOrderOpportunity({ contactId, description, amount, transactionId }) {
  const { pipelineId, pipelineStageId } = ordersPipelineConfig();
  if (!contactId || !pipelineId || !pipelineStageId) return;

  try {
    await ghlClient.createOpportunity({
      pipelineId,
      pipelineStageId,
      contactId,
      name: description ? `Order: ${description}` : `Order ${transactionId}`,
      monetaryValue: Number(amount),
      source: 'wellness111.com checkout'
    });
  } catch (error) {
    console.warn('[GHL Orders] Failed to create order opportunity:', error.message);
  }
}

/**
 * Best-effort: places an abandoned cart into the configured pipeline stage
 * so a recovery workflow / follow-up staff can act on it. Called when a
 * checkout session that had a known contact expires without ever
 * completing a charge.
 * @param {{contactId: string, description?: string, amount: string|number}} cart
 */
async function createAbandonedCartOpportunity({ contactId, description, amount }) {
  const { pipelineId, pipelineStageId } = abandonedCartPipelineConfig();
  if (!contactId || !pipelineId || !pipelineStageId) return;

  try {
    await ghlClient.createOpportunity({
      pipelineId,
      pipelineStageId,
      contactId,
      name: description ? `Abandoned Cart: ${description}` : 'Abandoned Cart',
      monetaryValue: Number(amount),
      source: 'wellness111.com checkout'
    });
  } catch (error) {
    console.warn('[GHL Orders] Failed to create abandoned-cart opportunity:', error.message);
  }
}

module.exports = { createOrderOpportunity, createAbandonedCartOpportunity };
