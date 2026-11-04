# STRIPE-LIVE-PREP-1_BUILD_REPORT (Build complete)

Built the approved scope. I did NOT touch the Payments tab, Stripe destinations,
secrets, or any Stripe object; made NO live Stripe write calls; did NOT run the real
cleanup or the catalog sync. Hyphens only.

## Files changed
Backend:
- backend/billing.py - added `mask_email`, `_as_id`, and the shared
  `subscription_id_from_invoice` (legacy -> parent.subscription_details ->
  lines[].parent.subscription_item_details -> customer fallback -> None with warning).
- backend/routers/payments_router.py - imported the two helpers; rewrote
  `_handle_event` to return a result string and use the helper for invoice.paid /
  invoice.payment_succeeded / invoice.payment_failed; rewrote `_on_payment_failed` to
  use the helper; rewrote `stripe_webhook` for structured logging + the 2xx-vs-5xx
  policy (clears its own dedup marker on failure so retries reprocess); added
  POST /api/admin/billing/sync-catalog (admin-only).
- backend/deps.py - `stripe_mode()` now reads STRIPE_MODE first (falls back to the
  STRIPE_API_KEY prefix only when unset); added the live-mode boot assertion.
- backend/setup_stripe.py - refactored `main()` into importable
  `sync_catalog(stripe_key=None) -> summary`; added `current_mode`, `PROMO_CODE_FOR`,
  and idempotent `ensure_promo` (SMNTEST3FREE in test, SMNALPHA3FREE in live; 100% off,
  repeating 3 months); `main()` now prints the summary. Added `Optional` import.
- backend/prepublish_cleanup_dryrun.py - NEW, dry-run-only pre-publish cleanup.
- backend/tests/test_webhook_formats.py - NEW, 20 tests.
- backend/tests/stripe_payloads/*.json + README.md - NEW, documentation-built fixtures.
Frontend:
- frontend/src/pages/AdminBilling.jsx - added the admin-only "Stripe catalog" card with
  a confirm-gated "Sync catalog" button (data-testid admin-sync-catalog /
  admin-sync-result) that calls the new endpoint and shows the summary.

## 2xx vs error policy (Part B item 1, as approved)
- Return 2xx + log a warning (permanent/known, no Stripe retry):
  - unknown / unused event type -> result "ignored".
  - checkout.session.completed with no subscription -> "ignored".
  - subscription event whose customer maps to no user (entitlement returns None) ->
    "unmapped".
  - invoice.paid / payment_succeeded / payment_failed where no subscription can be
    resolved even after the customer fallback -> "no_subscription" (logged, never dropped).
- Return 500 so Stripe retries (transient / unexpected): any exception raised while
  handling (DB error, Stripe retrieve/network error, unexpected bug). On this path the
  dedup marker just inserted is deleted so the retry reprocesses; dedup + idempotent
  entitlement make retries safe.

## Logging (Part B item 6)
One INFO line per delivery: `stripe webhook id=<evt> type=<type> result=<...>` with
result in {processed, ignored, unmapped, no_subscription, duplicate, failed}. No
payloads, tokens, or secrets are logged; emails are masked via `mask_email`
(d***@domain) where logged.

## Test results
`cd /app/backend && python -m pytest tests/test_webhook_formats.py -q` -> 20 passed.
Covered: `subscription_id_from_invoice` for legacy top-level, endive parent, endive
lines-only, failed-invoice parent, expanded-dict subscription, customer fallback
(mocked list), and unresolvable -> None; `mask_email`; `_handle_event` classification
for all 8 fixtures -> processed, unknown type -> ignored, checkout-without-subscription
-> ignored, unmapped subscription -> unmapped, invoice-with-no-subscription ->
no_subscription. Fixtures are DOCUMENTATION-BUILT (basil changelog + API reference),
not real captures.

Other verifications (read-only, no Stripe writes):
- Imports OK; `deps.stripe_mode()` -> {"mode":"test",...}; `setup_stripe.current_mode()`
  -> "test"; PROMO_CODE_FOR correct.
- GET /api/payments/mode (banner source) returns mode:test with STRIPE_MODE unset
  (prefix fallback working).
- POST /api/admin/billing/sync-catalog is registered (401 unauthenticated, not 404) -
  NOT invoked (it writes to Stripe).
- Webhook endpoint still reachable from outside (unsigned -> 400).
- Dry-run cleanup ran read-only: 4 demo/seed users and 8 sandbox-linked test users
  matched; 19 comp users protected; allowlist currently empty.
  NOTE: doug@topmarktech.com is among the 8 matched - if Doug is a real tester to keep,
  add his email to REAL_TESTER_ALLOWLIST before the real run.

## What I could NOT verify (needs real endive events after the webhook secret is synced)
- End-to-end parsing of REAL endive invoice.paid / payment_succeeded / payment_failed
  payloads - validated only against doc-built fixtures and unit logic. Confirm with a
  real signed delivery once STRIPE_WEBHOOK_SECRET is re-synced (STRIPE-WEBHOOK-FIX-1).
- A signed webhook actually returning 200 end-to-end - currently blocked by the
  secret mismatch (owsa secret nQTl vs env zBxN); the resync must happen first.
- The 500-retry path against real Stripe retries (only unit-reasoned here).
- `sync_catalog` against a live/test Stripe account (writes; not run). Idempotency is
  from code reading + the existing lookup_key/transfer_lookup_key design; the promo
  ensure is idempotent by promotion-code lookup. Run via the admin button after go live.
- The banner showing "live" in production (STRIPE_MODE=live) - only the logic is
  verified in preview; not exercised in a live environment.
- The boot assertion firing - only triggers when STRIPE_MODE=live with a non-live
  secret; not reproduced here (would require setting STRIPE_MODE, which is managed).

## Not done (by instruction / safety)
- No real cleanup run (dry-run only; awaiting your go-ahead right before Publish).
- No catalog sync executed (no live Stripe writes).
- No Payments tab / destination / secret / Stripe-object changes.
- Outgoing API-version pin (2024-06-20) left unchanged.

## Other problems noticed (reported, not fixed - per instruction)
- The webhook will keep failing signature verification until STRIPE_WEBHOOK_SECRET is
  re-synced to the owsa destination's nQTl (STRIPE-WEBHOOK-FIX-1 Part B). This build
  does not and cannot fix that (managed read-only secret).
- raejen2+test2@gmail.com has a stripe_customer_id but provider=None/tier=free (an
  abandoned checkout) - harmless, cleared by option (a) anyway.
