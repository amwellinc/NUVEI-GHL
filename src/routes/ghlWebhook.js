const express = require('express');
const router = express.Router();

/**
 * POST /webhooks/ghl
 * The Marketplace app's "Default webhook URL" — GHL posts app lifecycle
 * events here (INSTALL, UNINSTALL) plus any CRM events matching the app's
 * requested scopes. Logs and acknowledges everything for now; nothing
 * downstream depends on a specific event yet, so a new event type showing
 * up here is informational, not a failure.
 */
router.post('/', (req, res) => {
  const event = req.body || {};
  console.log(`[GHL Webhook] ${event.type || 'unknown event'} — locationId=${event.locationId || 'n/a'}`);
  res.status(200).json({ received: true });
});

module.exports = router;
