# VERIFY-LINK-SECURITY-1 - Email verification link opened while signed in as a different (admin) user
REPORT ONLY. No code or data changed. Hyphens only.

## Scenario
Jenn created a new FREE account on her phone. She then opened that account's
"verify your email" link in a desktop browser where she was ALREADY signed in as
her ADMIN account. The page said the email was verified; the browser was still the
admin session. Question: did the admin account get verified, did sessions get
swapped, is this a security hole?

## Code traced
- Backend route: `backend/routers/auth_router.py` -> `POST /auth/verify-email`
  (lines 380-405), token issuer `_send_verification_email` (327-346).
- Frontend page: `frontend/src/pages/VerifyEmail.jsx` (whole file, 49 lines).
- Related: `POST /auth/change-email` (408-444), `POST /auth/forgot-password`
  (547-605), `POST /auth/reset-password` (608-634).
- Session issuer `_issue_session` (74) is called ONLY by register (319) and login
  (484). It is NOT called by verify-email or reset-password.

## Findings

### a) Does verify act on the TOKEN's user or the signed-in session user?
TOKEN's user. `verify_email()` takes the token from the request BODY, looks up
`db.email_verifications` by that token, and sets `email_verified=True` on
`rec["user_id"]` (auth_router.py:387-403). It takes NO session cookie and NO
Authorization header - the function signature is `verify_email(body)` only. So the
NEW FREE ACCOUNT (the token's owner) was the account marked verified. The admin
account was NOT marked/affected by the token action. (The admin was almost
certainly already verified anyway.)

### b) Does verify set/replace/refresh the browser session or cookies?
The ENDPOINT does not. It returns `{"ok": true}` (or `{"already_verified": true}`)
and never sets, clears or refreshes a cookie, and never issues a session token.
The admin's session cookie was left exactly in place - no cross-login happened.
The FRONTEND page (VerifyEmail.jsx:22) does `if (user) refresh()` after success.
`refresh()` re-reads the CURRENTLY signed-in user (the admin) from the existing
session to flip that user's own verify banner/lock - it does NOT log in as the
token's user and does NOT change the session. So: the admin session stayed the
admin session. Nothing logged Jenn in as the new free user. What happened here:
the admin's own user object was harmlessly re-fetched; the new free account was
correctly verified in the database.

### c) Can the link be abused (expiry / single-use / guessable / reusable)?
No.
- Unguessable: token is `secrets.token_urlsafe(32)` = 256 bits of entropy
  (auth_router.py:330). Not enumerable or brute-forceable.
- Single-use: on success the token row is set `used=True` (line 404); a used token
  returns "expired" (399-400). If the account is already verified it short-circuits
  to `already_verified` (391-392) and does nothing.
- Expiring: `expires_at` TTL (VERIFY_TOKEN_TTL_DAYS = 7). Changing the email
  (`change-email`) invalidates all outstanding tokens for that user (435-436).
- No escalation: the token only flips ONE boolean (`email_verified`) on its OWN
  user. It cannot grant roles, change passwords, or touch another account. Being
  signed in as admin gives the link NO extra power - the link ignores the session
  entirely. An attacker holding someone's verify link could at most mark THAT
  person's email verified (not a privilege gain; it only removes the 24h lock on
  that same account), and cannot hijack a session or escalate.

### d) Wrong identity / admin controls shown after verify = display bug or session bug?
DISPLAY / UX only, NOT a session bug. Because the page was opened inside the
admin's logged-in browser, the app shell (nav, account name, any admin controls)
naturally renders the admin - that is the real, unchanged admin session. The
success panel text is generic and account-agnostic: "Email verified. Thanks. Your
account is fully active." (VerifyEmail.jsx:34-36). The word "Your" is misleading in
this cross-account situation (it reads as if the admin account was verified), but
no admin data was changed and no new session was created. The correct (new free)
account was verified server-side. This is confusing wording, not a breach.

### e) Password reset and other emailed-link flows
Same safe pattern.
- `reset-password` (608-634): acts on the TOKEN's user (`rec["user_id"]`), token is
  stored HASHED (`_sha256`), single-use (`used=True`), expiring; it does NOT
  auto-login and does NOT issue/replace a session. After reset it DELETES all
  sessions for the token's user (633) - it does not touch the signed-in admin's
  session. Opening a reset link while signed in as admin would reset the TOKEN
  account's password and sign that account's sessions out; the admin session is
  unaffected and the admin is NOT logged in as that user.
- `forgot-password` (547-605): only emails a link; no session effect; enumeration-
  safe (always returns ok) and rate limited per-email and per-IP.
- `change-email` (408-444): requires the signed-in session and only mutates THAT
  session user's own email; token-independent. Not reachable by a link alone.

## Severity: LOW (security). MEDIUM (UX/trust wording) at most.
Reasoning: there is NO real session, auth or privilege-escalation defect. The
verify and reset endpoints are token-scoped, session-agnostic, single-use,
expiring, unguessable, and non-escalating. The only defect is confusing success
copy on the verify page when it is opened inside a different user's session, which
can make an admin THINK a session got crossed when it did not.

## Recommended fix (UX hardening, optional, NOT a security patch)
1. Make the verify success copy account-specific / neutral. Have `verify-email`
   return the masked email it just verified (e.g. `j***@domain.com`) and show
   "Email verified for j***@domain.com" instead of "Your account is fully active."
2. If a session IS present and the signed-in user's email != the verified email,
   show a neutral note: "This verification link was for a different account. You are
   still signed in as <current account>." This directly prevents the confusion Jenn
   hit.
3. Optional: only call `refresh()` when the signed-in user's id matches the
   verified user (avoid an unnecessary admin refetch).
No backend auth changes are required.

## Must this be fixed BEFORE launch?
No - not as a security blocker (there is no vulnerability). It is a LOW-risk UX
polish item and can ship after launch. Recommended to do the small copy fix (#1/#2)
soon because it affects trust when staff/admins test, but it does not gate launch.
