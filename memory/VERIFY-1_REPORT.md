# VERIFY-1 Report (web + backend; mobile banner + lock screen)

Standing rules honored: no testing agent (curl/requests + read-only DB + browser smoke), no em dashes,
no passwords/tokens/token-links printed anywhere, test emails only to jenn@sailmorenow.com (exactly
ONE live send, used to prove the pipeline). Did not touch billing logic, account deletion or the admin
access pages. Temp data only, cleaned up (0 residue). Build stamp bumped rv3a-12 -> rv3a-13; mobile
restarted.

Rule recap built to: new password sign-up gets full access for 24h; after 24h an unverified account is
locked behind a Verify screen until verified; Google sign-ins are already verified.

## 1. Verification email at sign-up
- Sent on register via the EXISTING mailer (Jenn's Resend; managed proxy fallback). New template
  `verification_email_html`. Link = `{APP_PUBLIC_URL}/verify-email?token=...`, single-use, valid 7 days
  (longer than the 24h lock) so a locked person can still finish.
- Logged in /admin/email: every verification send writes an "EMAIL SENT" row (new `log_email_sent`
  helper; no body/token stored).
- VERIFIED: one live send to jenn@ returned status ok via resend and created the admin-log row.

## 2. Countdown banner + resend + fix email (web + mobile)
- Banner shows while unverified and inside the 24h window: "Verify your email within X hours to keep
  your account." Resend button (30s client cooldown) and "Wrong email? Fix it".
- Resend limits: 3 per hour per account, 10 per hour per IP (429 over limit). VERIFIED 429.
- Fix email: `POST /auth/change-email` changes the address, resets verified, invalidates old tokens,
  sends a fresh link. Validations VERIFIED (disposable -> 400, existing account -> 409).
- Cross-device / new tab: `POST /auth/verify-email` needs NO auth (the token is the proof), so the link
  works anywhere. VERIFIED (token consume -> 200, user verified).
- Original tab notices completion: the banner and lock screen poll the user's own /auth/me (20s / 15s)
  and update the cached user in place, so nothing navigates and a mid-checkout position is kept.

## 3. After 24h: locked to the Verify screen
- `verification_state()` marks a password account `locked` once 24h since signup elapses. The web Shell
  renders a full `VerifyLocked` screen (resend, fix email, sign out, contact support) in place of the
  app; mobile renders `VerifyLockedScreen` in the tabs layout. Sign-in still works.
- No posting/messaging/joining/checkout while locked: the shared `require_not_locked` gate is inside
  `require_interaction` (covers posting, DMs, comments, reactions, reviews, crew) and in
  `/payments/checkout`. VERIFIED: checkout while locked -> 403 VERIFY_EMAIL_REQUIRED.

## 4. Checkout/trial during grace (and card reuse detection - proposed only)
- During the 24h window checkout is NOT blocked by verification. VERIFIED: checkout in grace returns the
  normal 400 Invalid package_id, not a verify-lock. After lock it is blocked (item 3).
- Card reuse across accounts (NOT built): Stripe exposes `payment_method.card.fingerprint`, a stable
  per-card value across customers. PROPOSED RULE: on each subscription, read the PaymentMethod in the
  webhook and store its fingerprint; if one fingerprint attaches to >= 3 distinct accounts within, say,
  30 days, FLAG those accounts for admin review (do not auto-block - families and shared cards are
  legitimate). Our checkout is already card-only, so the fingerprint is available. Build later.

## 5. Unverified accounts by age (today) + cleanup proposal (NOT built)
Counts now (password accounts, not Google, not verified, not exempt):
  total unverified: 43  |  <24h (in grace): 3  |  24h-7d (locked, link valid): 2  |  >7d (locked,
  link expired): 38
(These are almost entirely pre-launch seed/test accounts - Jenn plans to delete all but her own before
launch. NOTHING was changed or locked in the DB; "locked" is a computed state only.)
PROPOSED cleanup job (after launch, build later): a daily task that SOFT-deletes password accounts that
are still unverified AND older than 30 days AND have never had a paid subscription or any content
(posts/messages/listings), emailing a final warning at day 23. Never touch Google, verified, exempt,
comp, or paying accounts. Dry-run + admin report first; hard delete only after a soft-delete grace.

## 6. Existing accounts by verification state (NOT changed)
total users: 51  |  Google sign-in (verified): 1 (jenn)  |  email_verified password accounts: 0  |
exempt (admin/comp/verified-by-admin): 1  |  password-login accounts: 43. No existing account was
locked or modified.

## 7. Sign-up rate limits + free protections + CAPTCHA proposal
Numbers chosen (live): sign-up max 10 per hour per IP, 20 per hour per email domain (429 over limit).
Free invisible protections ADDED and verified (all reject before any email is sent):
  - Honeypot hidden field (`company_website`) -> 400 if filled.
  - Minimum form fill time 3 seconds -> 400 if faster.
  - Disposable-email-domain blocklist (backend/disposable_domains.py) -> 400.
CAPTCHA options (PROPOSED, not built; pricing verified from official pages, Oct 2026):
  - Cloudflare Turnstile: FREE, no request limit (20 widgets/account). Privacy-friendly, minimal
    cookies, good accessibility, no ad tracking - lightest for our Termly policy. Web support is
    first-class; React Native needs a WebView (no first-class native widget).
  - reCAPTCHA v3: free to 10,000 assessments/month/org, then $8/mo for 10k-100k and $0.001 each above.
    Sets Google cookies and does behavioral scoring - the heaviest privacy/Termly disclosure burden.
    Native mobile SDKs exist.
  - hCaptcha: free Basic (~10k/mo soft guide), Pro $99/mo (annual) for 100k. Privacy-friendly, GDPR
    focus. Web first-class; mobile via SDK/WebView.
  RECOMMENDATION: Cloudflare Turnstile on the web signup (free, privacy-light, least Termly/cookie
  impact). On mobile, keep the invisible protections + server rate limits for launch and only add
  Turnstile via WebView if we see real abuse. Add a Turnstile cookie line to Termly before enabling.

## 8. Exempt from the 24h lock + admin "verify by admin"
- Exempt: jenn@ (ADMIN_EMAILS), comp/complimentary accounts, and any account an admin marks
  "verified by admin". VERIFIED: a 25h-old account with `verified_by_admin` is not locked and reads
  verified.
- New admin action `POST /admin/users/verify-email` (+ web page /admin/verify-user, linked from the
  admin portal): marks an account verified, sets verified_by_admin, audit-logged. VERIFIED: 200,
  verified_by_admin set, audit_logs row written (action verify_email_by_admin). Use for App Store
  reviewer demo logins.

## 9. Resend capacity vs launch volume
- Free plan: 100/day, 3,000/month. Each signup currently sends 2 emails (welcome + verification), plus
  up to 3 resends/account and other transactional mail (billing, crew, reviews, digests).
- Rule of thumb on the free plan: the 2-emails-per-signup rate caps sustainable signups near ~30-40/day
  (leaving headroom for other mail under 100/day), and ~1,200-1,400 signups/month before nearing the
  3,000/month cap.
- Upgrade to Resend Pro BEFORE a launch push, or once sustained signups exceed ~30/day OR total monthly
  sends approach ~2,500 (keep a buffer under 3,000). Optional lever: merge welcome + verification into
  ONE email to roughly halve signup volume (not done now; flagged).

## What was browser-verified vs code-only
- BROWSER-VERIFIED (web): /verify-email renders and consumes a token end-to-end (invalid token ->
  "Link invalid or expired"). Route/page compile and the verify POST works from the browser.
- BACKEND-API VERIFIED (curl/requests, temp data): verification_state (grace vs locked vs hours),
  verify-email consume, resend rate limit (429), change-email validations (400/409), checkout blocked
  when locked (403) and allowed in grace (400 pkg), exempt-by-admin, admin verify-email + audit, and
  one live send to jenn@ + /admin/email log row.
- CODE-ONLY (not browser-rendered, to avoid handling a session-token cookie secret): the authed web
  banner and lock screen, and ALL mobile UI (banner + lock screen). Mobile VerifyGate.tsx type-checks
  clean (the _layout tabBar color TS warnings are pre-existing and unrelated). Mobile service restarted;
  please sanity-check the banner/lock on an unverified login in the Expo preview.

## Files changed (VERIFY-1)
Backend: deps.py (verify_exempt / verification_state / require_not_locked; identity payload),
disposable_domains.py (new), mailer.py (verification_email_html + log_email_sent), routers/auth_router.py
(register anti-abuse + verification send; send-verification / verify-email / change-email), schemas.py
(honeypot + fill-time fields), routers/payments_router.py (checkout lock gate), routers/admin_router.py
(verify-by-admin + audit).
Web: components/VerifyUI.jsx (new), pages/VerifyEmail.jsx (new), pages/AdminVerifyUser.jsx (new),
App.js (routes + Shell banner/lock), pages/AdminHome.jsx (portal card), pages/Login.jsx (honeypot +
fill-time on signup).
Mobile: src/components/VerifyGate.tsx (new), app/(tabs)/_layout.tsx (banner + lock gate),
src/lib/buildStamp.ts (rv3a-13).
