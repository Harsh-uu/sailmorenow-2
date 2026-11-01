# NEW BRANCH CHECK-IN + PLAN-RULES-0 (REPORT ONLY)

Report only. No code, no data changes, no backfill, sync switch NOT touched.
No testing agent. No em dashes. No seed data altered. No emails. No secret
read/printed. Plain English, handles only. "Could not verify" items are called
out.

Branch state read live (read-only): CRM sync switch = ON (enabled, as Jenn left
it); last connection test = ok; outbox pending=0 / sent=96 / failed=4 /
skipped=0; 51 users total; 20 users carry zoho_plan_term_months + zoho_sub_start;
0 users carry subscription_started_at (the real field was left untouched).

================================================================================
PART A - ZOHO STATE IN THIS BRANCH
================================================================================

All four pieces are present in code:

- ZOHO-CRM-5 (encrypted credential screen): PRESENT. backend/zoho_secrets.py
  stores the CRM refresh token Fernet-encrypted in the zoho_secrets collection
  (key from ZOHO_SECRETS_KEY), with store/get/delete, the DB sync switch
  (default OFF, DB beats the env flag), the connection-test timestamp, and the
  server-side grant-code exchange. No token value ever leaves the module.
  frontend/src/pages/AdminZoho.jsx is the admin screen.

- ZOHO-CRM-6 (datetime fix + background backfill): PRESENT. zoho_sync.py has
  _zoho_datetime (ISO 8601 + offset, microseconds stripped) and _zoho_date
  (yyyy-MM-dd), applied to every date/datetime field, plus _coerce_types that
  coerces each field to the live Zoho data type. The backfill/reconcile run as
  an asyncio background job (start_job / _run_job / job_status writing progress
  to app_meta zoho_crm_job), so they no longer run inside one long HTTP request.

- ZOHO-CRM-7 (test exclusions): PRESENT. Durable app_meta "zoho_exclude" handle
  list loaded by refresh_exclusions() before each drain; is_syncable_user hard-
  skips test email domains, sailmorenow.dev, tmp_/seed_ ids, demo, excluded
  handles, plus-addressed test handles, and the managed-seed name markers
  (psss / puget sound sailing / wtyc / wash n go / willamette). looks_like_test
  is advisory only.

- ZOHO-CRM-8 (Paid rule + soft delete): PRESENT (details below).

Nothing from ZOHO-CRM-8 is MISSING in code. Two things to flag, neither is a
gap in what was built:
  1. The member_status == "deleted" -> App_Account_Status "Deleted" mapping
     exists but is currently DORMANT: there is no self-serve or admin "delete
     account" endpoint anywhere that sets member_status = "deleted" (grep
     confirms zero writes of that value). The only live route to "Deleted" is
     the hard-deleted-user path in the drain (see A5).
  2. jeffmcdonald is still intentionally left empty on plan length / start date
     (ambiguous transactions, see A4), awaiting your call.

--- A1. What Subscription_Status do granted Founding Partner and Community
Partner orgs get, and why ---

They get EMPTY (no value sent). In build_contact_fields, when account_type is
"partner" and tier is founding_partner or community_partner, Subscription_Status
is set to None, so the field is dropped from the payload. Their status is carried
by Org_Status ("Founding Partner" / "Community Partner") and, for founding,
Founding_Member = true.

Why empty and not "Paid" or "Free": a granted partner never ran a Stripe
checkout, so "Paid" would be untrue; and "Free" is dishonest for a comped
partner who has full access. Empty keeps Subscription_Status meaning strictly
"a self-serve paid plan state," and the org truth lives in Org_Status. This is a
deliberate change from the earlier ZOHO-CRM-7 proposal (which had suggested
"Paid" for partners); CRM-8 corrected it to EMPTY.

--- A2. captain_jenn: is her Premium explained by the sailor package mapping to
tier premium? ---

YES. In _apply_paid_subscription the applied tier is:
  new_tier = "premium" if audience in ("sailor", "boat_owner") else pkg["tier"]
So a sailor or boat_owner who completes ANY of their premium packages becomes
subscription_tier = "premium". captain_jenn bought a sailor premium package, so
her Premium is a normal payment-mapped tier, not an admin grant. The ZOHO-CRM-8
correction confirmed all 21 paying individuals (captain_jenn included) are
payment-explained; the earlier "looks granted" note on her was WRONG and has
been retracted. Only the 3 partner orgs are admin grants.

--- A3. The rule that any completed Stripe checkout (cs_test_ or cs_live_) maps
to Paid with "(Stripe test mode)" in the history line - is it implemented? ---

YES, both halves:
  - Status: in build_contact_fields, any paid app tier (Boat Pro basic/featured/
    premium, or sailor/owner premium) maps to Subscription_Status = "Paid" while
    the plan is active (subscription_expires in the future) and "Cancelled" once
    it has expired. There is no test-vs-live distinction in the STATUS; a
    completed checkout of either kind lands the user on a paid tier, which reads
    as Paid. Trial / Founding Member Trial are never sent (no trial state
    exists).
  - History note: in _apply_paid_subscription the Subscription_History line gets
    the suffix "(Stripe test mode)" when the session id starts with "cs_test_".
    A live session id (cs_live_) would omit the note. So every row booked in
    this preview carries "(Stripe test mode)" because every session here is a
    test session.

--- A4. Plan-length backfill and derived Subscription_Start_Date: how many
users affected, enqueued, left empty and why ---

- Users filled: 20. They now carry zoho_plan_term_months (derived from their one
  matching completed transaction) and a Zoho-only zoho_sub_start (the real
  subscription_started_at was left untouched; verified 0 users have the real
  field set). build_contact_fields falls back to zoho_sub_start for
  Subscription_Start_Date.
- Zoho update events enqueued: 20 (one per filled user), and the running 2-minute
  drain synced them (they are part of the sent=96 total; failed=4 are the two
  fake-email accounts failing Campaigns only, their CRM Contact is fine).
- Left empty: 4 in total.
    - jeffmcdonald: EMPTY on purpose. He has TWO completed paid transactions (a
      3-month and a 12-month), so the single-match rule could not decide a term
      without guessing, and it declined to guess. (See Part C point 2 for his
      exact values.)
    - The 3 granted partner orgs: EMPTY because they have no transaction and no
      plan length (their status lives in Org_Status, not a term).

--- A5. Soft-delete behavior (App_Account_Status = Deleted, never hard delete)
and the exact code path for admin deactivate or ban ---

Mapping (build_contact_fields): App_Account_Status is
  "Suspended" if the user doc has banned == true,
  else "Deleted" if member_status == "deleted",
  else "Active".

Admin "deactivate / ban": POST /api/admin/users/{uid}/ban in
admin_content_router.py sets banned = true + banned_at, then enqueues a Zoho
outbox event "account_banned". The matching POST /api/admin/users/{uid}/unban
sets banned = false and enqueues "account_unbanned". So the admin deactivate
action maps a contact to SUSPENDED (reversible), not Deleted. The drain picks up
the enqueued event and pushes the updated App_Account_Status.

Hard-delete / "Deleted" path: there is NO delete endpoint that sets
member_status = "deleted". The only way a contact becomes Deleted today is when
a user row is MISSING from the users collection at drain time (a true hard
delete done outside the app). In that case process_outbox does NOT hard-delete
the Zoho contact: it calls crm.mark_account_deleted(app_user_id), which finds the
Contact by App_User_ID and sets App_Account_Status = "Deleted" while KEEPING the
record. If the contact cannot be found, the outbox row is marked skipped
("user_gone"); nothing is ever hard-deleted in Zoho.

Could not verify live: no live Zoho write was performed in this branch; the
mapping and code path are confirmed by reading the code, not by a live Deleted
write. The member_status == "deleted" branch is presently unreachable because no
code sets that value.

================================================================================
PART B - MYPLAN-0 (re-delivered report)
================================================================================

This is the audit you asked for earlier, re-stated in full. It is a report only;
nothing has been built.

--- B1. Entitlement table (who can do what) ---

Interaction gate (comment on posts, message, RSVP write actions, etc.): any
non-free paid tier. Resolved by deps.can_interact() (tier != "free") and
deps.require_interaction(). Back-compat alias is_paid_subscriber() routes to the
same helper.

Writing reviews: stricter. deps.can_review() requires a paid tier AND an
unexpired subscription (an expired paid plan is treated as free for reviews).
So review-writing can switch off a moment before the directory UI catches up.

Boat Pro listing richness, by tier (directory_router _pro_tier_caps +
_apply_tier_visibility + TIER_MAX_MARKETS):
  - Basic: NO logo, NO cover photo, NO gallery, NO credentials; 1 market.
  - Featured: logo + cover; NO gallery; NO credentials; 2 markets.
  - Premium: logo + cover + up to 5 gallery photos; credentials; unlimited
    markets (cap 999).
  When a field is above the tier cap it is locked and the server returns a
  "locked" list (e.g. logo / cover / gallery / credentials) so the UI can show
  an upgrade prompt.

Event posting: CLOSED to sailors and boat owners even when paid (community_router
returns code "event_posting_closed"). Free organizations may post volunteer
opportunities only, capped at 1 per month; Community / Founding Partners post
unlimited events.

--- B2. Prices and plan lengths (constants.SUBSCRIPTION_PACKAGES) ---

Boat Pro (per-month base, with term discounts 1mo 0%, 6mo 10%, 12mo 20%):
  - Basic:    12.99/mo  -> 1mo 12.99,  6mo 70.15,  12mo 124.70
  - Featured: 19.99/mo  -> 1mo 19.99,  6mo 107.95, 12mo 191.90
  - Premium:  29.99/mo  -> 1mo 29.99,  6mo 161.95, 12mo 287.90
  (Boat Pro has NO 3-month package.)

Sailor Premium and Boat Owner Premium (single paid tier each; 6.99/mo; discounts
1mo 0%, 3mo 10%, 6mo 15%, 12mo 20%):
  - 1mo 6.99, 3mo 18.87, 6mo 35.65, 12mo 67.10
  (Totals via package_total = monthly * months * (1 - discount), rounded to 2dp.)

Organizations (partner): NO self-serve package. Community Partner / Founding
Partner are admin grants only.

--- B3. Current-plan data endpoint ---

GET /api/payments/subscription returns, for a signed-in user: is_free, tier,
interval ("Monthly" / "N-month" / "Recurring"), interval_months, renews_at
(= subscription_expires), cancel_at_period_end. It does NOT currently return a
start date. (PLAN-RULES-0 proposes adding subscription_started_at and the queued
plan; see Part C.)

--- B4. Locked states / gaps found ---

On the web Boat Pro editor (MyListing.jsx) a Basic pro's cover and logo are
silently ABSENT rather than shown as a locked placeholder with an upgrade
prompt. The backend already returns the "locked" list; the UI just does not
surface a placeholder. This is the main thing a shared "My plan" screen should
fix for Basic.

--- B5. Where plan UI / upgrade entry points live ---

Web: Dashboard.jsx (quick status), MyListing.jsx / BoatProListing.jsx (Boat Pro
editor and its tier gating), Pricing.jsx (the upgrade/checkout surface). The
subscription summary is fed by GET /payments/subscription.
Mobile: app/(tabs)/profile/index.tsx (profile / subscription area),
app/(tabs)/my-listing.tsx and app/(tabs)/profile/boat-pro-listing.tsx (Boat Pro
editor + gating), register.tsx and the pricing screen for purchase.

--- B6. Proposal for a shared "My plan" screen ---

One shared layout across web and mobile:
  - Current plan card: tier name, interval/term, start date, renew/expiry date,
    and (new) any queued plan line.
  - "What's included" checklist for the current tier, with locked items shown
    greyed with a lock and an "Upgrade to unlock" affordance (fixes B4 for Basic
    Boat Pros: show locked cover-photo and logo placeholders instead of hiding
    them).
  - Upgrade button -> pricing/checkout. For Boat Pro this is the prorated tier
    upgrade (Part C RULE 2); for everyone else it is a stacked purchase (RULE 1).
Backend support needed: add subscription_started_at (and, once built, the queued
plan) to GET /payments/subscription.

================================================================================
PART C - PLAN-RULES-0 (DESIGN REPORT, NO BUILD)
================================================================================

Jenn's two decided rules:
  RULE 1 (stacking): the active plan runs to its end date; any newly purchased
  plan (longer/shorter/same/any account type) is QUEUED and starts when the
  current plan expires. No refunds/credits/proration for stacking. A free or
  lapsed account starts the new plan immediately.
  RULE 2 (tier upgrade, Boat Pro only): a higher tier starts IMMEDIATELY; the
  buyer pays only the PRICE GAP between the two tiers, prorated for the days left
  on the current plan; the end date does NOT change. More time is a separate
  stacked purchase under RULE 1. Sailors/owners have one paid tier, so RULE 2
  does not apply to them. Partner statuses are admin grants, out of scope.

--- C1. How plans/packages/prices/months are defined today, and whether a
per-day or per-month price per tier is reliably derivable ---

Defined in constants.SUBSCRIPTION_PACKAGES as a flat dict of packages, each with
tier, audience, months, monthly (base per-month price), and discount (a fraction
off for the longer term). The charged total is
package_total = round(monthly * months * (1 - discount), 2). Terms: Boat Pro
sells 1 / 6 / 12 months; Sailor and Owner sell 1 / 3 / 6 / 12 months. (The
prices are in B2.)

Per-month and per-day prices ARE reliably derivable for RULE 2 because the tier
price is a clean base monthly figure (12.99 / 19.99 / 29.99) with a known term
discount. For an upgrade we need the GAP between two tiers at the SAME term the
buyer is on:
  gap_per_day = (monthly_target - monthly_current) * (1 - discount(term)) / 30
(30 days per month, matching how expiry is computed: expires = now + 30*months).
This is exact and does not require storing a daily rate anywhere; it is computed
from the two tiers' monthly figures and the term's discount. The only judgement
call is whether the gap should use the term discount the buyer originally paid
(recommended: yes, so the upgrade matches what they are actually on) - see C5.

--- C2. How _apply_subscription works today, step by step, and jeffmcdonald's
real values ---

_apply_paid_subscription(session_id) today:
  1. Load the payment_transactions row; bail if missing or already
     subscription_applied (idempotency flag).
  2. Look up the package; compute expires = now + 30*months.
  3. new_tier = "premium" for sailor/owner audiences, else the package tier
     (Boat Pro basic/featured/premium).
  4. Read the prior user doc; was_active = had a non-free tier not yet expired.
  5. start = the prior subscription_started_at if the user was already active
     and had one, else now. (Intent: keep the original start across a renewal.)
  6. Write subscription_tier, subscription_expires = now + 30*months,
     subscription_started_at, zoho_plan_term_months = months,
     subscription_package_id.
  7. For a Boat Pro audience, ensure the directory listing exists.
  8. Append ONE Subscription_History line with action "Upgraded" (was active and
     tier changed), "Renewed" (was active, same tier), or "Started" (was free),
     with a "(Stripe test mode)" note for cs_test_ sessions, then enqueue a
     "plan_purchase" Zoho outbox event and push the level to Campaigns.
  9. Mark the transaction subscription_applied.

CRITICAL current behavior: a REPURCHASE WHILE ACTIVE RESETS THE PERIOD. Step 6
sets expires = now + 30*months regardless of time left, so buying again replaces
the remaining time rather than adding or queuing it. This DIRECTLY CONTRADICTS
RULE 1 (which says stack/queue, never reset) and must be changed.

jeffmcdonald (handle only), live values read read-only:
  - account_type: boat_owner; subscription_tier: premium
  - subscription_expires: 2027-10-13 (about 360 days from his last applied
    purchase)
  - subscription_started_at: None; zoho_plan_term_months: None;
    subscription_package_id: None; zoho_sub_start: None; zoho_sub_history: None
    (his subscription was applied by an OLDER code path that only set tier +
    expiry, before those fields existed; this is why the CRM-8 backfill could
    not auto-fill him and, combined with two completed txns, left him empty).
  His transactions (dates, package, amount, state):
    - 2026-10-07 14:50  sailor_premium_12  $67.10  initiated/pending  (abandoned)
    - 2026-10-07 14:51  sailor_premium_1   $6.99   initiated/pending  (abandoned)
    - 2026-10-08 03:59  sailor_premium_3   $18.87  complete/paid, APPLIED 10-08
    - 2026-10-18 18:50  owner_premium_12   $67.10  complete/paid, APPLIED 10-18
  So he has his 3-month test txn (Oct 8) and his 12-month test txn (Oct 18). The
  Oct 18 12-month is the one that set his current expiry (reset the period under
  today's behavior). The correct derivation, if you want to fill him, is 12
  months with a start around 2026-10-18; I did not write it (awaiting your word).

--- C3. Proposed data model for a queued plan ---

Store an ordered queue on the user doc (simplest for an MVP; a dedicated
subscription_queue collection is the cleaner alternative if you want full audit
history and easy admin editing):
  user.queued_plans = [ {
     package_id, tier, audience, months,
     amount_paid, session_id, purchased_at,
     status: "queued"            # "queued" -> "active" on promotion
  }, ... ]   # order = purchase order = activation order
Promotion (nightly job): when the active plan's expiry passes, instead of
dropping to free, pop the FIRST queued plan and activate it:
  subscription_tier = queued.tier
  subscription_started_at = the lapse moment
  subscription_expires = lapse moment + 30 * queued.months
  zoho_plan_term_months = queued.months; subscription_package_id = queued.package_id
  append a "Started" (or "Renewed" if same tier) Subscription_History line and
  enqueue a Zoho event; remove it from queued_plans.
Only when the queue is EMPTY does the user drop to free with a "Lapsed" line.
A queued plan does NOT change the active plan in any way while it waits.

--- C4. How Stripe is used today, and how to charge a custom prorated amount ---

Today: one-time Stripe Checkout Sessions via emergentintegrations StripeCheckout
(amount = package_total, currency usd, metadata carries user_id / package_id /
tier / months). There is NO auto-renew, NO Stripe Customer, NO billing portal;
the app tracks expiry itself and lazy-downgrades. Completion is detected two
ways, both idempotent via the transaction's subscription_applied flag: the
webhook POST /api/webhook/stripe and the return-page poll
GET /api/payments/status/{session_id}; both call _apply_paid_subscription. Mode
is test (sk_test_ / cs_test_) in this environment.

Charging a custom prorated amount for RULE 2:
  - Create a one-time Checkout Session with the computed amount (a dynamic
    price via price_data/unit_amount in cents, or just passing the float amount
    to CheckoutSessionRequest as today - the current helper already takes a free
    amount, so no fixed Stripe Price object is needed). Product/line name like
    "Upgrade to Premium (prorated, 40 days)" so the receipt is self-explaining.
  - Metadata: kind = "upgrade", from_tier, to_tier, days_remaining,
    keep_end_date = the unchanged expiry, so the apply path knows NOT to extend.
  - Apply path (new _apply_upgrade, mirrors _apply_paid_subscription's
    idempotency): set subscription_tier to the higher tier IMMEDIATELY, KEEP
    subscription_expires and subscription_started_at unchanged, append an
    "Upgraded (prorated)" history line, enqueue the Zoho event. Guard with the
    same subscription_applied flag + a unique transaction row so a webhook +
    poll double fire cannot double-apply or double-charge.
  - Receipt / mode: the Stripe receipt shows the product name and the exact
    prorated amount; in test mode it is clearly a TEST payment (as all are here).
  - Rounding: compute gap_per_day * days_remaining, round to cents (2dp); send
    unit_amount as the rounded cents.
  - Minimum charge: Stripe's floor is $0.50 USD. If the prorated amount is below
    $0.50 (very little time left, or a small gap), do NOT create a sub-minimum
    Checkout. Recommended: comp the upgrade (apply the higher tier immediately
    for $0, log a history line "Upgraded (prorated, comped below minimum)") -
    this is goodwill and avoids a Stripe error. Alternative you could pick:
    block with "too little time left to upgrade - buy more time instead."
  - Zero case: if days_remaining <= 0 the plan has effectively lapsed, so it is
    not an upgrade at all - it becomes a fresh immediate purchase (RULE 1 free/
    lapsed branch).

--- C5. Exact RULE 2 proration formula, 3 worked examples, and edge cases ---

Formula (Boat Pro only):
  gap_per_day = (monthly_target - monthly_current) * (1 - discount(term)) / 30
  upgrade_charge = round(gap_per_day * days_remaining, 2)
  end date unchanged; tier changes immediately.
(discount(term) = the discount of the term the buyer is currently on: 1mo 0%,
6mo 10%, 12mo 20%. Using the buyer's own term discount keeps the top-up
consistent with what they already paid.)

Worked examples (real Boat Pro prices; Boat Pro terms are 1/6/12, no 3-month):
  1) Basic -> Premium, on a 6-month plan, 40 days left:
     gap/day = (29.99 - 12.99) * (1 - 0.10) / 30 = 17.00 * 0.90 / 30 = 0.51
     charge  = 0.51 * 40 = $20.40. End date unchanged.
  2) Basic -> Featured, on a 12-month plan, 200 days left:
     gap/day = (19.99 - 12.99) * (1 - 0.20) / 30 = 7.00 * 0.80 / 30 = 0.186667
     charge  = 0.186667 * 200 = $37.33. End date unchanged.
  3) Featured -> Premium, on a 1-month plan, 10 days left:
     gap/day = (29.99 - 19.99) * (1 - 0.00) / 30 = 10.00 / 30 = 0.333333
     charge  = 0.333333 * 10 = $3.33. End date unchanged.

Edge cases:
  - Upgrade on the LAST day (1 day left): tiny charge (e.g. Basic->Premium 6mo =
    $0.51). If it lands below Stripe's $0.50 minimum, comp it per C4.
  - A queued plan already exists: the immediate tier upgrade applies to the
    ACTIVE plan only; the queued plan is untouched and still starts at the
    (unchanged) end date at its own tier. (Flag: should the queued plan inherit
    the upgrade? Recommended NO - it is a separately purchased plan at its own
    tier. Confirm.)
  - Upgrade THEN buy more time: the extra time is a RULE 1 stacked purchase that
    queues after the unchanged end date (at whatever tier they buy).
  - Two upgrades in a row (Basic->Featured->Premium): each upgrade charges the
    gap from the CURRENT tier to the new one for the days left at that moment
    (Basic->Featured, then Featured->Premium); never charge Basic->Premium twice.
  - A downgrade purchase (buying a lower tier while on a higher one): there is no
    immediate downgrade; it QUEUES under RULE 1 and starts at the end date at the
    lower tier. No credit for the difference.
  - Refunds / chargebacks: none are automated today. A refunded upgrade would
    need a manual tier revert; flag for a later admin tool.

--- C6. UI copy the app must show ---

Checkout (RULE 2 upgrade):
  "Upgrade to Premium today and pay $20.40 for the remaining 40 days. Your plan
  still ends on October 1, 2026. Want more time? Buy a new plan and it starts
  when this one ends."
Checkout (RULE 1 stacked purchase while active):
  "You are set until October 1, 2026. Your new 12-month plan starts on
  October 1, 2026 and runs to October 1, 2027."
My plan page lines:
  - Current plan: "Boat Pro Premium - started Jun 1, 2026, renews/ends Oct 1,
    2026."
  - Queued plan: "Next: Boat Pro Premium (12 months) starts Oct 1, 2026."
  - Upgrade: "Upgrade your tier - pay only the difference for the days left,
    same end date." (Boat Pro only.)
Zoho Subscription_History line formats (one line per event; current builder uses
"date | Account Tier | term | Action | ends DATE | note"):
  - Started:            2026-06-01 | Boat Pro Premium | 12 months | Started | ends 2027-06-01
  - Queued:             2026-06-01 | Boat Pro Premium | 12 months | Queued | starts 2026-10-01
      (needs a new "starts" variant; the current builder only emits "ends")
  - Upgraded (prorated):2026-06-01 | Boat Pro Premium | 6 months | Upgraded (prorated) | ends 2026-10-01 | paid $20.40 for 40 days (Stripe test mode)
  - Renewed:            2026-06-01 | Boat Pro Premium | 12 months | Renewed | ends 2027-06-01
  - Lapsed:             2026-06-01 | - | - | Lapsed | ends 2026-06-01

--- C7. Every place the business terms / app copy must state something ---

Terms of Service / policy sections to add or update:
  - Stacking: additional plans queue and start at the current end date.
  - No refunds, no credits, no proration for stacked purchases.
  - Prorated tier upgrades (Boat Pro): immediate, pay the price gap for the days
    left, end date unchanged.
  - Start dates: how a queued plan's start/end is set at promotion.
  - Lapse behavior: on expiry a user drops to free unless a plan is queued.
  - Test mode: payments are currently test-mode (no real charge) until live.
App copy that would need to change:
  - Pricing page (web Pricing.jsx; mobile pricing screen + plans.ts): add "plans
    stack" and "upgrade = pay the difference" explainers.
  - Checkout confirmation copy (the two C6 checkout strings).
  - The shared My plan screen (current + queued + upgrade lines).
  - Cancel copy (payments_router cancel endpoint message) if queue changes it.
  - Welcome / win-back / renewal emails where plan length or renewal is worded.

--- C8. Risks and smallest-safe build order ---

Risks:
  - CRITICAL: deps.py does a LAZY downgrade to free on access the moment a plan
    is expired (before the nightly job runs). If the queue lives only in the
    nightly job, a user with a queued plan could be flipped to free on their next
    request and skip the queue. The lazy-downgrade MUST consult the queue too.
  - Idempotency / double-apply on the prorated upgrade (webhook + poll double
    fire) - reuse the subscription_applied flag + a unique transaction row.
  - Stripe sub-minimum ($0.50) and rounding (penny) on small upgrades - comp-
    below-minimum rule (C4).
  - Changing the current "repurchase resets the period" behavior is a real
    behavior change; existing users mid-cycle must be handled (going forward
    only; no retroactive edits without your say-so).
  - Refund / chargeback reversal is manual today.
  - Partner grants must stay out of the queue/upgrade logic entirely.

Smallest-safe build order:
  1. Add the queue data model + change the purchase apply path so: free/lapsed =
     immediate; active + same-or-lower tier = QUEUE (stop resetting the period);
     (higher tier handled in step 4). Backend only, no UI.
  2. Fix the lazy-downgrade in deps.py AND the nightly job to PROMOTE a queued
     plan before dropping to free. (Do 1 and 2 together so no one is ever
     wrongly downgraded.)
  3. Extend GET /payments/subscription with subscription_started_at and the
     queued plan, so the My plan screen can read it.
  4. RULE 2 prorated upgrade: the upgrade checkout (custom amount) + the
     _apply_upgrade path (immediate tier, unchanged end date), with the comp-
     below-minimum rule.
  5. Shared My plan screen (web + mobile) + the checkout/pricing copy.
  6. Zoho history line variants (Queued "starts", Upgraded (prorated)) + Terms
     copy.

--- Open questions for Jenn ---

  1. Is there a limit on how many plans can be queued at once (e.g. cap at 1, or
     unlimited)?
  2. What happens to a queued (already paid) plan if the account is deleted or
     banned? The no-refund rule points to dropping it, but that is money paid for
     service not delivered - do you want it refunded manually, held, or forfeited?
  3. On a tier upgrade, should an already-queued plan inherit the higher tier, or
     stay at the tier it was bought at? (Recommended: stay as bought.)
  4. For RULE 2, use the buyer's current term discount in the gap (recommended),
     or the undiscounted monthly gap?

Could not verify (whole report): no live Zoho write and no live Stripe charge
were performed in this branch; everything above is from reading the code and a
read-only database query. Native iPhone/Android behavior is not verifiable in
the web preview.
