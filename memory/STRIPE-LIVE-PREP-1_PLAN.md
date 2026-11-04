# STRIPE-LIVE-PREP-1_PLAN (Part B + Part C) - PLAN ONLY

Nothing was changed. This is a plan with the files I would touch, the risks, and test
lists, for your approval. No code, data, secrets, or Stripe objects were modified; the
Payments tab was not touched. Hyphens only. Tags: [VERIFIED] = read from this repo /
Stripe changelog; [INFERRED] = reasoned.

===============================================================================
PART B - webhook payload format (2026-09-30.endive)
===============================================================================

### Changelog confirmation [VERIFIED - docs.stripe.com/changelog/basil/2025-03-31]
In 2025-03-31.basil Stripe added a mandatory `parent` field to invoicing objects and
REMOVED the top-level links. For the Invoice object, the deprecated top-level
`subscription` is replaced by `invoice.parent.subscription_details.subscription`, and
you must check `invoice.parent.type == "subscription_details"` first. Line items moved
to `line.parent.subscription_item_details.subscription`. This is in force for basil,
clover, and endive (all >= 2025-03-31), so our account-default endpoints (no pinned
version, confirmed in STRIPE-WEBHOOK-FIX-1) deliver invoices in the new `parent` shape.
Guidance is to code defensively: read `parent` first, fall back to the old top-level
field. Subscription, Checkout Session, and SetupIntent objects were NOT changed by this
migration (their `subscription`/`customer` fields are unchanged); `current_period_end`
separately moved to the subscription ITEM in newer versions (already handled in code).

### B1. Every webhook/payload read today [VERIFIED - file:line]
Invoice objects (THE GAP - these use the removed top-level field):
- payments_router.py:648 `obj.get("subscription")` in invoice.paid branch.
- payments_router.py:676 `invoice.get("subscription")` in `_on_payment_failed`.
- payments_router.py:687 `invoice.get("hosted_invoice_url")` (unchanged field, fine).
Checkout Session (unchanged by basil - fine):
- payments_router.py:593-594 `sess.get("subscription")`, `sess["subscription"]` (poll).
- payments_router.py:641-642 `obj.get("subscription")`, `obj["subscription"]`
  (checkout.session.completed).
Subscription objects (unchanged top-level; item-level period already handled):
- billing.py:190-191 metadata.user_id, customer; :205-207 items.data[0].price.lookup_key;
  :209 status; :213-214 current_period_end (sub -> item -> trial_end fallback already
  present); :217 metadata; :224 start_date/created; :230 cancel_at_period_end;
  :242 trial_end.
- payments_router.py:317, 392-394, 449-460 (plan-change/preview paths) read
  `sub.get("current_period_end") or item.get("current_period_end")` and
  `item["price"]["id"]` from a RETRIEVED subscription - these come back in our pinned
  2024-06-20 shape (see Part C / B5), so they are safe and OUT OF SCOPE for this change.
- `_recipient` (payments_router.py:654-655) reads metadata.user_id / customer from a
  subscription or invoice - customer is unchanged, fine.
SetupIntent: the webhook does not branch on setup_intent.* (we ignore it) - no reads.

### B2. Plan: one shared helper to resolve the subscription id on an invoice
New helper in billing.py (single source, imported by payments_router):
`def subscription_id_from_invoice(invoice: dict) -> Optional[str]` that tries, in order:
1. `invoice.get("subscription")` (legacy / pre-basil).
2. If `invoice.get("parent", {}).get("type") == "subscription_details"`:
   `invoice["parent"]["subscription_details"]["subscription"]`.
3. Scan `invoice.get("lines", {}).get("data", [])` for
   `line["parent"]["subscription_item_details"]["subscription"]` (newer line shape).
4. FALLBACK: if still none and a customer id is present, look up the customer's active
   subscription via `stripe.Subscription.list(customer=..., status="all", limit=1)` and
   use it; log a WARNING that we fell back.
5. If nothing resolves, LOG an error with event id + type and still return 2xx (never
   drop silently) - the entitlement is also covered by customer.subscription.* events.
Then change payments_router.py:648 and :676 to call this helper instead of
`invoice.get("subscription")`. The id can be a string or an expanded object - the helper
returns the id string (handle both `x` and `x["id"]`).
[Design confirmed against the basil changelog; the `parent.type` guard is required.]

### B3. Always 2xx for event types we do not use
Plan: in `stripe_webhook` (payments_router.py:692-716) the flow already returns
`{"received": True}` (200) for unhandled types because `_handle_event` just falls
through. KEEP that. Non-2xx ONLY for:
- bad/missing signature or parse error -> 400 (already: line 699-701).
- a real processing EXCEPTION -> change the current behavior. Today line 712-715
  swallows the exception and still returns 200. Plan: on a genuine processing failure,
  LOG it (B6) and return 500 so Stripe RETRIES (the dedup via stripe_events makes retry
  safe). Keep returning 200 for "ignored" types. (Small, deliberate behavior change -
  flag for your approval, since it enables Stripe retries on transient DB errors.)

### B4. Test payloads - both formats
Plan to add `backend/tests/stripe_payloads/` with JSON fixtures and a test module that
feeds them through `_handle_event` / `subscription_id_from_invoice` (bypassing signature
by calling the handler directly, since we cannot sign without the secret):
- invoice.paid, invoice.payment_succeeded, invoice.payment_failed - in BOTH legacy
  (top-level `subscription`) and endive (`parent.subscription_details.subscription` +
  `lines.data[].parent`) shapes.
- customer.subscription.created / updated / deleted - endive shape (item-level
  current_period_end, status transitions trialing->active, cancel_at_period_end).
- checkout.session.completed - unchanged shape.
Assert: subscription id resolves in every shape; entitlement writes the right tier;
unknown type returns 200; fallback path logs a warning; nothing is dropped.
SAMPLE SOURCE: these will be BUILT FROM DOCUMENTATION (the basil changelog + the Stripe
API object reference), NOT real captures, because we have no signed captures of Doug's
events and must not pull live data. I will mark each fixture header as "doc-built". If
you can export 1-2 real events from the Stripe dashboard later, we can swap them in.

### B5. Outgoing API version pin - UNCHANGED
Leave `stripe.api_version = "2024-06-20"` (billing.py:22) as-is. All `stripe.*.retrieve`
calls therefore return the 2024-06-20 shape (top-level current_period_end, top-level
invoice.subscription), which the retrieve-based code paths already expect. Only the
DIRECT webhook invoice objects (endive) need the helper. [VERIFIED-CODE.]

### B6. Structured logging for every webhook
Plan: one log line per event at INFO with `event_id`, `type`, and `result` in
{processed, ignored, failed}. Add a tiny `mask_email` util (keep first char + domain,
e.g. `d***@topmarktech.com`) and use it anywhere a recipient is logged. Never log
payloads, tokens, or secrets. Emit the line in `stripe_webhook` after `_handle_event`
returns / raises, and have `_handle_event` return a small result enum/string.

### Part B - files I would change
- backend/billing.py: add `subscription_id_from_invoice` + `mask_email` helpers.
- backend/routers/payments_router.py: use the helper at :648 and :676; add per-event
  structured log + result; return 500 on real processing failure (B3).
- backend/tests/stripe_payloads/*.json + backend/tests/test_webhook_formats.py (new).
No other files. No change to signatures, routes, or the API-version pin.

### Part B - risks
- Changing the exception path to 500 enables Stripe retries; a persistent bug would
  retry for ~3 days. Mitigated by dedup + idempotent entitlement. (Approve explicitly.)
- The customer-active-subscription fallback (B2.4) makes an extra Stripe call; guard it
  so it only runs when the id is truly missing, to avoid rate pressure.
- Fixtures are doc-built, so they validate our parsing logic, not Stripe's exact live
  bytes - real-event confirmation still needs one signed delivery (STRIPE-WEBHOOK-FIX-1
  section 6).

===============================================================================
PART C - go-live preparation
Support note: at go live only STRIPE_MODE and STRIPE_SECRET_KEY switch to live;
STRIPE_API_KEY stays on the sandbox key.
===============================================================================

### C1. "Test mode" banner must read STRIPE_MODE, not STRIPE_API_KEY [VERIFIED]
Today `deps.stripe_mode()` (deps.py:23-40) derives mode from the STRIPE_API_KEY PREFIX
(line 30-36). Since STRIPE_API_KEY stays sk_test_ in prod, the banner would wrongly show
"Test mode" live. Plan: compute mode from `STRIPE_MODE` when set
(`os.environ.get("STRIPE_MODE")` -> "live"/"test"), falling back to the key-prefix logic
only when STRIPE_MODE is unset (preview/local). Keep the return shape identical so the
/pricing UI (payments_router.py:75, out = dict(stripe_mode())) needs no change.
File: backend/deps.py (stripe_mode only).

### C2. Audit of STRIPE_* usage [VERIFIED file:line]
- STRIPE_API_KEY
  - deps.py:20 - defined, default "sk_test_emergent".
  - deps.py:30 - read by stripe_mode() for the banner (prefix check). -> fix in C1.
  - identity_router.py:14 import; :19 `stripe.api_key = STRIPE_SECRET_KEY or STRIPE_API_KEY`
    (Identity outgoing key, prefers SECRET); :76 error-message text only.
- STRIPE_SECRET_KEY (the real outgoing key everywhere)
  - billing.py:19 `stripe.api_key = STRIPE_SECRET_KEY or STRIPE_API_KEY` (all billing +
    webhook retrieves).
  - setup_stripe.py:20 same pattern (catalog).
  - identity_router.py:19 same pattern (Identity).
- STRIPE_PUBLISHABLE_KEY - NOT read anywhere in the backend. [VERIFIED: no references.]
  (Checkout uses server-side Checkout Sessions, so no publishable key is needed. Nothing
  to change; note it for completeness.)
- STRIPE_MODE - NOT read by any code today. [VERIFIED.] C1 will start reading it.
- STRIPE_ACCOUNT_ID - NOT read by any code today. [VERIFIED.] Informational only.
- What happens in prod if STRIPE_API_KEY stays on the sandbox key?
  - Could a real call hit the TEST account? NO for billing/catalog/Identity, because all
    three set `stripe.api_key = STRIPE_SECRET_KEY or STRIPE_API_KEY` and STRIPE_SECRET_KEY
    switches to live, so SECRET wins and all outgoing calls use the live key. [VERIFIED.]
  - The only concrete issues: (a) the Test-mode banner shows wrong (fixed by C1); and
    (b) a LATENT risk - if STRIPE_SECRET_KEY were ever empty/unset in prod, every
    `SECRET or API_KEY` would fall back to the sandbox STRIPE_API_KEY and real flows
    would silently hit the TEST account. Recommend a boot assertion in prod: if
    STRIPE_MODE == "live" then STRIPE_SECRET_KEY must start with sk_live_, else log a
    loud error (optional hardening, plan-only).

### C3. Trial settings - env vs DB [VERIFIED]
- Defaults come from env: billing.py:25 `TRIAL_ENABLED` (default "1" = on), :26
  `TRIAL_DAYS` (default 30).
- `trial_settings()` (billing.py:35-39) reads `db.app_settings {key:"billing"}` and uses
  the DB values if present, otherwise the env defaults. So the DATABASE WINS; env is only
  the fallback default.
- How Jenn changes it safely in prod: the admin endpoint POST /api/admin/billing/trial
  (payments_router.py:612-630) writes app_settings and is audit-logged - no redeploy, no
  env edit needed. (A UI toggle already drives this.)
- Default if neither DB nor env is set: enabled, 30 days. [VERIFIED.]
- No code change needed for C3; this is documentation for Jenn.

### C4. STRIPE_IDENTITY_WEBHOOK_SECRET missing in prod [VERIFIED]
- If unset, the identity webhook returns 400 `{"received": false, "reason": "no_secret"}`
  (identity_router.py:106-108) - it never processes async events.
- BUT verification still COMPLETES via the return-to-app poll: GET /api/identity/status
  (identity_router.py:82-99) does a server-side `VerificationSession.retrieve` and
  `_apply_session`, setting identity_verified when the user comes back. So it is SAFE to
  launch without the secret, with verification completing on return-to-app. [VERIFIED.]
- Recommendation: set it post-launch to (a) silence Stripe dashboard delivery errors and
  (b) catch completions when a user does NOT return to the app. Not a launch blocker.
- No code change needed for C4.

### C5. Pre-publish cleanup (the preview DB is copied to prod once) - PLAN ONLY
Goal: enter prod with no sandbox-linked billing state and no demo rows, without touching
real testers' accounts.
- Demo/seed data: the only demo source found is seed_router.py (idempotent, only seeds
  an EMPTY users collection - it does not reset). Demo rows are identifiable by
  `user_id` prefix `seed_` and emails `@sailmorenow.dev`, plus seed_post_* / seed_ev_*.
  Plan a one-off cleanup script (run in PREVIEW before Publish) to delete those seed docs
  across users, boat_pros, community posts, events.
- Find test users carrying SANDBOX Stripe ids: query users where
  `subscription_provider == "stripe"` OR `stripe_customer_id` exists OR
  `stripe_subscription_id` exists (from STRIPE-SNAPSHOT-1: 6 customers / 5 subs). All are
  test accounts (jenn+*, raejen*, doug@topmarktech.com, Scott Test) created against the
  sandbox; their cus_/sub_ ids are sandbox objects invalid for live.
- Safe clearing options (plan - choose one at approval):
  (a) CLEAR IDS, KEEP ACCOUNTS: unset stripe_customer_id, stripe_subscription_id,
      subscription_package_id, subscription_provider, subscription_status,
      subscription_expires, is_promo, trial_used, trial_end and set subscription_tier to
      "free" for exactly those matched users. Preserves the accounts for re-testing live.
  (b) DELETE ONLY TEST ACCOUNTS: delete users whose email matches the known test patterns
      (jenn+*@sailmorenow.com, raejen*@gmail.com, *test*@..., doug@topmarktech.com) AND
      that carry a sandbox id. Requires an explicit allowlist you confirm first.
- Protect real testers: do the match by the fields above + an explicit email allowlist
  you approve; NEVER delete comp-grant users (subscription_provider == "comp", e.g.
  jenn@sailmorenow.com) and never touch rows without a sandbox id. Run as a dry-run first
  (print the matched list for your sign-off), then execute. Zero-residue, preview only.
- Note: whichever we pick, after go-live those test users simply re-subscribe on the live
  account (see STRIPE-SNAPSHOT-1 section 4), so option (a) is the lower-risk default.

### C6. Admin-only "Sync Stripe catalog" button - plan + effort
- Behavior: an admin endpoint that re-runs the idempotent setup_stripe logic against the
  CURRENT live key (stripe.api_key already = STRIPE_SECRET_KEY) to (re)create any missing
  of the 5 products / 17 prices. setup_stripe.ensure_price already uses
  lookup_keys + transfer_lookup_key, so it is safe to re-run. [VERIFIED setup_stripe.py:
  44,53-65,70.]
- Gap to flag: setup_stripe does NOT create the promo coupon/promotion code (confirmed
  in STRIPE-SNAPSHOT-1). The button should either (i) also ensure the coupon + promotion
  code idempotently, or (ii) report "coupon must be created manually" in its summary.
  Recommend (i) as a small addition.
- Files I would change:
  - backend/setup_stripe.py: refactor `main()` into an importable
    `sync_catalog(stripe_key=None) -> dict summary` (counts created/updated/unchanged per
    product+price), keep the CLI `__main__` wrapper. Add optional coupon-ensure.
  - backend/routers/payments_router.py (or admin_router): add
    POST /api/admin/billing/sync-catalog (require_admin) that runs sync_catalog in a
    threadpool (stripe calls are sync) and returns the summary; audit-log it.
  - frontend/src/pages/Admin*.jsx: an admin-only button that calls it and shows the
    summary, with a confirm dialog (writes to Stripe). data-testid="admin-sync-catalog".
- Effort estimate: ~3-5 hours (refactor + endpoint + threadpool + coupon-ensure + admin
  button + smoke test). Low risk because the operation is idempotent.

### Part C - risks
- C1 mode source: if STRIPE_MODE is ever set to "live" while STRIPE_SECRET_KEY is still a
  test key, the banner would say live while calls go to test - mitigate with the optional
  boot assertion in C2.
- C5 cleanup is destructive to data - MUST run dry-run first with your sign-off on the
  matched list, and only in preview before the one-time copy.
- C6 button writes to Stripe - admin-only + confirm dialog; never expose publicly.

===============================================================================
CONSOLIDATED TEST LIST (run after approval; NO testing agent, per Jenn)
===============================================================================
Part B:
1. Unit: `subscription_id_from_invoice` resolves on legacy, endive-parent, and
   endive-lines fixtures; returns None -> fallback path logs warning (mock the Stripe
   list call); unknown invoice shape never raises.
2. Handler: feed each fixture through `_handle_event`; assert entitlement/emails fire for
   invoice.paid and payment_failed in BOTH shapes; subscription.* apply correct tier;
   checkout.session.completed unchanged.
3. Unknown event type -> 200 "ignored"; forced processing error -> 500 (retryable) with a
   masked-email log line; signature failure -> 400.
4. Live proof (after STRIPE-WEBHOOK-FIX-1 secret resync): Stripe "Send test webhook" for
   invoice.paid and customer.subscription.updated -> 200 in dashboard, event id in
   db.stripe_events, correct DB entitlement, one structured log line each.
Part C:
5. /pricing (and admin) banner: with STRIPE_MODE unset -> shows test (key prefix); with
   STRIPE_MODE=live (simulated in preview) -> shows live. Confirm no other behavior
   changes.
6. Trial: toggle via POST /api/admin/billing/trial -> reflected in GET; new checkout uses
   the DB trial_days; with app_settings cleared, env default (30, enabled) applies.
7. Identity without secret: GET /api/identity/status reconciles a verified session (mock
   retrieve) and sets identity_verified; webhook without secret returns 400 and is not
   relied upon.
8. Cleanup dry-run: print matched seed rows and sandbox-id test users; verify comp users
   and non-sandbox users are excluded; then (option a) confirm ids cleared and tiers set
   to free.
9. Sync catalog: on a key missing a price, the button recreates exactly that price
   (idempotent re-run shows all unchanged); coupon ensured or reported.

Verification tools: curl against the external backend URL, python DB reads, screenshots
of the admin/pricing banner and the sync button, and the Stripe dashboard delivery log.

Sources: this repo (payments_router.py, billing.py, deps.py, identity_router.py,
setup_stripe.py, seed_router.py); Stripe changelog basil 2025-03-31 (parent field);
cross-ref STRIPE-ERRORS-1, STRIPE-WEBHOOK-FIX-1, STRIPE-SNAPSHOT-1, STRIPE-EXPIRY-CHECK-1,
PROD-READINESS-1.
