# PROD-READINESS-1_REPORT - First Publish readiness for app.sailmorenow.com

READ-ONLY. Nothing changed, nothing clicked, no secrets entered, no purchases. Hyphens
only. Tags: [VERIFIED-CODE] = read from this repo; [INFERRED] = reasoned / platform
behavior not in the repo. Backend reads env via `os.environ.get(...)` with defaults
except two hard subscripts (see section 5). Frontend build reads only
REACT_APP_BACKEND_URL (+ NODE_ENV).

Launch note that reframes several answers: the production domain IS
app.sailmorenow.com, which is exactly the domain hard-coded as the default in email
links and CORS behavior, so most "hardcoded URL" items below are already CORRECT for
this launch and need no change.

---

## (1) Environment variables (names only) - who injects what

### A. Auto-injected by production (Jenn does nothing) [per Emergent docs]
- MONGO_URL, DB_NAME - DB connection (hard-required, see section 5).
- REACT_APP_BACKEND_URL - web build's API base.
- CORS_ORIGINS - injected, but NOT read anywhere in the backend (see section 4); no
  effect either way. [VERIFIED-CODE: not in the env-read set.]

### B. Emergent-managed secrets (already in Secrets; carry automatically on Publish)
- EMERGENT_EMAIL_KEY - managed Resend proxy; the mailer sends through this when
  RESEND_API_KEY is unset, so email works in prod with zero extra config.
  [VERIFIED-CODE mailer.py:45,189.]
- EMERGENT_LLM_KEY - also the auth key for Emergent OBJECT STORAGE (avatars, images,
  dispute files). [VERIFIED-CODE storage.py:15.]
- STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_ACCOUNT_ID, STRIPE_WEBHOOK_SECRET,
  STRIPE_MODE, STRIPE_API_KEY - managed by the claimable-sandbox / Go-live flow (see
  STRIPE-CLAIM-VS-REMOVE-1 and STRIPE-EXPIRY-CHECK-1). Jenn does not hand-set these.

### C. Jenn SHOULD set / confirm in Manage -> Secrets before first Publish
Each with what happens if missing [VERIFIED-CODE unless noted]:
- ADMIN_EMAILS - IMPORTANT. Bootstraps/promotes the first admin on boot (server.py
  118-147) and is a recipient source for admin digests. If missing, NO admin is
  auto-seeded. Set this to Jenn's admin Google email. (It already has test+live slots
  in Secrets - confirm the LIVE slot holds the right email.)
- EMAIL_LOGO_URL - logo in emails; if unset the logo may not render. Recommend set to
  a URL that resolves on the prod domain.
- APP_PUBLIC_URL - base for some email links; DEFAULT is https://app.sailmorenow.com
  (mailer.py:1229), which is already correct, so optional but recommended to set
  explicitly to the prod domain.
- APP_BASE_URL - falls back to APP_PUBLIC_URL then the hardcoded prod domain; optional.
- EMAIL_FROM_NAME - default "Sail More Now" (mailer.py:23); optional.
- EMAIL_FROM_ADDRESS / RESEND_FROM_EMAIL - sender; default
  notifications@notifications.sailmorenow.com. The sending DOMAIN must be verified in
  the Resend/managed-email account (account-level) - confirm before launch.
- RESEND_API_KEY - OPTIONAL. If unset, email still sends via EMERGENT_EMAIL_KEY. Set
  only to send from Jenn's own Resend account/domain.
- ADMIN_NOTIFY_EMAIL - default admin@sailmorenow.com; CONTACT_INBOX_EMAIL - default
  customersupport@sailmorenow.com. Confirm these inboxes exist/are monitored.
- VAPID_SUBJECT - web-push contact; default mailto:hello@sailmorenow.com; optional.
- RESEND_WEBHOOK_SECRET - if unset, inbound Resend webhook events are accepted UNSIGNED
  with a logged warning (hub_router.py:196). Set it if the Resend webhook is used.
- STRIPE_IDENTITY_WEBHOOK_SECRET - only if Stripe Identity verification is used.
- Zoho keys (ZOHO_ACCOUNTS_URL, ZOHO_CLIENT_ID/SECRET, ZOHO_REFRESH_TOKEN,
  ZOHO_CAMPAIGNS_* , ZOHO_CRM_* , ZOHO_SECRETS_KEY, etc.) - only needed if Zoho
  Campaigns/CRM is turned on. Currently INACTIVE and a no-op if unset (sync logs
  "skip"). Leave unset unless launching Zoho.
- APP_STORE_URL, GOOGLE_PLAY_URL - store links for the mobile app; Secrets slots are
  currently empty. Optional until the mobile apps are published.

### D. TEST-ONLY - do NOT set in production
ADMIN_PASSWORD, ADMIN_TOKEN, FREE_TOKEN, PREMIUM_TOKEN, SMN_ALLOW_RESTART, CLEANUP,
PYTEST_XDIST_WORKER - referenced only by tests. Setting them in prod is unnecessary and
ADMIN_* could create risk; leave them unset. [VERIFIED-CODE: no non-test references.]

### Frontend build
- Only REACT_APP_BACKEND_URL (auto-injected) and NODE_ENV. No secrets needed in the web
  build. [VERIFIED-CODE: only two process.env reads.]

## (2) File writes outside /tmp and where uploaded photos live

- Uploaded photos/images (avatars, sponsor images, dispute attachments) go to EMERGENT
  OBJECT STORAGE via storage.py `put_object` (HTTP to the integrations proxy). Only a
  RELATIVE PATH string is stored in Mongo (e.g. user.picture = "/api/files/..."); the
  bytes are NOT in Mongo and NOT on local disk. Files are served back through the
  authenticated/by-path backend endpoint (`/api/files/{path}`), and private dispute
  files only through an authed endpoint. [VERIFIED-CODE storage.py,
  storage_router.py:40-48,67-73, review_disputes_router.py:376-385.]
- Object storage uses INTEGRATION_PROXY_URL (default integrations.emergentagent.com) +
  EMERGENT_LLM_KEY, both managed, so uploads work in prod with no extra config.
  [VERIFIED-CODE.]
- WHAT HAPPENS IN PROD / RISK [INFERRED]: whether the object store is PROJECT-scoped
  (so images uploaded in preview are still reachable from prod) or ENVIRONMENT-scoped
  (preview URLs could 404 in prod) is NOT determinable from the repo. Flag to confirm
  with Emergent. Already tracked as BILLING-PLAN-1 item (h).
- No app-runtime code writes to local disk. The only files written outside /tmp are
  from STANDALONE maintenance scripts (dedup_apply.py, bod_fix.py, pacific2_repair.py,
  tropical_fix.py, events_recat.py, migrations/*) that dump JSON backups into
  /app/backend/. These are run by hand, NEVER at boot or by the server, so the
  read-only prod filesystem does not affect the running app. (If anyone runs those
  scripts in prod they will fail at open-for-write - run them in preview instead.)
  [VERIFIED-CODE.] mailer.py only READS template files from email_templates/ (fine on a
  read-only FS). [VERIFIED-CODE mailer.py:926.]

## (3) Scraper + scheduled/background jobs

- START + PROCESS: an APScheduler AsyncIOScheduler is started in-process at startup
  (server.py:211 -> scheduler.start_scheduler) and runs INSIDE the backend web process -
  there is no separate worker. [VERIFIED-CODE.]
- EVENTS SCRAPER (aggregator.py): fetches external event sources (list + a
  SailMoreNow User-Agent in event_sources.py) over HTTP via curl/requests. Runs weekly
  (Sundays 03:00 PT) plus a one-time startup catch-up if it has not run in >8 days,
  guarded by an `aggregator_lock` doc in Mongo. External deps: the public event-source
  sites only; NO API keys. [VERIFIED-CODE scheduler.py:24-32,225-259, aggregator.py.]
- ALL JOBS (in-process, America/Los_Angeles): weekly aggregator sync; nightly expiry /
  win-back / lapse / renewal reminders (02:15); zoho outbox drain (every 2 min); zoho
  nightly (02:45); Sunday community digest (08:00 Sun); Monday admin report digest
  (08:30 Mon); contact-reply retry (every 3h); hourly event reminders; import-contact
  digest (Mon 09:00); volunteer reminders (09:00); review nudges (10:00); trial-ending
  (09:30); promo-ending (09:40); comp-expiry (02:05). [VERIFIED-CODE scheduler.py
  start_scheduler.]
- EXTERNAL SERVICES / KEYS used by jobs: email (EMERGENT_EMAIL_KEY or RESEND_API_KEY);
  Zoho jobs (ZOHO_*, currently inactive -> no-op); aggregator (public HTTP, no key).
  [VERIFIED-CODE.]
- TWO INSTANCES RUNNING (the main scaling caution) [VERIFIED claims + INFERRED risk]:
  if prod runs MORE THAN ONE backend replica, each boots its OWN scheduler and jobs
  would fire on every replica. Many jobs already guard against double-work with atomic
  Mongo claims/CAS (Sunday digest `digest_sent_at` claim, Monday admin digest
  claim+unique index, contact-retry 1-minute lease, aggregator lock doc, review-reminder
  per-mark claim). Others dedupe via per-doc flags / notification lookups that are
  idempotent but race-prone. So a multi-replica deploy risks occasional DUPLICATE emails
  on the non-CAS paths. RECOMMENDATION: run the backend as a SINGLE instance in prod (or
  confirm the platform does), at least through launch.
- RATE LIMITS / FAILURE HANDLING: every job is wrapped in try/except and logs on
  failure; the aggregator uses HTTP timeouts and a stale/overlap lock; the Zoho outbox
  retries from a durable outbox; contact-reply retry is capped at 5 attempts with a
  lease. [VERIFIED-CODE.]
- RECOMMEND BEFORE LAUNCH: (a) confirm single backend instance (or scheduler guard);
  (b) confirm the email sending domain is verified so the nightly/weekly jobs do not
  bounce; (c) watch the first startup aggregator catch-up in logs so the events feed is
  populated on the prod domain.

## (4) CORS_ORIGINS and hardcoded preview URLs

- CORS: CORS_ORIGINS is NOT read by the backend. CORS is a custom middleware
  (server.py:75-94) that, per request, echoes the Origin + allows credentials when the
  session cookie is present (web) and otherwise returns "*" (mobile/Bearer). It adapts
  to ANY origin automatically, so NOTHING needs changing for app.sailmorenow.com.
  [VERIFIED-CODE.]
- NO hardcoded PREVIEW (*.preview.emergentagent.com) URLs exist in backend or web src.
  [VERIFIED-CODE: grep found none.]
- Hardcoded PRODUCTION URLs that are already correct for this launch (app_url / email
  link defaults = https://app.sailmorenow.com) in scheduler.py:341,544,632;
  admin_router; messaging_router; community_router:1530,1833; auth_router welcome/verify;
  and the APP_PUBLIC_URL default. Because the prod domain IS app.sailmorenow.com, these
  need no change. [VERIFIED-CODE.] CAUTION: they are literals, not env-driven, so if the
  domain ever changes they must be updated in code (or routed through APP_PUBLIC_URL).
- Sender address literal notifications@notifications.sailmorenow.com (auth_router,
  mailer) - its DOMAIN must be verified for sending in the email account. [VERIFIED-CODE;
  verification status INFERRED - confirm.]
- Managed-service base URLs (storage.py / mailer EMAIL_BASE_URL = integrations
  .emergentagent.com; constants.py:81 EMERGENT_AUTH_SESSION_URL = demobackend
  .emergentagent.com) are the standard Emergent-managed endpoints, environment-agnostic,
  and correct in prod. [VERIFIED-CODE; prod-correctness INFERRED - standard managed URLs.]

## (5) What would crash on boot in production

- The ONLY hard boot dependency: MONGO_URL and DB_NAME, read as hard subscripts at
  import time in deps.py:17-18 (`os.environ["MONGO_URL"]`, `os.environ["DB_NAME"]`).
  deps is imported by server.py at module load, so a missing value raises KeyError and
  the backend fails to boot. Both are AUTO-INJECTED in prod, so this is safe - but it is
  the single thing that must be present. [VERIFIED-CODE.]
- Everything else is resilient: all other env reads use `.get(...)` with defaults, and
  the entire startup body (index creation, admin bootstrap, migrations, scheduler start,
  object-storage init, seeds) is wrapped in try/except, so a failure in any of those is
  LOGGED and does not crash the process. Object-storage init failure specifically falls
  back to lazy retry. [VERIFIED-CODE server.py:97-298.]
- No import-time network calls that could hang boot (storage/LLM/Stripe clients are
  created lazily or guarded). Scheduler start is inside try/except. [VERIFIED-CODE.]
- The hard-subscript maintenance scripts (dedup_*, *_fix, migrations) are NOT imported
  by the server, so they cannot crash boot. [VERIFIED-CODE.]

## (6) Pre-Publish checklist for Jenn (ordered) - [J] = only Jenn can do

1. [J] In Manage -> Secrets, set the LIVE slot of ADMIN_EMAILS to your admin Google
   email (so the admin account seeds on first prod boot). CONFIRM it is correct.
2. [J] Confirm the email sending domain (notifications.sailmorenow.com) is verified in
   the email account; set EMAIL_LOGO_URL (and optionally APP_PUBLIC_URL, EMAIL_FROM_NAME)
   in the LIVE slot. RESEND_API_KEY is optional (managed email works without it).
3. [J] Confirm ADMIN_NOTIFY_EMAIL and CONTACT_INBOX_EMAIL inboxes exist and are
   monitored (defaults admin@ / customersupport@sailmorenow.com).
4. [J] Leave test-only vars UNSET (ADMIN_PASSWORD, ADMIN_TOKEN, FREE_TOKEN,
   PREMIUM_TOKEN, SMN_ALLOW_RESTART, CLEANUP). Leave Zoho and store-URL vars unset unless
   launching those features.
5. [J + Emergent] Confirm with Emergent: (a) the backend runs as a SINGLE instance in
   prod (or the scheduler is guarded) to avoid duplicate scheduled emails; (b) object
   storage is project-scoped so existing image URLs resolve on the prod domain; (c) the
   prod DB (MONGO_URL/DB_NAME) is the intended production database.
6. [J] Stripe for real money: this is a SEPARATE Go-live (see STRIPE-EXPIRY-CHECK-1 /
   BILLING-PLAN-1) - not covered by this web Publish. If launch takes payments, complete
   Go live, run the live catalog, and activate the live portal first.
7. [J] Publish. Then verify on app.sailmorenow.com: sign in as admin, load the events
   feed (watch logs for the startup aggregator catch-up), upload a profile photo (object
   storage), and send yourself one test email (links + logo render).

Nothing here requires a code change for a correct app.sailmorenow.com launch. The
code-level cautions (hardcoded domain literals, single-instance scheduler) are noted for
future awareness, not blockers.

Sources: this repo (server.py, deps.py, storage.py, storage_router.py, scheduler.py,
aggregator.py, event_sources.py, mailer.py, routers/*); Emergent prod env-injection
docs (as stated by Jenn); cross-ref BILLING-PLAN-1 (items h, i, k),
STRIPE-EXPIRY-CHECK-1.
