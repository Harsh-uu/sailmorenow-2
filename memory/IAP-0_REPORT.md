# IAP-0 — Apple & Google in-app purchases for the mobile app (REPORT ONLY)

Status: REPORT ONLY. No code, no installs, no store/Stripe setup. Expo SDK 58, React Native 0.88, React 19.3, expo-router 58. No IAP library installed today. Store facts/policies below are cited to official pages; where I did not open a page or where fees/eligibility apply, I say "verify" - no fees or rules are quoted from memory.

---
## 1. IAP options in this Expo (SDK 58) app

Two viable paths (both need a **development build** - neither works for real transactions in Expo Go):
- **`expo-iap`** - the official Expo module (`npx expo install expo-iap`), New-Architecture ready; `react-native-iap` is now deprecated for Expo. You talk to StoreKit / Play Billing directly and do your own backend validation.
- **RevenueCat** (`react-native-purchases` [+ `react-native-purchases-ui`]) - a paid third-party service that wraps both stores, aggregates entitlements, and ingests both stores' server notifications. Has a Preview/mock mode so Expo Go won't crash during UI work.
- Expo Go: UI/logic prototyping only; **real purchases require an EAS development build** with `expo-dev-client`. Test on device with App Store **sandbox testers** (+ a StoreKit config file) and Google Play **license testers** on an **internal testing** track.
- Build/test setup: enroll in Apple Developer Program + Google Play Console; create the products in each console; stand up server-side validation (Apple App Store Server API, Google Play Developer API) and the webhook/notification receivers; EAS build a dev client, then TestFlight / Play internal testing.
- **Recommendation for this app:** because BILLING-PLAN-1 already requires ONE backend-owned entitlement with a `provider` field, either (a) `expo-iap` + our own backend validation/notifications (keeps control, no extra vendor, more work) or (b) RevenueCat as the cross-store aggregator that then syncs one entitlement to our backend (faster, less store plumbing, adds a vendor + cost). Pick one; both satisfy the single-entitlement model.

## 2. Mapping our 17 packages to store products

Our catalog: Boat Pro Basic/Featured/Premium at 1/6/12 months (9) + Sailor Premium and Owner Premium at 1/3/6/12 months (8) = **17**. Sailor vs Owner Premium are the same price/entitlement, so store-side they collapse into ONE "Member Premium" (audience stays a backend attribute).

- **Apple (App Store Connect):** a **subscription group** = the set in which a user holds at most one active sub; **levels** rank tiers for upgrade/downgrade. Each *duration* is its own subscription product. So:
  - Group "Boat Pro" with 3 levels (Basic/Featured/Premium); each level has 1-month, 6-month, 1-year products (Apple durations: 1 wk, 1/2/3/6 mo, 1 yr - our 1/6/12 and 1/3/6/12 all exist).
  - Group "Member Premium" with 1/3/6/12-month products.
  - Upgrade = immediate with prorated refund; downgrade = deferred to next renewal; same-level crossgrade = immediate if same duration else at renewal. Monthly-with-12-month-commitment type: upgrades immediate, downgrades deferred to end of commitment. This matches Jenn's "upgrade immediate, downgrade at term end."
- **Google (Play Console):** one **subscription** per tier, each with **base plans** (billing periods: monthly auto-renew, 6-month, annual; prepaid also possible). Tier changes use **ReplacementMode** (`WITH_TIME_PRORATION`, `CHARGE_PRORATED_PRICE`, `CHARGE_FULL_PRICE`, `WITHOUT_PRORATION`, `DEFERRED`) to express immediate-upgrade vs deferred-downgrade.
- **Longer-term discounts (10/15/20%):** set the 6/12-month product/base-plan price lower per month in each console. These prices are **store-side**, independent of Stripe's amounts (they must be maintained in two more places).
- **Free trials:** store-side **introductory offers / free trials** are once-per-subscription-group (Apple) / once-per-eligibility (Google). **Code-gated** trials use Apple **Offer Codes** (one-time 18-digit or custom codes, with limits/expiry) or Google **promo codes / offers**. Our own backend code cannot inject free time into a store subscription (see §6).

## 3. One entitlement per user across Stripe / store / comp

- Backend owns a single `entitlement {user_id, tier, status, current_period_end, provider: stripe|apple|google|comp, source_id}`; at most one **active paid** entitlement.
- **Coexistence / precedence (recommended):** before showing a buy button, check the backend entitlement. If an active paid sub already exists on another platform, **hide/disable purchase** and show "You're subscribed via {Apple|Google|the web}. Manage it there." `comp` (admin) outranks all while active and never bills. If a double-active somehow occurs (e.g., a race), honour the higher tier, flag for admin, and tell the user to cancel the duplicate (we cannot cancel another platform's sub programmatically).
- **Cross-platform view:** a sub bought on iOS is cancel/upgrade-only in iOS Settings; a sub bought on Android only in Play; a web sub only in the Stripe portal. On the "other" surface we show read-only status + a deep link to the right place (iOS `itms-apps`/Settings, Play subscriptions deep link, Stripe portal URL). **Restore purchases** on mobile re-links the store account to our user.

## 4. Validation + server notifications + cancellation

- **Validate server-side**, never trust the client. Apple: **App Store Server API** (verify the transaction/JWS) + **App Store Server Notifications V2** (SUBSCRIBED, DID_RENEW, DID_FAIL_TO_RENEW, GRACE_PERIOD, EXPIRED, DID_CHANGE_RENEWAL_STATUS, REFUND, REVOKE). Google: **Play Developer API** `purchases.subscriptionsv2.get` + **Real-time Developer Notifications (RTDN)** over Pub/Sub (SUBSCRIPTION_PURCHASED, RENEWED, CANCELED, ON_HOLD, IN_GRACE_PERIOD, REVOKED, RESTARTED, EXPIRED). **Google requires acknowledging** a purchase within 3 days or it auto-refunds.
- These notifications are the mobile equivalent of Stripe webhooks and drive the single entitlement. (RevenueCat can receive both and give us one webhook if chosen.)
- **Restore:** StoreKit restore (iOS) / query existing purchases (Android) -> map to the logged-in user.
- **Cancellation:** the user cancels in the store (iOS Settings > subscriptions; Play > subscriptions); the app CANNOT cancel for them. Access continues to period end; a store refund (Apple refund request / Google Play) fires REFUND/REVOKED -> we revoke. Dunning/grace is store-run (ON_HOLD/GRACE_PERIOD) - keep access during grace, revoke on EXPIRED/REVOKED.

## 5. Stays on Stripe; what mobile hides/redirects

- **Stays Stripe:** all web purchases; **Stripe Identity** verification (a real-world identity service, not a digital-content unlock - keep it, but verify it's allowed outside IAP, §7); **Community Partner variable price** (arbitrary per-partner amounts don't fit store subscription products - keep off-store / arranged via Stripe).
- **Mobile must hide/redirect:** do NOT show web/Stripe plan checkout inside the iOS/Android app for the digital plans (that's what requires IAP). Hide the Community-Partner purchase on mobile (show a "contact us"/redirect instead). Any "manage billing on the web" link is subject to each store's anti-steering rules (§7) - safest default is to keep plan purchase/management fully in-store on mobile.

## 6. Can our override/trial code live inside a store purchase?

- **No** - a free period *inside a store subscription* must be a store-side **intro offer / free trial** or a redeemed **Offer Code (Apple) / promo code or offer (Google)**. Our backend code cannot make Apple/Google grant free billed time.
- Options to realise Jenn's code-gated beta trial (limited uses, expiry, 30 days Premium for sailors/owners, 1 month Boat Pro Premium then auto-continues monthly, none on multi-month):
  1. **Store Offer Codes / offers** attached only to the *monthly* products (so multi-month have none), configured as a free intro period; Apple Offer Codes support limited quantities + expiry and are redeemed in the store. Closest match to "code, limited, expiry, then auto-continues monthly." Eligibility rules (e.g., new-subscriber-only) are store-enforced - verify they fit "beta, not everyone."
  2. **Comp entitlement via our own code, with NO store purchase** - we grant Premium for the window; there's no auto-billing afterwards, so the tester must subscribe via IAP to continue (no silent auto-continue). Good for internal testers.
  3. If RevenueCat is used, it can grant a **promotional entitlement** server-side for free - again no store auto-renew afterwards.
- **Tester access** is best done with **TestFlight (iOS)** and **Play internal testing (Android)** + sandbox accounts (no real charges), not production codes.

## 7. Policy items Jenn must verify (official links)

Do NOT treat fees/eligibility as settled - confirm with counsel and the live pages:
- **IAP required for digital plans:** Apple Review Guidelines (3.1.1) - https://developer.apple.com/app-store/review/guidelines/ ; Google Play Payments policy - https://support.google.com/googleplay/android-developer/answer/10281818
- **Linking out to web payment / anti-steering:** Apple May-2025 update - https://developer.apple.com/news/?id=9txfddzf (US-storefront external-link allowance; non-US needs the StoreKit External Purchase Link Entitlement); Google external offers / alternative billing - https://support.google.com/googleplay/android-developer/answer/17161464 and https://support.google.com/googleplay/android-developer/answer/16497028 . **Fees and program eligibility change by region and date - VERIFY, do not assume.**
- **Account deletion (store blocker):** Apple Guideline 5.1.1(v) - https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/ ; Google - https://support.google.com/googleplay/android-developer/answer/13327111 . Both require an in-app way to delete the account (+ Google requires a web deletion link disclosed in Data safety). **Our app has NO self-serve account deletion today (PRD notes the deleted-status branch is dormant) - this must be built before mobile submission.**
- **User-generated content:** Apple Guideline 1.2 (on the guidelines page above - verify the exact 1.2 text); Google UGC policy - support.google.com/googleplay/android-developer (UGC policy page - verify exact URL). We have posts/reviews/messaging, so we need report/block/filter + moderation (we have some; confirm it meets 1.2).
- **Privacy labels / data disclosure:** Apple App Privacy "nutrition labels" - https://developer.apple.com/app-store/app-privacy-details/ (verify); Google Play **Data safety** form - support.google.com/googleplay/android-developer/answer/10787469 (verify). Must declare data collected (account, payments via store, identity verification via Stripe, analytics).
- **Could not verify (flag):** exact service-fee percentages and external-link program eligibility for our case; whether Stripe Identity is unambiguously allowed outside IAP for our use; the exact current UGC (1.2) and privacy-label URLs (I cited from search, did not open each). These need a live read + legal review.

## 8. Effort, risks, real-device vs browser testing

**Effort (S/M/L):**
- expo-iap or RevenueCat wiring + EAS dev build + store products created: **L**.
- Backend receipt/token validation + ASSN v2 + Google RTDN receivers: **L**.
- Single entitlement model with `provider` + precedence + cross-platform "manage where you bought it" UI: **M**.
- Hide/redirect web-Stripe plan checkout + Community Partner on mobile: **S**.
- Store-side products/prices/intro-offers/offer-codes for 17 packages (two consoles): **M** (ongoing maintenance in 3 price systems).
- **In-app account deletion + web deletion link (store gate): M - prerequisite to submit.**
- Code-gated beta-trial design via offer codes/comp: **M** (plus policy confirmation).

**Risks:** price drift across Stripe + App Store + Play; double-billing if a user subscribes on two platforms; Google 3-day acknowledgement auto-refund if missed; anti-steering missteps can get the app rejected/removed; Expo Go cannot validate any of this (dev build only); store review rejections for account deletion / UGC / privacy; refund/revoke handling; sandbox behaves differently from production.

**Test on a REAL device (dev build):** every purchase/renew/cancel/refund/restore on iOS sandbox and Android license-tester; upgrade (immediate) and downgrade (deferred) per tier; grace/on-hold; ASSN v2 + RTDN reaching our backend and updating the single entitlement; cross-platform "already subscribed" hiding; offer-code redemption. **Test in a BROWSER:** nothing store-specific - only the web Stripe side and the backend entitlement API responding to simulated store notifications.

## Files read
- `/app/mobile/package.json` (Expo 58, RN 0.88, React 19.3, expo-router 58; no IAP lib present).
- `/app/memory/BILLING-PLAN-1.md` (web Stripe auto-renew plan, single-entitlement + provider requirement, Stripe Identity, Community Partner variable price).
- `/app/backend/constants.py` (the 17 SUBSCRIPTION_PACKAGES + prices/terms/discounts) and PRD notes on the dormant account-deletion path.

## Could not verify
- Exact store service-fee percentages and external-link/alternative-billing program eligibility for our region/case (policy + legal).
- Whether Stripe Identity is permitted outside IAP for our exact use (verify with Apple/Google).
- Live/exact URLs and current text for Apple UGC 1.2 and the privacy-label pages, and Google's UGC + Data-safety pages (cited from search, not each opened).
- Real purchase/renewal/refund behaviour - not runnable here (needs an EAS dev build + sandbox accounts on real devices).
- Whether a store intro-offer's eligibility can be constrained to "beta testers only" exactly as Jenn wants (Offer Codes are the closest; confirm in App Store Connect / Play Console).
