# Known gaps — GHL Custom Payment Provider (Phase 1)

Status as of 2026-08-30: **both originally-identified load-bearing gaps are
fixed.** This doc is kept as a record of what they were and how they were
closed, plus one lower-severity residual limitation that remains.

## 1. Order-substitution / underpayment (FIXED)

**Original bug:** `POST /ghl-provider/charge` was unauthenticated and
trusted a client-supplied `amount`. Binding `chargeId` to GHL's
`transactionId` closed cross-order replay but not same-order underpayment —
an attacker who legitimately harvested their own real `transactionId` (just
by loading the checkout iframe, no purchase required) could call `/charge`
directly with `{transactionId: <real>, amount: 0.01, <own card>}` and have
`/query` confirm the real order as paid in full.

**First fix attempt (insufficient, caught by review):** verified the
requested `amount` against a client-supplied `orderId` via GHL's
`GET /payments/orders/:orderId`. This didn't close the bug — `orderId` was
just as attacker-controlled as `amount`, so an attacker could still bind an
unrelated cheap order's amount to a victim's real `transactionId`.

**Actual fix:** `src/services/ghlTransactionsClient.js`'s
`getTransactionAmount(locationId, transactionId)` looks up the transaction
by `transactionId` — the one identifier GHL's real `queryUrl` verify call
actually sends and the same value `/query` reconciles against — via
`GET /payments/transactions/:transactionId`. `/charge`
(`src/routes/ghlProvider.js`) now verifies the requested amount against
this GHL-sourced, transactionId-keyed amount before ever calling the
BaseCommerce gateway. `orderId` is still accepted for logging but is inert —
nothing security-relevant reads it. Verified: a security review traced the
attack scenario against the new code and confirmed it no longer succeeds;
a regression test (`ghlProvider.test.js`, "verifies the amount against
GHL's transaction record keyed by transactionId — NOT by the client-supplied
orderId") locks in the binding.

## 2. `/query` didn't check charge mode against the verifying apiKey's mode (FIXED)

**Bug:** a charge that correctly failed closed to the BaseCommerce sandbox
(no real money moved) could still be confirmed to GHL via `/query` as a
successful live payment, if the live/test publishable-key env vars ever
drifted out of sync with GHL's actual registration — `/query` only checked
`apiKey` validity and `transactionId` match, never `charge.mode`.

**Fix:** `src/routes/ghlProvider.js`'s `/query` verify handler now also
requires `charge.mode === mode` (the mode the caller's `apiKey`
authenticated as). Tested end-to-end: a real test-mode charge, verified with
a live-mode `apiKey`, correctly returns `{success:false}`.

## Residual, lower-severity limitation: `/charge` is still unauthenticated

`POST /ghl-provider/charge` has no auth check of its own (`/query` does, via
`apiKey`). Combined with the amount-verification fix above, this is no
longer an underpayment/fraud vector — but it is still a reachable oracle:
anyone who already knows a valid `(locationId, transactionId)` pair (e.g. by
loading a real checkout iframe) can probe `/charge` to learn whether a
guessed `amount` matches that transaction's real amount, via the 400
vs. non-400 response, without ever reaching the payment gateway. Rate
limiting (20/min/IP) applies but doesn't close it. `transactionId`s are
presumably opaque and not enumerable, which narrows the practical blast
radius significantly compared to the original bug. Not fixed in this pass —
would need either authenticating `/charge` itself (no natural point to mint
a token today, since `payment_initiate_props` is client-only) or accepting
this as a documented tradeoff. Worth a deliberate decision before this
integration handles significant transaction volume, not urgent before then.

## Everything else from the final whole-branch review

C1 (mode derivation), C2 (per-mode BaseCommerce credentials), I1 (charge
eviction + reconciliation logging), I2 (OAuth callback rate limiting), I3
(`.env.example` completeness), I4 (checkout page CSP, including the
`style-src` follow-up), and I5 (`NUVEI_SANDBOX_MODE` override) are all fixed
and covered by tests, as recorded in the original final-review ledger
(reconstructed in git history between `d25f3c7` and `b56d9d1` on `main`,
since the ledger itself was gitignored scratch inside a worktree).
