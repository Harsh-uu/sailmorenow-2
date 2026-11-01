# EMAIL-AUDIT-1 — Email Audit (REPORT ONLY, nothing changed, no emails sent)

Date: 2026-06-24. All mail goes through `backend/mailer.py` -> Emergent managed Resend proxy (`EMERGENT_EMAIL_KEY`, hardcoded proxy `https://integrations.emergentagent.com`). `send_email` sets NO custom headers (so no List-Unsubscribe). `from_name` = `EMAIL_FROM_NAME` = "Sail More Now". A `from_email` is sent only when a caller passes one; otherwise `EMAIL_FROM_ADDRESS` (UNSET) -> the proxy's own verified sender is used.

Link base: `app_public_url()` / `_base_url()` = env `APP_PUBLIC_URL`/`APP_BASE_URL` (currently the preview URL), else fallback `https://app.sailmorenow.com`. Several scheduler/mailer links are HARD-CODED to `https://app.sailmorenow.com` (not env-driven) - flagged below.

## A. Full email inventory
Legend: Logo = does the round SMN image logo render. Link = where the main button goes; "specific" = links to the exact item, "generic" = a list/section page.

| # | Email | Trigger | Recipient | Subject | From | Reply-To | Logo | Button link | Specific? |
|--|--|--|--|--|--|--|--|--|--|
| 1 | Welcome (4 role variants: sailor/boat-owner/boat-pro/club-org) | Onboarding complete (auth_router register/onboarding) | new member | "Welcome to the Sail More Now Community" | notifications@notifications.sailmorenow.com | - | YES | {app}/dashboard + FAQ | generic |
| 2 | Password reset | /auth forgot-password (password account) | user | "Reset your Sail More Now password" | notifications@notifications.sailmorenow.com | - | YES | reset_url (one-time token) | SPECIFIC |
| 3 | Password reset (Google-only) | forgot-password on Google account | user | "Reset your Sail More Now password" | notifications@notifications.sailmorenow.com | - | YES | {app}/login | generic |
| 4 | Crew-signup to organizer | sailor joins Crew Bank for an event | event organizer | "New crew signup for {event}" | proxy sender | - | NO | {app}/events?event={id} | SPECIFIC event |
| 5 | Event blast | organizer sends an event update | RSVP'd / crew members | "{subject} - {event}" (em dash) | proxy sender | organizer email | NO | {app}/events?event={id} | SPECIFIC event |
| 6 | Mention | @mentioned, no push subscription | mentioned user | "{name} mentioned you on Sail More Now" | proxy sender | - | NO | {app}/feed | generic (not the post/thread) |
| 7 | DM locked-message | a paid member DMs a free-tier member (throttled 24h) | free member | "You have a new message on Sail More Now" | proxy sender | - | YES | {app}/pricing | generic |
| 8 | Review reminder (day 3 / day 6) | nightly scheduler, pending mutual review | reviewer | "{N} days left to review {other}" | proxy sender | - | NO | {app}/reviews | generic |
| 9 | Review dispute - FILED | dispute filed | filer + other party | approved RC subject; heading "About a review" | proxy sender | - | NO | {app}/reviews?tab=disputes | generic (not the dispute) |
| 10 | Review dispute - DECIDED | admin decides a dispute | involved users | heading "A decision was made" + outcome | proxy sender | - | NO | {app}/my-disputes | generic |
| 11 | Review restored | admin restores a review | involved users | "A review was restored" | proxy sender | - | NO | {app}/reviews?tab=disputes | generic |
| 12 | Volunteer reminder | scheduler, lead days before event | volunteer | "Volunteer reminder: {event}" | proxy sender | - | NO (plain HTML, no button) | - | - |
| 13 | Winback | nightly scheduler, subscription lapsed | lapsed member | "Your Sail More Now membership lapsed - come back?" (em dash) | proxy sender | - | YES | {app}/pricing | generic |
| 14 | Community Partner welcome | admin activates a partner | partner org | "Welcome aboard - you're a Sail More Now Community Partner" (em dash) | proxy sender | - | YES | {app}/dashboard | generic |
| 15 | Admin contact reply | admin replies to a contact message (+3h retry job) | original sender | "Re: your note to Sail More Now" | proxy sender | info@sailmorenow.com | NO | - | - |
| 16 | Public contact form (/contact) | public "send us a note" | **info@sailmorenow.com (hard-coded)** | "[Sail More Now] {label} - {name}" (em dash) | proxy sender | sender email | NO | - | - |
| 17 | Support contact (/support/contact) | signed-in Profile contact | **customersupport@sailmorenow.com (hard-coded)** | "[Sail More Now Support] {subject} - {name}" (em dash) | proxy sender | sender email | NO | - | - |
| 18 | Community Sunday digest | scheduler Sun 08:00 PT, newsletter_opt_in | opted-in members | "Your Sail More Now Sunday digest - {market/N markets}" (em dash) | proxy sender | - | NO | {app} home | generic |
| 19 | Admin report digest | scheduler Mon 08:30 PT | admins (role + ADMIN_EMAILS) | "Sail More Now - {N} new reports this week" (em dash) | proxy sender | - | NO | {app}/admin/reports (hard-coded app.sailmorenow.com) | generic |
| 20 | Events need a category | on import / scheduled | **ADMIN_EMAILS** | "{N} events need a category - Sail More Now" (em dash) | proxy sender | - | NO | app.sailmorenow.com/admin/events (hard-coded) | generic |
| 21 | Imported events need a contact | scheduler Mon 09:00 PT | admins + ADMIN_EMAILS | "Sail More Now - {N} imported events need a contact" (em dash) | proxy sender | - | NO | app.sailmorenow.com/admin/events (hard-coded) | generic |

Not found (do NOT exist as emails): **account/ID verification email** (ID verification is Stripe Identity, in-app + return_url only) and any **payment receipt/confirmation** (Stripe sends its own receipts; the only billing emails are #7 locked-message and #13 winback).

## B. Requested specifics
**1. Logo hosting + which emails depend on each; broken/missing.**
- **WordPress media (ACTIVE):** `https://sailmorenow.com/wp-content/uploads/2026/09/cropped-smn_round_logo_transparent_200x200.png` - the real logo via `email_logo_url()` (env `EMAIL_LOGO_URL` is EMPTY, so the WordPress fallback is live). Used by #1 welcome (all 4), #14 partner welcome, #7 locked-message, #13 winback, #2 and #3 password reset. **RISK/FLAG: if the WordPress.com site is cancelled, this URL 404s and the logo breaks in every one of those emails.** Move the asset to a stable host (or set `EMAIL_LOGO_URL`) BEFORE cancelling WordPress.
- **Declared but UNUSED (dead) in `mailer.py`:** `LOGO_SEAL_URL` (static.prod-images.emergentagent.com ...jpeg) and `LOGO_ROUND_URL` (customer-assets.emergentagent.com ...webp), plus `SOCIAL_INSTAGRAM_ICON`/`SOCIAL_FACEBOOK_ICON` (icons8). No code or template references them. (The emergent customer-assets host is also not a safe long-term email host.)
- **No image logo at all (navy text-wordmark header only):** #4, #5, #6, #8, #9, #10, #11, #12, #18, #19, #20, #21, #15, #16, #17 - i.e. the digest and all review-dispute emails (as you noted) plus ~13 more. No "wrong" logos found; the only broken-logo risk is the WordPress dependency above.

**2. "Events needing attention" recipient.** Two emails: #20 "need a category" (`notify_admins_category_review`) and #21 "need a contact" (`_import_contact_digest_job`). Both resolve recipients from `admin_emails()` = env **`ADMIN_EMAILS`** (currently `jenn@sailmorenow.com`) plus any user with `platform_role=admin`. So the recipient is set in ONE place (the `ADMIN_EMAILS` env, read centrally via `deps.admin_emails()`), NOT hard-coded in several places. (Only the button URL is hard-coded to `https://app.sailmorenow.com/admin/events` in `scheduler.py`.)

**3. Contact form routing.** Public `/contact` -> hard-coded `info@sailmorenow.com` (reply-to = sender), also saved to `contact_messages`. Signed-in `/support/contact` -> hard-coded `customersupport@sailmorenow.com` (reply-to = sender), also saved. Both via the Resend proxy. Admin replies from the Admin Contact page send #15 with reply-to `info@sailmorenow.com`.

**4. Footer / address / support / unsubscribe / List-Unsubscribe.** Most templates carry a one-line "You're getting this because..." footer. **No postal mailing address in any email** (CAN-SPAM gap for the marketing-style ones). **No unsubscribe or preferences LINK and no `List-Unsubscribe` header anywhere** - the Sunday digest only says "Update preferences in your profile" as plain text. No support-contact line in footers. Password-reset footer is just "Sail More Now - Pacific Northwest sailing community".

**5. In-app only vs emailed admin notifications; which need email + a deep link.**
- In-app ONLY: new report (`report_new`), content auto-hidden (`content_hidden`), and new dispute for admins (admins only see disputes in the moderation queue; the dispute EMAILS #9/#10 go to the involved members, not admins).
- Emailed to admins: #19 report digest (weekly), #20/#21 events-needing-attention (weekly).
- Emailed to fixed inboxes (not the admin env): #16 info@, #17 customersupport@.
- Deep links are ALL generic today (reports -> /admin/reports, disputes -> /reviews?tab=disputes or /my-disputes, events -> /admin/events). Items that would benefit from an email + a link to the EXACT item: new report, new dispute, each contact inquiry (-> /admin/contact or the specific message), and events-needing-attention (-> the specific event edit).

**6. Resend domain + From per email.** All send through the Emergent managed Resend proxy. #1 welcome and #2/#3 password reset explicitly set From = `notifications@notifications.sailmorenow.com`. All others send no `from_email` (and `EMAIL_FROM_ADDRESS` is unset), so they use the proxy's pinned verified sender. **Whether `notifications.sailmorenow.com` is verified in Resend CANNOT be confirmed from code - must be checked in the Resend/Emergent email dashboard.** If it is not verified, the explicit From may be rejected or silently overridden by the proxy sender.

**7. One setting to control the admin recipient -> route everything to admin@sailmorenow.com.** Today `ADMIN_EMAILS` already drives #19/#20/#21 (via `admin_emails()`), but it ALSO grants admin login/role, and the contact inboxes (#16 info@, #17 customersupport@) and the admin-reply From are hard-coded. To route reports, disputes, inquiries, anything needing a response, and events-needing-attention to `admin@sailmorenow.com`:
   - Add ONE env, e.g. `ADMIN_NOTIFY_EMAIL` (keep `ADMIN_EMAILS` separate so a shared inbox doesn't get admin rights).
   - Point #19/#20/#21 at `ADMIN_NOTIFY_EMAIL` (small change in `scheduler.py`).
   - Make `/contact`, `/support/contact`, and the admin-reply From read the env instead of the hard-coded addresses (`directory_router.py`, `admin_router.py`).
   - Add NEW email sends (currently in-app only) for new report and new dispute to `ADMIN_NOTIFY_EMAIL`, each with a deep link to the specific item.
   Effort: small-moderate - mostly centralizing the recipient + two new sends + item deep-link routes.

## C. Proposed fix list (priority order)
- **P0 - Logo before WordPress is cancelled:** host the email logo on a stable URL (or set `EMAIL_LOGO_URL`) and remove the dead `LOGO_SEAL_URL`/`LOGO_ROUND_URL`/social constants, so #1/#2/#3/#7/#13/#14 don't break.
- **P0 - Live link base:** set `APP_BASE_URL`/`APP_PUBLIC_URL` to the production domain and replace the hard-coded `https://app.sailmorenow.com` links in `scheduler.py`/`mailer.py` (#19/#20/#21 and `app_url=` literals) so admin buttons point at the live site.
- **P1 - Admin routing:** add `ADMIN_NOTIFY_EMAIL`; route #16/#17/#19/#20/#21 + new report + new dispute to it, with deep links to the exact report/dispute/message/event.
- **P1 - Verify sender:** confirm `notifications.sailmorenow.com` (or the chosen From) is verified in Resend; set `EMAIL_FROM_ADDRESS` so all emails use one consistent From.
- **P1 - Brand consistency:** add the logo header to the no-logo transactional emails (at least dispute, digest, crew, mention, reminders).
- **P2 - Compliance:** add a postal address + an unsubscribe/preferences LINK + a `List-Unsubscribe` header to the marketing-style emails (#18 digest, #13 winback); make the digest "preferences" text a real link.
- **P2 - Copy:** remove the em dashes in subjects (#5, #13, #14, #16, #17, #18, #19, #20, #21) per the no-em-dash rule.

### Files read
backend/mailer.py; backend/email_templates/{welcome-sailor,welcome-boat-owner,welcome-boat-pro,welcome-club-org}.html; backend/scheduler.py; backend/routers/{auth_router,review_disputes_router,reports_router,directory_router,community_router,messaging_router,admin_router,identity_router}.py; backend/deps.py (admin_emails); backend/.env (keys only).
