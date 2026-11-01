# EMAIL-FIX-3 Report

Date: 2026-06 (build stamp `EF3-2026.06`)
Scope: backend `mailer.py`, contact endpoints, dispute paths, welcome + reset
templates. No email-provider change. No billing/scraper/mobile-screen changes.
Real test emails sent to jenn@sailmorenow.com ONLY.

---

## 1. Duplicate contact email - FIXED
Root cause (confirmed in logs, Oct 30 07:07 and 07:29): each contact submission
fired TWO sends:
1. a plain email to `CONTACT_INBOX_EMAIL` (-> customersupport@) with the message
   text and Reply-To the sender, and
2. a branded `admin_notify` alert to `ADMIN_NOTIFY_EMAIL` (-> admin@), with NO
   message text.
admin@ is an alias of customersupport@, so both landed in one inbox = duplicate.

Fix: both `/api/contact` and `/api/support/contact` now send ONE branded email
(new `contact_message_email_html`) to `CONTACT_INBOX_EMAIL` in the shared navy
layout, containing: sender name + email, subject, full message text, Reply-To =
sender, and an "Open in admin" button with the deep link
(`/admin/contact?msg=<id>`). The separate admin alert for contact messages was
removed. Because each endpoint now makes exactly one send, no alert can reach the
same address twice (per-send-call dedupe, per your choice).

## 2. Missing dispute email - FIXED
Root cause: Jenn's dispute at 07:28:45 PT on Oct 30 was a self-removal request
(`reason = remove_my_own_review`, `filer_role = reviewer_self_removal`). In
`file_dispute`, the admin alert lived inside `_notify_filed`, which was called
ONLY for non-self-removal filings. So a self-removal opened an "open" dispute
needing a moderator decision but NEVER alerted the admin. Confirmed:
`admin_alert_log` had zero `dispute` entries ever.

Errors were NOT the cause here (the per-party notices sent fine); the alert was
simply never called for that path.

Fix - admin is now alerted on EVERY filing path, each with distinct wording and a
deep link to the exact item (`/admin/moderation?dispute=<id>`):
- Regular dispute filing -> "New review dispute filed"
- Reviewer self-removal request -> "Review self-removal request"
- Contest of a removed review -> "Review removal contested"
  (the contest path `/review-disputes/{id}/contest` also had NO admin alert
  before; now fixed.)

What the OTHER parties receive when a dispute is filed (unchanged):
- Regular filing: the filer gets "We received your review request"; the other
  party gets "A review you're part of was reported".
- Self-removal filing: parties are intentionally NOT notified at filing time;
  they are notified only if/when a removal is approved (existing policy). Only
  the admin is alerted at filing.
- On decision: neutral per-outcome notices to each party (unchanged).

## Make email failures visible
`send_email` now, on any failure (HTTP >= 400 or exception):
- logs `EMAIL SEND FAILED to=... subject=... reason=...` at ERROR level, and
- records the failure to a new Mongo collection `email_failures`
  (`{to, subject, reason, at}`).

Where an admin can see failures:
- Backend logs: `grep "EMAIL SEND FAILED" /var/log/supervisor/backend.err.log`
- Mongo: the `email_failures` collection (queryable; one row per failed send).
(There is no admin UI surface for this yet - flagging it as a possible follow-up.)

## 3. Consistent layout - DONE
The 4 welcome emails and the 2 password-reset emails were converted to the shared
navy header with the logo right-aligned (two-cell banner: eyebrow/title left,
56x56 logo right). The plain contact/support email now uses the shared navy
layout too. No email shows the logo above the banner, and the logo is pinned
right (`align="right"` + `margin-left:auto`) so it does not drift left on phones.
Templates with a hand-built header carry an `SMN_HEADER_DONE` marker so the
auto-logo-injection does not double-insert (verified: exactly one logo each).

## 4. Dark mode - DONE (what I changed vs. what I cannot control)
Centralised in `_apply_branding` -> `_harden_dark_mode`, applied to every email:
- Added `<meta name="color-scheme" content="light dark">` and
  `<meta name="supported-color-schemes" content="light dark">` (normalising the
  welcome/reset templates that previously said `light only`/`light`). This tells
  Apple Mail / Outlook the email is dark-mode-aware, which stops them force-
  inverting the navy banner and orange accents.
- Added a dark-mode `<style>` block (`@media (prefers-color-scheme:dark)`) that
  re-asserts the navy banner background for clients that honour it.
- Added explicit `bgcolor="#1F3F5B"` to every navy banner cell, which helps Gmail
  keep the navy dark instead of lightening it to "light blue".
- Brightened the brand orange from `#F2A03B` to `#FF9E2C` for eyebrow text and
  buttons, and switched button label colour to navy `#10233A`, so both stay
  legible after Gmail/Apple Mail colour shifts.

What I cannot control: the Gmail iOS/Android app applies its own proprietary
colour transforms and largely ignores `<style>`/media queries and even
`color-scheme`. The explicit `bgcolor` + brighter orange + navy button text are
the levers that survive Gmail's transform, but Gmail may still nudge exact
shades. Apple Mail now respects our light design (no inversion). Please verify on
your phone.

## 5. Sender report (From address, From name, sending path) for every email type
All transactional email goes through ONE path:
`mailer.send_email` -> Emergent managed Resend proxy
(`https://integrations.emergentagent.com/api/v1/email/send`, header `X-Email-Key`).

- From name: `Sail More Now` (env `EMAIL_FROM_NAME`).
- From address: NO `EMAIL_FROM_ADDRESS` is set, so the proxy injects its OWN
  verified sender -> this is why you see `hey@emergentmails.com` on support and
  admin emails. It is the managed proxy's verified address, not configured by us.
  (To use a sailmorenow.com From address you would verify that domain in the
  provider and set `EMAIL_FROM_ADDRESS`; we are leaving the provider/switch
  decision to you and changed nothing here.)
- Reply-To by type:
  - Contact / Support message: Reply-To = the sender's email (reply reaches the
    member directly).
  - Everything else (welcome, password reset, dispute party notices, dispute /
    report / market-request admin alerts, digests, crew, event, etc.): Reply-To =
    `customersupport@sailmorenow.com` (default).
- Recipients by type:
  - Contact / Support: `CONTACT_INBOX_EMAIL` (default customersupport@).
  - Admin alerts (dispute, report, content-hidden, market request):
    `ADMIN_NOTIFY_EMAIL` (default admin@).
  - Member emails (welcome, reset, notices, digests): the member's address.

So every type uses From name "Sail More Now" + From address hey@emergentmails.com
(proxy default) via the managed Resend proxy; only Reply-To and recipient differ.

## Bonus audit - other admin-needed actions that skipped their alert
You asked me to check report-on-a-message, verification requests, Boat Pro claims.
Findings:
- Reports (post / comment / discussion / event): alert fires correctly.
- Content auto-hidden: alert fires correctly.
- Messages are NOT reportable (no message report/block endpoint exists), so there
  is no missed alert there.
- No Boat Pro claim or verification-request feature exists in the codebase, so
  nothing to miss.
- MISSED ALERT FOUND + FIXED: `POST /api/markets/request` wrote a
  `market_requests` doc with NO admin notification and no admin view - it sat
  silently. Added an admin alert ("New market request") with a deep link.

## 6. Tests
Real sends to jenn@sailmorenow.com ONLY (verified "ok" with Resend IDs):
- Contact message (branded, consolidated)   id 01a18bd3-f9ad-...
- Dispute admin alert                        id 01a18bd3-fa7b-...
- Welcome (sailor)                           id 01a18bd3-fb3c-...
- Password reset                             id 01a18bd3-fc0b-...
Nothing was sent to any other address. All temp scripts/output and the two
offline `admin_alert_log` rows created during verification were cleaned up.

Build stamp bumped to `EF3-2026.06` (shown as tiny muted text in every footer).

### Verified in a real inbox vs code-verified
- Rendered-HTML verified (browser screenshots): navy header + right-aligned logo
  on welcome, reset, contact, admin alert; brighter orange + navy button text;
  build stamp in footer; single logo per header (no duplicate); no em-dashes.
- Real inbox: four emails delivered to jenn@ (provider accepted, IDs above) -
  Jenn to visually confirm dark mode on her phone.
- Code-verified only (NOT sent, to honour "jenn@ only"): the live `/contact`,
  `/support/contact`, dispute self-removal, and contest endpoints. The
  self-removal and contest admin-alert paths were proven to reach the admin
  recipient (admin@sailmorenow.com) via an offline capture test.

## Files changed
- `backend/mailer.py` - colours/build-stamp constants, `_harden_dark_mode`,
  `contact_message_email_html`, `_record_failure` + failure logging/recording,
  `_apply_branding` SMN_HEADER_DONE guard, reset-email headers, em-dash removal.
- `backend/email_templates/welcome-{sailor,boat-owner,boat-pro,club-org}.html` -
  shared navy header with right-aligned logo.
- `backend/routers/directory_router.py` - consolidated contact/support emails,
  market-request admin alert.
- `backend/routers/review_disputes_router.py` - `_admin_alert_dispute`, admin
  alerts on self-removal + contest, distinct wording per path.
