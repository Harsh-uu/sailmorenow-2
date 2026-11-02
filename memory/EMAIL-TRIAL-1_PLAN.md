# EMAIL-TRIAL-1 - PLAN (no code until Jenn approves)

Goal: add a visible "free trial" notice plus a short "manage your plan" section to
the welcome emails, shown ONLY when the admin trial setting is on, using the
current number of trial days. No em-dashes (hyphens only).

--------------------------------------------------------------------------------
## STATUS: ON HOLD - do not build yet (blocked by FREE-TIER-PLAN-1)
Jenn approved the direction with changes, but build is paused until the free-tier
plan is settled. Reason: free members will soon be able to POST, COMMENT and
REACT, so the trial pitch and the comparison tables change. Build only after
FREE-TIER-PLAN-1 lands and the on-site comparison tables are updated for the new
free tier.

### Decisions resolved (Jenn)
- D1: Not yet - changes first (this hold). Trial copy will change once free members
  can post/comment/react.
- D2 (Organization welcome): OMIT the trial block. Instead explain the Community
  Partner and Founding Partner process and say Jenn works with each organization
  individually.
- D3 (Sailor / Owner / Boat Pro): REPLACE the main trial button with a "Manage your
  plan" button, using this exact line: "Whether you've joined for free, have
  started your free trial or are ready to upgrade, manage your plan easily from
  here."
- D4 (Paid welcome AND Community-Partner welcome): BOTH also get the tier table,
  the steps to upgrade or apply, and a link to contact Jenn directly.
- Tier tables in EVERY sign-up welcome: Sailor and Owner -> Free vs Premium; Boat
  Pro -> Basic, Featured, Premium; Organizations -> Free vs Community or Founding
  Partner. Reuse the comparison tables already built on the site, once those are
  updated for the new free tier.
- Mobile wording: plans can be managed from mobile once the app is available for
  download (see section 5; revisit when mobile payment handling arrives).

--------------------------------------------------------------------------------
## 1) Every welcome email and role we have today
Three distinct welcome emails exist:

A. SIGN-UP welcome - `welcome_member_email_html` (mailer.py:907). Loads one of
   four authored HTML templates by `account_type` and fills `{{...}}` tokens:
   - Sailor            -> email_templates/welcome-sailor.html
   - Boat Owner        -> email_templates/welcome-boat-owner.html
   - Boat Pro          -> email_templates/welcome-boat-pro.html
   - Organization/Partner -> email_templates/welcome-club-org.html
   Sent from auth_router.py:303 (email/password register) and auth_router.py:891
   (Google onboarding finish). Recipients are brand-new, usually FREE members.

B. PAID welcome - `billing_welcome_email_html` (mailer.py:426). Sent by the Stripe
   webhook `_maybe_welcome` (payments_router.py:660) when a subscription becomes
   active/trialing. Recipient has just subscribed.

C. COMMUNITY PARTNER welcome - `community_partner_welcome_email_html`
   (mailer.py:819). Sent by admin when activating a partner (admin_router.py:693).
   Organizations only.

Roles (account_type) at sign-up: `sailor`, `boat_owner`, `boat_pro`, `partner`
(organization). All four map to A above.

--------------------------------------------------------------------------------
## 2) Where the block goes in each email
Every A-template already has a "A quick note on plans" section (the "Plans +
support" block, e.g. welcome-sailor.html line 71-73). Proposal: insert a new,
self-contained TRIAL block immediately BEFORE that "quick note on plans" section,
wrapped in strip sentinels so it can be removed cleanly when the trial is off:
    <!--TRIAL_BLOCK_START--> ... <!--TRIAL_BLOCK_END-->
This mirrors the existing `<!--STORE_ROW_START-->/<!--STORE_ROW_END-->` pattern
already handled in `welcome_member_email_html` (strip_between + sentinel cleanup).

- welcome-sailor.html, welcome-boat-owner.html, welcome-boat-pro.html: add the
  TRIAL block (role copy in section 6).
- welcome-club-org.html: NO trial block (see section 4). Optionally reword its one
  plans line to say the plan is managed by our team.
- B (paid welcome) and C (partner welcome): no trial OFFER block (section 4).

--------------------------------------------------------------------------------
## 3) How the email reads the trial setting at send time
`billing.py:35 trial_settings()` (async) returns `{trial_enabled, trial_days}`
from a settings doc, falling back to env `TRIAL_ENABLED` / `TRIAL_DAYS`. The admin
screen writes it via POST /admin/billing/trial (payments_router.py:612).

`welcome_member_email_html` is currently SYNC and does not touch the DB. Smallest-
change proposal: keep the builder sync and add two params,
`trial_enabled: bool` and `trial_days: int`. Each caller (auth_router.py:303 and
:891, both already async) does `s = await trial_settings()` and passes
`trial_enabled=s["trial_enabled"], trial_days=s["trial_days"]`. The builder shows
or strips the TRIAL block based on `trial_enabled` and substitutes
`{{TRIAL_DAYS}}` (with correct "day"/"days" plural).

What happens to emails already sent if the setting changes: nothing. Every email
is a static HTML snapshot captured at send time. If the trial is later turned off
or the days changed, previously delivered emails keep whatever they showed; only
NEW sends reflect the new setting. (No scheduled re-send, no stored template that
recomputes.)

--------------------------------------------------------------------------------
## 4) Which roles get it (UPDATED per Jenn)
Every sign-up welcome now carries a TIER TABLE (reusing the site comparison
tables once updated for the new free tier), and the main action is "Manage your
plan" rather than a trial button.
- Sailor and Boat Owner: tier table Free vs Premium + "Manage your plan" button
  and line (section 6). Trial notice shown when the admin trial is on, with final
  wording pending FREE-TIER-PLAN-1.
- Boat Pro (all tiers): tier table Basic / Featured / Premium + "Manage your plan"
  button and line. Trial notice when on, wording pending.
- Organization / Partner: NO trial block. Instead, copy explaining the Community
  Partner and Founding Partner process and that Jenn works with each organization
  individually, plus the Free vs Community/Founding tier table.
- Paid welcome (B, Stripe): NOW IN SCOPE. Add the tier table, steps to upgrade or
  apply, and a link to contact Jenn directly.
- Community Partner welcome (C, admin): NOW IN SCOPE. Add the tier table (Free vs
  Community/Founding), steps to apply, and a link to contact Jenn directly.

--------------------------------------------------------------------------------
## 5) Where "manage your plan" points, and mobile wording
Links (built from `app_public_url()` = APP_PUBLIC_URL or https://app.sailmorenow.com):
- Start / choose a plan: `{{PRICING_URL}}` = `<base>/pricing` (public page; this is
  where a free user starts the trial at checkout).
- Manage your plan: `{{MANAGE_PLAN_URL}}` = `<base>/my-plan` (the "Your plan" page,
  auth-gated). That page is where the user opens the Stripe Customer Portal (card,
  invoices, cancel) via POST /payments/portal, and compares/switches plans.
  NOTE: we cannot deep-link the Customer Portal directly from an email (it needs a
  logged-in POST to create a portal session), so the email links to Your plan,
  which has the "Manage billing" button to the portal.
- A brand-new free user has no subscription yet, so the primary CTA is "Start your
  free trial" -> /pricing; "Manage your plan" -> /my-plan is the secondary line for
  once they subscribe.

Mobile wording (UPDATED per Jenn): the welcome email is the same for web and
mobile sign-ups and always links to the website. Use this line: "Plans can be
managed from mobile once the app is available for download." REVISIT this wording
when mobile payment handling arrives (see the note at the end of this file).

--------------------------------------------------------------------------------
## 6) Draft copy for each variant (UPDATED per Jenn; hyphens only, no em-dashes)
Tokens: {{TRIAL_DAYS}} = current number; {{PRICING_URL}}, {{MANAGE_PLAN_URL}} as above.
NOTE: any trial-notice sentence below is PENDING FREE-TIER-PLAN-1 (free members
will post/comment/react, which changes the pitch). The "Manage your plan" button,
its line, and the tier tables are settled.

Shared button + line for Sailor, Owner and Boat Pro (replaces the old trial button):
  Button: Manage your plan  ->  {{MANAGE_PLAN_URL}}
  Line: Whether you've joined for free, have started your free trial or are ready
  to upgrade, manage your plan easily from here.
  Mobile line: Plans can be managed from mobile once the app is available for
  download.

### Sailor and Boat Owner
- Tier table: Free vs Premium (reuse the site comparison table once updated).
- Optional trial notice when admin trial is on (wording PENDING): "Try Premium
  free for {{TRIAL_DAYS}} days."
- Manage-your-plan button + line (shared block above).

### Boat Pro
- Tier table: Basic / Featured / Premium (reuse the site comparison table).
- Optional trial notice when on (wording PENDING): "Try your Boat Pro plan free
  for {{TRIAL_DAYS}} days."
- Manage-your-plan button + line (shared block above).

### Organization / Partner (no trial block)
- Tier table: Free vs Community vs Founding Partner.
- Process copy (draft): "Community Partner and Founding Partner spots are set up
  with you directly. Jenn works with each organization individually to choose the
  right fit and get you set up. To start or ask a question, contact Jenn." with a
  link to contact Jenn directly.

### Paid welcome (B) and Community-Partner welcome (C)
- Both get the role-appropriate tier table, the steps to upgrade or apply, and a
  link to contact Jenn directly. (B uses the subscriber's role table; C uses the
  org Free vs Community/Founding table.)

### When the trial is OFF (all roles)
The trial notice sentence is removed; the tier table, the "Manage your plan"
button and line remain.

--------------------------------------------------------------------------------
## 7) Files/templates to change, risks, and test plan
Files (for the future BUILD, not changed now):
- backend/mailer.py - `welcome_member_email_html`: add `trial_enabled` and
  `trial_days` params; strip `<!--TRIAL_BLOCK_START/END-->` when off; substitute
  {{TRIAL_DAYS}} (with day/days plural), {{PRICING_URL}}, {{MANAGE_PLAN_URL}}; add
  TRIAL sentinels to the leftover-comment cleanup regex. (A small helper can build
  the day/days string.)
- backend/email_templates/welcome-sailor.html, welcome-boat-owner.html,
  welcome-boat-pro.html - add the TRIAL block markup (table-based, inline styles,
  same navy/teal palette, button style copied from the existing CTA).
- backend/email_templates/welcome-club-org.html - no trial block; optional one-line
  copy change only if Jenn wants the "managed by our team" line.
- backend/routers/auth_router.py - both welcome call sites (~303 and ~891): add
  `s = await trial_settings()` and pass the two values into the builder. (Import
  `trial_settings` from billing.)
- No change recommended was REVERSED per Jenn D4: payments_router `_maybe_welcome`
  / `billing_welcome_email_html` (B) and the admin `community_partner_welcome_email_html`
  (C) are now IN SCOPE - add the role-appropriate tier table, upgrade/apply steps
  and a "contact Jenn directly" link to both.
- Tier tables: reuse the on-site comparison content. The site table lives in
  `frontend/src/components/PlanComparison.jsx`, driven by plan/tier data in
  `backend/constants.py`. Emails cannot render the React component, so the build
  must reproduce the SAME tier/feature content as email-safe table HTML (inline
  styles) sourced from the same data, and keep it in sync. Do this only AFTER the
  comparison tables are updated for the new free tier (FREE-TIER-PLAN-1).
- "Contact Jenn directly" link: confirm the exact address/route during build
  (likely a mailto to Jenn or a contact page); used in the org, paid and partner
  emails.

Risks:
- Sync builder vs async setting: resolved by reading `trial_settings()` in the
  (already async) callers and passing values in. Low risk.
- Email-client rendering: keep the block table-based with inline styles and the
  existing button pattern so Outlook/Gmail render it; no flexbox, no web CSS.
- Placeholder/sentinel leak: must add TRIAL sentinels to the cleanup regex so no
  stray comments or `{{TRIAL_DAYS}}` ship if a branch is missed.
- Org path: make sure the Organization template never shows the block.
- Price drift: keep copy price-free ("free trial", "see plans"); do not hardcode
  dollar amounts (prices live in constants / Pricing page).
- Days wording: handle "1 day" vs "{{TRIAL_DAYS}} days".
- Em-dashes: all new copy uses hyphens only.

Test plan (emails only to jenn@sailmorenow.com; this task sends NOTHING):
1. Set the admin trial setting on with TRIAL_DAYS = 30 (POST /admin/billing/trial),
   then also test off and a different day count (for example 14).
2. Offline render check first (no send): a throwaway script calls
   `welcome_member_email_html(account_type=..., trial_enabled=..., trial_days=...)`
   for sailor, boat_owner, boat_pro and org, writing each to /tmp/*.html to eyeball
   that the block appears with the right days and links when on, is absent when off,
   and never appears for org.
3. Live check to Jenn only: register a temp account using jenn+trialtest@
   sailmorenow.com (plus-addressing delivers to Jenn's inbox) so the real
   register -> welcome path sends ONLY to Jenn; confirm the block, the {{TRIAL_DAYS}}
   value, and that the Your plan / pricing links resolve. Repeat with the setting
   off to confirm the block is gone.
4. Clean up: delete the temp account(s) with zero residue (users, signup_events,
   user_sessions, zoho_outbox), as in prior tasks.
5. No testing agent; verification is manual render + a single Jenn-only send.

--------------------------------------------------------------------------------
## Decisions - RESOLVED (see STATUS block at top)
D1 hold / D2 org process copy / D3 Manage-your-plan button + line / D4 paid and
partner welcomes in scope - all answered by Jenn and captured above. Remaining
open item is only the trial-notice wording, which depends on FREE-TIER-PLAN-1.

--------------------------------------------------------------------------------
## REVISIT LATER - mobile payment handling
The welcome emails currently say "Plans can be managed from mobile once the app is
available for download," and link plan management to the website. When mobile
payment handling arrives (in-app subscribe/manage), REVISIT this line and the
link so the email points mobile users to the correct in-app path. Tracked here so
it is not forgotten.

## BLOCKED BY
FREE-TIER-PLAN-1 - free members gaining post/comment/react changes both the trial
pitch and the Free-tier column of every comparison table. Do not build EMAIL-TRIAL-1
until that is settled and the on-site comparison tables are updated.
