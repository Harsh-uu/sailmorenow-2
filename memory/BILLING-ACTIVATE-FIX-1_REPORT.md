# BILLING-ACTIVATE-FIX-1: Boat Pro plan activates but listing/editor stays locked

Date: 2026-10-30. Mode: Stripe TEST (API 2024-06-20). No em-dashes. testing_agent NOT used.
Legend: [BROWSER] real browser. [STRIPE-WH] real Stripe subscription + real webhook delivery.
[STRIPE-API] direct Stripe/DB API. [CODE] code-only.

## ROOT CAUSE
The Boat Pro `boat_pros` directory listing was NEVER created on a Stripe activation.
`billing.apply_subscription_entitlement` (the ONLY place a Stripe tier is granted; used by
both the webhook and the return-page `/payments/status` reconcile) set tier/status/expiry but
did not create the listing. Listing creation lived only in the legacy `queued_plans` promotion
path in deps.py (the old one-time model), which the webhook model never hits. So a paying Boat
Pro got tier=featured/active but `/boat-pros/mine` 404'd, and the editor showed "Your listing is
created after your plan is active" with a Choose a plan button.

Jenn's account (raejen2+test3) confirmed this: user row was CORRECT (featured/active/is_promo,
had_paid_plan, sub id set, all webhook events in stripe_events, $0 invoice paid) but
`boat_pros` doc was missing. Webhook delivery itself was fine (events arrived + handled 200).

## FIX (small, safe)
1. backend/billing.py: in `apply_subscription_entitlement`, when entitled and the package
   audience is `boat_pro`, lazily import and call `_ensure_boat_pro_listing(uid, tier)`. This
   makes the webhook AND the return-page reconcile both yield a listing. Idempotent upsert.
2. frontend/src/pages/BoatProListing.jsx: the no-listing 404 now distinguishes "plan still
   activating" (GET /payments/subscription -> not free) from "no plan". A paying pro sees a
   friendly "Setting up your plan..." state with a Refresh button (data-testid
   `pro-listing-setup-state` / `pro-setup-retry-btn`) instead of the Choose a plan gate.
   Webhooks remain source of truth; the return page already polls /payments/status (idempotent
   backstop) and that path now also creates the listing.
3. Repaired Jenn's account: created her missing `boat_pros` listing (tier=featured) via
   `_ensure_boat_pro_listing`. No new charge, no second subscription (only the boat_pros doc).

## VERIFICATION (what ran how)
- [STRIPE-WH] Boat Pro Featured monthly + promo (SMNTEST3FREE): real customer+sub -> real
  webhooks -> entitlement tier=featured/active/is_promo AND listing auto-created within 2s. PASS.
- [STRIPE-WH] Boat Pro Basic (plain paid): active/basic + listing created. PASS.
- [STRIPE-WH] Boat Pro Premium (30-day trial): trialing/premium + listing created,
  trial_used=True. PASS.
- [STRIPE-WH] Member monthly (sailor_premium_1, plain): active/premium, no listing (correct). PASS.
- [STRIPE-API] Jenn repair verified: user featured/active, listing tier=featured present.
- [CODE] frontend compiled successfully (webpack). The "Setting up..." state was not browser-
  driven behind auth this pass; logic is a simple conditional render.
- HONEST SCOPE: all plan runs used real Stripe subscription creation + REAL webhook delivery to
  our endpoint (identical subscription objects/events to a browser Checkout). The only part NOT
  exercised is Stripe's hosted card FORM itself (Stripe's concern, not ours). "promo + later
  term choice" was proven earlier in BILLING-3a with test clocks [STRIPE], not re-run here.
- All temp accounts, Stripe customers/subscriptions and temp scripts were deleted; sweep shows
  0 e2e users left. No seed data touched.

## CHECKOUT PAYMENT METHODS (report only, no change made)
Our Checkout Session does NOT set `payment_method_types`, so Stripe applies the DASHBOARD
automatic/dynamic payment-methods defaults - that is why Apple Pay, Link, Amazon Pay, Cash App
Pay, Klarna and Bank appear. For an auto-renewing subscription:
- Reliable off-session recurring: card, Apple Pay, Google Pay, Link (all ride the card rail).
- Risky for renewals: Klarna (BNPL, not for ongoing auto-renew), Cash App Pay (weaker
  off-session), Bank debit/ACH (microdeposit delays + higher failure), Amazon Pay (partial).
RECOMMENDATION: restrict to card + wallets by setting `payment_method_types=["card"]` on the
subscription Checkout Session (Apple/Google Pay + Link still show automatically), or disable the
non-card methods for this account in the Stripe dashboard. Prevents silent renewal failures.

## QUEUED NEXT (per Jenn, build after this P0 - not started here)
1. Admin-page trial toggle (show state, on/off, trial days, audit-logged, admin-only) wired to
   GET/POST /api/admin/billing/trial.
2. (c) Premium wording: remove "Annual bio in the newsletter" from the Premium card; add
   "Enhanced listing card" and "Trust and credentials" to the "What Premium adds" block. Do NOT
   advertise "Featured in the app" (ships with LANDING-PREMIUM-1).
3. (a) Promo box on the signed-out signup plan step + clear free-trial wording during account
   creation (a new account currently sees no trial mention and no promo box).
4. (b) Basic/Featured/Premium listing-card preview thumbnails in the comparison.
