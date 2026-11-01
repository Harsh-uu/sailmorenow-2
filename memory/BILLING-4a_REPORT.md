# BILLING-4a Report: admin trial toggle, Premium wording, signup trial+promo, card-only checkout

Date: 2026-10-30. Build stamp: SIGNUP1-2026.10 -> BILLING4A-2026.10 (mobile BUILD_ID rv3a-8 -> rv3a-9).
Mode: Stripe TEST (API 2024-06-20). No em-dashes in new copy. testing_agent NOT used. Did not
touch email provider setup, scrapers or account deletion. Zoho Campaigns left OFF. No passwords
printed. All temp accounts + Stripe test objects deleted (0 left).
Legend: [BROWSER] real browser. [STRIPE-CHECKOUT] real hosted Checkout + test card + real webhook.
[API] admin API via curl. [CODE] code-only.

## 1. ADMIN TRIAL TOGGLE
- Backend endpoints already existed; added audit logging to `POST /admin/billing/trial`
  (payments_router.py): records who/when + old and new value via `audit.log_admin_action`
  (entity_type "billing_trial"). Admin-only (`require_admin`, server enforced). Reads/writes the
  single source of truth `app_settings {key:"billing"}`; published via `GET /payments/mode`.
- New web page `/admin/billing` (AdminBilling.jsx), linked from Admin home ("Trials & billing").
  Shows current state (ON/OFF + days), on/off toggle, trial-length input. testIDs:
  admin-trial-toggle, admin-trial-days, admin-trial-save-days, admin-trial-state.
- [API] toggle off -> /payments/mode trial_enabled=false; on -> true; audit rows written with
  old->new. [BROWSER] page shows ON (teal) / OFF (grey) with "Trial settings saved"; when OFF the
  Pricing page renders ZERO trial badges and NO trial note (0 badges, note absent verified in DOM);
  restored to ON. People already trialing keep it (reminder + status are state-driven, unchanged).

## 2. PREMIUM WORDING
- Removed "Annual bio in the newsletter" from the Boat Pro Premium feature set at the SOURCE: the
  backend plan matrix `plan_features.py` (`newsletter_feature` row deleted). Because web + mobile
  pricing/upgrade/comparison all read `GET /api/plans/matrix`, the line is gone everywhere at once.
- Also removed the hardcoded mentions: Landing.jsx, Login.jsx (PRO_PLANS note), content_router.py
  FAQ answer, mobile register.tsx and mobile index.tsx. (The Founding Partner org "annual newsletter
  bio" is a SEPARATE, real manual org benefit and was intentionally left.)
- Added to the web "What Premium adds" block (Pricing.jsx): "Enhanced listing card" and "Trust and
  credentials" (exact matrix labels; no unbuilt features, no "Featured in the app").
- [BROWSER] Pricing/Boat Pro: "What Premium adds" now lists 5 items incl. the two additions; the
  Premium card feature list no longer shows any newsletter line. [API] matrix contains no Boat Pro
  newsletter label. Wording is identical web vs mobile (both matrix-driven).

## 3. SIGNUP: TRIAL WORDING + PROMO BOX
- Signed-out Pricing plan step: the "Have a promo code?" box now shows for signed-out visitors too
  (capture-only, helper "We'll apply this when you create your account. Monthly plans only.") since
  the validate endpoint is auth-gated. The code is carried to /register via the URL. The "30 days
  free" badge and the card-explanation note already showed signed-out (toggle-gated).
- Register (Login.jsx): reads the promo from the URL, and when a monthly paid plan is chosen shows a
  trial badge ("{days} days free", toggle-gated), the card-explanation text, and a promo input
  (testIDs reg-trial-badge, reg-card-explanation, reg-promo-input). On submit the code is passed as
  `promo_code` to `/payments/checkout`, which VALIDATES it server-side with the SAME rules
  (monthly-only, no prior trial/paid plan, rate-limited) and surfaces a plain reason on failure.
- Decision (honest): a promo CANNOT be validated before an account exists (endpoint is auth-gated
  and the rules depend on the user's trial/paid history), so it is captured pre-account and
  validated/applied at checkout right after sign-up, exactly as Jenn allowed.
- [BROWSER][STRIPE-CHECKOUT] New Boat Pro account, promo SMNTEST3FREE carried from the plan step:
  register -> card-only Stripe Checkout showing "100% off for 3 months, $0.00 due today" -> Subscribe
  -> returned "You're all set! Your subscription is active" -> the Boat Pro listing EDITOR opened
  (no "choose a plan" gate). DB after: tier=featured, status=active, is_promo=true, listing created.
- [BROWSER][STRIPE-CHECKOUT] New Sailor account, standard trial (no promo): Stripe showed "Try Sailor
  Premium / 30 days free / Then $6.99 per month starting {date}" -> Start trial -> "You're all set".
  DB after: tier=premium, status=trialing. (Sailor has no listing, correct.)

## 4. CHECKOUT PAYMENT METHODS
- Set `payment_method_types=["card"]` on the subscription Checkout Session (create_checkout).
  Verified via API the live session reports `payment_method_types: ['card']`.
- [BROWSER] On the hosted page: Apple Pay and Link appear (card rail); Klarna and Cash App Pay are
  GONE. A "Bank" option still appears as a Link funding source (Link is enabled on the account, which
  is in Jenn's allowed live set: cards, Apple Pay, Google Pay, Link). This Bank entry is NOT a
  standalone `us_bank_account` method (the session is card-only) and is controlled by Link settings
  in the dashboard, not by the session. If Jenn wants NO bank at all, disable bank funding within
  the Link settings in the Stripe dashboard; code cannot remove it while Link is enabled.
- Google Pay did not render in this Chromium run (no Google account / device), but it rides the same
  card rail as Apple Pay and will show for eligible users; nothing in our config blocks it.

## TESTING SUMMARY (browser vs stripe vs code)
- [BROWSER] admin toggle on/off + Pricing hides all trial wording when off; Premium wording (web);
  signup trial badge/card-explanation/promo box (signed-out Pricing + Register); card-only Stripe page.
- [STRIPE-CHECKOUT] (real hosted Checkout + 4242 + real webhook) new-account promo -> active + listing;
  new-account trial -> trialing. Both returned "You're all set".
- [API] trial toggle flip + audit old/new; session payment_method_types=['card']; matrix newsletter-free.
- [CODE] mobile copy edits (register.tsx, index.tsx) - mobile is copy-only this task; matrix drives
  mobile feature lists so the newsletter removal applies there automatically.
- Widths/themes: captured at laptop width light/dark. Tablet/phone use the same responsive
  classes [CODE]; not separately screenshotted this pass.
- Cleanup: temp accounts smn4a/b/c/d and their Stripe customers+subscriptions purged; 0 left.

## Housekeeping / follow-ups
- Build stamp -> BILLING4A-2026.10 (mobile rv3a-9). No em-dashes added. Zoho Campaigns OFF.
- Optional: if Jenn wants the "Bank"/Link funding hidden, adjust Link settings in the Stripe
  dashboard (not a code change).
- Premium "Featured in the app" copy intentionally deferred to LANDING-PREMIUM-1.
