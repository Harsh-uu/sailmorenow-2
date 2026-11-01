# IAP-0b — Can the "first-N-per-market" 30-day trial be enforced across Stripe, Apple, Google? (REPORT ONLY)

Status: REPORT ONLY, no code. Follow-up to IAP-0. Store facts cited to official pages; third-party-sourced details flagged "verify". Rule to enforce: 30 days free for the first **100** paid sailors+owners **per home market**, and the first **20** Boat Pros **per home market** (Boat Pro trial = 1 month Premium then continues monthly; no trial on multi-month). Automatic (no code to redeem). Card up front everywhere.

Short answer: **enforceable exactly on Stripe (web) and on Google; NOT exactly on Apple.** Apple's new-subscriber free trial is a store-managed *introductory offer* we cannot cap by our own per-market/first-N rule, and Apple's server-signed *promotional offers* are for existing/lapsed subscribers, not first-time trials. So the exact rule needs a decision for iOS.

---
## 1. Web / Stripe — yes, fully controllable

At Checkout-session creation our backend decides whether to attach `subscription_data.trial_period_days=30` (card still collected up front). Eligibility is our own atomic DB counter, so we own the rule.
- **Counter location:** a `trial_caps` row per (group, market) with `count`/`cap` (see §4); the grant is logged in `trial_grants`.
- **No race on the last slot:** reserve atomically - `find_one_and_update({group, market, count < cap}, {$inc: count +1})`; if it returns nothing, no trial. Pair with inserting a `trial_grants` row that has a unique index on (user_id, group) so one user can't take two.
- **When a trial is "spent" (recommended):**
  - **Reserve at checkout-session creation** (the atomic increment) - this is what prevents the last-slot race.
  - **Finalize** on the trial-start webhook (`customer.subscription.created`/`updated` with status `trialing`) -> mark grant `active`.
  - **Release** only if the checkout is abandoned (`checkout.session.expired`) or the session TTL lapses -> decrement back.
  - **Do NOT release** if they cancel during the trial / before the first charge - they consumed the slot. (Otherwise a cancel-and-rejoin farms the cap.)

## 2. Apple & Google — can a store intro offer obey our per-market first-N rule?

**(a) Server-controlled eligibility**
- **Apple:** *Introductory offers* (the mechanism for a new-subscriber free trial) are **store-managed, one per subscription group per customer** - we can only turn the offer on/off for a product; we **cannot** gate it by our own per-market counter. *Promotional offers* ARE signed per-customer by our server key via StoreKit, so we control eligibility - **but they target existing/previously-subscribed customers, not brand-new first-time trials**, so they don't fit "first N new paid subscribers." Net: Apple **cannot** enforce first-N-per-market on a new-subscriber trial. (Introductory offers: https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions/ ; promotional/intro overview: https://developer.apple.com/app-store/subscriptions/ ) **Effort to try: not possible for the exact rule.**
- **Google:** offers support **developer-determined eligibility** (our backend/custom logic + tags decides who sees/gets the offer), so Google **can** honour our first-N-per-market counter: the app asks our backend, and we only surface/apply the free-trial offer when a slot is free. (Base plans & offers: https://support.google.com/googleplay/android-developer/answer/12154973 ; subscriptions/offers dev guide: https://developer.android.com/google/play/billing/subscriptions .) **The "developer-determined eligibility" detail came from third-party docs (RevenueCat/Purchasely) - VERIFY on the official Play pages above.** **Effort: M.**

**(b) Store Offer Codes we hand out in limited numbers** - Apple Offer Codes / Google promo codes with limited quantities + expiry. They *cap* usage, but the user must **redeem a code**, so it is **not "automatic"**, and tying "the Nth signup in market X" to a specific code is clumsy. Enforces: a hard max + expiry. Cannot: automatic/market-aware assignment. **Effort: M**, poor UX fit.

**(c) Backend-granted trial entitlement, no store purchase until it ends** - we comp Premium for the window with no store subscription. Enforces our exact per-market cap on any platform. Cannot: **no card up front on mobile and no auto-continue** - so it breaks "card up front for everyone" and Boat Pro "1 month then continues monthly" (the user must separately subscribe via IAP to continue). **Effort: M.**

**(d) Trial on web only** - mobile store subscribers get **no** free trial (or an accepted, *uncapped* store intro offer); the capped 30-day trial lives only on Stripe/web. Keeps the rule exact where we can enforce it and avoids an iOS cap we can't honour. Enforces: the exact rule on web (+ Google if we also do 2a there). Cannot: give a capped trial on iOS. **Effort: S.**

## 3. Home market - how it's set, and farming risk

- Field = **`primary_market`** on the user. Set at **registration** (`auth_router.py:205`, validated against `PNW_MARKETS`). **It is editable after signup** via the profile/settings update (`auth_router.py:574-578`, which also auto-adds the new market to `markets`). So a user **can change home market later** - a farming vector if eligibility were re-checked on the live field.
- **What stops farming:**
  - **Lock the market on the grant:** store `market_at_grant` in `trial_grants` and enforce **one trial per user per group ever** (unique index on (user_id, group)); eligibility is checked once at first paid checkout, not re-evaluated when `primary_market` later changes. Changing market afterwards grants nothing new.
  - **Second account:** harder to fully stop. Stripe `restrictions.first_time_transaction` / one-trial-per-customer + Stripe Radar on card/email fingerprints; on stores, an intro offer is inherently once-per-Apple-ID / once-per-Google-account, which blocks repeat trials on the same store account but not a brand-new account with a new card. Residual risk remains; accept it or add email/card-fingerprint de-dupe.

## 4. One shared trial-count table (web + phone draw from the same pool)

```
trial_caps:
  { _id, group: "sailor_owner" | "boat_pro",
    market: <PNW market>,            # home market
    cap: 100 | 20,
    count: <int>,                    # reserved+active+consumed
    updated_at }
  unique index (group, market)

trial_grants:
  { _id, user_id,
    group, market_at_grant,          # locked at grant time
    provider: "stripe" | "apple" | "google",
    state: "reserved" | "active" | "consumed" | "released",
    ref_id,                          # checkout/session or store purchase token
    reserved_at, started_at, released_at }
  unique index (user_id, group)      # one trial per user per group, all platforms
```
Both web Checkout and (if used) Google offer-eligibility call the **same** `reserve/confirm/release` service against these tables, so the 100/20 pool is shared across platforms. Admin view/edit: per market+group show cap, count, **slots remaining**, and the grants list by provider/state; let admin **raise/lower a cap**, **manually grant or revoke** a slot, and **release stuck `reserved` rows** (TTL sweeper for abandoned checkouts).

## 5. Recommendation + what makes the exact rule impossible

- **Recommend:** one shared counter (§4) enforcing the cap on **Stripe (web)** and on **Google via developer-determined offer eligibility** (verify on official Play docs). For **Apple**, pick one, since the exact first-N-per-market new-subscriber trial is **not possible**:
  - (preferred) **web-only capped trial** - iOS new subscribers get no free trial (cleanest, rule stays exact), or
  - accept an **uncapped Apple introductory offer** (every eligible new iOS subscriber gets 30 days - simple but breaks "first N" on iOS), or
  - **comp entitlement** on iOS (honours the cap but no card up front and no auto-continue - breaks those requirements).
- **What makes the exact rule impossible:** Apple gives no server-controlled, per-market, first-N gate on a *new-subscriber* free trial (introductory offers are store-managed and uncapped-by-us; promotional offers are for existing/lapsed users). Also, "automatic" + "capped" + "card up front" + "auto-continues" cannot all hold on iOS at once. Minor: `primary_market` is user-editable, so eligibility must be locked at grant time, and a determined user with a fresh account + new card can still get a second trial on a new store account.

## Could not verify
- Google's "developer-determined eligibility" behaviour/limits (sourced from RevenueCat/Purchasely, not an official page I opened) - confirm on the official Play base-plans/offers docs.
- Whether an Apple promotional/offer-code flow could be bent to approximate the cap within policy (needs App Store Connect + legal review).
- Real store behaviour (eligibility, once-per-account enforcement) - only testable on a dev build with sandbox accounts.
- Exact store fees/eligibility for any external/alternative path (out of scope here; see IAP-0).

## Files read
- `backend/routers/auth_router.py` (`primary_market` set at register line 205; editable at lines 574-578; PNW_MARKETS validation).
- `backend/constants.py` (PNW_MARKETS, the 17 packages) via prior IAP-0 read.
- `memory/BILLING-PLAN-1.md` and `memory/IAP-0_REPORT.md` (Stripe trial model, store offer types, single entitlement).
- Official Apple/Google links cited inline.
