# BILLING-3a Report: signup codes, comp grants, choose-term-before-first-charge

Date: 2026-10-30
Build stamp: BILL2-2026.10 -> BILL3A-2026.10
Mode: Stripe TEST (claimed sandbox), API version pinned to 2024-06-20 app-wide.
No em-dashes. testing_agent NOT used (forbidden). All temp accounts, sessions and
Stripe test objects (customers, clocks, test coupons/promo codes) were deleted;
sandbox + DB verified clean at the end. Test emails policy honored: no real email
was delivered (reminder sends were verified without delivery).

Legend: [BROWSER] real browser. [STRIPE] real Stripe via test clocks. [CODE] code-only.

## IMPORTANT infra fix (root cause of a latent Stripe outage)
`routers/identity_router.py` was overwriting the global `stripe.api_key` with the
PLACEHOLDER `STRIPE_API_KEY` ("sk_test_emergent") at import, which broke every
authenticated Stripe endpoint call. Fixed to use `STRIPE_SECRET_KEY` first (same as
billing.py) and pinned the API version. Also pinned `stripe.api_version=2024-06-20`
in billing.py because the account default (2026 "clover") changed coupon / promotion
-code / discount parameter shapes.

## A. SIGNUP CODE (3 months free, native Stripe promotion code)
- Jenn creates the coupon (100% off, repeating, 3 months) + promotion code in the
  Stripe dashboard. We only LOOK UP active codes (`billing.find_promotion_code`); no
  code database.
- `POST /payments/promo/validate` {code, package_id}: enforces monthly-only, not for
  anyone who used a trial or had a paid plan, current plan free, and checks the Stripe
  code is active/valid. Rate-limited to 8 attempts per user AND per IP per 10 min
  (`promo_attempts`). Returns valid + free_months + first_charge_date + price, or a
  plain reason. [STRIPE]
- `POST /payments/checkout` with `promo_code`: REPLACES the trial (no trial period),
  `payment_method_collection="always"` (card required though invoices are $0), applies
  the promotion code via `discounts=[{promotion_code}]` (never Stripe's checkout code
  box). Re-validated server-side. [STRIPE]
- Entitlement: `apply_subscription_entitlement` records `is_promo`, and
  `subscription_free_until` (exact coupon `discount.end`, fallback start + months).
  Status is `active` with $0 invoices during the free months; tier granted; had_paid
  _plan set so no second promo/trial. [STRIPE]
- Web: a "Have a promo code?" box on the plan screen (monthly only) validates in our
  box and shows the approved wording with the real date:
  "Free for 3 months, then $X per month, renews monthly until cancelled. Cancel
  anytime before {date} to avoid being charged." [BROWSER]
- Plan status for code subscribers: "Free until {date}, first payment ${amount} on
  {date}." [BROWSER]
- First-payment reminder: new `_promo_ending_job` (cron 09:40 PT) emails ~3 days
  before the first real charge; idempotent via `promo_reminder_sent` (cannot send
  twice). The existing trial reminder (`_trial_ending_job`) is unchanged for standard
  trials. Both reminder emails now include the plan lengths and a Your plan link. [CODE]

## B. COMPLIMENTARY ACCESS (comp grants) - NET NEW
Comp grants did NOT exist before (no end-date support). Built fresh:
- `comp_grants` collection {id,user_id,tier,reason,granted_by,granted_by_name,start_at,
  end_at (nullable=open-ended),status,prior_provider,...}. User doc: provider="comp",
  tier set, expires=end_at, comp_grant_id.
- `POST /admin/comps` grant (required reason, optional end date, records who granted);
  `GET /admin/comps?status=` list; `POST /admin/comps/{id}/revoke`. Admin-only
  (`require_admin`), audit-logged (comp_grant / comp_revoke). [STRIPE/CODE]
- Guard: a grant is BLOCKED (409) if the member has a live Stripe subscription
  (admin must cancel it first). [STRIPE] proven.
- Never billed: comp accounts have no Stripe subscription; and
  `apply_subscription_entitlement` SKIPS any comp account so a late Stripe event
  cannot override or charge them. [STRIPE] proven.
- Daily `_comp_expiry_job` (02:05 PT): grants past their end date -> member to free,
  grant marked expired. Open-ended grants untouched. [STRIPE] proven.
- Revoke returns the member to free immediately. [STRIPE] proven.
- Web Admin "Complimentary access" page (/admin/comps, linked from Admin home): grant
  form + filterable list (member, tier, reason, granted by, start, end, status) +
  Revoke with confirm modal. [BROWSER]
- Member Your plan shows "Complimentary plan" with the end date if any; never uses the
  word "lifetime". [CODE]

### Existing tier-without-payment paths found (per Jenn's check)
- The ONLY admin tier-grant path was the ORG partner status tool
  (`/admin/org-status`, community_partner / founding_partner) - 4 org accounts. That is
  a separate, legitimate off-app-paid ORG mechanism with its own Zoho Org_Status
  semantics and Founding-Partner caps; it is NOT a member comp and was intentionally
  left as-is (folding it into the member comp list would be wrong).
- Separately, 25 MEMBER accounts carried a paid tier with NO Stripe subscription
  (provider=None, legacy pre-Stripe / seed). MIGRATED into the comp system
  (reason="Legacy pre-Stripe grant (migrated BILLING-3a)", granted_by=system), tier and
  end date (= existing subscription_expires) preserved EXACTLY so nobody loses access;
  reversible via stored prior_provider. Now one mechanism. 25 migrated, 0 skipped.
  (`.comp` found in mobile Icon.tsx is an unrelated component field.)

## C. CHOOSE A PLAN LENGTH BEFORE THE FIRST CHARGE
- `POST /payments/subscription/choose-term` {package_id}; `POST .../undo-term`.
- Members: 1/3/6/12 months; Boat Pro: 1/6/12 (catalog has no pro 3-month). Default
  stays monthly auto-renew if they do nothing.
- Does the scheduled-change logic fit?
  - STANDARD TRIAL: NOT via the 2-phase schedule (that caused an extra monthly charge).
    Instead we modify the price IN PLACE while the trial runs (proration_behavior=none),
    so the term price is charged ONCE at trial end, no monthly charge. Undo reverts the
    price to monthly.
  - PROMO CODE: does NOT fit the existing `/change` (which anchors at current_period_end
    = month 1). We build a Subscription Schedule: phase 1 = monthly + the coupon, hard-
    bounded to the coupon end (`discount.end`); phase 2 = the chosen term, no discount,
    starting at the coupon end. Charged once at the free-period end.
- Web Your plan during the free period: "Your first payment is on {date}. Choose your
  plan length:" with each term, price and savings, a confirm step stating the date and
  amount, and change/undo before the date. [BROWSER]

### CRITICAL RISK - PROVEN SAFE with test clocks
Promo (100%-off, 3 months) + choose a 6-month term: invoices were [$0, $0, $0] for the
three free months, then EXACTLY ONE charge of $35.65 (sailor 6-month full price, 15%
built-in discount, NO promo discount applied) on the coupon-end date; package became
sailor_premium_6. The coupon never touched the prepaid term because phase 1 is hard-
bounded to `discount.end`. [STRIPE]

## D. TEST CLOCK RESULTS (TEST mode, temp accounts, test cards, real amounts)
| Scenario | Result | Amounts |
|---|---|---|
| Signup code -> 3 free months -> first charge (sailor monthly) | PASS [STRIPE] | $0,$0,$0 then $6.99 |
| Code on Boat Pro Featured monthly (accepted) | PASS [STRIPE] | $0,$0,$0 then $19.99 |
| Code on a 6-month plan (rejected) | PASS [STRIPE] | 400 "valid only on monthly plans" |
| Unknown / expired code (rejected) | PASS [STRIPE] | 400 "not valid or has expired" |
| Used-up code (max redemptions hit) | PASS [STRIPE] | 400 "not valid or used up" |
| Code after a prior trial (rejected) | PASS [STRIPE] | 400 "already used a free trial" |
| Cancel during the free months | PASS [STRIPE] | no charge; dropped to free |
| Standard trial -> monthly default | PASS [STRIPE] | $6.99 once at trial end |
| Promo + 6-month term (CRITICAL) | PASS [STRIPE] | $0,$0,$0 then $35.65 once |
| Trial + 12-month term | PASS [STRIPE] | $67.10 once at trial end, no double charge |
| Undo term choice before the date | PASS [STRIPE] | reverts; $6.99 monthly charged |
| Comp grant w/ end date, expiry, revoke | PASS [STRIPE] | expiry + revoke both drop to free |
| Comp blocked on an active Stripe sub | PASS [STRIPE] | blocked (409) |
Could-not-test: live Stripe webhook DELIVERY (per-environment registration; validated
handler logic against real Stripe objects). The 3-day reminder emails were verified at
the selection/idempotency level (BILLING-2 proved the trial reminder sends once; the
promo reminder mirrors it with its own `promo_reminder_sent` flag).

## E. REVIEW PASS (read-only)
Files/functions checked: billing.py (apply_subscription_entitlement, grant_comp,
revoke_comp, promo_eligible, find_promotion_code, _subscription_is_live_user,
_discount_end, _add_months_ts); routers/payments_router.py (create_checkout + the 409
one-subscription guard, promo_validate / _validate_promo / _promo_rate_ok,
preview_switch, upgrade, change_plan, choose_term, undo_term, cancel, resume,
_handle_event webhook + idempotency, _on_payment_failed); scheduler.py
(_trial_ending_job, _promo_ending_job, _comp_expiry_job, _nightly_job promote_or_lapse);
routers/admin_router.py (comp grant/list/revoke).
- Charge twice? No. One-subscription 409 guard; webhook idempotent via stripe_events;
  trial term-choice modifies in place (no extra monthly); promo term-choice schedule
  charges the term once (proven $35.65 / $67.10 single charges).
- Fail to charge when it should? No. Promo first charge at month 3 and trial first
  charge at trial end both proven.
- Charge a comp account? No. Comps have no Stripe subscription; grant blocked on a live
  sub; apply_subscription_entitlement skips comp accounts (so a trailing
  subscription.deleted cannot bill or wipe them).
- Leave paid access on after cancellation / non-payment? No. Cancel -> period end ->
  free; non-payment -> past_due (access during the 2-week dunning window) -> canceled ->
  free; comp expiry/revoke -> free. All proven.

## F. GO-LIVE NOTES (added to the running go-live list)
1. In LIVE mode create the coupon: Products -> Coupons -> New: 100% off, Duration
   "Multiple months", 3 months; then Promotion codes -> create the customer-facing code
   (set max redemptions / expiry as desired). Coupons and promo codes are per-mode, so
   the TEST ones do NOT carry to live - recreate them in Live.
2. Keep `STRIPE_API_VERSION=2024-06-20` (or set it in live env) so the discount params
   match. If Stripe is upgraded later, re-test promo + term with test clocks first.
3. Confirm `payment_method_collection="always"` satisfies live SCA for $0-first-invoice
   promo subscriptions.
4. (From BILLING-2) wire + verify dunning (Smart Retries ~2 weeks, cancel on exhaust) in
   LIVE; register the live webhook; swap keys; recreate the live price catalog.

## Housekeeping
- Build stamp -> BILL3A-2026.10. No em-dashes. testing_agent not used. Zoho Campaigns
  left OFF. Did not touch email provider setup, scrapers or account deletion. Did not
  build reward codes or the "Give 1 free month" admin action (BILLING-3b).
