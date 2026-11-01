# EMAIL-FIX-2 Report (email templates only, backend)

Standing rules honored: NO testing agent (render-assert script + 3 live sends to jenn@ only),
no em dashes anywhere, no tokens or full verification links printed. Zoho untouched.
Build stamps bumped: email footer EMAIL_BUILD BILL1-2026.06 -> EMAILFIX2-2026.06; mobile
buildStamp rv3a-14 -> rv3a-15.

---

## 1. BUTTONS - full re-audit (every <a> that has a background or looks like a button)

### Root cause the first audit missed
The central recolor in `_harden_dark_mode` only matched orange + text color on the SAME element
(`background:#F2A03B; color:#...`). The 4 welcome "Share with a friend" buttons put the orange on
the parent `<td bgcolor="#F2A03B">` while the `<a>` itself only carried navy text, so the regex never
touched them and they rendered bright orange. Fixed at source (see below).

### Every button, after fix (rendered through the real `_apply_branding` pipeline)
All now bg = TEAL #55B3AD with navy #1F3F5B text. Verified by render-assertion (bg extracted per anchor,
true text color read after stripping the `background-color` token).

| Email | Button label | bg | text |
|---|---|---|---|
| verification | Verify my email | #55B3AD | #1F3F5B |
| password_reset | Reset your password | #55B3AD | #1F3F5B |
| password_reset_google | Go to sign in | #55B3AD | #1F3F5B |
| welcome-sailor | Open Sail More Now | #55B3AD | #1F3F5B |
| welcome-sailor | Share with a friend | #55B3AD | #1F3F5B |
| welcome-boat_owner | Open Sail More Now + Share with a friend | #55B3AD | #1F3F5B |
| welcome-boat_pro | Open Sail More Now + Share with a friend | #55B3AD | #1F3F5B |
| welcome-club-org | Open Sail More Now + Share with a friend | #55B3AD | #1F3F5B |
| community_partner_welcome | Open your dashboard | #55B3AD | #1F3F5B |
| billing_welcome | View your plan | #55B3AD | #1F3F5B |
| billing_payment_failed | Update your card | #55B3AD | #1F3F5B |
| trial/promo ending | Choose your plan length | #55B3AD | #1F3F5B |
| crew_join | View event on Sail More Now | #55B3AD | #1F3F5B |
| event_blast | View event | #55B3AD | #1F3F5B |
| review_reminder | Review them now | #55B3AD | #1F3F5B |
| dispute_notice | See the details | #55B3AD | #1F3F5B |
| dispute_decision | See the details | #55B3AD | #1F3F5B |
| mention | Open the thread | #55B3AD | #1F3F5B |
| admin_alert | Open in admin | #55B3AD | #1F3F5B |
| contact_message | Open in admin | #55B3AD | #1F3F5B |
| category_review (admin) | Review in admin | #55B3AD | #1F3F5B |
| report_digest (admin) | Open reports queue | #55B3AD | #1F3F5B |
| locked_message | Upgrade to read and reply | #55B3AD | #1F3F5B |
| winback | Resubscribe in a tap | #55B3AD | #1F3F5B |
| community_digest | Review and respond | #55B3AD | #1F3F5B |
| community_digest | Open Sail More Now | #55B3AD | #1F3F5B |

### How each was made teal
- Welcome "Share with a friend" (4 files): source changed, parent `<td>` `#F2A03B` -> `#55B3AD`
  (anchor text was already navy).
- Welcome primary CTA "Open Sail More Now" (4 files): was navy `#1F3F5B` bg + white text; changed at
  source to teal bg + navy text.
- report_digest "Open reports queue" and community_digest "Review and respond": were navy bg + white
  text; changed at source to teal + navy text.
- All other buttons were inline orange `#F2A03B` anchors; they are recolored centrally to teal + navy
  by `_harden_dark_mode` (unchanged mechanism, re-verified). Source stays orange, render is teal.

### Orange kept (accent only, never a button) - confirmed still orange
- Welcome emails: the vertical left accent line on the "Know someone who'd use this?" box
  (`border-left:4px solid #F2A03B`, brightened to #FF9E2C in dark mode). Count verified = 1 per welcome.
- Eyebrow / label text on several headers (e.g. "Sail More Now . Admin", "Password reset") stays orange
  text. No orange remains as any button background.

### One deliberate exception (needs your call)
The welcome store-download buttons "Get it on the App Store" / "Get it on Google Play" are left as
white outline with navy text (standard store-badge styling). They are also currently stripped from the
email entirely because APP_STORE_URL / GOOGLE_PLAY_URL are not set yet. Say the word and I will make
them solid teal too.

---

## 2. PRICES, PLAN NAMES, DATES - every value, its source, and the comparison

Source of truth = `constants.SUBSCRIPTION_PACKAGES` (same table checkout uses). Monthly rates:
sailor Premium $6.99, boat owner Premium $6.99, Boat Pro Basic $12.99, Featured $19.99, Premium $29.99.

| Email | Value shown | Source | Matches table? |
|---|---|---|---|
| trial reminder (member) | price "per month", tier, charge date | monthly from pkg, tier from `subscription_tier`, date from `trial_end` | YES (now) |
| trial reminder (Boat Pro) | price "per month", "Boat Pro <tier>", charge date | same, audience prefix added | YES (now) |
| promo-ending reminder | term price or monthly, tier, date | `subscription_term_choice` or pkg monthly; `subscription_free_until` | YES |
| billing welcome | tier name, renewal date | `subscription_tier` + `subscription_expires` (set by Stripe webhook) | YES, not hard-coded |
| billing payment failed | tier name, update-card link | `subscription_tier` + Stripe hosted invoice URL | YES, not hard-coded |
| plan change | (no dedicated template; same billing_welcome shell is reused) | n/a | n/a |
| welcome (all roles) | NO prices, only "free and paid options" + "one volunteer event per month" (not money) | n/a | n/a |
| comp grant / expiry | no email carries a price | n/a | n/a |

Result: NO hard-coded prices exist in any template. The only price logic lived in the two scheduler
reminder jobs; both now read the monthly rate from `SUBSCRIPTION_PACKAGES`.

### The "$9 per month for Premium" question - answer
That was TEST INPUT, not a production bug. No package in the table produces $9; member Premium is $6.99.
In the EMAIL-FIX-1 test send the price string was passed by hand. HOWEVER, I did find a real latent bug
next to it, now fixed:

- BUG (fixed): the trial job passed `package_total(pkg)` (the whole-term total) into a sentence that
  says "per month". For a 1-month plan that equals the monthly rate so it looked fine, but for any
  multi-month package it would have overstated the monthly charge. The promo job passed a
  "$X for N months" string into the same "per month" sentence, producing broken grammar.
- FIX: trial job now sends `"$<monthly> per month"`; promo job sends `"$<total> for <N> months"` for a
  chosen term or `"$<monthly> per month"` otherwise; the template line changed from
  "charged {price} per month for {tier}" to "charged {price} for {tier}" so the cadence lives in the
  price string and reads correctly in both cases.

Verified renders:
- Member monthly: "You'll be charged $6.99 per month for Premium unless you choose a longer plan or cancel."
- Boat Pro Premium monthly: "You'll be charged $29.99 per month for Boat Pro Premium ..."

### Boat Pro tier name + price - confirmed
Boat Pro reminders now show "Boat Pro Basic/Featured/Premium" (audience prefix added in the scheduler)
with the correct monthly rate ($12.99 / $19.99 / $29.99).

### Promo and term-choice wording - confirmed against the real rules
The reminder's save line reads: "pick a 3, 6 or 12-month plan (Boat Pro: 6 or 12 months) ... The monthly
plan is the default if you do nothing." This matches the table: sailor/owner offer 1/3/6/12-month terms,
Boat Pro offers 1/6/12. Discounts in the table (10/15/20 percent) back the "built-in discount" phrasing.

---

## 3. EVENT-BLAST email - included this time
The prior audit script errored on this template (it was called with missing/None args, and the code
does `event_starts_at[:10]`). Re-audited with valid args: single logo, header eyebrow is teal, the
"View event" button renders teal #55B3AD with navy text. Compliant.

---

## 4. REPORT ONLY - verify-by-6-digit-code (nothing built)

### What it is
Let someone verify by typing a 6-digit code shown in the email into the same screen (web + mobile),
keeping the existing one-tap link as a backup.

### What would change
- Backend: on register/resend, generate a 6-digit code, store a SALTED HASH of it (never the raw code)
  on the user with an expiry (suggest 15 minutes) and an attempt counter; keep issuing the existing link
  token in parallel. Add `POST /api/auth/verify-code` that checks the hash, expiry, and attempt count.
  The email template gains a large code block alongside the existing button.
- Web: add a 6-box code input on `VerifyEmail.jsx` / `VerifyUI.jsx` that calls the new endpoint and
  flips verification state on success.
- Mobile: add the same code input on the verify screen (`VerifyGate.tsx`), using the shared endpoint.

### Effort
Small to medium. Roughly: backend endpoint + code issue/stamp on register and resend (about half a day),
web input (a few hours), mobile input (a few hours), plus the email copy. The link path already exists,
so this is additive.

### Risks and how to handle them
- Guessing attacks: a 6-digit code is 1 in a million. Mitigate with a strict attempt cap (e.g. 5 tries
  then invalidate and force a resend) and per-account + per-IP rate limiting (we already have the
  rate-limit helper used on login/reset). Lock the code, not the account.
- Expiry: short-lived code (15 min) with a visible "request a new code" action. Keep the LINK valid for
  7 days as the backup so a slow user is never stuck.
- Replay / reuse: single-use; delete the hash on success.
- Logging: never log the code or its hash.

### Different-device case
Codes shine here: someone reading the email on their phone can type the code into the app on their
laptop (and vice versa) without passing a link between devices. The link backup still works when they
open the email on the same device they want to verify on.

### Opening the app directly from the email link (store builds)
Needs deep linking / universal links: register an Associated Domains entry (iOS) and an intent filter +
Digital Asset Links file (Android) for the verify URL, add an `expo-linking` route in the mobile app that
captures the token and calls the verify endpoint, and host the two association files on the web domain.
This only pays off after the native builds are published; until then the link opens the web verify page,
which already works. Small-to-medium effort, mostly configuration + one deep-link handler.

---

## 5. REPORT ONLY - softer alternative to the 24-hour hard lock (nothing built)

Current 24h hard lock is LEFT EXACTLY AS IS.

### Softer model: persistent banner + action-gating
Instead of blocking the whole app after 24h, keep a banner ("Confirm your email to unlock X") and only
require verification at the moment the user tries a sensitive action. Browse, read, and look around stay
open indefinitely; the gate appears inline right where they act.

### Actions I recommend requiring verification for
- Sending a direct message or a first reply
- Posting to the feed or commenting
- Creating or RSVPing to an event, and any Crew Bank signup
- Posting a marketplace listing or contacting a seller
- Starting checkout / entering billing
- Leaving a review or filing a dispute
- Changing account email

### Actions to leave open (no verification)
- Browsing events, pros, clubs, feed, marketplace
- Editing their own profile basics
- Managing notification preferences

### Trade-off
Softer model is friendlier and lifts the "locked out" support risk, but it lets an unverified address
linger longer, so anti-abuse (disposable-domain block, rate limits) matters more. Easy to run either
model, or both (soft gating during a grace window, hard lock only if still unverified after N days).

---

## 6. Build stamp visibility - answer to your question
YES, the EMAIL_BUILD stamp IS visible to customers. It renders in the footer of every email at 9px in
light gray (#cbd5e1), bottom-center. It is subtle but present. Recommend adding "remove EMAIL_BUILD from
the email footer" to the pre-launch cleanup list (one-line change in `_standard_footer_html`).

---

## Verified in a real inbox vs code-only
- CODE-VERIFIED (render assertions on the exact `_apply_branding` output): every button bg = #55B3AD
  with navy #1F3F5B text across all buttons in 25 emails; single logo on all customer emails; orange
  accent line survives on welcome; zero orange button backgrounds; no em dashes; trial copy reads the
  correct "$6.99 per month" (member) and "$29.99 per month for Boat Pro Premium".
- REAL-INBOX: 3 emails were accepted and sent by Resend (status ok) to jenn@sailmorenow.com, subjects
  prefixed "[EMAIL-FIX-2 test]": member monthly trial reminder, Boat Pro Premium monthly trial reminder,
  sailor welcome. Actual pixel rendering and per-client dark-mode behavior is for you to confirm in your
  inbox; I cannot open your mailbox.

## Files changed
- backend/mailer.py: EMAIL_BUILD bump; trial-ending copy "charged {price} for {tier}"; report_digest and
  community_digest buttons navy -> teal+navy.
- backend/scheduler.py: trial + promo reminder jobs now read monthly rate from SUBSCRIPTION_PACKAGES and
  add the "Boat Pro" tier prefix for boat_pro audiences.
- backend/email_templates/welcome-sailor|boat-owner|boat-pro|club-org.html: share button orange -> teal;
  primary CTA navy -> teal+navy text; orange accent line kept.
- mobile/src/lib/buildStamp.ts: rv3a-14 -> rv3a-15.
