# BILLING-PLAN-1 - Stripe test webhook re-point, end-to-end test-mode script, and live go-live runbook
PLAN ONLY. No code, no emails, no secrets changed, no testing agent. Hyphens only.
(An earlier, different BILLING-PLAN-1 draft - "move to Stripe auto-renewing
subscriptions" - was preserved as BILLING-PLAN-legacy.md.)

Verified from code (sources): routers/payments_router.py (checkout, portal,
status, webhook), billing.py (trial settings, entitlement), constants.py
(SUBSCRIPTION_PACKAGES), setup_stripe.py (catalog), deps.py (Stripe key -> mode),
mailer.py (billing + welcome emails, app_public_url).

Key facts up front:
- Webhook route (router is mounted under /api): BOTH `/api/stripe/webhook` and
  `/api/webhook/stripe` are accepted (payments_router.py:692-693). Use
  `/api/stripe/webhook`.
- Webhook handler acts on: checkout.session.completed, customer.subscription.*
  (created/updated/deleted), invoice.paid, invoice.payment_failed
  (_handle_event, payments_router.py:634-650). Signature verified with
  STRIPE_WEBHOOK_SECRET (line 698); events are idempotent via db.stripe_events
  (704-709).
- Customer portal: POST /api/payments/portal, returns a Stripe-hosted URL,
  return_url = {origin}/my-plan (562-574). Requires the Stripe Customer Portal to
  be ACTIVATED in the dashboard (test and live are separate).
- Trial: TRIAL default ON, TRIAL_DAYS default 30 (billing.py:25-26); checkout sets
  `trial_period_days = 30` when the user is trial-eligible and no promo code
  (payments_router.py:198-212). Eligible = tier free, not trial_used, not
  had_paid_plan (billing.py:60-70). A signup/promo code REPLACES the trial.
- Prices (constants.py:83-100): Sailor Premium and Boat Owner Premium = $6.99/mo;
  Boat Pro Basic $12.99, Featured $19.99, Premium $29.99. CHEAPEST plan = $6.99
  (sailor_premium_1 / owner_premium_1) - use this for the real-money live test.
- Stripe mode is driven by WHICH secret key is in STRIPE_API_KEY (deps.py:26-30):
  sk_test_* = test, sk_live_* = live. STRIPE_MODE exists in .env but is not read by
  code (informational only). Email links use APP_PUBLIC_URL (default
  https://app.sailmorenow.com), mailer.py:1225-1229.
- Current preview backend base (TEST): the value of REACT_APP_BACKEND_URL,
  currently https://owsa-events-preview--7evdsk8f.preview.emergentagent.com. This
  changes on every fork/republish - ALWAYS read it fresh from frontend/.env.

================================================================================
## 1) Re-point the Stripe TEST webhook to THIS build

Why: the TEST webhook still points at a previous job's preview URL, so test-mode
subscription/payment events never reach this build and My plan / welcome emails
will not update after a test payment.

Exact TEST endpoint URL for this build:
  https://owsa-events-preview--7evdsk8f.preview.emergentagent.com/api/stripe/webhook
  (= current REACT_APP_BACKEND_URL + /api/stripe/webhook; re-read .env if the
  preview URL has changed.)

Route (backend): POST /api/stripe/webhook (alias POST /api/webhook/stripe) ->
payments_router.stripe_webhook.

Events to subscribe to (exactly these six):
  - checkout.session.completed
  - customer.subscription.created
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.paid
  - invoice.payment_failed

How the signing secret is stored:
  - Backend reads STRIPE_WEBHOOK_SECRET from backend/.env (imported in
    payments_router.py:17; used at line 698). It is an existing key in .env -
    never deleted, only its value updated.
  - It must hold the TEST endpoint's signing secret (whsec_...) for test mode.

How Jenn enters the new secret (secure card - NOT in chat, NOT hand-edited in
.env):
  - The agent opens the secure "secrets" card for the key STRIPE_WEBHOOK_SECRET
    (the key-management pop-up). Jenn pastes the whsec_... value from the Stripe
    test endpoint into that card. We never ask for or accept the value in chat and
    never edit the .env line by hand.
  - Stripe test/live are two different signing secrets. For preview/test we set
    the TEST whsec_. (At go-live the LIVE whsec_ goes into the live slot - see
    section 3.)
  - After the value is saved, restart the backend so it is picked up
    (sudo supervisorctl restart backend).

Steps (who does what):
  1. Jenn (Stripe Dashboard, TEST mode): Developers -> Webhooks -> either edit the
     stale endpoint's URL or Add endpoint with the URL above; select the six
     events; Save. [verify: the endpoint shows "Enabled" and lists the 6 events.]
  2. Jenn (Stripe): click the endpoint -> reveal the Signing secret (whsec_...).
  3. Agent + Jenn (secure card): agent opens the STRIPE_WEBHOOK_SECRET card; Jenn
     pastes the whsec_. Agent restarts backend.
  4. Confirm delivery (Stripe): use "Send test webhook" on the endpoint (e.g.
     checkout.session.completed) and check "Recent deliveries" shows HTTP 200.
     [A bad secret returns HTTP 400 "received: false" -> the whsec_ is wrong,
     re-enter via the card.]
  5. Cross-check in app: after the real test purchase (section 2), db.stripe_events
     has the event ids and My plan reflects the subscription - the true end-to-end
     confirmation.

Rollback: if the new endpoint misbehaves, disable it in Stripe (events stop
flowing; no data harmed). Re-enable after fixing the URL/secret.

================================================================================
## 2) End-to-end TEST-MODE script (phone browser + desktop)

Pre-req: section 1 done (test webhook points here, correct whsec_). Use Stripe
TEST cards. Keep it to ONE throwaway account.

Run the money steps on DESKTOP (Stripe Checkout + portal are easiest there); the
new-account + My plan checks also work on a PHONE browser - do a quick phone pass
of signup and My plan to confirm mobile layout.

Test cards (Stripe test mode):
  - Success: 4242 4242 4242 4242, any future expiry, any CVC, any ZIP.
  - Failure (declined): 4000 0000 0000 0002.
  - (Optional) requires authentication: 4000 0025 0000 3155.

Step A - New free account
  Do: Sign up a fresh throwaway account (a +tag email Jenn controls). Verify the
  email via the link.
  Expect: lands as a FREE member; can browse; can post/comment/react (free-tier).
  Where: nav shows signed-in; My plan shows "Free".

Step B - Start the 30-day trial on Premium
  Do: Pricing / My plan -> choose Premium (Sailor or Owner, $6.99/mo) -> Checkout.
  Expect: Stripe Checkout shows "30 days free, then $6.99/month" and still collects
  a card. Where: Stripe Checkout summary; /api/payments/checkout returned
  trial=true, trial_days=30.

Step C - Pay with a test card
  Do: enter 4242... and complete.
  Expect: redirect back to My plan. Webhook fires checkout.session.completed +
  customer.subscription.created (status "trialing"). Where:
    - Stripe: endpoint Recent deliveries = 200; Customers shows the new customer +
      subscription "trialing"; a $0 trial / upcoming invoice.
    - App My plan: Premium, status "trialing", "free until <~30 days>", a charge
      date, and a "Manage billing" entry.

Step D - Check My plan
  Expect: Premium, trialing, free-until ~30 days out, cancel guidance, and the
  option to pick a longer plan length. Where: /my-plan
  (GET /api/payments/subscription).

Step E - Check admin
  Do: as admin, open admin billing / members.
  Expect: account shows Premium / trialing. Where: admin members; GET
  /api/admin/billing/trial = {trial_enabled:true, trial_days:30}.

Step F - Paid welcome email (to jenn@sailmorenow.com only)
  Note: the welcome email goes to the ACCOUNT email, once (welcome_sent guard,
  payments_router.py:660-670). To keep it to jenn@sailmorenow.com ONLY, run this
  test with the throwaway account's email = jenn@sailmorenow.com (or a +tag that
  delivers to it). Do NOT send to any real customer.
  Expect: one "Welcome to Sail More Now" email naming the tier + renew date. Where:
  jenn@sailmorenow.com inbox; Resend shows one send.

Step G - Customer portal
  Do: My plan -> Manage billing (POST /api/payments/portal).
  Expect: redirect to Stripe portal (card, invoices, cancel); return_url back to
  /my-plan. [If "No billing account yet" -> customer not created, re-check the
  purchase. If Stripe says portal not configured -> activate the Customer Portal
  in Stripe TEST settings.]

Step H - Cancel, then resume
  Do: portal -> cancel at period end; back in app My plan shows "cancels on
  <date>". Then resume.
  Expect: customer.subscription.updated webhooks flip cancel_at_period_end on then
  off; My plan reflects it. Where: My plan cancel_at_period_end; Stripe
  subscription.

Step I - Failed card
  Do: easiest - a SECOND throwaway account, checkout, pay with 4000 0000 0000 0002
  (or swap to the declining card in the portal and trigger the next invoice).
  Expect: invoice.payment_failed webhook -> "payment didn't go through" email +
  My plan "at risk / update your card"; access stays on during Stripe retries.
  Where: Stripe invoice "failed"; app banner; Resend send.

Cleanup: cancel/delete the throwaway subscription(s)/customer(s) in Stripe TEST and
remove the throwaway account(s). Test data only; no live money.

================================================================================
## 3) LIVE go-live runbook (each step: WHO / WHERE / VERIFY / ROLLBACK)

Order matters - do not flip live keys until catalog + webhook + portal are ready.
"Agent" = me in the pod; "Jenn" = Stripe dashboard / secure card / Publish;
"Emergent staff" = platform-only actions.

G1. Freeze a known-good build
  WHO: Jenn. WHERE: Emergent. VERIFY: test-mode flow (section 2) fully passed.
  ROLLBACK: platform Rollback to this checkpoint.

G2. Custom production domain (app.sailmorenow.com) + production backend URL/TLS
  WHO: EMERGENT STAFF (platform). WHY staff-only: custom-domain mapping, TLS and
  the production ingress are platform-managed; agent/Jenn cannot provision them,
  and the LIVE webhook URL + APP_PUBLIC_URL depend on the final prod domain.
  WHERE: Emergent platform. VERIFY: the prod URL serves the app and /api responds.
  ROLLBACK: revert domain mapping (staff).

G3. Production environment values
  WHO: Jenn via secure card (values), applied by Publish. WHERE: secure secrets
  card "live" slot. Keys: STRIPE_API_KEY (sk_live_...), STRIPE_PUBLISHABLE_KEY
  (pk_live_...), STRIPE_WEBHOOK_SECRET (LIVE whsec_, after G6), APP_PUBLIC_URL
  (= prod domain). NOTE: test values update immediately in preview; LIVE values
  reach production on the next Publish. VERIFY: after publish, GET
  /api/payments/mode reflects live. ROLLBACK: blank/replace via the card +
  republish, or platform Rollback.

G4. Publish to production
  WHO: Jenn (Publish button). WHERE: Emergent. VERIFY: prod build live at the prod
  domain. ROLLBACK: platform Rollback.

G5. Run the Stripe catalog in LIVE mode
  WHAT: setup_stripe.py creates 5 products + 17 prices with stable lookup_keys
  (idempotent); uses STRIPE_SECRET_KEY / STRIPE_API_KEY from its environment.
  WHO/WHERE: must run with the LIVE secret key in scope. Pick with Jenn:
  (a) EMERGENT STAFF / agent run it ONCE in the PRODUCTION environment where the
  live key lives; or (b) agent runs a controlled one-off with the live key
  present. Preference: run in production so the live key never sits in preview.
  FLAG: if the agent cannot get a prod shell, this needs Emergent staff (or a
  platform job). VERIFY: Stripe LIVE -> Products shows 5 products + prices;
  re-running makes no duplicates. ROLLBACK: archive the live products in Stripe
  (safe before anyone subscribes).

G6. Live webhook + signing secret
  WHO: Jenn (Stripe LIVE) + secure card. WHERE: Stripe LIVE -> Developers ->
  Webhooks -> Add endpoint = https://<prod-domain>/api/stripe/webhook with the
  SAME six events. Copy the LIVE whsec_ into STRIPE_WEBHOOK_SECRET "live" slot via
  the secure card; reaches prod on publish/restart. VERIFY: "Send test webhook" ->
  200; a real test purchase (G9) writes db.stripe_events and updates My plan.
  ROLLBACK: disable the live endpoint.

G7. Live Customer Portal
  WHO: Jenn (Stripe LIVE -> Settings -> Billing -> Customer portal -> Activate;
  allow cancel + payment-method update + invoice history). VERIFY: Manage billing
  from a live account opens the portal. ROLLBACK: reconfigure anytime.

G8. Retries + payment methods
  WHO: Jenn (Stripe LIVE). WHERE: Settings -> Billing (Smart Retries / retry
  schedule) and Settings -> Payment methods (enable cards; wallets/others only if
  wanted). VERIFY: retry policy enabled; live Checkout shows intended methods.
  ROLLBACK: revert settings (no data impact).

G9. Real-money test on the CHEAPEST plan, then cancel + refund
  WHO: Jenn (real card). WHERE: live app -> Premium $6.99/mo (sailor/owner). NOTE:
  with the 30-day trial ON, a monthly checkout charges $0 today, which does NOT
  exercise a real charge. To truly test a live charge either (i) temporarily set
  the trial to 0 days (admin billing trial) for this one test, buy, verify the
  $6.99 charge, refund, then restore 30; or (ii) start trialing then use the portal
  to pay now / end trial. Recommend (i), single account. VERIFY: Stripe LIVE
  Payments shows a real $6.99 charge; My plan = Premium active; one welcome email
  to jenn@sailmorenow.com. Then CANCEL in the portal and REFUND in Stripe LIVE
  (Payments -> Refund). VERIFY refund: Stripe shows refunded; subscription
  canceled; My plan returns to free at period end. ROLLBACK: the refund fully
  reverses the money; cancel reverses access.

G10. Restore trial + final state
  WHO: Agent/Jenn. Set admin billing trial back to 30 days ON if changed in G9.
  VERIFY: GET /api/admin/billing/trial = {enabled:true, days:30}.

Steps that CANNOT be done without Emergent staff, and why:
  - G2 custom domain + prod backend URL/TLS: platform-managed ingress/DNS/cert;
    neither agent nor Jenn can provision them, and the live webhook URL +
    APP_PUBLIC_URL depend on the result.
  - G5 live catalog run, IF the agent has no prod shell: the live secret must not
    live in preview, so running setup_stripe.py in prod may require staff (or a
    platform one-off job).
  - Promotion of "live-slot" secret values into the running production env happens
    via the platform Publish pipeline (not a manual .env edit).
  All Stripe-dashboard actions (webhook, portal, retries, payment methods, refund)
  are Jenn's - she owns the Stripe account; the agent has no dashboard access.

================================================================================
## 4) Risks and ordering (keep live exposure small) + "no test keys in prod" check

Ordering to minimize exposure:
  1. Fully pass test mode (section 2).
  2. Catalog live (G5) BEFORE any live key is user-reachable, so prices exist.
  3. Live webhook + portal + retries (G6-G8) BEFORE announcing.
  4. Exactly ONE real-money test on the $6.99 plan (G9), then refund immediately.
  5. Only then open signups / announce.

Risks:
  - Wrong/stale webhook secret -> events 400, My plan silent. Mitigation: "Send
    test webhook" + db.stripe_events check.
  - Trial hides a real charge (G9) -> you think live charging works when it was $0.
    Mitigation: the trial-off-for-one-test approach in G9.
  - Duplicate catalog prices if lookup_keys change -> setup_stripe.py is idempotent
    by lookup_key; do NOT rename keys.
  - Double entitlement sources -> handled: webhook is source of truth + /status
    reconcile + idempotent stripe_events.
  - Live welcome/payment email to a real inbox during testing -> restrict test
    accounts to jenn@sailmorenow.com.

Confirm NO test keys remain in production (all read-only):
  - After publish, in PRODUCTION confirm STRIPE_API_KEY / STRIPE_PUBLISHABLE_KEY
    start with sk_live_ / pk_live_ (never sk_test_ / pk_test_), and
    STRIPE_WEBHOOK_SECRET is the LIVE endpoint's whsec_.
  - GET /api/payments/mode in prod reports live.
  - Stripe LIVE dashboard (not Test) shows the products, the prod webhook endpoint,
    and the real $6.99 charge/refund.
  - Spot-check: a live Checkout URL is checkout.stripe.com with no "test mode"
    banner. Confirm via the secure-card list that the live slots are populated.

================================================================================
## 5) Free-tier check (does billing/matrix/trial still work after FREE-TIER-BUILD-1?)

- Billing endpoints: UNAFFECTED. FREE-TIER-BUILD-1 changed only posting/comment/
  react gates (require_participation) and copy; it did not touch
  payments_router.py, billing.py, SUBSCRIPTION_PACKAGES, setup_stripe.py or the
  webhook. Checkout/portal/entitlement unchanged.
- Checkout eligibility: still requires tier == free to start a NEW subscription
  (billing.py:110-122). Free individuals who can now post are still "free" for
  billing, so they remain eligible to start the trial - correct.
- Plan matrix: post_comment_react flipped to free:Y and org feed rows reworded
  (FREE-TIER-BUILD-1); scripts/check_plan_copy.py passes. The matrix still drives
  Pricing / My plan / PlanComparison. No billing fields changed.
- Trial logic: default 30 days, enabled (billing.py:25-26); checkout applies
  trial_period_days=30 for any eligible free user on the chosen MONTHLY package
  (payments_router.py:198-212). All monthly packages are the 1-month entries
  (sailor_premium_1, owner_premium_1, pro_basic_1, pro_featured_1, pro_premium_1),
  and the UI starts checkout on the 1-month package, so the 30-day trial applies to
  EVERY monthly plan. Multi-month terms are chosen later via the term-change path,
  which replaces the trial (by design).
- VERIFY (test mode, read-only): GET /api/payments/mode -> trial_days 30; GET
  /api/payments/packages as a fresh free account -> each monthly package row shows
  trial_eligible:true. Section 2 Step B/C then confirms a trialing subscription
  with a ~30-day free window.

================================================================================
## 6) Questions for Jenn (not assumed)
- Q1 Prod domain: is the live backend served from https://app.sailmorenow.com, or
  will the production URL differ (it sets both the live webhook URL and
  APP_PUBLIC_URL)? If a custom domain, that is the Emergent-staff step G2.
- Q2 Welcome-email recipient for testing: OK to run every test purchase on an
  account whose email is jenn@sailmorenow.com (or a +tag to it) so no real customer
  is emailed?
- Q3 Real-money live test (G9): OK to temporarily set the trial to 0 days for a
  single $6.99 charge so we actually exercise a live payment, then refund and set
  it back to 30? Or prefer the portal "pay now" variant?
- Q4 Who runs the live catalog (G5)? Can you grant the agent a run in the
  production environment, or should this be an Emergent-staff one-off so the live
  key never touches preview?
- Q5 Payment methods (G8): cards only at launch, or also wallets (Apple/Google
  Pay) / others?
- Q6 Timing: keep the 30-day trial ON at launch for all monthly plans (current
  default), or launch with it OFF / a different length?
- Q7 Confirm your Stripe country/account supports the live Customer Portal and that
  the destination currency is USD (prices are in USD today).
