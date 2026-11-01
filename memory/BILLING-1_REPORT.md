# BILLING-1 Report: Stripe auto-renewing subscriptions (TEST mode)

Date: 2026-10-30
Status: Code complete across backend + web + mobile. TEST mode only. Live-mode and
Stripe-sandbox (test clock) items are pending and listed below. No em-dashes used.

## 1. What changed
Replaced the legacy one-time "stacking / queued plan" model with Stripe recurring
subscriptions. Webhooks are the single source of truth for tier and expiry.

- `backend/billing.py`: `apply_subscription_entitlement()` is the ONLY place a Stripe
  tier is granted. Writes `subscription_tier`, `subscription_status`,
  `subscription_expires`, `subscription_cancel_at_period_end`, `subscription_package_id`,
  `stripe_customer_id`, `stripe_subscription_id`, `trial_used`, `trial_end`, `had_paid_plan`.
- `backend/routers/payments_router.py`: checkout, upgrade, change, cancel, resume,
  undo-change, portal, status poll, admin trial toggle, and the webhook.
- `backend/scheduler.py`: `_trial_ending_job` (trial reminder, see section 6).
- Web `frontend/src/pages/MyPlan.jsx` + `Pricing.jsx`: new subscription UI.
- Mobile `mobile/app/(tabs)/profile/my-plan.tsx`: read-only plan screen (this session).

## 2. Exact plan-change wording and behavior

### 2a. Entitlement is status-driven
`entitled = status in ("active", "trialing", "past_due")`. On `canceled` / `unpaid` /
`incomplete_expired` the user is reset to `tier = free`, `expires = null`.

### 2b. New purchase (`POST /payments/checkout`)
Creates a `mode="subscription"` Checkout Session with `payment_method_collection="always"`.
If the user is trial-eligible, `trial_period_days` is attached. Web disclosure shown in a
confirm dialog before redirect:
  "Free for {N} days, then {price} per month, renews monthly until cancelled. Cancel anytime
   before your first charge to avoid being charged. By continuing you agree to the Terms."

### 2c. Upgrade that ALSO changes term length (`POST /payments/subscription/upgrade`)
Boat Pro only. `stripe.Subscription.modify(... proration_behavior="always_invoice")`:
- Takes effect IMMEDIATELY.
- Stripe credits unused time on the old price and charges the prorated difference for the
  new price NOW (an invoice is created and charged immediately).
- Because the price item is swapped wholesale, a term change (e.g. Featured monthly ->
  Premium annual) re-anchors the billing cycle to the new price's interval; the next renewal
  date follows the new term.
- Any pending scheduled change is cleared (`$unset subscription_scheduled`).
- Web status line afterward: "Renews automatically on {new date}".

### 2d. Term downgrade, e.g. 12 months -> 1 month (`POST /payments/subscription/change`)
Uses a Stripe Subscription Schedule with two phases and `proration_behavior="none"`,
`end_behavior="release"`:
- Phase 1: current price until `current_period_end`. Phase 2: the new (cheaper / shorter)
  price begins at `current_period_end`.
- NO charge now. The customer keeps what they paid for until the end of the paid term.
- Stored as `subscription_scheduled = {tier, label, package_id, at}`.
- Web status line: "Changes to {label} on {date}" plus a scheduled banner with an
  "Undo change" action (`POST /payments/subscription/undo-change` releases the schedule).

### 2e. KNOWN WIRING GAP (must resolve before go-live)
`/payments/subscription/upgrade` and `/payments/subscription/change` are implemented and
reasoned through, but NO UI currently calls them. Both web `Pricing.jsx` and mobile
`pricing.tsx` route every purchase (including the "Upgrade" / "Change plan" links on the
web My Plan screen) through `/payments/checkout`, which opens a NEW Checkout Session rather
than modifying the existing subscription. This needs to be wired and verified against Stripe
so an existing subscriber who switches plans is modified/prorated instead of being given a
second parallel subscription. Flagged, not fixed (out of scope for the mobile finish).

## 3. Failed-payment path
- Stripe emits `invoice.payment_failed`. `_on_payment_failed()` re-reads the subscription and
  re-applies entitlement (status becomes `past_due`, which still counts as entitled, so the
  user keeps access during Stripe's retry/dunning window).
- A "Your Sail More Now payment didn't go through" email is sent with the
  `hosted_invoice_url` so the customer can pay/update their card.
- Web My Plan status line on `past_due`: "We couldn't take your last payment. Update your
  card to keep {tier}." with a "Update payment method" button to the Stripe portal.
- Mobile My Plan status line on `past_due`: "We couldn't take your last payment. Update your
  card on the website to keep {tier}." (read-only, no button, per product decision).
- If Stripe exhausts retries the subscription goes `unpaid`/`canceled`; entitlement resets to
  free via `apply_subscription_entitlement`.

## 4. Mobile My Plan screen (this session, CODE-VERIFIED ONLY)
`mobile/app/(tabs)/profile/my-plan.tsx` rewritten to the new model:
- Removed all legacy stacking / queued-plan / in-app upgrade / "buy more time" UI so stale
  subscription data can no longer crash the screen. Removed `expo-web-browser` and the
  upgrade-checkout call.
- Reads the new `/payments/subscription` payload (is_free, tier, status, interval_months,
  price, renews_at, cancel_at_period_end, scheduled_change).
- Read-only: shows current plan, status line (mirrors web wording for active / trialing /
  cancel_at_period_end / scheduled_change / past_due), renewal-or-trial date, price line, and
  the matrix-driven "What's included". No purchase, cancel or portal buttons.
- Added a "Manage on the website" note card directing users to manage plans on web.
- Free members: removed the in-app pricing CTA; added a note to subscribe on the website.
  Org free path unchanged.

Verification done this session:
- `tsc --noEmit`: clean for this file except two PRE-EXISTING typed-route warnings for
  `router.push("/contact")` (no `/contact` route exists in mobile; unchanged from the
  original file, not introduced here).
- Metro bundled with no errors after `supervisorctl restart mobile`.
- Headless screenshot correctly gated to the login screen (no session in automation), so the
  authenticated plan states were NOT rendered live. Mobile is CODE-VERIFIED ONLY, as agreed.

## 5. Test matrix: real browser vs code-only vs pending-on-sandbox
REAL BROWSER (prior session, web):
- New checkout redirect + trial disclosure dialog.
- My Plan active / free rendering; Pricing page and Stripe test-mode banner.

CODE-ONLY (this session):
- Mobile My Plan screen (tsc + Metro bundle; see section 4).

PENDING, requires Jenn claiming the Stripe sandbox + TEST CLOCKS to simulate time:
- Trial end -> first real charge transition and the 3-day reminder firing (section 6).
- Renewal (`invoice.paid`) advancing `subscription_expires` over a full period.
- `invoice.payment_failed` -> past_due -> dunning -> canceled, with the failed-payment email
  and the hosted invoice URL.
- `cancel_at_period_end` reaching period end and dropping the user to free.
- Scheduled term change (2d) actually flipping at period end.
- The upgrade proration invoice amount (2c) once the endpoints are wired (2e).

## 6. Trial-ending reminder (scheduled + cannot send twice)
- CONFIRMED scheduled: `scheduler.py` registers `_trial_ending_job` with
  `CronTrigger(hour=9, minute=30, timezone=America/Los_Angeles)`, id `trial_ending_reminders`,
  `replace_existing=True`.
- Targets users with `subscription_status="trialing"` whose `trial_end` is 2 to 4 days out
  (a window that guarantees the ~3-day-before reminder is caught by a daily run).
- CANNOT send twice: the query filters `trial_reminder_sent != true`, and the job sets
  `trial_reminder_sent=true` immediately after a successful send. Idempotent per user.
- Email subject: "Your Sail More Now free trial ends in 3 days". Live firing is pending on
  test clocks (section 5).

## 7. Go-live checklist (TEST -> LIVE)
1. Jenn claims the Stripe account/sandbox; confirm her country is supported.
2. Run the pending test-clock scenarios in section 5 in the Stripe sandbox and confirm each
   webhook writes the expected entitlement.
3. WIRE the upgrade/change endpoints (section 2e) and verify an existing subscriber who
   switches plans is modified/prorated, not double-subscribed. Remove the legacy
   `will_queue`/`queue_message` remnants from mobile `pricing.tsx`.
4. Create LIVE products/prices (re-run `setup_stripe.py` against the live key) and confirm
   every `lookup_key` matches `SUBSCRIPTION_PACKAGES`.
5. Swap `STRIPE_API_KEY` to the live key and set the LIVE `STRIPE_WEBHOOK_SECRET`; register
   the live webhook endpoint (`/api/stripe/webhook`) for: customer.subscription.*,
   checkout.session.completed, invoice.paid, invoice.payment_failed.
6. Confirm `payment_method_collection="always"` and trial disclosure copy meet Stripe's
   trial/SCA requirements for live cards.
7. Remove the test-mode banner gating (driven by `/payments/mode`) once live.
8. Verify welcome, trial-ending, and payment-failed emails send via the live Resend account
   (proxy fallback intact) with the navy header and no em-dashes.
9. Confirm Zoho Campaigns remains OFF; only the Zoho CRM `plan_purchase` enqueue runs.

## 8. Constraints honored
- testing_agent NOT used (forbidden). Manual/code verification only.
- No em-dashes anywhere in code or copy touched.
- No seed data altered; no temp data created this session.
- Zoho Campaigns left OFF.
