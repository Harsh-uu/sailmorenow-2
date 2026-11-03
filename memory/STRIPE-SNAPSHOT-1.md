> CORRECTION (STRIPE-EXPIRY-CHECK-1, later): The "migrate to a different (Jenn's own)
> Stripe account" premise of this file is RETRACTED. The sandbox is ALREADY Jenn's own
> account (claimable sandbox acct ending 1jyH, "Sail More Now Oct 12 2pm"). There is no
> second account to switch to, so the catalog does NOT need rebuilding and test users
> do NOT need re-linking for an account move. The inventory below stays valid and
> useful: the catalog (5 products, 17 price lookup_keys), the Stripe-id DB fields with
> live counts, and the secret names. Only the section (4) "steps to rebuild in a
> different account" is moot. See STRIPE-EXPIRY-CHECK-1_REPORT.md.


# STRIPE-SNAPSHOT-1 - Pre-migration snapshot of the Stripe setup

READ-ONLY capture taken before any Stripe account change. No code, secrets, or
data were modified to produce this file. No secret VALUES are shown (names only).
Hyphens only. Counts are live from the database at capture time.

Purpose: a single reference so the catalog can be rebuilt and test users re-linked
after the app is switched from the current Emergent-managed Stripe sandbox
(acct_1UW1tX... per STRIPE-ACCOUNT-CHECK-1) to a different (Jenn's own) Stripe
account. Stripe accounts are isolated, so every Stripe id below becomes stale on
the new account and must be recreated there.

---

## (1) Product and price lookup_keys the app expects + what setup_stripe.py creates

Source of truth: `backend/constants.py` (SUBSCRIPTION_PACKAGES, package_total) and
`backend/setup_stripe.py`. The app NEVER hardcodes price ids - it resolves a price
at runtime by `lookup_key` (billing.py `price_id_for`, setup_stripe `ensure_price`).
The `lookup_key` equals the package key. So the whole contract is just these names.

### 5 Products (setup_stripe.py PRODUCTS; matched/created by metadata
`emergent_product_id`, tax_code txcd_10103001)
| emergent_product_id | name              | audience   |
|---------------------|-------------------|------------|
| pro_basic           | Boat Pro Basic    | boat_pro   |
| pro_featured        | Boat Pro Featured | boat_pro   |
| pro_premium         | Boat Pro Premium  | boat_pro   |
| sailor_premium      | Sailor Premium    | sailor     |
| owner_premium       | Boat Owner Premium| boat_owner |

### 17 Price lookup_keys (one recurring USD price each; amount = monthly * months *
(1 - discount), baked in; interval: months 1/3/6 -> every N months, months 12 -> yearly)
| lookup_key          | tier     | audience   | months | amount USD |
|---------------------|----------|------------|--------|------------|
| pro_basic_1         | basic    | boat_pro   | 1      | 12.99      |
| pro_basic_6         | basic    | boat_pro   | 6      | 70.15      |
| pro_basic_12        | basic    | boat_pro   | 12     | 124.70     |
| pro_featured_1      | featured | boat_pro   | 1      | 19.99      |
| pro_featured_6      | featured | boat_pro   | 6      | 107.95     |
| pro_featured_12     | featured | boat_pro   | 12     | 191.90     |
| pro_premium_1       | premium  | boat_pro   | 1      | 29.99      |
| pro_premium_6       | premium  | boat_pro   | 6      | 161.95     |
| pro_premium_12      | premium  | boat_pro   | 12     | 287.90     |
| sailor_premium_1    | premium  | sailor     | 1      | 6.99       |
| sailor_premium_3    | premium  | sailor     | 3      | 18.87      |
| sailor_premium_6    | premium  | sailor     | 6      | 35.65      |
| sailor_premium_12   | premium  | sailor     | 12     | 67.10      |
| owner_premium_1     | premium  | boat_owner | 1      | 6.99       |
| owner_premium_3     | premium  | boat_owner | 3      | 18.87      |
| owner_premium_6     | premium  | boat_owner | 6      | 35.65      |
| owner_premium_12    | premium  | boat_owner | 12     | 67.10      |

Notes:
- Each price is created with `transfer_lookup_key=True`, so re-running
  setup_stripe.py is idempotent by lookup_key: if a live price with that lookup_key
  exists AND matches amount/currency/interval it is left unchanged; if it differs
  the old price is deactivated and a new one created; if absent it is created.
- Prices carry metadata tier/audience/months/discount; products carry
  managed_by=sailmorenow and emergent_product_id.
- A separate promotion coupon (100% off, repeating 3 months) is referenced in code
  (billing.py PROMO_MONTHS, find_promotion_code) but is NOT created by
  setup_stripe.py - it is a manual Stripe dashboard object. If signup promo codes
  are used on the new account, that coupon + promotion code must be recreated by hand.

---

## (2) Database fields that store a Stripe id + live test-user counts

Collection `users` (total users at capture: 59). Fields that hold an actual Stripe id:
| users field              | holds                                   | users with it set |
|--------------------------|-----------------------------------------|-------------------|
| stripe_customer_id       | Stripe Customer id (cus_...)            | 6                 |
| stripe_subscription_id   | Stripe Subscription id (sub_...)        | 5                 |
| subscription_package_id  | price lookup_key (NOT a raw price id)   | 6                 |

The app stores NO raw Stripe price id and NO raw product id anywhere - prices are
resolved by lookup_key on each call, so only the lookup_key is persisted
(subscription_package_id). That means after switching accounts the lookup_keys stay
valid (once setup_stripe.py recreates them); only stripe_customer_id and
stripe_subscription_id become stale (they point at sandbox objects and would 404 on
the new account).

Related billing/state fields on `users` (state, not Stripe ids - listed so nothing
is missed during migration):
- subscription_provider: "stripe" = 5 users, "comp" = 19 users (rest null/free)
- subscription_tier non-free: 28 users
- had_paid_plan = true: 6 users
- others set by billing.py: subscription_status, subscription_expires,
  subscription_cancel_at_period_end, subscription_free_until, is_promo, trial_used,
  trial_end, comp_grant_id

Collection `comp_grants`: 19 active grants (complimentary tiers). These have NO
Stripe objects (no customer, no subscription, no card) - they are internal grants
and are account-independent, so they survive the migration untouched. `comp_grant_id`
on users (19 set) points at these, not at Stripe.

Collection `stripe_events`: 1757 docs. This is the inbound webhook event log (stores
Stripe event ids evt_... for idempotency). Entries are tied to the OLD account's
events; they can be left as-is (historical) - they do not need re-linking.

---

## (3) Names of all Stripe-related secrets (names only, no values)

From the secrets store (env_file = backend). All five managed ones currently carry
managed="stripe_sandbox" and are read-only until the sandbox is unlinked.
| secret name            | slots        | managed          |
|------------------------|--------------|------------------|
| STRIPE_ACCOUNT_ID      | live         | stripe_sandbox   |
| STRIPE_MODE            | live         | stripe_sandbox   |
| STRIPE_API_KEY         | test + live  | (not tagged)     |
| STRIPE_PUBLISHABLE_KEY | test + live  | stripe_sandbox   |
| STRIPE_SECRET_KEY      | test + live  | stripe_sandbox   |
| STRIPE_WEBHOOK_SECRET  | test + live  | stripe_sandbox   |

Config env var read by code but NOT a stored secret:
- STRIPE_API_VERSION - unset in env; code pins the default "2024-06-20" for OUTBOUND
  calls (billing.py:22, identity_router.py). Inbound webhook signature verification
  does not depend on it (see STRIPE-ACCOUNT-CHECK-1 section 6).

Code reads STRIPE_SECRET_KEY first, falling back to STRIPE_API_KEY
(billing.py:19, setup_stripe.py:20).

---

## (4) Steps to rebuild the catalog and re-link test users in a different account

Prerequisite (platform UI, user action): unlink the Emergent-managed Stripe sandbox
(Preview -> Manage -> Payments -> Unlink), then Bring-Your-Own-Key so
STRIPE_SECRET_KEY / STRIPE_API_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_ACCOUNT_ID /
STRIPE_WEBHOOK_SECRET become editable and hold HER account's values. Collect keys
via the secure secrets card only (never in chat). Use integration_expert for the
Stripe BYOK playbook before touching any auth/payment code.

1. Rebuild the catalog on the new account:
   - Ensure the new account's STRIPE_SECRET_KEY (sk_test_ for test) is in env, then
     run `cd /app/backend && python setup_stripe.py`. It is idempotent and will
     create the 5 products + 17 prices with the same lookup_keys. Verify output
     lists all 17 prices as [created].
   - If signup promo codes are needed, manually recreate in the new Stripe dashboard:
     a coupon (100% off, duration=repeating, 3 months) and a PromotionCode with the
     customer-facing code the app looks up.

2. Webhook:
   - In the new account's Stripe dashboard create a webhook endpoint pointing at this
     build's `/api/stripe/webhook`, subscribe to checkout.session.completed,
     invoice.paid, and customer.subscription.created/updated/deleted. Paste its
     whsec_ into STRIPE_WEBHOOK_SECRET via the secure card (editable post-unlink).
   - Prefer setting the endpoint's API version to 2024-06-20 to match the code pin
     (see STRIPE-ACCOUNT-CHECK-1 section 6 for the subscription.* direct-parse risk).

3. Re-link test users (the 6 with stripe_customer_id / 5 with stripe_subscription_id):
   - Treat billing as starting clean. The old cus_/sub_ ids are from the sandbox and
     are invalid on the new account. They do NOT need to be migrated - instead each
     test user simply re-subscribes on the new account, which creates a fresh
     customer + subscription; the webhook (billing.apply_subscription_entitlement)
     then rewrites stripe_customer_id, stripe_subscription_id, subscription_tier,
     subscription_expires, etc.
   - Optional hygiene before re-testing: clear the stale ids on test users so a
     Stripe retrieve/portal call does not 404. Suggested one-time read-then-update
     (test accounts only, zero residue), to be run ONLY on explicit Build approval:
     unset stripe_customer_id, stripe_subscription_id, subscription_package_id,
     subscription_provider, subscription_status, subscription_expires, is_promo,
     trial_used, trial_end on the known test users, leaving tier at free.
   - comp_grants users (19) need NO action - internal grants, account-independent.

4. Go-live (publish): the live slot must hold HER sk_live_/pk_live_ and her acct_ id;
   re-run setup_stripe.py against the live key to build the live catalog, create a
   live webhook endpoint, and paste its live whsec_. Confirm live STRIPE_API_KEY
   starts with sk_live_ and the acct_ id is hers before taking real payments.

---

Capture provenance: counts from `db.users` / `db.comp_grants` / `db.stripe_events`
at snapshot time; catalog from constants.py + setup_stripe.py; secret names from the
secrets store metadata. See STRIPE-ACCOUNT-CHECK-1_REPORT.md for account identity,
BYOK behavior, and the webhook API-version analysis.
