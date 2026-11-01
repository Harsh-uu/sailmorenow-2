# SIGNUP-1 Report: universal 30-day trial, one trial switch, signup clarity

Date: 2026-10-30
Build stamp: BILL3A-2026.10 -> SIGNUP1-2026.10
Mode: Stripe TEST (API version pinned 2024-06-20). No em-dashes. testing_agent NOT
used. Did not touch email provider setup, scrapers or account deletion. No passwords
printed. All temp accounts + Stripe test customers/clocks deleted; the TEST promo code
SMNTEST3FREE is intentionally left active for Jenn.

Legend: [BROWSER] real browser. [STRIPE] real Stripe test clocks. [CODE] code-only.

## A. TRIAL RULE - now every monthly paid plan
`billing.package_trial_allowed` changed to allow ANY monthly package (member monthly +
Boat Pro Basic/Featured/Premium monthly); never multi-month. `user_trial_eligible`
unchanged otherwise (one trial per account, card required, free tier only). A promo
code still replaces the trial (BILLING-3a). Auto-converts to monthly unless cancelled or
a longer term is chosen (BILLING-3a). No UI text claimed "Premium only"; trial wording
is state- or switch-driven. [STRIPE] proven: all 4 monthly plans eligible; multi-month
not; Boat Pro Basic (previously excluded) ran trial -> $12.99 first charge.

## B. ONE SWITCH (TRIAL_ENABLED)
Single source of truth: `db.app_settings {key:"billing"}.trial_enabled` (default from env
`TRIAL_ENABLED`), read via `billing.trial_settings()`. Toggled by the admin endpoint
`POST /payments/admin/trial` (admin_set_trial). Exposed publicly via `GET /payments/mode`
-> `{trial_enabled, trial_days}`.
Every place that reads it:
- SERVER: `billing.user_trial_eligible` (gates the checkout trial); `/payments/checkout`
  (applies the trial through user_trial_eligible); `/payments/packages`
  (`trial_eligible` per package); `/payments/mode` (publishes the flag + days).
- WEB (reads /payments/mode.trial_enabled): Pricing.jsx "30 days free" badges on every
  monthly card (sailor + the 3 Boat Pro tiers); the trial note + card-explanation block
  in the checkout summary. The pre-checkout disclosure uses the checkout response
  `data.trial` (server-driven). MyPlan.jsx trial status + plan-length chooser are
  STATE-driven (status == trialing), so existing trials still show and still get the
  reminder even if the switch is later turned off.
- MOBILE (reads /payments/mode.trial_enabled): pricing.tsx "30 days free" badge;
  my-plan.tsx trial status is state-driven.
- SCHEDULER/EMAILS: `_trial_ending_job` + the trial email fire for ACTUAL trialing users
  (state-driven), honoring "people already in a trial keep it" when the switch is off.
[STRIPE] proven: switch off -> trial_settings.enabled False, /payments/mode false,
user_trial_eligible false for all; switch on -> all true again.
When off: no "30 days free" wording renders on web or mobile (badges + trial note are
gated by mode.trial_enabled); plans show normal pricing.

## C. CLARITY (done + gaps)
DONE:
- "30 days free" on every monthly plan card from the first plan screen (web + mobile),
  switch-gated. [BROWSER] web desktop-light and phone-dark both show all badges.
- Card-explanation line in the pre-checkout summary (our page has no card field; the
  real card entry is on Stripe's hosted page): "We ask for a card so your plan continues
  if you don't cancel. You won't be charged today. We'll email you 3 days before, and you
  can cancel anytime." (switch-gated). [BROWSER/CODE]
- Selected plan unmistakable on Pricing: thick orange ring (ring-4) + check + "SELECTED"
  label, light and dark, laptop and phone. [BROWSER] desktop-light + phone-dark verified;
  tablet uses the same responsive md: grid [CODE]. Your plan / current-plan highlight
  uses the existing current-plan treatment [CODE].
- Longer terms are chosen before first payment (BILLING-3a), not on signup. [existing]
GAPS (NOT done this pass, honest):
- The "Have a promo code?" box on the SIGNED-OUT signup plan step is NOT added. It works
  for signed-in users on Pricing and Your plan (BILLING-3a). Adding it pre-auth needs the
  code carried through registration into the post-signup checkout. Recommended follow-up.
- Mobile selected-plan highlight on the current plan (read-only) not restyled this pass.

## D. BOAT PRO COMPARISON COPY (partial)
DONE (web Pricing, Boat Pro): a "One login, two sides" row (personal + business, switch
any time), a "Performance stats, every tier (views and contacts)" line, and a "What
Premium adds" block in plain benefit wording from existing features only: "Show up first
in your category", "Show your work: 5 photos", "List in unlimited markets" (no
newsletter/quotes/lead alerts). [BROWSER] block renders desktop + phone.
NOT done (honest): the small Basic/Featured/Premium listing-card PREVIEW thumbnails; and
the existing BOAT_PRO_TIERS Premium feature list still shows "Annual bio in the
newsletter" (separate from the new block). Web/mobile feature-wording reconciliation was
not completed. These are the main SIGNUP-1 follow-ups.

## E. PROMO CODE MANAGEMENT
- Created a persistent TEST promotion code: code `SMNTEST3FREE`, coupon 100% off,
  repeating 3 months, max_redemptions 50, active in TEST. Proven: a freshly created code
  validates through our live `/payments/promo/validate` with NO code change. [STRIPE]
- Jenn's steps to create a new code (TEST and LIVE are separate):
  1. Stripe Dashboard -> Product catalog -> Coupons -> New coupon: Percentage discount
     100%, Duration "Multiple months" = 3. Save.
  2. On that coupon -> Promotion codes -> Create promotion code: type the customer-facing
     code (e.g. SAILFREE3). Optional: set an expiry (Expires on) and/or a redemption
     limit (Limit the number of times this code can be redeemed). Save.
  3. Hand the code to the member. Our box validates it (monthly-only, one per account);
     no deploy needed. Optional expiry/limit are enforced by Stripe automatically.
- Optional expiry + redemption limit proven at the API level (max_redemptions set; used-up
  and expired both rejected with plain reasons in BILLING-3a tests).

## F. REPORT ONLY (nothing changed)
### F1. What a deleted account leaves behind, and returning alpha testers
Full account deletion (ACCOUNT-DELETE-1 STAGE B) is NOT implemented yet - only the STAGE A
plan exists. Today a "deleted" member is a SOFT state (`users.member_status="deleted"`,
record retained; Zoho App_Account_Status set to Deleted). The STAGE A plan tombstones the
`users` row (clear PII INCLUDING email, name -> "Former member", keep opaque user_id +
member_status="deleted"), deletes sessions/content/photos, and KEEPS payment_transactions,
review_disputes, reports, ip_bans and audit_logs by user_id.
- There is NO email-keyed blocklist and NO trial-used-by-email tombstone. `trial_used` /
  `had_paid_plan` live ONLY on the user row.
- So under the STAGE A design (email cleared on the tombstone, email released), a returning
  alpha tester who signs up fresh gets a NEW user_id with trial_used=false -> eligible for
  a new trial AND promo code. They are NOT blocked.
- The old Stripe customer is referenced only by `users.stripe_customer_id`; a fresh signup
  makes a new customer, so Stripe does not block the new trial either (trials are enforced
  by our `trial_used`, not Stripe).
- RISK/decision for STAGE B: if you instead KEEP the email on the tombstone (to prevent
  re-registration) or add an email/Stripe-customer-keyed "already trialed" record, that
  WOULD block returning testers from another free trial/promo. Decide this policy
  explicitly in STAGE B. Recommendation: for alpha, release the email (fresh trial allowed)
  OR add an allowlist to re-enable trials for specific testers.

### F2. Boat Pro personal identity and Sailor/Owner Premium
A Boat Pro has ONE login with a personal identity and a business listing, switchable
(`resolve_active_identity`, `can_use_business`, `account_identity_payload`). The personal
identity's `author_account_type` is still "boat_pro" (deps.get author block line 524); it
is NOT a separate Sailor/Owner account.
- Does the personal side get Sailor/Owner Premium features today? NO. Entitlement is keyed
  on `account_type` + tier; Sailor/Owner Premium gates require account_type in
  ("sailor","boat_owner"). A boat_pro account never matches those, so the personal identity
  does not receive Sailor/Owner Premium perks - it is treated as a Boat Pro person.
- Can the personal side be set as sailor or owner? NO. account_type is fixed to boat_pro
  and there is no field to tag the personal identity as sailor/owner.
- What it would take (matches the future REVIEWS-3b work): either (a) in plan_features,
  grant a Boat Pro's PERSONAL identity the Sailor/Owner Premium feature set explicitly, or
  (b) add a personal-identity sub-type field (sailor|owner) and gate personal-side features
  on it. (a) is simpler if "Boat Pro personal == Premium member" is the intended rule.

## G. TESTING (Stripe test clocks, temp accounts, test cards)
[STRIPE] PASS: trial eligibility on all 4 monthly plans; no trial on multi-month; toggle
off then on (eligibility + /payments/mode flip); Boat Pro Basic trial -> $12.99 first
charge; promo code freshly created in dashboard validates with no code change.
[BROWSER] PASS: "30 days free" on all monthly cards and the selected-plan highlight
(ring + check + SELECTED) at laptop width (light) and phone width (dark); the Boat Pro
comparison copy block renders. [CODE]: tablet width (same responsive grid), card-
explanation line, mobile badge (tsc clean, Metro bundles).
Promo code at signup: validated for signed-in users [STRIPE]; the pre-auth signup promo
box is a documented gap (C).
Test emails: none delivered; reminder idempotency proven in BILLING-2/3a.

## GO-LIVE (added to the running list)
- Recreate the coupon + promotion code in LIVE mode (coupons/promo codes are per-mode;
  TEST ones do NOT carry over). Steps = section E with the Dashboard in Live.
- Decide the deleted-account trial/promo policy (F1) before shipping account deletion.

## Housekeeping
Build stamp -> SIGNUP1-2026.10. Temp data + Stripe test objects deleted; SMNTEST3FREE left
active in TEST. Zoho Campaigns OFF. Follow-ups: pre-auth signup promo box; Boat Pro listing-
card preview thumbnails + web/mobile feature-wording reconciliation; remove newsletter line
from the Premium tier list if desired.
