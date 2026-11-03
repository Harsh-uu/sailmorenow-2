# STRIPE-ACCOUNT-CHECK-1 - Is this Jenn's Stripe account? What changes if she connects her own?
READ-ONLY. Nothing changed, no secrets entered, no purchases. Hyphens only.
Only non-secret values shown (account id + first 8 chars of key prefixes).

## (1) Account identity and key prefixes - VERIFIED (in code / env + secrets metadata)
- STRIPE_ACCOUNT_ID: acct_1UW1tXDP0Tnx1jyH
- STRIPE_MODE: test
- STRIPE_API_KEY: prefix sk_test_
- STRIPE_SECRET_KEY: prefix sk_test_
- STRIPE_PUBLISHABLE_KEY: prefix pk_test_
- STRIPE_WEBHOOK_SECRET: prefix whsec_Pv
- STRIPE_API_VERSION: unset (code uses its default pin, see 6)
This IS an Emergent-managed TEST sandbox, not Jenn's account. VERIFIED: in the
secrets list STRIPE_ACCOUNT_ID, STRIPE_MODE, STRIPE_PUBLISHABLE_KEY,
STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET all carry "managed":"stripe_sandbox",
and the card is read-only ("Keys are auto-fetched from Stripe"). The sk_test_
prefix plus the managed tag confirm a managed sandbox. Jenn's observation that the
business name/address are not hers is consistent with a shared Emergent sandbox.

## (2) What connecting HER OWN account (Payments tab / BYOK) changes - INFERRED
(platform behavior, inferred from the secrets slot metadata + the managed-key note;
the exact UI is a platform feature, not in this repo)
- Secrets that change to HER values: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY,
  STRIPE_API_KEY, STRIPE_ACCOUNT_ID and STRIPE_WEBHOOK_SECRET. Today all five are
  managed/read-only; after unlinking the sandbox and doing Bring-Your-Own-Key they
  become HER keys and editable.
- Test vs live slots - PARTLY VERIFIED: the secrets list shows STRIPE_API_KEY,
  STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET with
  env_mode "separate" and BOTH a "test" and a "live" slot - so test and live keys
  are stored separately. STRIPE_ACCOUNT_ID and STRIPE_MODE are env_mode "shared"
  (single slot). INFERRED: test and live are therefore separate connections/values;
  connecting test does not fill live and vice versa.
- Webhook in BYOK - INFERRED: the managed auto-fetch of the webhook secret stops.
  Jenn creates her OWN webhook destination in HER Stripe dashboard (pointing at
  this build's /api/stripe/webhook) and its whsec_ reaches the app by her pasting
  it into STRIPE_WEBHOOK_SECRET in the secure card, which is editable once the key
  is no longer managed. (Contrast: in the managed sandbox she cannot paste it.)

## (3) What must be re-run for her account after connecting - VERIFIED + INFERRED
- setup_stripe.py: MUST be re-run against her account. VERIFIED it is idempotent by
  stable lookup_key (creates 5 products + prices, skips if the lookup_key exists).
  Her fresh account has none of these, so it will create them once. No code change;
  lookup_keys are identical.
- Existing test customers and subscriptions - INFERRED: they live inside the
  managed sandbox account (acct_1UW1tX...), which is a DIFFERENT Stripe account from
  hers. Stripe accounts are isolated, so none of those customers/subscriptions
  exist in her account. VERIFIED in code that the app stores users.stripe_customer_id
  and subscription ids; those stored ids point at sandbox objects and become STALE
  after switching accounts (a portal/retrieve for them would 404 in her account).
  Practical effect: any test accounts that "had" a subscription in the sandbox must
  re-subscribe in her account; billing should be treated as starting clean.

## (4) Option B - create the webhook inside the Emergent sandbox instead - INFERRED
- Jenn cannot set a webhook secret inside the managed sandbox herself (the secret is
  managed/read-only). But the sandbox ALREADY auto-provisions a webhook + secret to
  this build (that is the whsec_Pv... currently in the env), so "Option B" really
  means: just USE the managed sandbox as-is for TEST - no manual endpoint needed,
  and a manually-created endpoint would fail signature verification because its
  secret differs from the managed one.
- What would NOT carry over to live: everything in the sandbox. The sandbox is
  Emergent's test account; it cannot take real money and is not Jenn's business.
  Going live requires HER account, so the sandbox's account, customers, products,
  prices and webhook do NOT carry to live. Option B is fine ONLY to finish the
  test-mode exercise; it is a dead end for real revenue.

## (5) LIVE on publish - who is charged and paid out - INFERRED (+ VERIFIED mechanism)
- VERIFIED mechanism: the app selects test vs live purely by which secret key is
  loaded (sk_live_* = live). So whoever owns the key in the LIVE slot is the account
  that gets charged and paid out.
- INFERRED/REQUIRED: for real money to reach JENN, the live slot must hold HER OWN
  live keys (sk_live_/pk_live_ from her activated account) and HER acct_ id. If the
  app is published while the live slot still points at an Emergent sandbox, either
  no real charges are possible (sandboxes cannot process live payments) or funds
  would not land in her bank - so she MUST connect her own account before live.
- Same Payments-tab connection: INFERRED yes - the same BYOK connection fills the
  live slot with her live keys (test and live are separate slots on that one
  connection). CANNOT VERIFY the current live-slot VALUES from here (they are
  secret and must not be printed); confirm after connecting that the live
  STRIPE_API_KEY starts with sk_live_ and the live acct_ id is hers.

## (6) Does the webhook handler depend on API version? - VERIFIED
- Signature check does NOT depend on API version. VERIFIED: the handler calls
  stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
  (payments_router.py:698); it verifies the signature with the signing secret only.
  An endpoint on 2026-02-25.clover verifies fine as long as the secret matches.
- The code pin stripe.api_version = "2024-06-20" (billing.py:22,
  identity_router.py:20; STRIPE_API_VERSION unset so the default applies) affects
  OUTBOUND API calls, not inbound webhook parsing. VERIFIED: the handler sets no
  api_version (grep "api_version" in payments_router.py = none).
- Payload-shape nuance - VERIFIED code paths, INFERRED risk: for
  checkout.session.completed and invoice.paid the handler RE-RETRIEVES the
  subscription via stripe.Subscription.retrieve (payments_router.py:642,649,677),
  so those are processed in the pinned 2024-06-20 shape regardless of the endpoint
  version. BUT for customer.subscription.created/updated/deleted the handler reads
  the webhook payload object DIRECTLY (line 636-640 -> apply_subscription_entitlement
  on obj), and that object is shaped by the ENDPOINT's version (2026-02-25.clover),
  which is much newer than the code expects. INFERRED RISK: if any field
  apply_subscription_entitlement reads (for example subscription status or the
  period-end / price location) moved between 2024-06-20 and 2026-02-25.clover, those
  direct-parse events could mis-process. This is the one place a version mismatch
  could matter; it cannot be confirmed without a real test event. RECOMMENDATION
  (report only, no change made): when testing, prefer a webhook endpoint API
  version matching the code pin (2024-06-20), or confirm the subscription.* events
  process correctly, before relying on them.

## Verified vs inferred - quick key
- VERIFIED (code/env/secrets metadata): 1 (identity + prefixes + managed flag);
  3 (setup_stripe idempotency, stored stripe ids); 6 (signature independence, the
  api_version pin, retrieve-vs-direct code paths); the test/live separate-slot fact
  in 2.
- INFERRED (platform behavior / cross-account isolation, not in this repo): the
  BYOK key swap and webhook flow in 2; the sandbox-vs-her-account isolation in 3
  and 4; who is charged/paid and the live-slot ownership in 5; the field-shape risk
  in 6.
- CANNOT VERIFY from here: the actual VALUES in the live slots (secret, not
  printed) - confirm after connecting that live keys are sk_live_/pk_live_ and the
  acct_ id is hers.
