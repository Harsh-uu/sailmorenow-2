# STRIPE-WEBHOOK-FIX-1_REPORT (Part A - read-only analysis)

READ-ONLY. Nothing was disconnected, removed, reconnected, deleted, or changed - no
secret and no Stripe object was modified. I made read-only Stripe API calls and read the
DB/logs/code. Hyphens only. Tags: [VERIFIED] = observed here; [INFERRED] = reasoned /
platform behavior. NOTE: Stripe's API never returns a destination's signing secret after
creation (confirmed: `secret` not present on list), so which env secret maps to which
destination is correlated via the last4 Jenn read from the dashboard, not re-derived.

## (1) Every webhook destination on the sandbox (acct ending 1jyH), read-only
From `stripe.WebhookEndpoint.list` using the sandbox test key (sk_test_...04SP):

- Destination A - CURRENT fork [VERIFIED]
  - id: we_1UX4uJDP0Tnx1jyHn8d4nI9J
  - url: https://owsa-events-preview--7evdsk8f.preview.emergentagent.com/api/stripe/webhook
  - status: enabled
  - created: 2026-11-01 19:59:11 UTC
  - api_version: None (no pin -> uses the ACCOUNT default = 2026-09-30.endive at send)
  - livemode: false
  - enabled_events: ALL ("*")
  - Dashboard (Jenn): signing secret ends nQTl, 100% errors.
  - This URL == this fork's REACT_APP_BACKEND_URL (the live backend). [VERIFIED]

- Destination B - OLD fork [VERIFIED]
  - id: we_1UWBjrDP0Tnx1jyHg9A6u4JB
  - url: https://marina-connect-11.preview.emergentagent.com/api/stripe/webhook
  - status: enabled
  - created: 2026-10-30 09:04:43 UTC
  - api_version: None (account default = endive)
  - livemode: false
  - enabled_events: ALL ("*")
  - Dashboard (Jenn): signing secret ends zBxN, 21% errors.

- Which destination does the env secret belong to? Our STRIPE_WEBHOOK_SECRET ends zBxN,
  which matches Destination B (marina-connect-11), NOT the current Destination A (owsa,
  nQTl). [VERIFIED by last4 match; the API cannot expose the secret to prove it further.]
- This is the exact cause of "100% errors" on owsa: this backend verifies incoming
  signatures with zBxN, but owsa-signed events are signed with nQTl -> every delivery
  fails `construct_event` -> 400. Destination A was created Nov 1 19:59 UTC, and this
  fork's env was never updated to nQTl, so owsa has failed from creation. [VERIFIED,
  consistent with STRIPE-ERRORS-1.]

## (2) How the managed secret is chosen on a fork, why this one kept the old secret, and the supported sync path
- On a fork Emergent spins up a NEW preview (new host: owsa) and provisions a NEW managed
  webhook destination for it (Destination A, created Nov 1) - but the matching step that
  injects THAT destination's signing secret (nQTl) into the fork's STRIPE_WEBHOOK_SECRET
  did NOT complete. The env kept the PREVIOUS fork's secret (zBxN, which belongs to
  marina-connect-11). [VERIFIED facts: owsa endpoint exists + env still zBxN; INFERRED
  that the key-injection step was skipped/raced on this fork.]
- Supported way to get owsa's secret (nQTl) into this fork WITHOUT Remove or reconnect:
  there is NONE that the main agent can do - the secrets card is Emergent-managed and
  READ-ONLY, so STRIPE_WEBHOOK_SECRET cannot be hand-edited or pasted, and the API will
  not reveal nQTl. The secret can only be re-injected by the platform. [VERIFIED: card is
  managed/read-only; API hides the secret.]
- So the realistic supported path is a RECONNECT / re-link on the Emergent Payments tab
  (NOT Remove). What reconnect does: re-fetches the managed keys from the claimed sandbox
  and re-injects the current destination's signing secret; it should re-sync owsa's nQTl
  into the env. [INFERRED from the managed Flow A model.]
- IMPORTANT - what reconnect does NOT lose: the sandbox, its 5 products, 17 prices, and
  the coupon live in JENN'S Stripe account, independent of the app link, so a reconnect
  (re-link of the existing claimed sandbox) does not touch them. [INFERRED - consistent
  with STRIPE-CLAIM-VS-REMOVE-1.]
- DO NOT use "Remove". Remove severs the link and RE-ADDING MINTS A BRAND-NEW EMPTY
  SANDBOX. That would lose, in the app's linkage to the current sandbox: the 17 prices,
  the coupon SMNTEST3FREE, the 1,757-event history association, and both existing
  destinations - everything would need rebuilding (setup_stripe.py + manual coupon).
  [VERIFIED behavior per platform KB in STRIPE-CLAIM-VS-REMOVE-1.]
- Before reconnecting, confirm with Emergent whether a lighter "resync/refresh keys"
  action exists that re-injects the secret without a full reconnect; prefer that if
  offered. [INFERRED recommendation.]

## (3) Is the old marina-connect-11 fork still live and acting? Can it reach real users?
- Its destination is ENABLED with only ~21% errors, i.e. roughly 79% of deliveries return
  2xx. Something is answering 200 at that URL, and our env secret zBxN MATCHES marina's
  signing secret - so if the old fork backend is still running with secret zBxN it would
  VERIFY and FULLY PROCESS events: DB writes and entitlement emails. [VERIFIED error-rate
  + secret-match reasoning; INFERRED that the old pod is alive and processing.]
- That old pod runs the SAME codebase, so it has its own in-process scheduler, the events
  scraper/aggregator, and email sending (welcome, payment-failed, digests). It can send
  real email to real recipients. [VERIFIED-CODE that these run in-process; INFERRED it is
  active there.]
- The critical unknown: does the marina fork point at the SAME MongoDB as this fork
  (shared MONGO_URL) or an isolated copy? If shared, the old pod is double-writing live
  data and could email real users from stale logic; if isolated, the blast radius is a
  stale copy. This cannot be determined from inside this container - CONFIRM WITH
  EMERGENT. Treat as high-risk until confirmed. [INFERRED - unresolvable here.]
- How to pause it safely (describe only; Part B / Jenn action):
  1. Safest immediate stop of Stripe-driven actions: in Stripe, DISABLE (or delete) the
     marina-connect-11 destination so no events reach the old pod. This does NOT touch
     this app. (Part B.)
  2. That does NOT stop the old pod's TIME-BASED jobs (scheduler digests, scraper,
     reminder emails), which fire independently of Stripe. The only way to stop those is
     to STOP/retire the old fork environment itself - an Emergent platform action. Ask
     Emergent to stop the marina-connect-11 fork. [INFERRED.]
  - Do NOT rely on changing our env secret to "lock out" marina - marina has its own
    secret (zBxN) and its own pod; our env is irrelevant to it.

## (4) Is it safe to delete the marina-connect-11 destination in Stripe?
- YES, safe. Deleting a webhook endpoint only stops Stripe from delivering events to that
  URL. It does NOT affect the sandbox, the 5 products, the 17 prices, the coupon, the
  event history, or Destination A (owsa). [VERIFIED - endpoint delete is scoped to the
  endpoint.]
- What it "breaks": the old marina fork stops receiving Stripe events (the desired
  outcome - stops rogue DB writes/emails triggered by Stripe). The CURRENT app is
  unaffected, because its events flow through Destination A (owsa). [VERIFIED/INFERRED.]
- Note: our env secret equals marina's secret, but signature verification only needs the
  secret that SIGNED the incoming event - deleting marina's endpoint does not change
  owsa's secret or our ability to verify owsa events once nQTl is synced. [VERIFIED
  reasoning.]
- Caution: delete ONLY marina-connect-11 (we_1UWBjr...). Do NOT delete owsa
  (we_1UX4uJ...), the current app's destination.

## (5) Production destinations/secrets at Publish and Go live, and stale-fork cleanup
- At PUBLISH (web go-live) and at GO LIVE (install Emergent Payments app in the live
  account), Emergent provisions a MANAGED destination pointing at the production domain
  (app.sailmorenow.com/api/stripe/webhook) and injects its signing secret into the
  production environment; Emergent keeps that prod secret in sync. Jenn does not hand-set
  it. [INFERRED from the managed Flow A / Go-live model; see STRIPE-CLAIM-VS-REMOVE-1 and
  PROD-READINESS-1.] Test (sandbox) and live are separate accounts/destinations.
- Stale-fork cleanup: preview destinations are per-fork and accumulate. Delete the dead
  ones in Stripe (marina-connect-11 now; any future retired forks later), keeping only
  (a) the CURRENT preview destination for testing and (b) the PRODUCTION destination
  after Publish. The current-fork injection problem shows forks should be re-synced (or
  their stale destinations cleaned) as part of fork hygiene. [INFERRED recommendation.]

## (6) How to prove one signed delivery succeeds (after the env secret is re-synced to nQTl)
1. Confirm reachability: `curl -i -X POST <owsa-url>` with an unsigned body -> expect 400
   `{"received":false}` (already true; proves the route is live).
2. In Stripe, open Destination A (owsa) and use "Send test webhook" for
   customer.subscription.updated. Expect the dashboard delivery to show HTTP 200.
3. Prove it reached and was processed here, not just acknowledged:
   - backend logs show `POST /api/stripe/webhook ... 200` at that timestamp (no
     "signature/parse failed" warning).
   - the new event id appears in Mongo: `db.stripe_events.find_one({"id": "<evt_...>"})`
     returns the doc (the handler inserts it before processing).
4. Optional end-to-end: run one test checkout (card 4242, a $6.99 monthly plan) and
   confirm the matching customer.subscription.created / invoice.paid events now land in
   stripe_events (proving the webhook path works, independent of the redirect poll).
Do NOT use the testing agent (per Jenn) - verify via curl, the Stripe dashboard delivery
log, backend logs, and the DB. Clean up any throwaway test data.

---

## Summary / recommended Part-B order (for approval; not done here)
1. Re-sync the env webhook secret to owsa's nQTl via the Emergent Payments tab (prefer a
   resync/refresh if offered; otherwise reconnect - NOT Remove). Restart backend. Lost if
   Remove is used by mistake: the 17 prices, the coupon, and the sandbox linkage.
2. Delete (or disable) the marina-connect-11 destination (we_1UWBjr...) in Stripe - safe,
   stops the old fork receiving events. Keep owsa.
3. Ask Emergent to STOP the marina-connect-11 fork pod (its schedulers/scraper/email run
   independently of Stripe) and confirm whether it shares this MongoDB.
4. Prove one signed delivery per section 6.

Sources: read-only `stripe.WebhookEndpoint.list` (sandbox key sk_test_...04SP), this repo
(payments_router.py, server.py, scheduler.py), env last4, backend logs; cross-ref
STRIPE-ERRORS-1, STRIPE-CLAIM-VS-REMOVE-1, STRIPE-EXPIRY-CHECK-1, PROD-READINESS-1.
