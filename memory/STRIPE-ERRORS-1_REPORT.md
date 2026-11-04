# STRIPE-ERRORS-1_REPORT - Doug's Nov 3 webhook failures

READ-ONLY investigation. No code, data, Stripe objects, or secrets were changed; no keys
pasted. One harmless unsigned curl was sent to the public webhook to observe its live
response (it returned 400, as expected). Hyphens only. Tags: [VERIFIED] = observed in
this env (logs / live curl / DB / code); [INFERRED] = reasoned / platform behavior.

## TL;DR
Two separate failures, neither in our code:
1. AVAILABILITY (what Stripe's dashboard shows as 404 "404 page not found"): at Doug's
   purchase time the PREVIEW backend was not serving, so the Emergent edge returned a
   plain-text 404. That body is NOT from FastAPI (FastAPI returns JSON), proving the
   request never reached the app.
2. SIGNATURE MISMATCH (the current blocker): when retries DID reach the app, they failed
   signature verification - "No signatures found matching the expected signature" - so
   the handler returned 400. The STRIPE_WEBHOOK_SECRET in this environment no longer
   matches the Active destination's signing secret. The webhook has effectively been
   down since ~Nov 1 (last successfully stored event 2026-11-01 03:34 UTC).
Impact is contained because NEW checkouts are reconciled by the post-checkout redirect
poll (Doug's plan is correct). Webhook-ONLY events (renewals, failed payments, portal
cancels, refunds, trial-end) have NOT been applied since Nov 1.

---

## (1) Does POST /api/stripe/webhook exist and respond correctly now? Did Stripe's Nov 3 requests hit the backend?
- The route EXISTS: `@router.post("/stripe/webhook")` and an alias `@router.post(
  "/webhook/stripe")` (payments_router.py:692-693), both mounted under `/api`.
  [VERIFIED-CODE.]
- Live from OUTSIDE the container (current public preview URL, which equals the Stripe
  destination host) [VERIFIED by curl just now]:
  - GET  /api/                      -> 200
  - POST /api/stripe/webhook        -> 400, JSON body `{"received":false}` (FastAPI
    reached; signature invalid for the dummy body - correct behavior)
  - POST /api/webhook/stripe        -> 400 (alias also reached)
  - POST /api/stripe/nope-not-route -> 404, JSON `{"detail":"Not Found"}` (22 bytes)
- The 404 FastAPI produces is JSON, NOT the plain text "404 page not found" Stripe saw.
  So the Nov 3 404s were served by the Emergent/ingress edge BEFORE FastAPI - i.e. the
  preview backend was asleep / not serving at 21:40 UTC. [VERIFIED by the body-shape
  contrast; INFERRED that the specific cause was a sleeping/not-ready preview pod.]
- Did Stripe's requests ever reach the app? Yes, on the RETRIES. backend.err.log shows,
  at 2026-11-03 22:39-22:40 UTC (about an hour after Doug's 21:40 origin), repeated:
  "stripe webhook signature/parse failed: No signatures found matching the expected
  signature for payload" -> HTTP 400. Those carry a real stripe-signature header, so
  they are genuine Stripe deliveries that reached FastAPI but failed the secret check.
  (The 2026-11-04 19:08 "Unable to extract timestamp and signatures" lines are MY test
  curl, no signature header - ignore.) [VERIFIED logs.]
- What served the 404: the preview edge/ingress when the backend was not up - NOT a
  wrong route prefix (the route and the `/api` prefix are correct and reachable now).
  [VERIFIED/INFERRED.]
- Corroboration that the webhook never processed Doug's events: NONE of Doug's Nov 3
  event ids (setup_intent.*, checkout.session.completed, customer.subscription.created,
  etc.) are in `stripe_events`; the newest stored event is 2026-11-01 03:34 UTC.
  [VERIFIED DB.]

## (2) Who created this destination, where does it point, and Publish / Go-live behavior
- The destination URL is the PREVIEW host (owsa-events-preview--7evdsk8f...
  /api/stripe/webhook), which is this app's current REACT_APP_BACKEND_URL. It is the
  EMERGENT-MANAGED preview webhook (Jenn's manually created endpoint was deleted, so the
  remaining Active one is the managed preview destination). [VERIFIED URL = preview host;
  INFERRED that it is the managed one.]
- Its signing secret is supposed to be injected as STRIPE_WEBHOOK_SECRET (present,
  whsec_...zBxN). It has DRIFTED out of sync with the destination (see section on root
  cause), which is why signatures fail. [VERIFIED: present + mismatch symptom.]
- At PUBLISH / GO LIVE: Emergent provisions a SEPARATE managed PRODUCTION destination
  pointing at the prod domain and keeps ITS signing secret in sync automatically - the
  preview destination is not reused for prod, and Emergent (not Jenn) maintains the
  secret. [INFERRED from the managed Flow A / Go-live model; see STRIPE-CLAIM-VS-REMOVE-1
  and PROD-READINESS-1.] This incident shows the PREVIEW secret can drift after a
  claim/rotation, so secret-sync must be re-verified after any Stripe account change and
  after Publish.

## (3) How "My plan" is updated, and what depends ONLY on the webhook
- TWO paths write entitlement, both calling the single `apply_subscription_entitlement`:
  1. The WEBHOOK (`_handle_event`, payments_router.py:634-650) - the intended source of
     truth.
  2. The POST-CHECKOUT REDIRECT POLL (payments_router.py:591-603): when the user returns
     from Stripe Checkout, the app retrieves the session + subscription and applies
     entitlement + marks the transaction paid. [VERIFIED-CODE.]
- This redirect poll is why Doug is correctly entitled even though his webhook events
  failed - it does NOT depend on the webhook. [VERIFIED by DB, section 6.]
- Things that depend ONLY on the webhook (currently NOT happening since ~Nov 1):
  - Renewals: `invoice.paid` -> re-apply entitlement / extend expiry.
  - Failed payments: `invoice.payment_failed` -> downgrade handling + "payment didn't go
    through" email.
  - Portal cancellations: `customer.subscription.updated` (cancel_at_period_end) ->
    reflect "cancels on ...".
  - Refunds / cancellations / expiry: `customer.subscription.deleted|updated` -> drop
    tier.
  - Trial-end conversion: `customer.subscription.updated` trialing -> active (and the
    activation welcome email).
  These never go through the redirect poll, so while the webhook is broken they are
  silently dropped. [VERIFIED-CODE + INFERRED impact.]

## (4) Is the handler idempotent? Is Stripe "Resend" safe?
- Idempotent: YES. `stripe_webhook` upserts the event id into `stripe_events` with
  `$setOnInsert`; if the event was already seen (`matched_count`) it returns
  `{"received":true,"duplicate":true}` without reprocessing (payments_router.py:702-709).
  And `apply_subscription_entitlement` writes ABSOLUTE state from the subscription, so
  reprocessing is harmless. The welcome email is guarded by `welcome_sent`.
  [VERIFIED-CODE.]
- Resend is SAFE - no double charge (webhook does not charge), no double entitlement, no
  duplicate welcome. [VERIFIED-CODE.]
- Two caveats: (a) Resending Doug's Nov 3 events will STILL 400 until the signing secret
  is fixed - fix the secret first, then Resend. (b) Minor: the event id is recorded
  BEFORE handling, so if handling had thrown after insert, a later Resend would be
  treated as duplicate and skipped; but because entitlement is also idempotent and the
  redirect poll already reconciled new checkouts, this is not a practical risk here.
  [VERIFIED-CODE / INFERRED.]

## (5) Will the handler cope with API version 2026-09-30.endive?
- customer.subscription.* (parsed directly from the webhook object): YES.
  - user mapping: `metadata.user_id` then `customer` lookup - stable. [VERIFIED-CODE.]
  - price/lookup: `items.data[0].price.lookup_key` - stable location. [VERIFIED-CODE.]
  - status, cancel_at_period_end, metadata.promo/promo_months, start_date/created -
    stable. [VERIFIED-CODE.]
  - current_period_end: handled - `sub.current_period_end or item.current_period_end or
    sub.trial_end` (billing.py:213), which is exactly the field that moved to the item
    level in newer versions. trial_end read directly. [VERIFIED-CODE.]
- Objects we RETRIEVE (checkout.session.completed, invoice.paid, payment_failed call
  `stripe.Subscription.retrieve`) come back in our pinned 2024-06-20 shape, so they parse
  fine regardless of the endpoint version. [VERIFIED-CODE.]
- SECONDARY RISK [INFERRED - verify]: the invoice branches read `invoice.get(
  "subscription")` (payments_router.py:648,676). In 2025+/endive API versions Stripe
  REMOVED the top-level `invoice.subscription` (moved under
  `invoice.parent.subscription_details.subscription` / lines). Under endive,
  `invoice.paid` and `invoice.payment_failed` may not find the subscription, so renewal
  re-entitlement and the failed-payment email could be skipped. The main tier is still
  driven by customer.subscription.* events, so entitlement is not lost - but this is a
  code follow-up to read the subscription from the new invoice location. NOT the cause of
  Doug's failure.

## (6) Stripe state vs our database (Doug and Jenn)
- Doug (doug@topmarktech.com, user_88a706b9c777) [VERIFIED DB]:
  - tier=featured, status=trialing, provider=stripe,
    stripe_customer_id=cus_VYxK7uIeYhayWy,
    stripe_subscription_id=sub_1UXpQyDP0Tnx1jyHVDwHEIwA, package=pro_featured_1,
    expires 2026-12-03T21:40.
  - payment_transactions: his session cs_test_a1KlGt... status=completed,
    payment_status=paid, created 2026-11-03T21:39:01.
  - So his "My plan" IS CORRECT and matches Stripe (a $19.99 Boat Pro Featured trial),
    applied via the redirect poll despite the webhook failing. None of his Nov 3 events
    are in `stripe_events`. [VERIFIED.]
- Jenn: her real admin account (jenn@sailmorenow.com) is a COMP premium grant (no Stripe
  objects) - unaffected. Her Stripe TEST accounts (jenn+123@, jenn+stripe1@) show
  trialing stripe subscriptions created Nov 3 and are correctly entitled via the redirect
  poll (sub_1UXWn0..., sub_1UXdXF...). [VERIFIED DB.]
- Conclusion: entitlement is consistent for everyone who completed checkout, so NO user
  is under-entitled today. The gap is purely the webhook-only lifecycle events since
  ~Nov 1 (renewals/cancels/failed-payments/trial-end), which have not been processed.

---

## ROOT CAUSE
The managed webhook signing secret (STRIPE_WEBHOOK_SECRET, whsec_...zBxN) is OUT OF SYNC
with the Active destination's current signing secret, so every delivery that reaches the
app fails signature verification and returns 400. This started around Nov 1 (last stored
event 2026-11-01 03:34 UTC), consistent with a secret rotation during the sandbox
claim/changes. A secondary, preview-only availability gap (the pod not serving at Doug's
21:40 purchase) produced the plain-text 404s Stripe first recorded, before the retries
hit the 400.

## IMPACT
- PREVIEW: webhook effectively down since ~Nov 1. NEW checkouts are still correctly
  entitled via the redirect poll (verified for Doug + Jenn's test subs). Webhook-only
  events (renewals, failed-payment emails, portal cancels, refunds/downgrades, trial-end
  conversions + activation welcome) are being dropped.
- PRODUCTION: the sleeping-pod 404 will NOT occur (prod is always-on). The signature
  drift would also break prod IF the managed prod secret is not in sync - but Go-live
  provisions and syncs the prod destination/secret automatically. Verify sync after
  Publish/Go-live.

## SMALLEST FIX (no code change)
Re-sync STRIPE_WEBHOOK_SECRET with the Active destination's signing secret. Because the
secret is Emergent-managed (read-only secrets card), the path is to RECONNECT / re-link
Stripe on the Emergent Payments tab so Emergent re-injects the matching whsec_, then let
the backend restart pick it up. [Jenn + Emergent action.] No application code needs to
change for the core fix. (Optional, separate follow-up: update the invoice.* branches to
read the subscription from the endive invoice location - see section 5.)

## TEST PLAN (after the secret is re-synced; preview)
1. Confirm reachability: `curl -i -X POST <preview>/api/stripe/webhook` -> expect 400
   `{"received":false}` for an unsigned body (already true).
2. In Stripe, use "Send test webhook" for customer.subscription.updated -> expect HTTP
   200 in the dashboard and the event id newly present in `stripe_events`.
3. RESEND Doug's Nov 3 events (checkout.session.completed, customer.subscription.created,
   invoice.paid) -> expect 200, and Doug's record unchanged (idempotent) - safe.
4. End-to-end: run one test checkout with card 4242 on a $6.99 monthly plan -> confirm
   the plan flips AND the matching events now land in `stripe_events` (proving the
   webhook, not just the poll, is working).
5. Exercise a webhook-only path: cancel in the customer portal -> expect
   customer.subscription.updated to arrive (200) and the record to show
   cancel_at_period_end. Optionally test a failed payment (card 4000...0341) for the
   invoice.payment_failed email (watch for the section-5 invoice.subscription caveat).
6. Keep the preview awake during the test so availability 404s do not reappear.
Do NOT use the testing agent (per Jenn). Verify via curl, the Stripe dashboard delivery
log, and `stripe_events` / `users` in the DB. Clean up any throwaway test accounts.

Sources: this repo (payments_router.py, billing.py, server.py), backend supervisor logs,
live curl to the public preview URL, and DB reads (users, payment_transactions,
stripe_events). Cross-ref STRIPE-CLAIM-VS-REMOVE-1, STRIPE-EXPIRY-CHECK-1,
PROD-READINESS-1.
