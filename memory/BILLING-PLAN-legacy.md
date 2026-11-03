# BILLING-PLAN-1 — Move to Stripe auto-renewing subscriptions (PLAN ONLY)

Status: PLAN ONLY. No code, no Stripe provisioning, no data changes made. Stripe facts below were checked against current Stripe docs (API version 2026-09-30.endive is the latest as of research). Campaigns stays OFF throughout.

Jenn's decisions (fixed): paid at signup, AUTO-RENEW until cancelled, at the end of the committed term (1/3/6/12 months). Upgrades immediate with credit for unused time. Downgrades never charge, apply at term end. Cancel stops renewal, keeps tier until term end. ToS already promises auto-renew + cancel-in-account, plus a 30-day free trial.

---
## 1. Replacing the stacking / queue model

Today (one-time Checkout + queue): the 11 Terms-Checklist "stacking rules" (PRD lines 135-145). Mapping each to the new subscription model:

- RULE 1 (calendar-month term) — KEEP the idea; Stripe owns the dates now. A term = a recurring Price interval (1-month, 3-month, 6-month, 12-month). `current_period_end` is the renewal date.
- RULE 2 (Boat Pro immediate prorated upgrade, keep end date) — KEEP, but via Stripe `Subscription.modify(proration_behavior="always_invoice")`: immediate tier change, Stripe credits unused time and charges only the difference now. (Behavioural note vs today: Stripe by default keeps the same period end; "credit for unused time" is automatic.)
- RULE 3 (max one queued plan), RULE 4 (queued plan keeps its tier), RULE 5 (no refund/credit/proration on stacks), RULE 7 (queued start=current end) — REMOVE. There is no queue; renewal is automatic.
- RULE 6 (sailors/owners single paid tier) — KEEP.
- RULE 8 (lapse to free when nothing queued) — REPLACE with subscription status: `active`/`trialing`/`past_due` = entitled; `canceled`/`unpaid` = free. No lazy `promote_or_lapse`.
- RULE 9 (banned holds queue) — REPLACE: on ban we revoke app access and `pause`/`cancel` the Stripe subscription; on unban, resume.
- RULE 10 (deletion handling of paid queue) — REPLACE: on delete, cancel the subscription (Stripe handles remaining period per settings).
- RULE 11 (test mode during alpha) — KEEP.

Concretely REMOVED: `queued_plans` model, `create_checkout` 409 queue-full block, `stacked_checkout_msg`/`queue_full_msg`/`PLAN_STACK_PRICING_LINE`, `promote_or_lapse` promotion/lapse logic, the one-time prorated-`/payments/upgrade` custom-amount path, the "Buy more time" card (web `MyPlan.jsx`, mobile `my-plan.tsx`) and the pricing-page "Plans stack…" line. "Buy more time" has no meaning once renewal is automatic.
KEPT/REWORDED: tier labels, term options (now as Prices), the upgrade action (reworded "Upgrade now — you're charged the prorated difference and keep your renewal date"). Alpha data is deleted before launch, so NO queued-plan data migration is needed.

## 2. Stripe objects, prices, webhooks (single source of truth)

- **Products:** one per tier that has its own feature set — Boat Pro Basic / Featured / Premium, Sailor Premium, Boat Owner Premium (5). (Community Partner handled in §6b.)
- **Prices (recurring), one per term, each with a stable `lookup_key`:** e.g. `pro_basic_monthly`, `pro_basic_6mo`, `pro_basic_annual`, … mapping today's catalog:
  - Boat Pro 12.99/19.99/29.99 monthly base; terms 1/6/12 (discount 0/10/20%).
  - Sailor & Owner Premium 6.99 monthly base; terms 1/3/6/12 (0/10/15/20%).
  - Encode a term as interval+interval_count with the discount baked into the amount: 1mo = `month`; 3mo = `month`×3; 6mo = `month`×6; 12mo = `year`. Amount = monthly×months×(1−discount), charged once per interval, auto-renewing. Resolve Prices by `lookup_key` at runtime, never hardcode IDs.
- **Customer:** one Stripe Customer per user/account (store `stripe_customer_id` on the user; reuse for every Checkout/Portal). This is the "one business per account" anchor (§6c).
- **Checkout Session** `mode=subscription` for signup; `Subscription.modify` for upgrade; **Subscription Schedule** for downgrade (§ below); `cancel_at_period_end` for cancel.
- **Webhooks = single source of truth.** Verify signatures on the raw body. Handle: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.updated`. On each, fetch the live Subscription and write our entitlement: `{status, tier (from the item price lookup_key), current_period_end, cancel_at_period_end, scheduled_price (if a schedule), provider:"stripe"}`. Idempotent per event id. The app NEVER grants a tier except from a webhook-derived entitlement.
- **Downgrade at term end (no charge):** attach a **Subscription Schedule** — current phase ends at `current_period_end`, next phase starts then at the lower-price `lookup_key` with `proration_behavior:"none"`. Or configure the Customer Portal with `schedule_at_period_end` + condition `decreasing_item_amount`. Show it in-app as a "scheduled change".
- **Upgrade (immediate, credited):** `Subscription.modify(items=[{id, price: <higher lookup_key>}], proration_behavior="always_invoice")`. Preview with the invoice-preview endpoint before confirming so the UI can show the exact charge.
- **Failed renewals / dunning:** enable Smart Retries + set the final action in the Dashboard. Access policy by status: `active`/`trialing` = full; `past_due` = KEEP access during retries + show a "update your card" banner; `canceled`/`unpaid` = revoke to free. If `invoice.payment_action_required`, surface the `hosted_invoice_url` for 3DS.
- **Card updates / self-serve management:** Stripe **Customer Portal** (create a billing-portal session with a `return_url`). Portal handles update card, cancel, view invoices, and (configured) scheduled downgrades. This is where a member updates their card.

## 3. Sandbox vs shared test key; going live

- **Now:** the app uses a shared Stripe TEST key. Recommend provisioning a **dedicated claimable Sandbox** (isolated products/prices/webhooks/settings, own `sk_test_`/`pk_test_`) so our subscription catalog and webhook config don't collide with other test data, and so the account can later be claimed and switched to live without rebuilding. Objects in a sandbox are invisible to live mode and cannot be shared.
- **Test mode behaviour:** `sk_test_`/`pk_test_` keys; use Stripe's test cards (incl. the `4000...0341` renewal-fail card and `...3155` 3DS) for dunning/SCA. (Stripe test clocks still don't apply on the current shared key; a claimed sandbox CAN use test clocks to fast-forward renewals — see §9.)
- **Going live:** set live keys (`sk_live_`/`pk_live_`) in the secrets store, and re-create the Prices, Portal config and webhook endpoint in **live** mode (sandbox objects don't carry over). Keys live in env/secrets, never in code.
- **Confirm:** deploying/publishing NEVER switches to live keys on its own. The key is read from the secrets store at runtime; nothing in the deploy flow flips test→live. Live only happens when someone explicitly sets the live key values.

## 4. Mobile return + IAP coexistence

- Stripe does NOT support universal links for return URLs — must use a **custom app scheme**. Two viable designs:
  - (A, recommended) Native **`@stripe/stripe-react-native` PaymentSheet** with `returnURL: "<scheme>://stripe-redirect"` + `handleURLCallback` in the root deep-link listener; use `Linking.createURL()` so the scheme is stable across Expo Go and builds. Cleanest return + no dead browser tab.
  - (B) Keep hosted Checkout/Portal but set `success_url`/`return_url` to a tiny **backend bridge page (https)** that 302-redirects to `<scheme>://…`, opened via `WebBrowser.openAuthSessionAsync` (which captures the redirect and auto-closes). Reuses the pattern already used for Google auth.
- **Refresh after payment:** on deep-link return, re-fetch `/payments/subscription`; do NOT trust the client — the webhook is the source of truth, so poll briefly until the entitlement reflects the change (today the mobile upgrade does no polling — fix that).
- **What web Stripe needs from IAP-0:** ONE entitlement record per user with a `provider` field (`stripe` | `apple` | `google`) and at most one active paid entitlement; the backend owns it. Web/desktop purchases are Stripe and own the entitlement there; in-app iOS/Android purchases would write the same single record via Apple/Google server notifications. IAP-0 must define precedence when a user somehow has both (recommend: block a second provider while one is active).

## 5. The 30-day trial (ToS) vs "paid at signup"

- These two ToS promises conflict; pick one model (Jenn decides):
  - **Trial-first:** Checkout `mode=subscription` with `subscription_data.trial_period_days=30`. Card handling:
    - **Card at signup** (`payment_method_collection:"always"`): status `trialing` for 30 days, then auto-converts — the first invoice charges the committed term automatically at day 31. Best for conversion; matches "paid at signup" intent minus the first 30 days.
    - **No card** (`payment_method_collection:"if_required"` + `trial_settings.end_behavior.missing_payment_method:"cancel"` or `"pause"`): free for 30 days, then cancels/pauses unless a card is added. Lower friction, lower conversion.
  - **Paid-at-signup, no trial:** charge immediately; drop the trial from ToS or treat the trial as a launch-period promo (§6a).
- **Conflict to flag:** Stripe **promotion codes are NOT supported in Checkout sessions that use trial offers** — so a "30-day trial" and a "90-day tester promo code" cannot both be applied through the trial mechanism in the same Checkout. Use the trial for the public launch and the coupon for testers (mutually exclusive per session).

## 6. Added scope

**(a) Tester promo — 90 days free, tester-only, single-use, expiring.**
- Coupon `percent_off=100`, `duration="repeating"`, `duration_in_months=3` (≈90 days; note 3 calendar months ≠ exactly 90 days — if exact 90 is required, use a 90-day `trial_end` instead of a coupon). Promotion code with `max_redemptions=1` (single use), `expires_at` (expiry), `restrictions.first_time_transaction=true`; "tester-only" = hand the code only to testers (or generate one code per tester). Require a card at signup so conversion is automatic.
- **Day 91:** coupon ends → the next invoice charges the normal committed-term price on the stored card. No card on file → `past_due` → dunning → revoke. So a card at signup is required for a clean auto-convert.

**(b) Community Partner variable-price item.** Model as a Product with a **`custom_unit_amount`** recurring Price (set `minimum`/`maximum`/`preset`) so the amount can vary per partner, or create a bespoke Price per partner deal. Still a normal auto-renewing subscription; entitlement = partner tier. (Org/partner tiers remain NOT self-serve in the public pricing UI.)

**(c) Company-level billing.** Business name + tax ID on receipts = set `Customer.name` and `Customer.tax_ids`, enable invoice/receipt emails and (if needed) Stripe Tax/`automatic_tax`. **One business per account** = one Stripe Customer per account (enforced by storing a single `stripe_customer_id`). **Ownership transfer** = update the Customer's email/owner mapping in our DB and keep the same Customer/subscription (no Stripe migration needed); define an admin action. **Reporting** = Stripe Dashboard + Sigma/exports; optionally mirror key fields to our DB for in-app reporting.

**(d) Zoho receiving subscription events.** On each billing webhook, enqueue a Zoho **CRM** event via the existing `zoho_sync.record_sub_event` (Started, Renewed, Upgraded, Downgrade-scheduled, Cancelled, Lapsed/Unpaid, Trial-started, Trial-converted). CRM only — **Campaigns stays OFF**. Reuse the current outbox so it's durable/idempotent.

## 7. Existing alpha accounts
Grandfathering is acceptable and alpha data is deleted before launch, so there is NO production migration: no `queued_plans` to convert, no legacy subscriptions to re-anchor. Clean cut-over to the new catalog.

## 8. UI — Subscription section (web + mobile) + EXACT wording for Jenn to approve

Reuse existing MyPlan styles. Replace the "Upgrade your tier" + "Buy more time" cards with ONE Subscription card.

Current-plan card:
- Title: `Your plan`
- Line 1: `{Tier} — {term}` e.g. `Boat Pro Featured — 12 months`
- Line 2 (active): `Renews automatically on {date}`
- Line 2 (trialing): `Free trial — your first payment is on {date}`
- Line 2 (cancel scheduled): `Cancels on {date} — you keep {Tier} until then`
- Line 2 (downgrade scheduled): `Changes to {Lower tier} on {date}`
- Line 2 (past_due): `We couldn't take your last payment. Update your card to keep {Tier}.`
- Price line: `{price} every {term}`

Buttons / actions (exact labels):
- `Upgrade` → subtext `Upgrade now — you're charged the prorated difference for the time left and keep your renewal date.`
- `Change plan` (downgrade/term change) → subtext `Lower plans start at your next renewal. You're not charged now.`
- `Cancel plan` → confirm body: `Cancel auto-renewal? You'll keep {Tier} until {date}, then move to the free plan. No further charges.` Confirm button `Cancel auto-renewal`, dismiss `Keep {Tier}`.
- When cancel is scheduled, the Cancel button becomes `Resume auto-renewal` → toast `Auto-renewal is back on. Your plan renews on {date}.`
- When a downgrade is scheduled: banner `Scheduled: changes to {Lower tier} on {date}.` with `Undo change` → toast `Kept on {Tier}.`
- `Update payment method` / `Manage billing` → opens the Stripe Customer Portal.
- Free account: `You're on the free plan.` + `See plans` button.

Toasts / states:
- Upgrade success: `You're now on {Tier}. You were charged {amount} today.`
- Signup success (paid): `Welcome to {Tier}! Your plan renews on {date}.`
- Signup success (trial): `Your 30-day free trial has started. First payment on {date}.`
- Payment failed banner (global): `Your payment didn't go through. Update your card to keep your plan.` + `Update card`.

Copy rules: no em dashes (use hyphens), term "username" not "handle", and remove every "Renews / ends", "Buy more time", and "Plans stack…" string.

Placement: web `frontend/src/pages/MyPlan.jsx` (route `/my-plan`); mobile `app/(tabs)/profile/my-plan.tsx`. Pricing pages lose the stacking note and show plain "auto-renews, cancel anytime".

## 9. Verification list

Test mode (sandbox; use test cards + a test clock to fast-forward renewals):
1. New signup (paid) → `active`, entitlement + renewal date correct, Zoho CRM event, receipt.
2. New signup (trial) → `trialing`, no charge, converts to `active` + charge at day 31 (advance test clock).
3. Upgrade with credit → immediate tier change, invoice shows prorated charge + unused-time credit, renewal date preserved.
4. Each downgrade (every higher→lower tier, and term changes) → zero charge now, schedule shows, applies at `current_period_end` (advance clock), lands on the lower tier.
5. Cancel → `cancel_at_period_end`, tier kept to term end, lapses to free after (advance clock), no charge.
6. Undo cancel / undo scheduled downgrade → back to normal auto-renew.
7. Failed renewal → test card declines at renewal → `past_due` keeps access + banner → Smart Retry → recovers on card update, OR terminal → `canceled`/`unpaid` revokes.
8. 90-day tester promo → 100% off for 3 cycles/months, single-use + expiry enforced, day-91 charge on file.
9. Webhook idempotency + signature verification; entitlement matches Stripe after each event.
10. Mobile deep-link return refreshes entitlement for signup/upgrade/cancel/portal.

Can only be tested with real money at the very end: a genuine live-mode card charge end-to-end, real bank decline/3DS behaviour, real payout, and real tax calculation. Everything else is coverable in sandbox/test.

## 10. Effort, risks, conflicts

**Effort (realistic phases):**
- P1 Catalog + plumbing: create Products/Prices+lookup_keys, Customer creation, store `stripe_customer_id`, entitlement model + `provider` field. (M)
- P2 Signup Checkout (`mode=subscription`) + webhook handlers as source of truth + entitlement reads replacing `promote_or_lapse`. (L)
- P3 Upgrade (always_invoice + preview), Downgrade (subscription schedule), Cancel/Undo (`cancel_at_period_end`). (M)
- P4 Customer Portal (card update/manage) + dunning/past_due access policy + banners. (M)
- P5 Web + mobile Subscription UI with approved copy; remove queue/stacking/"buy more time" code + copy. (M)
- P6 Mobile deep-link return (PaymentSheet or bridge) + post-pay refresh. (M)
- P7 Zoho CRM subscription events. (S)
- P8 Tester promo + Community Partner custom price + company tax/name fields. (M)
- P9 Sandbox verification run (incl. test clock) against the §9 list. (M)

**Risks:** webhook/entitlement drift if a non-webhook path grants tiers; `past_due` grace vs instant revoke policy; proration surprises on upgrade (credit > charge → balance credit, not refund); term-as-interval modelling (6-month = month×6) must be right or renewal dates skew; mobile scheme mismatch between Expo Go and builds; promo/trial mutual exclusivity; one-Customer-per-account enforcement; Campaigns must stay OFF while CRM events flow.

**Conflicts with Jenn's decisions vs Stripe behaviour:**
- "Paid at signup" + "30-day free trial" are mutually exclusive on day 1 — must choose (trial-first with card, or paid-now). (§5)
- "90 days free" via coupon = `duration_in_months=3` ≈ 90 days, not exactly 90; exact-90 needs a `trial_end` timestamp instead. And a promo code can't ride on a trial-offer Checkout. (§6a, §5)
- "Upgrade keeps the same end date" (today's RULE 2) — Stripe's `always_invoice` upgrade keeps the period end by default but the mental model is "credit + charge difference", not "end date frozen with no money math"; fine, just reworded.
- "Cancel keeps tier until term ends" works via `cancel_at_period_end`, but for a 6/12-month term that means access until the far renewal date — confirm that's intended (no early cancellation/refund).

## Files read
- backend: `routers/payments_router.py`, `routers/identity_router.py`, `deps.py` (promote_or_lapse, current_user_from_token), `plan_features.py`, `constants.py` (SUBSCRIPTION_PACKAGES + package_total).
- frontend (web): `pages/MyPlan.jsx`, `pages/PaymentSuccess.jsx`, `pages/VerificationReturn.jsx`, `components/IdentityVerification.jsx`.
- mobile: `app/(tabs)/profile/my-plan.tsx`, `app/pricing.tsx`, `app/payment/success.tsx`, `app/verify/return.tsx`, `app/(tabs)/profile/index.tsx` (identity start).
- memory: `PRD.md` (Terms Checklist = the 11 rules, PLAN-QUEUE-1/PLAN-RULES-0 changelogs), `PLAN-RULES-0_REPORT.md`.
- Stripe docs (current): prorations/always_invoice, subscription schedules + portal schedule_at_period_end, keys/sandboxes/go-live, customer portal, trials (trial_period_days, payment_method_collection, trial_settings.end_behavior), no-cost orders/coupons, promotion code restrictions, smart retries/dunning webhooks, mobile return (custom scheme, no universal links; RN PaymentSheet returnURL/handleURLCallback).

## Could not verify
- No live Stripe charge, real decline/3DS, payout, or real tax was run (plan only).
- Whether the shared/sandbox account currently supports test clocks (needs a claimed sandbox to confirm).
- Exact dunning retry schedule/final action — depends on the Dashboard settings of whichever account is claimed.
- Mobile deep-link return not prototyped on a real device (web preview only here); PaymentSheet vs bridge to be confirmed on an actual build.
- IAP-0 precedence rules (dual-provider) are stated as a requirement, not yet designed.
