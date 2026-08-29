# GHL Custom Payment Provider — Verified Spec (Phase 1: one-time payments)

This is the ground-truth reference the implementation plan argues from. Everything below was verified against GoHighLevel's official marketplace docs on 2026-08-29 (`marketplace.gohighlevel.com/docs/...`, `help.gohighlevel.com/support/solutions/articles/155000002620`), except where explicitly marked as inferred/lower-confidence.

## Why this exists

The app's prior "GHL Custom Payment Provider" routes (`/checkout`, `/query/:transactionId`, `/pay/:sessionId`) were built on a server-redirect model that does not match GHL's real integration contract at all. GHL's actual model is: an iframe-embedded checkout page using `postMessage`, plus a server-side `queryUrl` GHL calls for verification/charging, plus outbound webhooks the provider sends to GHL. None of the prior routes are reusable for this — they're being replaced, not extended.

## Two integration paths GHL offers — this account must use the custom one

- **White-label path** (`POST /payments/integrations/provider/whitelabel`): restricted to `provider: 'authorize-net'` or `'nmi'` only. Not usable here — this merchant's gateway is BaseCommerce (see `project_nuvei_gateway_is_basecommerce` memory).
- **Fully-custom path** (`queryUrl` + `paymentsUrl`): what this spec covers. You own 100% of the payment logic; GHL just orchestrates the UI shell and calls your endpoints.

## Prerequisite: Marketplace App (not the Private Integration Token)

Custom Payment Provider registration requires a **marketplace-app OAuth token**, explicitly not the location-scoped Private Integration Token (`GHL_API_TOKEN`) this app already uses for contacts/notes. A Marketplace App already exists for this integration (status: **Draft, not yet approved**) — confirmed that draft apps can be installed and used for real OAuth/API calls against your own location without needing GHL's approval first (approval only gates public listing/distribution to other agencies).

Required OAuth scopes on the app:
```
payments/orders.readonly
payments/orders.write
payments/subscriptions.readonly
payments/transactions.readonly
payments/custom-provider.readonly
payments/custom-provider.write
products.readonly
products/prices.readonly
```

**Needed from the user before Task 3 (OAuth) can be tested live:** the Marketplace App's Client ID and Client Secret, and confirmation of the app's configured Redirect URL.

## OAuth flow

- Authorization happens via GHL's marketplace install flow (user clicks install on the app, GHL redirects to the app's configured Redirect URL with a `code` query param).
- Token exchange: `POST https://services.leadconnectorhq.com/oauth/token`, body (form-encoded): `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `user_type` (`Location` for a sub-account install), `redirect_uri`.
- Response: `access_token`, `token_type` (`Bearer`), `expires_in`, `refresh_token`, `scope`, `refreshTokenId`, `userType`, `companyId`, `isBulkInstallation`, `userId`, `locationId`.
- Refresh: same endpoint, `grant_type=refresh_token` with `refresh_token` instead of `code`.
- Tokens must be persisted (access + refresh) per location — there is no existing token store in this app; Phase 1 adds a minimal file/DB-free in-memory + env-seedable store (see Task 3).

## Provider registration — one endpoint, called at two different times

`POST https://services.leadconnectorhq.com/payments/custom-provider/connect?locationId=<LOCATION_ID>`
Headers: `Authorization: Bearer <marketplace-app OAuth access token>`, `Version: 2021-07-28` (existing app convention) — **note:** the payments-specific docs say `Version: v3` for this endpoint specifically, which conflicts with the `2021-07-28` version used elsewhere in this app for the standard GHL v2 API. Use `v3` for this call specifically; it is a different API surface (payments) from the contacts/notes API this app already calls.

Request body (full shape; this app's initial registration call sends `name`/`description`/`imageUrl`/`queryUrl`/`paymentsUrl` fields, and — per the support article's staged description — the `live`/`test` credential blocks may be omitted on first call and sent later when credentials are configured/updated; **inferred, not directly observed**: sending them together on the first call is expected to also work, since only one endpoint is documented):
```json
{
  "name": "NUVEI-Payments",
  "description": "AMWELL USA payment processing",
  "imageUrl": "https://am333-nuvei-production.up.railway.app/static/nuvei-logo.png",
  "queryUrl": "https://am333-nuvei-production.up.railway.app/ghl-provider/query",
  "paymentsUrl": "https://am333-nuvei-production.up.railway.app/ghl-provider/checkout",
  "live": { "apiKey": "<random-secret>", "publishableKey": "<random-public-id>" },
  "test": { "apiKey": "<random-secret>", "publishableKey": "<random-public-id>" }
}
```
Response (200): `{ name, description, paymentsUrl, queryUrl, imageUrl, _id, locationId, marketplaceAppId, paymentProvider, deleted, createdAt, updatedAt, traceId }`.

The `apiKey` values here are **this app's own generated secrets**, not BaseCommerce credentials — GHL stores them and echoes the matching one back in every `queryUrl`/webhook call so this app can verify the call genuinely came from GHL for this location. Generate with `crypto.randomBytes(32).toString('hex')`, one per mode (live/test), stored in this app's own config (not `.env` — see Task 2, must be per-location since a real deployment could serve multiple locations, though this account only has one today).

## Checkout iframe flow (`paymentsUrl`)

GHL loads `paymentsUrl` in an iframe on the customer-facing checkout page. All communication is `window.postMessage`.

1. Iframe page loads, posts to `window.parent`:
   ```json
   { "type": "custom_provider_ready", "loaded": true }
   ```
   (Phase 1 omits `addCardOnFileSupported` — that's Phase 2, saved cards.)
2. GHL responds by posting a `payment_initiate_props` message to the iframe:
   ```json
   {
     "type": "payment_initiate_props",
     "publishableKey": "...",
     "amount": 100.00,
     "currency": "USD",
     "mode": "payment",
     "contact": { "...": "..." },
     "orderId": "...",
     "transactionId": "...",
     "locationId": "..."
   }
   ```
   (`productDetails`, `subscriptionId` also appear in the wider docs; not relevant to Phase 1 one-time flow.)
3. The iframe page renders its own card form (this app's own HTML/JS — same visual pattern as the existing hosted `/pay/:sessionId` page being replaced, minus the server-redirect plumbing), collects card data client-side, and **posts it directly to this app's own backend** (a new endpoint, not GHL) to run the actual BaseCommerce `createPayment()` call.
4. On success, the iframe posts back to `window.parent`:
   ```json
   { "type": "custom_element_success_response", "chargeId": "<this app's own charge/transaction id>" }
   ```
   On failure:
   ```json
   { "type": "custom_element_error_response", "error": { "description": "Card declined" } }
   ```
   On user-initiated cancel:
   ```json
   { "type": "custom_element_close_response" }
   ```

## Server-side verification (`queryUrl`) — Phase 1 handles only `type: "verify"`

GHL POSTs to `queryUrl` after the iframe reports success, to confirm the charge really happened:
```json
{
  "type": "verify",
  "transactionId": "ghl_transaction_id",
  "apiKey": "the apiKey this app generated and registered for the active mode",
  "chargeId": "the chargeId this app returned in custom_element_success_response",
  "subscriptionId": "ghl_subscription_id"
}
```
Respond:
- `{"success": true}` — charge confirmed
- `{"failed": true}` — charge confirmed failed
- `{"success": false}` — still pending

**Verification of the caller**: compare the request body's `apiKey` against this app's own stored `live`/`test` apiKey (constant-time compare, reuse `timingSafeEqual` from `src/lib/security.js`) — this is GHL's actual auth mechanism, replacing the invented `X-Provider-Secret` header from the previous (wrong) implementation.

Other `queryUrl` request types (`list_payment_methods`, `charge_payment`, `create_subscription`, `refund`) are out of scope for Phase 1 — the route should recognize and cleanly reject them (`501`) rather than silently mishandling them, so a real GHL call for one of these during Phase 1 fails loud, not silent.

## Webhooks (outbound, this app → GHL) — deferred to Phase 2

`POST https://backend.leadconnectorhq.com/payments/custom-provider/webhook`, event types `subscription.trialing`, `subscription.active`, `subscription.updated`, `subscription.charged`, `payment.captured`, body includes `apiKey`. Phase 1's one-time-payment flow is confirmed synchronously via the `verify` queryUrl call above, so outbound webhooks are not required for Phase 1 to function — GHL's docs describe them as required specifically for keeping subscription state in sync, which is Phase 2 scope.

## What's explicitly NOT in Phase 1

- Saved/on-file cards (`addCardOnFileSupported`, `list_payment_methods`, `charge_payment`)
- Subscriptions / recurring billing (`create_subscription`, the "run your own billing cycle" responsibility, `subscription.*` webhooks)
- Refunds initiated from GHL (`type: "refund"` on `queryUrl`) — refunds remain possible via this app's existing `/api/payments/refund` route directly against BaseCommerce, just not reachable from GHL's UI yet
- Removing/replacing the OLD `/checkout`, `/query/:transactionId`, `/pay/:sessionId` routes in `ghl.js` — Task 6 removes them since they don't correspond to anything in GHL's real contract and are actively confusing to leave in place
