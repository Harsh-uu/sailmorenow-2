# VERIFY-PAGE-1 - Make email verification never look like it applies to a different signed-in account
PLAN ONLY. No code until Jenn approves. No emails. Hyphens only. Builds on
VERIFY-LINK-SECURITY-1 (the backend is correct and session-safe; only the page is
confusing).

Goal (Jenn): when someone verifies their email, the result must NEVER look like it
applies to, or link into, a DIFFERENT account that is already signed in on web.

================================================================================
## 1) Exact CURRENT behavior

### Web (the only place these links open)
- Verification links are `{APP_PUBLIC_URL}/verify-email?token=...`
  (auth_router._send_verification_email:339). They ALWAYS open the WEB app.
- Screen: `frontend/src/pages/VerifyEmail.jsx` (49 lines).
  - On mount it reads `token` from the query string and calls
    `api.post("/auth/verify-email", { token })` (line 21).
  - Backend `POST /auth/verify-email` (auth_router.py:380-405) verifies the
    TOKEN's user (sets `email_verified=True` on `rec["user_id"]`), marks the token
    `used`, and returns `{ "ok": true }` (or `{ "ok": true, "already_verified":
    true }`). It takes NO session - it never reads or sets a cookie.
  - On success the page does: `setStatus("done"); if (user) refresh();` (line 22).
  - `refresh()` (AuthContext.jsx:10-19) re-fetches `/auth/me` for the CURRENTLY
    signed-in session (the admin) and `setUser(data)`. It does NOT switch accounts.
  - Success panel text is generic and account-agnostic (lines 34-36):
    "Email verified / Thanks. Your account is fully active." with a "Go to the app"
    link to `/community`.
  - Error panel (bad/expired/used token) at lines 39-45.
  - No toasts are shown on this page.

### Why the success message appeared inside the admin session
The page was opened in a browser that already had the ADMIN session cookie. The
app shell (nav, account name, admin controls) renders from that live admin session,
which the verify call never touched. The success copy says "Your account is fully
active" with NO account name, so inside the admin shell it reads as if the admin
account was the one verified. In reality the NEW FREE account (the token's owner)
was verified server-side, and `refresh()` merely re-read the admin's own user
(harmless). Net: correct account verified, admin session intact, but the wording +
admin shell = the confusion Jenn saw.

### Mobile (deep link)
- There is NO mobile deep link and NO native verify screen. `grep` for
  "verify-email" across `mobile/` returns nothing. Tapping the link on a phone
  opens the mobile BROWSER, which loads the same web `VerifyEmail.jsx`.
- The only in-app mobile verify surfaces are `VerifyGate` / `VerifyBanner`, driven
  by `POST /auth/send-verification` + the 24h countdown state. They are unaffected
  by this issue and need no change.

### Email-change verification
- `POST /auth/change-email` (auth_router.py:440) reuses
  `_send_verification_email`, so its link is the SAME `/verify-email?token=...`
  web page. Any fix to that page automatically covers change-email.

================================================================================
## 2) Proposed behavior (web VerifyEmail page)

### Backend change
`POST /auth/verify-email` returns the identity of the account it just verified so
the page can compare and display it safely:
```
{ "ok": true, "email_masked": "j***@domain.com", "user_id": "<verified user_id>",
  "already_verified": <bool> }
```
- Add a small `_mask_email(email)` helper: first char + "***" + "@" + domain
  (e.g. `jennadmin@x.com` -> `j***@x.com`; 1-char local part -> `*@x.com`).
- Return the same `email_masked` + `user_id` on the `already_verified` branch too
  (so the page can still show the right-account / different-account state).
- Returning the verified account's masked email + id is acceptable: the token is
  the secret proving ownership of THAT account, so it exposes nothing new. Still no
  session is read or set. No change to token rules (single-use, 7-day expiry).

### Frontend change (VerifyEmail.jsx) - decide display from (session user) vs (verified account)
After a successful verify call, read the signed-in user from `useAuth()` and
branch on four runtime states. While `useAuth().loading` is true, keep showing
"Verifying..." so we never flash the wrong message.

1. LOGGED OUT (no session user):
   - Show success: "Email verified for <email_masked>. You can sign in now."
   - Primary action: "Sign in" -> `/login`.
   - Do NOT call `refresh()` (there is no session to refresh).

2. SAME ACCOUNT (signed-in `user.user_id` === returned `user_id`, or emails match):
   - Keep the clear success path: "Email verified. Your account is fully active."
   - Primary action: "Go to the app" -> `/community`.
   - Call `refresh()` so the signed-in user's own verify banner/lock clears. This
     is the ONLY case where `refresh()` runs.

3. DIFFERENT ACCOUNT (session user exists and differs from the verified account):
   - Show the plain warning Jenn asked for:
     "Email verified for <email_masked>. You are currently signed in as
     <current account label>. Sign out and sign in with the verified account to
     continue."
   - Primary action: "Sign out" (calls `logout()` from AuthContext, which posts
     `/auth/logout` and lands on `/` or `/login`). Secondary (optional, see Q1):
     "Stay signed in as <current account>" link that just dismisses to the app.
   - Do NOT show "Your account is fully active".
   - Do NOT call `refresh()`; do NOT touch or re-render the signed-in user's
     verified banner/lock (the admin account was not the one verified).
   - `<current account label>`: use the signed-in `user`'s name or masked email
     (NOT the verified one), so it is clearly a different identity.

4. ALREADY VERIFIED (`already_verified: true`): same three-way branch as above
   using the returned `email_masked`/`user_id`, with wording "This email is already
   verified" instead of "Email verified".

Error states (unchanged, already handled):
- EXPIRED or USED token -> backend 400 -> page shows "Link invalid or expired.
  Sign in and tap Resend email to get a fresh link." -> "Sign in" link. (No
  account comparison needed; nothing was verified.)
- MISSING token -> same error panel.

24-hour verification window:
- The verify action lifts the token account's unverified lock. The page itself does
  not need a countdown. The key rule: in the DIFFERENT-ACCOUNT case we must NOT run
  `refresh()` or alter the signed-in admin's banner, so the admin's own lock/grace
  state is never changed by someone else's verification.

================================================================================
## 3) Mobile equivalent (deep link) + change-email
- No mobile code change is required: verification/change-email links open the web
  page in the phone browser, so the web fix covers the phone-tap case too.
- In-app `VerifyGate` / `VerifyBanner` are unaffected (they verify the logged-in
  user via send-verification, never another account).
- change-email: covered automatically (same `/verify-email` page).
- Optional future nicety (NOT in this scope): a real mobile deep link
  (`mobile://verify?token=`) that verifies in-app. Flagged as a separate idea;
  recommend NOT doing it now to keep scope tight. See Q4.

================================================================================
## 4) Other emailed-link flows - should they show the same different-account warning?
- PASSWORD RESET (`frontend/src/pages/ResetPassword.jsx` + `POST
  /auth/reset-password`): token-scoped, acts on the token's user, deletes that
  user's sessions, requires the person to type a new password and then "Sign in".
  It never says "your account" ambiguously and forces a manual sign-in, so the
  confusion risk is LOWER. RECOMMENDATION: add a light, optional note only - if a
  session exists, show "You are signed in as <current account>. This reset is for a
  different account." above the form. Low priority; can be deferred. See Q3.
- CHANGE-EMAIL: same page as verify -> covered by the main fix.
- INVITES: no invite-link flow exists in the codebase today (no invite token route
  found). Nothing to change. If invites are added later they should reuse this same
  different-account pattern.
- FORGOT-PASSWORD / WELCOME / LAPSE emails: these contain no account-mutating token
  link that could be opened in a foreign session, so no change.

================================================================================
## 5) Files, risks, test plan, size, shipping

### Files to change (when approved)
- `backend/routers/auth_router.py` - `verify_email()` returns `email_masked` +
  `user_id` (+ on already_verified); add `_mask_email()` helper. ~15 lines.
- `frontend/src/pages/VerifyEmail.jsx` - four-way success rendering + conditional
  `refresh()` + sign-out action. ~40-60 lines (rewrite of the done-state block).
- `frontend/src/pages/ResetPassword.jsx` - OPTIONAL light different-account note
  (only if Jenn says yes to Q3). ~10 lines.
- No mobile files. No `.env`. No new deps.

### Risks (all low)
- Must gate the success branch on `useAuth().loading === false` so we do not flash
  "same account" before `/auth/me` resolves, then correct it. Mitigation: keep the
  "Verifying..." state until both the verify call AND auth loading settle.
- Comparing identity: prefer `user_id` equality; fall back to case-insensitive
  email match only if ids are missing. Avoids false "different account".
- `logout()` currently redirects to `/` (AuthContext.jsx:34). Confirm desired
  landing for the sign-out action (login vs home) - see Q1.
- Returning `user_id` from an unauthenticated endpoint: acceptable (token proves
  ownership); double-check no other caller depends on the old exact `{ok:true}`
  shape (VerifyEmail.jsx ignores the body today, so safe).

### Test plan (temporary accounts, ZERO residue, no testing agent)
Backend (curl + a Mongo-seeded token row, temp `_fttest` tag):
- Seed temp user A (new free) + a real `email_verifications` token row; call
  `/auth/verify-email` -> assert `ok`, `email_masked` shape, `user_id` == A.
- Re-call with same token -> assert "expired/used" 400.
- Seed user B already verified + token -> assert `already_verified:true` +
  masked email returned.
Browser at phone width (390px), using temp sessions:
- Logged OUT: open `/verify-email?token=<A>` -> generic success + "Sign in", no
  refresh call.
- Signed in as the SAME account A: -> "Your account is fully active" + banner
  clears.
- Signed in as a DIFFERENT account (temp "admin" B): open A's link -> warning names
  the masked A email AND shows "signed in as B", "Sign out" works, B's banner does
  NOT change, B stays B.
- Expired/used token -> error panel.
Cleanup: delete all temp users, sessions, and `email_verifications`/token rows by
tag; assert residue 0. (Same zero-residue script pattern used in FREE-TIER-BUILD-1.)

### Size estimate
SMALL. ~2-4 hours including the zero-residue test and phone-width browser checks.

### Ship before launch?
RECOMMEND YES for the verify-page fix (items in section 2). It is small, low-risk,
and directly removes the exact confusion Jenn hit - which staff/admins will keep
hitting while testing. It is not a security blocker (no vulnerability), so if the
launch is time-boxed it can slip to immediately after launch. The optional reset-
password note (Q3) is post-launch.

================================================================================
## Questions for Jenn (no assumptions)
- Q1 Sign-out action in the different-account case: (a) a single "Sign out" button
  that logs out and lands on the sign-in page (recommended), with a secondary
  "Stay signed in as <current account>" link; or (b) sign-out only, no "stay"
  option? And after sign-out, land on /login or the home page?
- Q2 Show the masked email `j***@domain.com` on the success/warning (recommended,
  clearer), or keep it vague as "a different account" with no email shown?
- Q3 Apply the same "signed in as a different account" note to the PASSWORD RESET
  page now, or leave reset as-is for this task (recommended: defer)?
- Q4 Leave mobile as "opens in the phone browser" (recommended, no mobile code), or
  do you want a native in-app verify deep link later (separate task)?
- Q5 Any exact wording you want for the different-account message, or is the draft
  in section 2 good to implement?
