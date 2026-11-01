# PUBLISH-0 — Publish & Custom-Domain Report (REPORT ONLY, no code/DNS/store changes)

Date: 2026-06-24. Scope: how to publish the web app to a custom domain and ship mobile to the App Store + Google Play. Platform facts below are from current Emergent publish/custom-domain docs (via support agent); app-specific facts are from the codebase.

---

## 1) What "Publish" does to THIS app
- **URLs**: Publish creates a SEPARATE production deployment (default host `<appname>.emergent.host`) distinct from the preview `marina-connect-11.preview.emergentagent.com`. Initial deploy ~10-15 min.
- **Database**: On the FIRST deploy, the preview MongoDB data is copied ONE TIME into a new, independent production database. After that, preview and production DBs are fully separate - edits in one never appear in the other. Production does NOT start empty on first publish; it starts as a copy of whatever is in preview at that moment. (=> clean the preview DB BEFORE first publish - see section 6.)
- **Uploaded files / object storage**: Preview and production do NOT share storage. Our attachments use Emergent Object Store (external, persistent) via `storage_router.py`, so stored files persist across redeploys; anything written to local container disk is ephemeral and lost on redeploy. Object-store contents are per-environment.
- **Env vars & secrets**: Platform keys (`REACT_APP_BACKEND_URL`, `MONGO_URL`, `DB_NAME`) are auto-set to production values on first deploy. Our CUSTOM backend env values (APP_BASE_URL, APP_PUBLIC_URL, ZOHO_*, STRIPE_API_KEY, ADMIN_*, EMERGENT_* etc.) are copied from the preview `.env` on first deploy, then PRESERVED on later redeploys. To change a production secret you edit it in Manage Publishes -> Secrets, then redeploy. IMPORTANT: because APP_BASE_URL/APP_PUBLIC_URL currently hold the PREVIEW url, they will carry the preview url into production unless updated (section 3).
- **Preview vs production afterward**: separate deployment + separate DB + separate storage. Preview edits do NOT auto-affect production; a **Republish** is required to push new code to production.

## 2) Custom domain
### Subdomain app.sailmorenow.com (simplest, recommended for launch)
Steps: (1) In Emergent -> Manage Publishes -> Domain, add `app.sailmorenow.com`. (2) At Squarespace DNS add the A record(s) Emergent shows for the `app` host (Emergent currently issues Cloudflare-fronted A records, e.g. two A records Host=`app`; use the EXACT values the Domain tab displays - do not hardcode the IPs from this doc). (3) Propagation ~5-15 min (up to 24-48 h). (4) SSL is auto-provisioned/renewed by Emergent/Cloudflare - no manual certs. If Squarespace ever proxies, keep the record "DNS only", not proxied.

### Bare/apex sailmorenow.com + www
- Emergent DOES support apex + www with automatic www<->root redirect, configured in the Domain tab. Apex needs an A record on `@` (Emergent provides apex-capable targets); www is a CNAME/redirect. Use the exact records the Domain tab gives you.
- **Which to use**: app.sailmorenow.com is the lower-risk option (only adds one host, cannot disturb the root). Apex is supported but touches the root record Squarespace may already use for its site/forwarding - only do apex once the old Squarespace/WordPress landing pages are retired.

### Do NOT break Google Workspace email
- You are only ADDING A/CNAME records for the app host. **Leave the existing MX, SPF (TXT), DKIM (TXT), and DMARC (TXT) records at Squarespace untouched** - email routing lives entirely in those, not in the A records you add.
- Pitfalls: (a) Do not "replace all" DNS or switch nameservers away from Squarespace. (b) If you go apex, change ONLY the root A record - never the MX/TXT. (c) If a restrictive **CAA** record exists it can block SSL issuance - check/remove only if it blocks the issuing CA; CAA does not affect email. (d) Our outbound email sender is `notifications@notifications.sailmorenow.com` (a separate sending subdomain) - its SPF/DKIM are independent of Workspace MX; verify that sender domain is set up for the email provider, but it does not touch Workspace inbox mail.

## 3) Every configured/hard-coded URL to change at publish (web)
Backend `.env` (edit in production Secrets to the live web domain, e.g. https://app.sailmorenow.com):
- `APP_BASE_URL` and `APP_PUBLIC_URL` - currently the preview url. Used for email links and deep links in `review_disputes_router.py` (_app_base), `reports_router.py`, email builders. MUST be set to the production domain or emails will link to preview.
- `EMAIL_LOGO_URL`, `APP_STORE_URL`, `GOOGLE_PLAY_URL` - currently blank; set to live asset/store URLs when ready.

Hard-coded `https://app.sailmorenow.com` fallbacks in email/app_url (correct ONLY if the app domain is app.sailmorenow.com; WRONG if bare domain is chosen - see below):
- `routers/auth_router.py` lines ~255, 349, 370, 666 (app_url + from_email `notifications@notifications.sailmorenow.com`)
- `routers/messaging_router.py` ~72 (DM email app_url)
- `routers/admin_router.py` ~661, 816
- `routers/community_router.py` ~1089, 1506, 1807 (origin fallback)
- `routers/identity_router.py` ~66
- `routers/review_disputes_router.py` ~162-163 and `routers/reports_router.py` ~24-25 (env first, then app.sailmorenow.com fallback)

CORS: our CORS is a CUSTOM middleware in `server.py` (echoes Origin when the session cookie is present, else `*`). It is domain-agnostic and does NOT read the `CORS_ORIGINS` env (that key is unused). => no CORS change needed at publish.

Cookie domain: `auth_router.py` `set_cookie` uses `httponly, secure, samesite=none`, NO `domain` attribute (host-only). Web and API share the same origin, so the cookie works on any HTTPS domain automatically. => no cookie change needed. (samesite=none requires HTTPS, which production has.)

Google OAuth (Emergent-managed): `frontend Login.jsx`/`Header.jsx` build `redirectUrl = window.location.origin + "/dashboard"` then go to `https://auth.emergentagent.com/?redirect=...`; `AuthCallback.jsx` posts the `session_id` to `/auth/session`. The return URL is derived from the live origin at runtime -> adapts automatically to the production domain. No Google Cloud Console redirect-URI change is required (it is Emergent-managed Google Auth, not a self-managed Google OAuth client).

Stripe return URLs: `payments_router.py` builds `success_url`/`cancel_url` from the client-sent `origin_url` (web sends `window.location.origin`), so they auto-point at the production domain. No hard-coded Stripe URL. (Live vs test keys = section 5.)

Zoho: refresh-token based (`ZOHO_*` in backend `.env`); no runtime return URL. Campaigns kill switch stays OFF. Re-verify the refresh tokens still work from production (section 5).

### If the app domain were the BARE sailmorenow.com instead of app.sailmorenow.com
- Set `APP_BASE_URL`/`APP_PUBLIC_URL` to `https://sailmorenow.com`.
- The hard-coded `https://app.sailmorenow.com` literals above would then be WRONG and would need a code change to read the env (or be edited to the bare domain) - a code task, out of scope for this report. Recommendation: launch on app.sailmorenow.com so these literals stay correct; revisit the bare-domain code change later.

## 4) Mobile
- **API address**: `mobile/.env` `EXPO_PUBLIC_BACKEND_URL` (currently preview). A store build must point at the PRODUCTION backend URL. `EXPO_PACKAGER_PROXY_URL` / `EXPO_PACKAGER_HOSTNAME` are preview-only (protected) and irrelevant to a store build.
- **Checkout origin**: `pricing.tsx`, `my-plan.tsx`, `profile/index.tsx` send `origin_url: EXPO_PUBLIC_BACKEND_URL` to Stripe checkout -> so Stripe return also follows the production backend once the build points at production.
- **OAuth return / deep links**: `AuthContext.tsx` opens `https://auth.emergentagent.com/?redirect=<mobile deep link>` via `WebBrowser.openAuthSessionAsync`; the app scheme is `mobile` (app.json). Identifiers: iOS `bundleIdentifier` and Android `package` both `com.emergent.boatcommunity.eiiznp`; version `1.0.0`.
- **What changes for a store build**: point `EXPO_PUBLIC_BACKEND_URL` at production (Emergent handles this through its mobile build/env config - set it there, not by editing protected preview vars). Confirm scheme + identifiers are final (bundle id locks after first build).
- **Build flow** (needs YOUR developer accounts): Publish -> Mobile -> iOS/Android. iOS: Emergent runs EAS Build, uploads IPA to TestFlight via your Apple Developer account ($99/yr); invite testers / submit for review in App Store Connect. Android: EAS Build produces AAB; upload to Google Play Console (your $25 account), set up the internal testing track, submit for review. Push notifications need `google-services.json` (Android/FCM) and the APNs key (iOS) - NOT configured yet; push is out of scope until Jenn asks.

## 5) Secrets / integrations to re-enter or re-check after publish
- **Stripe**: `STRIPE_API_KEY` is a TEST key in preview. Publishing NEVER switches Stripe to live automatically - swapping to `sk_live_` (+ live webhook secret `whsec_`) is ALWAYS a manual action in production Secrets, done only when Jenn says so. Stays on test until then.
- **Zoho** (`ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`, CRM + Campaigns): copied to production on first deploy; re-verify the refresh tokens authenticate from the production host. Campaigns kill switch REMAINS OFF. `ZOHO_CRM_ENABLED=false` today.
- **Email**: `EMERGENT_EMAIL_KEY` (Emergent-managed/Resend) + sender `notifications@notifications.sailmorenow.com`. Re-check the sender domain is verified for sending from production; confirm no real emails go out during cleanup/testing.
- **Google OAuth**: Emergent-managed; nothing to re-enter, just confirm sign-in works on the live domain.
- **Admin**: `ADMIN_EMAILS=jenn@sailmorenow.com`, `ADMIN_PASSWORD` - idempotently seeded on startup; confirm admin login on production.
- **LLM**: `EMERGENT_LLM_KEY` carries over.

## 6) Data cleanup before first publish (because first deploy COPIES preview data)
- **Demo data**: `demo_seed.py` tags every demo record `is_demo: True`; admin-only reset (`demo_router` -> `reset_demo`) deletes `{is_demo: True}` from users/boat_pros/posts/events/event_registrations/reviews. Run this in preview before publishing to clear demo content. It will NOT return at deploy (nothing re-seeds demo automatically).
- **Public `/seed`**: only runs while the users collection is EMPTY (idempotent guard) - it cannot reset live data and will not re-fire once there are users. The `seed_*` accounts (sailmorenow.dev: Salish Marina, North Sound Rigging, River City Canvas, Puget Sound Sailing Society) are the "seed Boat Pros"/PSSS the handoff says to KEEP - leave them.
- **"Chad Pass" dispute**: NOT created by any seed/code (no "chad" reference anywhere in the codebase) - it is alpha test data living only in the preview DB. It WILL copy into production on first publish unless deleted first. Remove it (and any other alpha test accounts/sessions/disputes) from the preview DB via a narrowly-filtered manual delete BEFORE publishing. Do NOT touch the real seed data (Wash N Go, PSSS, WTYC, seed Boat Pros).
- **Re-running seeds on purpose**: demo seed/reset is admin-only via the Demo data admin page; only runs when triggered. No deploy step re-seeds.

## 7) Launch-day checklist (in order)
1. In PREVIEW: run demo reset (clear `is_demo`), delete alpha test accounts/sessions and the "Chad Pass" dispute (narrow filters), keep real seed data. Verify counts.
2. Confirm integrations stay on TEST (Stripe test key; Campaigns OFF).
3. Click Publish (web). Wait ~10-15 min for `<app>.emergent.host`.
4. In production Secrets: set `APP_BASE_URL` + `APP_PUBLIC_URL` to the live web domain; set store/logo URLs if ready. Redeploy.
5. Add the DNS A record(s) for `app` at Squarespace (exact values from Domain tab). Do not touch MX/SPF/DKIM/DMARC. Link the domain; wait for SSL.
6. Smoke test on the live domain: sign-up/login (email + Google), create/read post, event edit/delete + importer, messaging (personal + business thread), a Stripe TEST checkout, an email link points to the live domain, admin portals + non-admin block.
7. Only when ready: swap Stripe to live keys in Secrets + redeploy; do a small real charge test.
8. Mobile: point build at production backend, run iOS/Android builds, push to TestFlight + Play internal testing, QA on device, then submit for review.
9. Later: redirect the old domain (and retire Squarespace/WordPress pages) once the app domain is verified live.

### Rollback plan
- If production breaks: Manage Publishes -> Overview -> rollback (restores a previous container image in ~1-3 min; up to the last 3 deploys). Rollback changes CODE only - production DB/config/URL are untouched. Then fix in preview, test, and Republish. (Codebase rollback for the app itself = Emergent "rollback" feature, never git reset.)

## 8) Could NOT verify without actually publishing
- The exact production hostname and the precise A-record values/targets the Domain tab issues for this app (use what the UI shows).
- Whether apex A targets are offered for sailmorenow.com in this account/plan, and the exact www-redirect toggle behavior.
- That the Emergent email sender domain `notifications.sailmorenow.com` is already verified for production sending.
- Real Stripe live-mode behavior and live webhook delivery (test-key only in preview).
- Whether the preview -> production one-time data copy includes Object Store files or only MongoDB for this app (docs say storage is per-environment; confirm attachments appear in production after first deploy).
- Actual mobile EAS build/signing success and the TestFlight/Play upload path with Jenn's developer accounts.

---
### Files read
- backend/.env, frontend/.env, mobile/.env (keys only)
- backend/server.py (CORS + startup), backend/routers/auth_router.py (cookies, Google session), backend/routers/payments_router.py (Stripe URLs)
- backend/routers/community_router.py, review_disputes_router.py, reports_router.py, identity_router.py, messaging_router.py, admin_router.py (app_url/email fallbacks)
- backend/routers/seed_router.py, backend/routers/demo_router.py, backend/demo_seed.py (seed/demo/reset)
- backend/event_sources.py (aggregator user-agent URL)
- frontend/src/pages/Login.jsx, AuthCallback.jsx, PaymentSuccess.jsx; frontend/src/context/AuthContext.jsx; frontend/src/App.js; frontend/src/components/Header.jsx (origin-based redirects)
- mobile/app.json (scheme/identifiers/version), mobile/src/context/AuthContext.tsx (AUTH_BASE/redirect), mobile/app/pricing.tsx, my-plan.tsx, profile/index.tsx (checkout origin_url)
