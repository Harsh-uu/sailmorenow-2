# BILLING-2 Report: wire plan switching, cleanup, test clocks, dunning, security

Date: 2026-10-30
Build stamp: BILL1-2026.10 -> BILL2-2026.10
Mode: Stripe TEST (claimable sandbox, now claimed by Jenn). No em-dashes.
testing_agent NOT used (forbidden). All temp data (Stripe test customers, test
clocks, temp DB users/sessions) created for this work has been deleted; sandbox
and DB verified clean at the end (0 test customers, 0 test clocks, 0 bill2_* users).

Legend: [BROWSER] = verified in a real browser. [STRIPE] = verified against real
Stripe objects via test clocks. [CODE] = code-verified only (compiles/renders,
not clicked through live).

## 1. Wire plan switching (backend guard + web + mobile)
Rule for an existing subscriber (active / trialing / past_due):
- Higher tier than current -> UPGRADE: immediate, `proration_behavior=always_invoice`,
  charged the prorated difference today (`/payments/subscription/upgrade`).
- Lower tier, or same tier with any term change -> DOWNGRADE/term change: scheduled
  at period end via a Stripe Subscription Schedule, no charge now
  (`/payments/subscription/change`). Sailors/owners have one paid tier, so all their
  switches are same-tier term changes = scheduled.

Backend (`routers/payments_router.py`):
- NEW hard guard in `/payments/checkout`: if `_subscription_is_live(u)` it returns
  HTTP 409 and refuses to open Checkout. A second Stripe subscription can no longer
  be created for an account from the API, independent of the UI. [STRIPE-adjacent/CODE]
- NEW `POST /payments/subscription/preview`: returns `{kind, amount_today, currency,
  effective_at, to_tier, to_label, interval_months}` for the confirm step. Upgrade
  amount comes from `stripe.Invoice.create_preview(..., always_invoice)`. [STRIPE]
- `/upgrade` and `/change` now validate account-type/audience, require a live sub, and
  reject switching to the same package. [STRIPE]
- `/payments/subscription` now also returns `package_id` so the client can tell the
  current plan from a term change.

Web (`frontend/src/pages/Pricing.jsx`):
- Fetches `/payments/subscription`. For a live subscriber the primary button becomes
  "Change my plan"; selecting the exact current package shows "Current plan - manage".
- `doSwitch()` calls preview, shows a confirm dialog that states either the amount
  charged today (upgrade) or the effective date with "No charge today" (downgrade),
  then calls `/upgrade` or `/change` and routes to /my-plan. New Checkout is used only
  for users with NO live subscription. [BROWSER] button renders "Change my plan" for a
  Premium subscriber on a different term; [CODE] confirm dialog + redirect.
- My Plan "Upgrade"/"Change plan" already link to /pricing, which now does the switch.

Mobile: stays read-only; no purchase flow (see section 2).

## 2. Cleanup
- Removed `will_queue` / `queue_message` from `mobile/app/pricing.tsx` (the only place
  those existed in client code). [BROWSER] confirmed gone.
- Mobile pricing is now read-only: removed the Stripe Checkout button, the
  WebBrowser/open + status polling, the payment/success navigation, and the legacy
  "Plans stack" note. It shows plan info plus a "See full plan details" link to My Plan
  and a note that subscriptions are purchased and managed on the website; "Continue with
  free" is kept for the signup flow. Test-mode banner no longer shows the card number
  (you cannot pay on mobile). [BROWSER]
- NOTE: new Boat Pro/sailor signups on MOBILE can no longer pay in-app; they are told to
  subscribe on the website. Native in-app purchase is the future path (IAP-0).
- Deeper legacy `queued_plans` reads still exist in backend `deps.py`, `scheduler.py`
  and `directory_router.py`. They are harmless against the new data (fields are simply
  absent) and were left untouched to avoid scope creep; flagged for a later cleanup.

## 3. Test clocks (TEST mode) - results with amounts
All run with real Stripe test clocks + test cards, temp customers, then deleted.
Entitlement verified by invoking the exact webhook handler
`billing.apply_subscription_entitlement` against the real Stripe objects and reading
the resulting users doc.

| # | Scenario | Result | Amounts / detail |
|---|----------|--------|------------------|
| S1 | Trial -> first charge (Sailor Premium monthly, 30-day trial) | PASS | trialing while in trial; after +31d status=active, first charge $6.99, tier=premium |
| S2 | 3-day trial-ending reminder, once only | PASS | run1 selects 1 user + sends 1; sets `trial_reminder_sent`; run2 selects 0 + sends 0 (recorded, not delivered, to avoid touching the real account) |
| S3 | Monthly renewal | PASS | next period charged $6.99, status stays active |
| S4 | Upgrade WITH term change (Boat Pro Featured monthly -> Premium 12mo), ~20 days left | PASS | preview_today=$266.47 EXACTLY matched charged_today=$266.47; new tier=premium, package=pro_premium_12 |
| S5 | Downgrade at period end (Boat Pro Premium 1mo -> Basic 1mo) | PASS | no charge at schedule time; at period end flipped to tier=basic/pro_basic_1 and charged $12.99 for the new term |
| S6 | Cancel at period end -> free | PASS | kept Premium until period end; after period end status=canceled, tier=free |
| S7 | Resume | PASS | cancel_at_period_end True -> False, stays Premium/active |
| S8 | Failed payment -> past_due -> retries -> exhausted | PASS (see note) | renewal charge failed -> status=past_due, access KEPT (tier=premium) through +5d and +10d; at ~+16d status=canceled, tier=free |

Could-not-test / caveats:
- Live webhook DELIVERY was not exercised (the public Stripe->backend webhook endpoint
  is registered per environment). These tests validate our handler logic against real
  Stripe objects; registering + confirming the live webhook is a go-live item.
- S8's exact exhaustion timing (16 days here) is governed by the sandbox's current
  dunning setting; the 2-week/cancel policy is configured in section 4.

## 4. Failed-payment window (Smart Retries, 2 weeks, cancel when exhausted)
There is NO public Stripe API to set the retry schedule or the final action; it is a
Dashboard-only, account-wide setting. Exact TEST-mode clicks (Jenn to do):
1. Dashboard, confirm the TEST toggle is ON.
2. Settings (gear) -> Billing -> Revenue recovery -> Retries.
   (Older layout: Settings -> Billing -> Subscriptions and emails -> Manage failed payments.)
3. Retry schedule: enable Smart Retries (spreads attempts intelligently over up to ~2
   weeks). If a strict 14-day window is required, choose a Custom schedule with attempts
   at roughly day 1, day 7 and day 14.
4. Under "If all retries for a payment fail" / "Subscription status": choose
   "Cancel the subscription".
5. Save. (Applies account-wide; existing subs re-evaluate on their next failure.)

LIVE-mode equivalent (added to the go-live list):
- Repeat steps 2-5 with the Dashboard TEST toggle OFF (Live). Confirm the same
  Smart-Retries/2-week schedule and "Cancel the subscription" on exhaustion, because
  retry settings are per-mode and do NOT carry over from test to live.
Our code already handles the outcome: past_due keeps access (entitled), and on
canceled/unpaid `apply_subscription_entitlement` drops the member to free (proven by S6
and S8).

## 5. Security question (report only; nothing changed)
Admin accounts (admin = `platform_role == "admin"` OR email in env `ADMIN_EMAILS`;
`ADMIN_EMAILS = jenn@sailmorenow.com`):
- jenn@sailmorenow.com (platform_role=admin): password login = YES (a `password_hash`
  is stored). Google sign-in linked = NO (no `google_id`). So the admin is currently
  password-based, tied to her email, NOT Google-only.
- No other admin accounts exist (total admin accounts = 1).

To make admin sign-in Google-only (remove password login):
1. First LINK a Google identity to the admin account (have Jenn sign in with Google
   using jenn@sailmorenow.com so a `google_id`/sub is stored) and confirm Google login
   still grants admin. `is_admin()` keys off `platform_role`/`ADMIN_EMAILS` and is
   independent of the sign-in method, so admin rights are preserved.
2. THEN unset `password_hash` on all admin accounts so password login is impossible.
3. Harden auth so password login and password-reset cannot (re)create a password for an
   admin account. This is an authentication change and MUST be built via the
   integration_expert playbook, not ad hoc.
4. Keep a recovery/break-glass path (e.g. a second linked Google account) so a Google
   outage cannot lock all admins out.
Critical ordering caveat: do NOT remove the password hash before Google is linked and
verified, or the admin will be locked out.

Files in /app that contain a real account password or hash (values NOT printed here):
- PLAINTEXT real admin password: `/app/memory/test_credentials.md` (holds the
  jenn@sailmorenow.com password in clear text; this file is intentionally read by
  testing/fork agents).
- Password HASHES (bcrypt, not reversible) for real accounts, in DB backups:
  `/app/backend/migration_backups/users_before_org_status_20261012_054317.json` and
  `/app/backend/migration_backups/cleanup_backup_20261012_211128/users.json`.
- Test scripts `/app/backend/tests/test_iter*.py` hardcode passwords for THROWAWAY test
  accounts they create (*.dev / test domains), not real or admin accounts.
Recommendations (not done): if the plaintext in test_credentials.md is unacceptable,
replace it with a reference and rotate the admin password; move the migration_backups
(with hashes) out of the repo or restrict access.

## 6. Housekeeping
- All test emails policy honored: no real email was delivered during this work (the
  trial reminder was recorded via a temporary stub, not sent). Real Resend delivery was
  already proven in BILLING-1.
- Build stamp bumped to BILL2-2026.10.
- Go-live checklist from BILLING-1 report section 7 still applies, PLUS: the wiring gap
  from BILLING-1 2e is now CLOSED, and the dunning live-mode steps in section 4 above are
  added to it.
