# SECURITY-2 Report (web + backend)

Standing rules honored: no testing agent (curl + requests scripts + read-only DB checks + py_compile +
one browser smoke), no em dashes, and NO password, hash, key or session token printed anywhere. Did not
touch billing, email setup, scrapers or account deletion. Build stamp bumped (rv3a-11 -> rv3a-12).
All testing used temp data only and was cleaned up (0 residue). Jenn confirmed Google sign-in works
for jenn@sailmorenow.com before Part 1.

## PART 1 - admin is now Google-only

(a) Removed the admin's password login and blocked the password form from reaching ANY admin account.
- The admin account is `captain_jenn` / `jenn@sailmorenow.com`, platform_role admin.
- On startup the backend now strips any stored password hash from every admin account
  (`password_hash` unset) and the login endpoint refuses password login for admin accounts, returning
  401 "Admin accounts sign in with Google." (unless break-glass is armed - Part 2).
- Verified: admin count = 1, admins-with-password = 0; a password login attempt to the admin email
  returns 401 with the Google message; `require_admin` still authorizes `captain_jenn` after a fresh
  Google session (list-admins returned 200). BROWSER: /admin/access route loads and the guard
  redirects a signed-out visitor cleanly (no crash).

(b) Removed ADMIN_PASSWORD from backend/.env and from code.
- Deleted the ADMIN_PASSWORD line from backend/.env (value never printed). ADMIN_EMAILS remains (now
  bootstrap-only).
- server.py no longer reads ADMIN_PASSWORD; the old password-seeding block was replaced with a
  Google-only bootstrap (create/promote the first admin with NO password, then strip password hashes
  from admins).
- What depended on it: the legacy manual test scripts in backend/tests/*.py read
  os.environ.get("ADMIN_PASSWORD") to log in as admin via password. With the key gone (and admin
  password login removed) those scripts can no longer authenticate as admin; they are legacy and were
  left in place. Nothing in the running app depended on ADMIN_PASSWORD other than the old seeder.
- NOTE for Jenn: if ADMIN_PASSWORD was also stored in the secure secrets manager, remove it there too.

(c) /root/security1_offtree_backups/ (moved in SECURITY-1) - contents, names only:
    migration_backups/cleanup_backup_20261012_211128
    migration_backups/cleanup_backup_20261012_220207_stage3
    migration_backups/cleanup_backup_20261012_213730
    migration_backups/users_before_org_status_20261012_054317.json
  Nothing in the app reads this location. The only code mentioning "migration_backups" is the one-off
  script backend/migrations/split_boat_pro_identity.py, which WRITES to its own
  backend/migrations/migration_backups/<stamp>/ when run manually - a different path - and never reads
  the moved folder. Not deleted.

## PART 2 - break-glass recovery (Option A), off by default

New module backend/break_glass.py. Controlled ONLY by environment variables (never in the repo):
  BREAK_GLASS_ENABLED=1
  BREAK_GLASS_EMAIL=<the admin email>
  BREAK_GLASS_PASSWORD_HASH=<bcrypt hash of a freshly chosen password>   (never plaintext)
  BREAK_GLASS_WINDOW_MINUTES=30   (optional; default 30, hard-capped at 60)

- Off by default: with no env vars set, admin password login stays blocked.
- Auto-expiry: proposed 30 minutes (capped at 60). The window starts the first time it is seen and is
  tracked in app_settings; re-arming with a new hash resets the clock. After expiry, password login is
  refused again even if the flag is left on.
- Password never stored in plain text: the environment carries only a bcrypt HASH. To create it without
  the plaintext ever touching a file or log, run locally and paste only the printed hash:
    python -c "import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass().encode(),bcrypt.gensalt()).decode())"
- Audit + email: every successful break-glass login writes an audit_logs entry and emails
  ADMIN_NOTIFY_EMAIL ("Break-glass admin login used").
- Rate limits: the normal tiered login lockout applies (5 fails per IP+email -> 15 min, 10 per account
  -> 30 min, 30 per IP -> 60 min).

How Jenn uses it / turns it off:
  1. Generate a fresh bcrypt hash locally (command above) for a one-time password she chooses now.
  2. Set BREAK_GLASS_ENABLED=1, BREAK_GLASS_EMAIL=jenn@sailmorenow.com, BREAK_GLASS_PASSWORD_HASH=<hash>
     through the secure environment (not the repo).
  3. Sign in with email + that password within 30 minutes. A confirmation email is sent.
  4. Turn OFF: clear BREAK_GLASS_ENABLED (or all three). It also auto-expires after 30 minutes.

## PART 3 - give someone else admin access

Risk assessed BEFORE the change and reported in chat (not serious, proceeded): previously is_admin was
true for platform_role admin OR email in ADMIN_EMAILS, and every login RESET platform_role to None for
anyone not in that env list - so a DB-granted admin would be demoted on next login. Fixed safely.

Change made:
- is_admin() is now DB-authoritative (platform_role == "admin" only). ADMIN_EMAILS is used ONLY to
  bootstrap/promote the first admin on an empty database (server.py); it no longer grants access at
  request time.
- Login and Google-session role sync are now PROMOTE-ONLY: the env list can promote, but never demotes
  a DB-granted admin. Verified the current sole admin keeps platform_role admin.

New admin-only page "Admin access" (/admin/access, web) + router backend/routers/admin_access_router.py:
- An admin enters an existing account's email + a REQUIRED reason and clicks Grant.
- The target must have signed in with Google at least once (auth_google) and have a verified email
  (email_verified) - both are stamped by /auth/session. FULL admin only (no limited roles).
- The granting admin must RE-AUTHENTICATE with Google immediately before the action takes effect: the
  page sends them through a fresh Google sign-in, /auth/session stamps last_reauth_at, and the grant
  requires last_reauth_at within 120 seconds (else 401 reauth_required).
- Granting strips the target's password hash (admins are Google-only) and records granted_by /
  granted_at / reason.
- Revoke works the same way (re-auth required). The LAST remaining admin can never be revoked (400).
- Every grant/revoke writes audit_logs and emails ADMIN_NOTIFY_EMAIL.
- The page lists current admins with who granted and when.

## What was browser-verified vs code-only
- BROWSER-VERIFIED (web): /admin/access route loads; the guard redirects a signed-out visitor to home
  with no crash (page compiles and is wired).
- CODE + BACKEND-API VERIFIED (not browser): the authed Admin access UI and all grant/revoke/list
  behavior. I did not seed a session-token cookie in the browser because a session token is a bearer
  secret I will not print. Backend verified end-to-end against localhost with a seeded admin session and
  a throwaway target:
    - admin count 1, admins-with-password 0
    - admin password login -> 401 (Google message)
    - list admins: no-auth 401, admin 200
    - grant: non-Google target 400, missing reason 400, success 200 (target promoted, password stripped,
      granted_by recorded)
    - stale re-auth -> 401 reauth_required; fresh -> revoke 200
    - cannot remove last admin -> 400
  All temp data removed afterward (0 residue; jenn.last_reauth_at unset).

## Files changed (SECURITY-2)
- backend/break_glass.py (new)
- backend/routers/admin_access_router.py (new)
- backend/deps.py (is_admin DB-authoritative; count_admins helper)
- backend/routers/auth_router.py (admin password login blocked + break-glass path; /auth/session stamps
  auth_google/email_verified/last_reauth_at; promote-only sync)
- backend/server.py (register admin_access_router; Google-only admin bootstrap; strip admin passwords)
- backend/.env (removed ADMIN_PASSWORD)
- frontend/src/pages/AdminAccess.jsx (new)
- frontend/src/App.js (route /admin/access)
- frontend/src/pages/AdminHome.jsx (portal card)
- mobile/src/lib/buildStamp.ts (rv3a-11 -> rv3a-12)
