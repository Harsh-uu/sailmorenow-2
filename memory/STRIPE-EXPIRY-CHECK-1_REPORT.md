# STRIPE-EXPIRY-CHECK-1_REPORT - Claimable-sandbox key expiry, the identity pause, and the Nov 3 launch

READ-ONLY. Nothing changed in the app or in Stripe, no clicks, no secrets entered,
no purchases. This report DOES correct stale memory files (see "Corrections" at the
end). Hyphens only. Tags: [VERIFIED-DOCS] = Stripe docs
(docs.stripe.com/sandboxes/claimable-sandboxes) or the Emergent Payments playbook;
[VERIFIED-CODE] = this repo; [INFERRED] = reasoned, not directly confirmable here.

## Corrected baseline (Jenn's Update 1 + Update 2)
- The sandbox the app uses (acct ending 1jyH, titled "Sail More Now Oct 12 2pm") is
  Jenn's OWN Stripe account/environment with her correct business info. It is NOT an
  Emergent-owned or shared account. My earlier STRIPE-ACCOUNT-CHECK-1 claim ("this IS
  an Emergent-managed sandbox, not Jenn's account ... a shared Emergent sandbox") was
  WRONG and is corrected below.
- "Managed by Emergent" is still true in ONE narrow sense: under Emergent Payments
  Flow A (claimable sandbox) Emergent auto-fetches and owns the KEYS (the secrets card
  is read-only). That is key-management, not account-ownership. Account = Jenn's;
  key delivery = Emergent-managed. Both are true at once. [VERIFIED-DOCS: playbook.]
- Her MAIN business Stripe account shows no outstanding requirements. The SANDBOX
  environment (Sail More Now Oct 12) is currently PAUSED for a past-due representative
  identity task, which she submitted and is under review. Her manual test webhook
  endpoint was deleted.

## Key lifecycle facts (foundation for the answers) [VERIFIED-DOCS]
- A claimable sandbox has a 60-day Time-To-Live (expires_at). If it stays UNCLAIMED
  past 60 days Stripe permanently deletes it and all its test data. A reminder email
  goes out 7 days before deletion.
- The CLAIM LINK (onboarding URL) expires after 7 days and is renewable while status
  is unclaimed or claimed.
- Once the user completes the claim flow and the sandbox status reaches the end state
  (claimed/activated, "live"), the TTL sweeper will NOT delete it - the countdown
  stops.

---

## (1) The two keys, which one the app uses, and whether the claim is complete

- The "claimable sandbox" key that "expires in 4 days": this is the temporary,
  claim-window credential tied to the claimable sandbox (the short-lived key/link
  Stripe issues so a platform can operate the sandbox during the claim window). The
  "4 days" is the claim-window/link clock (7-day class), NOT the 60-day sandbox TTL -
  the sandbox was created Oct 12, only ~3 weeks ago, so the 60-day TTL is nowhere near
  4 days. [INFERRED from dates + VERIFIED-DOCS on the 7-day claim-link vs 60-day TTL
  distinction.]
- The "separate secret key with full access": this is the standard sandbox secret key
  that exists because the sandbox is now in Jenn's account. It is the permanent key to
  use once the claim is complete. [INFERRED + VERIFIED-DOCS.]
- Which one the app's STRIPE_SECRET_KEY uses RIGHT NOW: cannot be read here (secret
  value, not printed). It is sk_test_ and Emergent-managed. [VERIFIED earlier: prefix
  + managed tag.] RISK: if the env still holds the EXPIRING claimable key rather than
  the full-access key, the app's test payments break when that key expires in ~4 days.
  If Emergent has already rotated the managed key to the full-access one (its normal
  behavior), the app is safe. This is the single most important thing to confirm.
  [INFERRED - this is why section 3 exists.]
- Is the claim fully complete? Partially. Ownership has transferred (Jenn sees the
  account under her login with her business info = at least "claimed"). But full
  ACTIVATION has NOT completed - the sandbox is paused pending the representative
  identity review, so status has not reached the final activated/"live" state.
  [INFERRED from Update 2 + VERIFIED-DOCS on the status progression.]
- How Jenn verifies the claim/activation state in Stripe:
  - The account no longer shows a "claim this sandbox" banner and appears under her
    own login (ownership done).
  - Settings -> Business/Account status: no "Submit required information" / no
    "payments paused" banner once activation completes.
  - The presence of a full-access secret key (not just the expiring claimable key) is
    the practical signal the sandbox is hers; the DISAPPEARANCE of the "expires in N
    days" claimable key after activation confirms the claim window closed cleanly.
  - Authoritative check (platform side): the sandbox status endpoint reports
    unclaimed -> claimed -> account_activated. Emergent can read this; Jenn sees it as
    the paused banner clearing. [VERIFIED-DOCS: playbook state machine + status endpoint.]

## (2) What happens at expiry

- If the expiring item is the temporary CLAIMABLE key (as reasoned in Q1) and the
  sandbox is already claimed into Jenn's account: the SANDBOX and all its contents -
  the 5 products, 17 prices, coupon SMNTEST3FREE, the managed webhook destination and
  the 1,757 stored events - SURVIVE. They live in her account now and are not deleted
  by the claimable-key expiry. Only the temporary claim credential stops working.
  [INFERRED + VERIFIED-DOCS: TTL deletion applies only to UNCLAIMED sandboxes.]
- App test-payment ability at expiry: survives ONLY IF the app's STRIPE_SECRET_KEY is
  (or is rotated by Emergent to) the full-access key. If the env still points at the
  expiring claimable key, checkout/entitlement will start failing at expiry until the
  key is refreshed. [INFERRED - confirm per section 3.]
- Managed webhook: keeps working. Jenn's manually created endpoint was deleted, which
  is fine - the app relies on the Emergent-managed endpoint + its signing secret, not
  her manual one. The claimable-key expiry does not retire the managed webhook.
  [INFERRED + VERIFIED-DOCS that the managed webhook is platform-provisioned.]
- Live mode / Go live: NOT affected by this test-sandbox expiry. Live is a separate
  step on a live-mode account (install the Emergent Payments app in the live account +
  republish). The expiring TEST claimable key has no bearing on live keys or payouts.
  [VERIFIED-DOCS: test and live are separate; playbook Go-live is independent.]
- Extended or removed once the claim completes: once activation completes (status
  reaches activated/"live"), the TTL/expiry no longer applies and the full-access key
  is the stable credential - effectively the expiry concern is removed, not extended.
  The temporary claimable key is simply superseded. [VERIFIED-DOCS for TTL; INFERRED
  for the temp key superseding.]

## (3) Step still needed before expiry - who, and when vs the Nov 3 evening launch

- Step A - finish activation: clear the past-due representative identity task so the
  sandbox reaches the activated/"live" state. WHO: Jenn already submitted it; it is
  under Stripe review (Stripe's action now). This both stops the TTL clock and
  guarantees the full-access key is the stable one. [VERIFIED-DOCS.]
- Step B - confirm the app's live key source is the full-access key, not the expiring
  claimable key. WHO: Emergent (platform auto-manages/rotates the key); Jenn's part is
  only to confirm in the Payments tab that Stripe still shows as connected. If, after
  the claimable key expires, test payments fail, the fix is for Emergent to re-fetch
  the managed key (reconnect/re-link in the Payments tab). [INFERRED.]
- Timing vs a Nov 3 EVENING launch: the claimable key "expires in ~4 days", which lands
  right around Nov 3-4 - uncomfortably close to launch. Resolve Steps A and B BEFORE
  Nov 3 daytime, not on launch evening, so a key expiry cannot coincide with go-live.
  Do NOT leave the identity review as the only thing standing between now and launch.
  [INFERRED - date math from "Oct 12" + "expires in 4 days" + the stated launch date.]
- Separate but critical: if the Nov 3 launch takes REAL customer money, test mode is
  not enough - Jenn must also complete Go live (install the Emergent Payments app in
  her LIVE account + publish), run setup_stripe.py against the live key for the live
  catalog, and activate the live Customer Portal. The expiring test key does not
  deliver a live launch by itself. [VERIFIED-DOCS: playbook Go-live; BILLING-PLAN-1
  G5/G7.]

## (4) Does the identity-verification pause change any of this / block claim or Go live?

- It does not change the data-survival answers (products/prices/coupon/webhook/events
  are safe regardless). [INFERRED.]
- It DOES hold the sandbox short of full activation: while paused for the
  representative identity task, status cannot reach the activated/"live" end state, so
  (a) the TTL-stop guarantee is not yet in force and (b) the claim is not "fully
  complete". Clearing the review is what finalizes the claim. [VERIFIED-DOCS: status
  must reach the end state; INFERRED mapping to this pause.]
- Could it block Go live? Go live needs an ACTIVATED account with no outstanding
  requirements. Jenn's MAIN account has none, but this is about which account the live
  install authorizes. If the paused environment is tied to the account/org being taken
  live, the identity pause would block live activation until cleared. Her main account
  being clean is encouraging, but the representative-identity task on this specific
  account must clear before relying on live. Confirm with Stripe/Emergent that the
  account going live is the verified one. [INFERRED - account-vs-sandbox relationship
  is not confirmable from here.]
- Net: the identity review is the gating item. It cannot block data survival, but it
  can delay a clean claim-complete state and, potentially, Go live. Treat the review
  outcome as a launch dependency. [INFERRED.]

## (5) Unsafe / time-sensitive items - added to BILLING-PLAN-1
A new section "4) TIME-SENSITIVE (STRIPE-EXPIRY-CHECK-1)" has been appended to
/app/memory/BILLING-PLAN-1.md capturing: the ~4-day claimable-key expiry vs the Nov 3
launch, the identity-review dependency, confirm-the-key-source step, and the
do-not-click-Remove / do-not-Go-live-on-launch-evening cautions.

---

## Corrections made to stale memory files (per Update 1)
- STRIPE-ACCOUNT-CHECK-1_REPORT.md: added a top CORRECTION banner and rewrote the
  false "this IS an Emergent-managed sandbox, not Jenn's account / shared Emergent
  sandbox" lines to state the account is Jenn's own claimable sandbox (keys still
  Emergent-managed). Its sections 2-5 BYOK/"different account" framing is superseded
  by the banner (claim flow, not BYOK; same account, not a different one).
- STRIPE-SNAPSHOT-1.md: added a top CORRECTION banner - there is no "switch to a
  different (Jenn's own) account"; the sandbox is already hers, so the catalog does
  NOT need rebuilding and customers do NOT need re-linking for a move. The snapshot's
  catalog/field/secret inventory stays valid; only the "migration to a different
  account" premise is retracted.
- STRIPE-CLAIM-VS-REMOVE-1_REPORT.md: added a top note - the claim is no longer
  hypothetical; it is in progress (ownership done, activation pending the identity
  review). Its claim-vs-remove-vs-go-live analysis stands.
- (No changes needed to PRD.md, PUBLISH-0_REPORT.md, or the BILLING-PLAN-1 body - their
  "Emergent-managed" references are to email/Google/managed config, not the Stripe
  account ownership.)

Sources: docs.stripe.com/sandboxes/claimable-sandboxes (60-day TTL, 7-day claim-link,
status-reaches-live stops TTL, 7-day reminder email); Emergent Payments / Stripe Flow A
playbook (claimable-sandbox state machine, managed keys/webhook); this repo
(billing.py, payments_router.py, setup_stripe.py); STRIPE-ACCOUNT-CHECK-1,
STRIPE-SNAPSHOT-1, STRIPE-CLAIM-VS-REMOVE-1, BILLING-PLAN-1.
