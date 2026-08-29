# Known gaps before real GHL payment traffic — GHL Custom Payment Provider (Phase 1)

Phase 1 of the GHL Custom Payment Provider integration (see the plan and spec
in this same directory) is merged to `main` and passes its full test suite
(87/87), but the final whole-branch review's fix wave left **two load-bearing
gaps unresolved**. Do not point real GHL Marketplace App credentials at this
integration, or run real (non-test) transactions through it, until both are
fixed.

## 1. `POST /ghl-provider/charge` order-substitution risk (partially fixed)

`src/routes/ghlProvider.js`'s `/charge` endpoint is unauthenticated. The fix
in commit `af98c38` bound the returned `chargeId` to the GHL `transactionId`
forwarded from `payment_initiate_props`, which closes cross-order replay (an
attacker can no longer reuse a cheap `chargeId` against a *different* GHL
order). It does **not** close same-order underpayment: an attacker can open a
real, large GHL order, read their own legitimate `transactionId` out of
`payment_initiate_props`, then call `/charge` directly with
`{transactionId: <their own txn>, amount: 0.01, <their own card>}`. `/query`'s
`type:verify` handler finds a matching `transactionId` and reports
`{success:true}` — GHL marks the large order paid for a fraction of the
price, because both `transactionId` and `amount` are supplied by the same
untrusted caller.

**Fix options** (either closes it):
- Authenticate `/charge` — e.g. a short-lived, server-issued token minted
  when `payment_initiate_props` context is first established and required on
  the subsequent `/charge` call.
- Cross-check the charged amount against GHL's own order record before
  confirming — `locationId` and `transactionId` are already forwarded and
  stored on the charge record, and per-location OAuth tokens exist via
  `src/services/ghlOAuthClient.js`, so the lookup is feasible without new
  plumbing.

## 2. `POST /ghl-provider/query` doesn't check charge mode against the verifying apiKey's mode

`src/routes/ghlProvider.js`'s `/charge` stores `mode` (`'live'` or `'test'`)
on each charge record, and `/query`'s `verify` handler independently resolves
which mode the caller's `apiKey` authenticates as — but it never compares the
two. If `GHL_PROVIDER_LIVE_PUBLISHABLE_KEY`/`GHL_PROVIDER_TEST_PUBLISHABLE_KEY`
ever drift out of sync with what's actually registered with GHL (for example,
after re-running `scripts/register-ghl-provider.js`, which rotates all four
keys — live and test — on every invocation), a charge that correctly failed
closed to the BaseCommerce **sandbox** (no real money moved) can still be
confirmed to GHL via `/query` as a successful **live** payment, because the
verify check only looks at `apiKey` validity and `transactionId` match, never
`charge.mode`.

**Fix:** add `charge.mode === mode` to `/query`'s success condition
(`src/routes/ghlProvider.js` around line 243 as of commit `b56d9d1`) — both
values already exist in scope, this is a one-line change plus a test.

## Everything else from the final review is resolved

C1 (mode derivation), C2 (per-mode BaseCommerce credentials), I1 (charge
eviction + reconciliation logging), I2 (OAuth callback rate limiting, with
a documented reason CSRF `state` isn't applicable to this integration's
GHL-initiated flow), I3 (`.env.example` completeness), I5 (`NUVEI_SANDBOX_MODE`
override), and M1 (unused import) are all fixed and covered by tests.

One cosmetic-only gap also remains, safe to defer: the checkout page's CSP
(`src/routes/ghlProvider.js`, `GET /checkout`) has no `style-src`, so the
page's inline `<style>` block is blocked by browsers enforcing the policy —
the form still works, just renders unstyled. Fix: add
`style-src 'self' 'unsafe-inline'` to the CSP header.

## Context

Full history of how this was built (7 tasks via subagent-driven development,
per-task review findings, the rulings made along the way) is in the git log
between `d25f3c7` and `b56d9d1` on `main` — the execution ledger itself was
gitignored scratch inside a now-removed worktree and did not survive, but
every finding and ruling is reconstructed here and in the commit messages.
