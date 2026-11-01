# SECURITY-1 Report - Step 1 (web + backend)

Standing rules honored: no testing agent (curl + read-only DB scripts + py_compile), no em dashes,
and NO password, hash or key is printed anywhere in this report. Did not touch billing, email setup,
scrapers or account deletion. Build stamp bumped (rv3a-10 -> rv3a-11). Step 2 NOT started
(waiting for Jenn to confirm Google sign-in works).

## (a) Link Google to the admin account - what Jenn clicks + how linking works
Account linking is automatic by email, so there is no separate "link" button. The admin account is
handle `captain_jenn`, email `jenn@sailmorenow.com`, role admin (that email is in ADMIN_EMAILS), so
a Google sign-in with the SAME email lands on the SAME account.

Steps for Jenn (web): sign out -> on the sign-in screen click "Continue with Google" -> choose the
Google account whose email is exactly `jenn@sailmorenow.com`. The app sends the Google session to
`POST /api/auth/session`, which finds the existing user by email (lowercased), signs in as
`captain_jenn`, and re-syncs admin role. Her password is NOT removed (left intact per Step 1).

How matching works: `/api/auth/session` matches ONLY by email. A Google-only account and a
password account with the same email are the same record (one email = one account). Admin role is
re-derived from ADMIN_EMAILS on every login, so the Google session keeps admin.

Duplicate-account risk: the only risk is using a DIFFERENT Google email. If Jenn signs in with a
Google account whose email is not `jenn@sailmorenow.com`, a NEW separate account is created and it
would NOT be admin (its email is not in ADMIN_EMAILS). There is no provider/identity field stored,
so linking is purely by exact (lowercased) email string. Recommendation (not built): add an explicit
provider/identities list and an in-app link/confirm step before we rely on Google-only.

## (b) Deleted test_credentials.md + scrubbed plaintext passwords (names + counts only)
- Deleted: `/app/memory/test_credentials.md` (1 file; contained the admin + a sample password).
- Scrubbed the real admin password literal out of code/history:
  - 15 files under `/app/backend/tests/*.py`: replaced the hardcoded literal with
    `os.environ.get("ADMIN_PASSWORD", "")` (all have `import os`; all still compile).
  - 29 files under `/app/test_reports/iteration_*.json`: replaced the literal with `[REDACTED]`.
- Left in place on purpose: the password-strength TEST VECTORS in
  `backend/tests/test_iter87_regression.py` (intentional weak/strong inputs to assert the policy,
  not real credentials).
- `/app/auth_testing.md`: scanned, no real password present.
- `backend/.env` still holds ADMIN_PASSWORD - this is the designated secret store and seeds the admin
  account; it is NOT a file/report/script and was left untouched (will become moot after Step 2).
- Verified: no file under /app (excluding backend/.env) still contains the real admin password.

## (c) migration_backups (contained password hashes)
- `backend/migration_backups/` (3 cleanup_backup_* folders + 1 users_before_org_status_*.json,
  all point-in-time user snapshots that include bcrypt hashes) was MOVED out of the app tree to
  `/root/security1_offtree_backups/migration_backups/`.
- Why move, not delete: they are one-off migration safety snapshots, not used by the app at runtime,
  so they do not belong in the repo; moving removes the hashes from /app while keeping a recoverable
  copy off-tree in case a restore is ever needed. Nothing else was deleted.

## (d) READ-ONLY inventory - password-login accounts created for testing (nothing deleted)
44 accounts have a password login; 9 look test/seed/demo/temp by email or username. Jenn decides
later which to delete. `raejen*` and alpha testers are flagged keep. Hashes never read into this
report; "known/default password" means the stored hash matched a known test/default value when
checked in memory (value never shown).

Test-like password accounts (username | type | known/default pw):
- demohost | sailor | no
- feedtester | sailor | no
- jenntest | sailor | no
- misstest | boat_pro | no
- shilsholesailingsoci | partner | YES (uses a known default)
- testacctcreation | sailor | no
- stripetester | boat_pro | no  (Jenn's Stripe test account family - keep until billing testing done)
- stripetest2 | boat_pro | no  (keep until billing testing done)
- moreteststripe | boat_pro | no  (keep until billing testing done)

Keep-for-now (Jenn's own / alpha): raejenwaters, moreteststripe, stripetest2, stripetester.
Admin account captain_jenn uses the env admin password (known) - stays until Step 2 makes it
Google-only. The other ~33 password accounts are non-test-pattern alpha/real users.

## (e) Rate limiting + temporary lockout - numbers chosen
LOGIN (backend/routers/auth_router.py) - three independent counters in db.login_attempts, each
locks its own key when its limit is hit; a successful login clears all three:
- Per IP + account (combo): 5 failed attempts -> 15 minute lockout.  (kept existing)
- Per account (email, across all IPs): 10 failed attempts -> 30 minute lockout.  (NEW - stops a
  targeted account even when the attacker rotates IPs)
- Per IP (across all accounts): 30 failed attempts -> 60 minute lockout.  (NEW - stops one IP
  spraying many accounts)
A locked request returns HTTP 429. A password reset clears the account's login lockout.
Also fixed a latent bug: the stored lockout timestamp came back from Mongo as naive and crashed the
comparison (500); it is now coerced to UTC.

PASSWORD RESET (unchanged, already in place; confirmed the numbers):
- Per account (email): max 3 reset requests per hour.
- Per IP: max 10 reset requests per hour.
Over the limit, the endpoint silently sends nothing and still returns the same generic 200 (no user
enumeration).

Verified with a throwaway email against localhost (6th attempt -> 429), then the throwaway
rate-limit counters were deleted. No real account was locked.

## (f) PROPOSED (not built) - admin recovery if Google sign-in fails
Option A (recommended) - server-side break-glass switch, off by default: an env flag (e.g.
ADMIN_PASSWORD_LOGIN_ENABLED) that, only when turned on by someone with server/.env access,
re-enables email+password login for the admin account for a short window. Risk: anyone with .env
access can flip it; mitigate by keeping it off, auditing the flip, and auto-expiring it.
Option B - one-time recovery codes held OFF-app: generate a small set of single-use codes, show them
to Jenn ONCE, store only their hashes, and accept one at a sign-in "recovery" step to issue a session.
Risk: the codes are bearer secrets - if lost or captured they grant admin; mitigate with hashing,
single use, expiry, and printing/storing them in a password manager, not in the app.
Option C - keep a second admin account (another email in ADMIN_EMAILS) with its own Google login, so
there are always two independent ways in. Risk: a second admin is a second attack surface.
Common risk across all: any always-available recovery path is also an attack path; keep it off by
default, audited, time-boxed, and never stored in the repo.

## Files changed (Step 1)
- backend/routers/auth_router.py (tiered login lockout + naive-datetime fix)
- 15 backend/tests/*.py (admin password literal -> env lookup)
- 29 test_reports/iteration_*.json (admin password redacted)
- mobile/src/lib/buildStamp.ts (rv3a-10 -> rv3a-11)
- Deleted: memory/test_credentials.md
- Moved out of tree: backend/migration_backups/ -> /root/security1_offtree_backups/

## STEP 2 (pending Jenn's go-ahead in chat)
After Jenn confirms Google sign-in lands on the admin account: remove the admin account's
password_hash (Google-only), do the same for any other admin-role accounts, confirm admin pages load
after a fresh Google sign-in, and check nothing re-seeds the admin password on startup.
