> UPDATE (STRIPE-EXPIRY-CHECK-1, later): The claim is no longer hypothetical. Jenn has
> CLAIMED this sandbox into her own Stripe account (acct ending 1jyH, "Sail More Now
> Oct 12 2pm"); ownership is done, but full activation is PENDING a representative
> identity review (sandbox currently paused), and the claimable key shows "expires in
> ~4 days". The claim-vs-Remove-vs-Go-live analysis below still holds. Time-sensitive
> launch detail is in STRIPE-EXPIRY-CHECK-1_REPORT.md and BILLING-PLAN-1 section 4.


# STRIPE-CLAIM-VS-REMOVE-1_REPORT - Claim vs Remove vs Go-live on the Emergent Payments tab

READ-ONLY. Nothing changed, no secrets entered, no buttons clicked, no purchases.
Hyphens only. Each point is tagged [VERIFIED-DOCS] (Emergent Payments playbook /
platform KB / this repo's code) or [INFERRED] (Stripe claimable-sandbox semantics,
cross-referenced with docs.stripe.com/sandboxes/claimable-sandboxes).

Context that reframes everything: this app is on Emergent Payments **Flow A - the
claimable sandbox** (STRIPE_SECRET_KEY = sk_test_ from a managed sandbox, keys tagged
managed=stripe_sandbox). The three buttons Jenn sees (Connect on Stripe / Go to
Stripe / Remove) are the Flow A lifecycle, NOT Bring-Your-Own-Key. [VERIFIED-DOCS]
This means my earlier "unlink then paste your own keys" advice was the wrong path for
her; the correct Emergent path is to CLAIM the sandbox. See section 6 for what
changes in STRIPE-ACCOUNT-CHECK-1.

---

## (1) What does "Connect on Stripe" (claim the sandbox) do?

- It opens Stripe to CLAIM the existing managed sandbox into Jenn's own Stripe login
  (an existing account, or a new one she creates then). It does NOT mint a new empty
  sandbox. [VERIFIED-DOCS: playbook - claim happens via the sandbox onboarding_url;
  FAQ "if they already have a Stripe account, account registration is skipped at
  claim time"; platform KB "claim your Stripe sandbox".]
- The existing sandbox (acct_1UW1tX...) and everything already created inside it -
  the 5 products, 17 prices, the coupon SMNTEST3FREE, the webhook destination and the
  1,757 stored events - stay INTACT and move with the sandbox as it becomes attached
  to Jenn's Stripe account. A claimable sandbox is the same Stripe test account being
  transferred/owned, not recreated. [INFERRED from Stripe claimable-sandbox semantics
  + the playbook anti-pattern "if user wants to change their stripe sandbox ... it
  will require major code changes", which only makes sense if the sandbox persists.]
- Mechanism is Stripe's claimable-sandbox handoff (account ownership claim), not an
  OAuth key paste. KYC on Stripe is required only if she is creating a NEW Stripe
  account; skipped if she claims into an existing one. [VERIFIED-DOCS: playbook FAQ.]
- Non-destructive. Claiming does not wipe or reset the catalog. [INFERRED]

## (2) After claiming, are the five secrets still managed/read-only? Does Emergent keep managing the webhook?

- Yes. The five Stripe secrets (STRIPE_MODE, STRIPE_ACCOUNT_ID, STRIPE_PUBLISHABLE_KEY,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) stay Emergent-managed and READ-ONLY after
  claiming - they show "Managed by Emergent" / "auto-fetched from the linked account",
  and edits are blocked (platform_key_blocked). [VERIFIED-DOCS: platform KB; playbook
  FAQ "User can't edit their Stripe keys - Expected on Flow A - the keys come from the
  claimed sandbox automatically."]
- Emergent keeps auto-provisioning and managing the webhook endpoint + signing secret
  for this build. So Jenn does NOT need to create her own test webhook endpoint, and
  she cannot paste a whsec_ (the card is read-only). A manually created endpoint is
  unnecessary and would in fact fail signature verification because its secret differs
  from the managed one. [VERIFIED-DOCS: playbook A2 preview_webhook_secret is
  auto-injected; KB "preview webhooks ... registered/deregistered by the platform."
  The signature-mismatch consequence is INFERRED, consistent with
  STRIPE-ACCOUNT-CHECK-1 section 4.]
- Net: claiming changes WHO OWNS the sandbox (Jenn), not HOW keys/webhooks are
  delivered (still Emergent-managed). This is the key correction to my earlier BYOK
  advice. [VERIFIED-DOCS]

## (3) What does the 3-dot "Remove" do?

- Remove = detach/unlink the Stripe integration from the app. It retires the preview
  webhooks (deregisters them from Stripe) and severs the platform association. It is
  NOT primarily a "delete all my Stripe data" button. [VERIFIED-DOCS: platform KB.]
- Reversibility: it is NOT cleanly reversible to the same setup. Re-adding Stripe
  afterward MINTS A BRAND-NEW sandbox (empty), which would need the catalog rebuilt
  (setup_stripe.py) and users re-linked. So treat Remove as effectively one-way for
  the current test setup. [VERIFIED-DOCS: KB "re-adding Stripe afterward mints a
  brand-new sandbox."]
- Effect on the claimed Stripe account's data: if the sandbox was already CLAIMED into
  Jenn's account, the sandbox and its products/prices/coupon still live inside HER
  Stripe account after Remove (Remove detaches it from the app; it does not reach into
  her Stripe account to delete it). If it was still UNCLAIMED (Emergent-owned), Remove
  effectively relinquishes it. [INFERRED - the KB describes severing the app
  association, not deleting a user-owned Stripe account. Distinct from the playbook's
  raw DELETE sandbox API (A5), which does destroy products/pricing; the UI "Remove"
  is the unlink, not that DELETE.]
- Test-payment ability after Remove: in PREVIEW the app loses test-payment ability -
  the managed keys are gone from the card and the preview webhook is retired, so
  checkout/entitlement will not work until Stripe is reconnected. If the app were
  already deployed LIVE, the deployed app keeps its existing keys and keeps
  transacting; only the preview linkage is severed. [VERIFIED-DOCS: KB.]
- RECOMMENDATION: Jenn should NOT click Remove. It buys nothing for testing and costs
  her the intact catalog + the claim she may have done.

## (4) What does step 3 ("install the Emergent Payments app in your LIVE account") do?

- It is the go-live handoff: Jenn installs the Emergent Payments app into her ACTIVATED
  (KYC-complete) live Stripe account; Emergent then republishes the site with her LIVE
  keys. No API keys are pasted by her - the install authorizes Emergent to fetch and
  manage her live keys, same managed model as test. [VERIFIED-DOCS: button copy "No
  API keys needed ... We then republish your website"; playbook notes "platform
  auto-switches sandbox keys to live keys on approval ... automatic redeployment with
  live keys", "Once the user publishes ... live keys will automatically be used in
  production. No user actions needed."]
- Mechanism: app-install authorization (Stripe App / Connect-style), not a manual key
  paste. It fills/replaces the LIVE-slot keys with her own live keys. [INFERRED from
  "no API keys needed" + managed-key model; the exact OAuth vs App-install detail is
  not in the KB.]
- Who is charged / paid out: her OWN live Stripe account. Real buyer charges land in
  Jenn's account and pay out to her bank. [VERIFIED-DOCS mechanism: the app selects
  test vs live purely by which key is loaded; the live key is hers.]
- Live webhook + signing secret: Emergent auto-provisions and manages the LIVE webhook
  + whsec_ as part of go-live (same managed mechanism as preview). Jenn does not create
  the live endpoint or paste the live whsec_. [INFERRED from the managed model +
  "no API keys / no user actions"; the KB does not spell out the live webhook step.]
- Catalog (setup_stripe.py): the app install does NOT create her products/prices. The
  5 products + 17 prices must still be created in her LIVE account by running
  setup_stripe.py against the live key (idempotent by lookup_key). [VERIFIED-DOCS:
  playbook A3/A5; also "if user asks to add products ... upon re-deployment the
  products will re-sync."]
- Customer portal: still must be ACTIVATED by Jenn in her LIVE Stripe dashboard
  (Settings -> Billing -> Customer portal). Not auto-created by the app install.
  [VERIFIED-DOCS: BILLING-PLAN-1 G7 + Stripe portal is a per-account dashboard config.]

### Which BILLING-PLAN-1 live steps does step 3 replace or change?
- G5 (run setup_stripe.py in LIVE): UNCHANGED - still required; the app install does
  not build the catalog. [VERIFIED-DOCS]
- G6 (manually add the live webhook endpoint + paste live whsec_ via the secure card):
  REPLACED - Emergent auto-manages the live webhook + signing secret through the app
  install, and the live whsec_ card is read-only (managed). Jenn should NOT hand-create
  the live endpoint or paste a secret. This is the biggest change from the old BYOK
  runbook. [VERIFIED-DOCS that keys/webhook are managed; INFERRED that this fully
  supplants the manual G6 steps.] (Likewise G4's "flip live keys via the card" is
  replaced by the automatic key swap on publish.)
- G8 (retries + payment methods): UNCHANGED - still configured by Jenn in her Stripe
  dashboard; the app install does not set the retry policy or enabled payment methods.
  [VERIFIED-DOCS: these are Stripe dashboard settings.]

## (5) Webhook API version vs the code pin 2024-06-20 - does entitlement still parse?

- The managed/claimed webhook endpoint sends events in the API version Emergent set on
  the endpoint at creation (the account default, observed as 2026-02-25.clover in
  STRIPE-ACCOUNT-CHECK-1), NOT the code pin. Jenn cannot change this herself in the
  managed flow - Emergent owns the endpoint. [VERIFIED: endpoint version observed
  earlier; INFERRED that it is not user-editable under managed.]
- The code pin stripe.api_version = "2024-06-20" (billing.py:22) affects only OUTBOUND
  API calls (and the re-retrieved objects for checkout.session.completed / invoice.paid,
  which the handler fetches via stripe.Subscription.retrieve - payments_router.py:642,
  649, 677 - so those are normalized to 2024-06-20). [VERIFIED-DOCS: code.]
- For customer.subscription.* events the handler parses the webhook object DIRECTLY
  (payments_router.py:637-638 -> apply_subscription_entitlement), so those are shaped
  by the ENDPOINT version. The one field that moved is current_period_end (now on the
  item, not the subscription). The code ALREADY handles this:
  period_ts = sub.get("current_period_end") or item.get("current_period_end") or
  sub.get("trial_end") (billing.py:213-214). status, price.lookup_key, customer,
  metadata are read from stable locations. [VERIFIED-DOCS: code.]
- Conclusion: apply_subscription_entitlement reads the fields correctly, including
  current_period_end, under the newer webhook version because of the item-level
  fallback. Residual risk is low and limited to any other field that might move; it
  cannot be 100% proven without a live subscription.* event. [INFERRED - same residual
  risk noted in STRIPE-ACCOUNT-CHECK-1 section 6, now reduced because the one known
  moved field is handled.] Recommend a real test subscription event (section 6) rather
  than only "Send test webhook".

## (6) Safest path to test the full billing flow tonight/tomorrow - exact click order

Goal: exercise checkout -> entitlement -> portal -> cancel -> payment-failed in TEST
mode without touching anything irreversible. Jenn does NOT need to claim or go live to
test with the 4242 card - the managed test sandbox already works.

Do, in order:
1. Do NOT click "Remove" and do NOT click "Go to Stripe" / Take payments live tonight.
   Both are out of scope for testing (see irreversible flags below).
2. (Optional, safe) "Connect on Stripe" to claim the sandbox into her own Stripe
   account. Safe and non-destructive; the catalog/coupon/webhook stay intact. Only do
   it if she wants ownership now; it is NOT required to run the test. Note the one-way
   caveat: if she later clicks Remove, reconnecting mints a new EMPTY sandbox.
3. Confirm the TEST webhook is delivering to THIS build. In managed mode Emergent
   points it here automatically; verify by checking the Stripe test endpoint's Recent
   deliveries show HTTP 200, or simply proceed to step 4 and confirm the tier flips.
   (If deliveries are failing, that is the thing to fix - see BILLING-PLAN-1 section 1,
   which notes the test webhook may still point at a previous job's preview URL.)
4. In the app, run a real end-to-end upgrade using Stripe test card 4242 4242 4242 4242
   (any future expiry, any CVC) - pick a monthly plan (sailor_premium_1 or
   owner_premium_1, $6.99). This is the single best full-flow test. Confirm: tier flips
   to premium in My plan, welcome email sent, Stripe shows the new customer +
   subscription, and stripe_events logged the event.
5. Customer portal: My plan -> Manage billing. If Stripe says the portal is not
   configured, activate the TEST Customer Portal in the Stripe test dashboard
   (Settings -> Billing -> Customer portal), then retry.
6. Cancel at period end in the portal; confirm My plan shows "cancels on ..." via the
   customer.subscription.updated webhook.
7. (Optional) Payment-failed path: use test card 4000 0000 0000 0341 to confirm the
   invoice.payment_failed email.
8. Cleanup: these are throwaway test accounts/customers; remove any test user created,
   per the zero-residue rule. No live money involved.

Irreversible / republishing steps to flag:
- "Remove" (3-dot): IRREVERSIBLE for the current setup - retires webhooks, severs the
  link, and reconnect mints a new empty sandbox (catalog must be rebuilt). Avoid.
- "Go to Stripe" / Take payments live: REPUBLISHES the site and switches to her LIVE
  account. Not for testing; only when truly going live. Avoid tonight.
- "Connect on Stripe" (claim): safe and non-destructive, but effectively one-way in
  that a later Remove will not restore this same sandbox.

### What changes in STRIPE-ACCOUNT-CHECK-1
- Section (2) CHANGES: that report said unlink the sandbox then paste her own keys
  (BYOK), with her creating her own webhook. The correct Emergent path is to CLAIM the
  sandbox (Connect on Stripe). After claiming, the keys stay Emergent-managed and
  read-only and Emergent keeps auto-managing the webhook - she neither pastes keys nor
  creates a webhook. BYOK is only a fallback if claiming fails.
- Section (5) CHANGES (mechanism, not conclusion): going live is NOT "paste sk_live_
  into the live slot". It is "install the Emergent Payments app in her activated live
  account; Emergent swaps in her live keys and republishes" - no manual key entry, live
  webhook auto-managed. The conclusion is unchanged: real money only reaches Jenn once
  her OWN activated live account is connected, and setup_stripe.py must still build the
  live catalog and she must still activate the live portal.
- Section (1), (3), (4), (6) of that report are unaffected (account identity, catalog
  idempotency, stale cross-account ids, signature independence all still hold).

---

Sources: Emergent Payments / Stripe integration playbook (Flow A claimable sandbox)
and platform KB; this repo (billing.py, routers/payments_router.py, setup_stripe.py,
constants.py); BILLING-PLAN-1 (G5/G6/G8) and STRIPE-ACCOUNT-CHECK-1. Stripe side:
docs.stripe.com/sandboxes/claimable-sandboxes.
