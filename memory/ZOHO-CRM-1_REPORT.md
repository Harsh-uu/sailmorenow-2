# ZOHO-CRM-1 + REFRESH-0 Report (for Jenn)

Status: code shipped, NOT live-tested against Zoho (CRM stays gated OFF until
you add credentials in production). No testing agent was used. No em dashes in
anything I wrote. No seed data touched. Conventions: this report states what I
could not verify.

---

## PART 1 - ZOHO CRM (Contacts) sync

### 1a. Env var names you must set (names only, values go in production .env)

CRM (Contacts) - in `backend/zoho_crm.py` / `zoho_sync.py`:
- `ZOHO_CRM_ENABLED`         set to `true` to turn the live CRM push on (default false)
- `ZOHO_CRM_API_DOMAIN`      default `https://www.zohoapis.com` (US data center)
- `ZOHO_CRM_REFRESH_TOKEN`   the CRM-scoped refresh token (distinct from Campaigns)
- `ZOHO_CRM_SIGNUP_SOURCE`   optional, default `Alpha Tester` (written to Signup_Source)
- `ZOHO_CRM_EXCLUDE_HANDLES` optional, comma-separated extra handles to never sync

Campaigns (newsletter) - in `backend/zoho.py` (already live here except topic):
- `ZOHO_CAMPAIGNS_API_ROOT`  default `https://campaigns.zoho.com/api/v1.1`
- `ZOHO_CAMPAIGNS_LIST_KEY`  the mailing list key (PRESENT in this env)
- `ZOHO_CAMPAIGNS_TOPIC_ID`  optional (ABSENT here; see Part 2)
- `ZOHO_UNSUBSCRIBE_ON_OPT_OUT` default true
- `ZOHO_SUBSCRIPTION_FIELD`  default `Subscription Level`

Shared by BOTH integrations (same Zoho self-client app):
- `ZOHO_ACCOUNTS_URL`        e.g. `https://accounts.zoho.com` (US)
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`       the CAMPAIGNS-scoped refresh token

Note: CRM and Campaigns use SEPARATE refresh tokens (`ZOHO_CRM_REFRESH_TOKEN`
vs `ZOHO_REFRESH_TOKEN`) because the OAuth scopes differ, but they share the
same client id/secret and accounts URL.

### 1b. OAuth scopes required for the CRM self-client
- `ZohoCRM.modules.contacts.ALL`  create / update / search Contacts
- `ZohoCRM.modules.leads.ALL`     search + convert Leads
- `ZohoCRM.settings.fields.READ`  read field metadata to validate picklists
- `ZohoCRM.modules.accounts.CREATE`  only needed IF a Lead convert forces an
  Account (happens when the Lead has a Company). The code logs a warning when a
  convert creates an Account so you can see it.

COULD NOT VERIFY: I have not been able to confirm these scopes against a live
Zoho tenant (no credentials in this env). They are the scopes the code paths
require; please grant them when you create the self-client. If you prefer to
not grant Leads/Accounts, tell me and I will drop the Lead-convert branch.

### 1c. Zoho field API names - mapping vs your list

Your canonical list and whether the code sends it (exact API name match):

MATCHES your list (sent with the exact API name):
App_User_ID, App_Handle, App_Account_Type, Org_Status, App_Plan_Tier,
Plan_Term_Months, Subscription_Start_Date, Subscription_End_Date,
Subscription_History, App_Signup_Date, App_Last_Active, Signup_Source,
Auth_Method, Email_Verified, ID_Verification, Listing_Status,
App_Account_Status, Test_Account, App_Primary_Market, App_Markets_Followed.

EXTRA fields the code ALSO sends that are NOT on your list (ACTION NEEDED):
These must EXIST in Zoho with these EXACT API names or the Contact create/update
will fail (Zoho rejects the whole record on an unknown field API name; my
picklist validator only drops unknown VALUES, it does not catch an unknown
FIELD name). Please either create them in Zoho or tell me to stop sending them:
- `First_Name`, `Last_Name`, `Email`  (standard Zoho Contact fields - fine)
- `Account_Name`  (standard; set from org_name/company_name)
- `Contact_Types`  (MULTI-SELECT picklist; values Sailor/Crew, Boat Owner, Boat Pro, Organization)
- `Market`  (standard-ish single picklist; I send the EXACT app market, worker
  falls back to "Other" if not in the live picklist. NOTE this DUPLICATES
  App_Primary_Market. If you only want App_Primary_Market, tell me and I will
  drop `Market`.)
- `Subscription_Status`  (picklist: Free / Paid / Cancelled)
- `Subscription_Plan`  (picklist: Basic / Featured / Premium)
- `Founding_Member`  (boolean / checkbox)
- `Billing_Cycle`  (picklist: Monthly / Seasonal (6-Month) / Annual)
- `Email_Opt_Out`  (boolean; true when newsletter_opt_in is false)

MISMATCH / DUPLICATION to decide:
1. You list `App_Plan_Tier` (I send it: raw tier string e.g. basic/premium/
   community_partner). I ALSO send `Subscription_Plan` (Basic/Featured/Premium)
   and `Subscription_Status`. If App_Plan_Tier is meant to be the single source
   of plan truth, say so and I will stop sending Subscription_Plan/Status.
2. You list `App_Primary_Market`; I additionally send the standard `Market`
   field with the same value. Confirm you want both or just one.
3. `Test_Account` is always sent as boolean false (real syncable users only;
   excluded accounts are never sent at all - see 1g).
4. `Email_Verified` is a boolean: true for Google accounts, false for
   email+password (there is no email-verification flow yet), see "earlier
   issue" below.

### 1d. What changed in sign-up, renewal and plan-length handling

Sign-up (NO blocking network call; just a cheap Mongo insert into `zoho_outbox`):
- Email sign-up `POST /api/auth/register` -> enqueue event `signup_email`
  (auth_router.py:226).
- Google sign-up `POST /api/auth/session` -> enqueue `signup_google`
  (auth_router.py:138).
- Onboarding `POST /api/auth/onboarding` -> enqueue `onboarding` (line 672).
- Profile edits enqueue too: markets, handle, newsletter, account_type,
  generic profile_update (lines 423/481/495/518/592).
- Identity verification (identity_router.py) and admin org-status changes
  (admin_router.py:615) and directory edits (directory_router.py:440) enqueue.

Plan / renewal (payments_router.py:120-150, `_apply_subscription`):
- On a paid package apply, the code sets on the user doc:
  `subscription_tier`, `subscription_expires` (= now + 30*months),
  `subscription_started_at` (KEPT from the original paid period on a
  renewal/upgrade; set fresh only when the buyer was previously free),
  `zoho_plan_term_months` (= package months), `subscription_package_id`.
- It then appends ONE line to `Subscription_History` (stored app-side in
  `user.zoho_sub_history`, joined with newlines into the Zoho field) via
  `record_sub_event` + `sub_history_line`, with action classified as
  `Started` (was free), `Renewed` (same tier, still active), or `Upgraded`
  (active + tier changed). Then enqueues event `plan_purchase`.
- Nightly lapse (scheduler `_nightly_job`): when a paid sub expires, the user
  is downgraded to free, a `Lapsed` history line is appended, and `plan_lapsed`
  is enqueued.

Plan length -> Zoho mapping (`zoho_sync.py`):
- `Plan_Term_Months` = package months (1 / 6 / 12; 3 is possible for some
  packages).
- `Billing_Cycle` picklist from months: 1 -> Monthly, 6 -> Seasonal (6-Month),
  12 -> Annual. Any other month count (e.g. 3) -> Billing_Cycle left EMPTY
  (reported so you can add a picklist value if you sell a 3-month plan).
- `Subscription_Start_Date` = subscription_started_at (date only).
- `Subscription_End_Date` = subscription_expires (date only).
- `Subscription_History` lines look like:
  `2026-06-15 | Boat Pro Premium | 12 months | Upgraded | ends 2027-06-15`

COULD NOT VERIFY: none of the above has been pushed to a live Zoho tenant.
Verified only with local mock scripts that exercised the mapping + outbox
state machine (then deleted). The exact Zoho acceptance of each field/picklist
value can only be confirmed once credentials are live.

### 1e. Admin screens and where they are
Backend endpoints (all admin-only), in `routers/auth_router.py`:
- `GET  /api/admin/zoho/crm/status`        crm_enabled, credentials_present,
  outbox counts (pending/sent/failed/skipped), recent failures, last dry-run
  time, the exclusion rules. (line 715)
- `POST /api/admin/zoho/crm/retry-failed`  reset failed rows under the cap to
  pending and drain. (732)
- `POST /api/admin/zoho/crm/reconcile`     re-process failed+pending. (739)
- `POST /api/admin/zoho/crm/backfill/dry-run`  counts + HANDLES only. (745)
- `POST /api/admin/zoho/crm/backfill/run`  live backfill; REQUIRES a dry-run in
  the last hour AND ZOHO_CRM_ENABLED=true, else 400. (751)
- Campaigns (pre-existing): `GET /api/admin/zoho/status`,
  `GET /api/admin/zoho/campaigns/check`, `GET /api/admin/zoho/lists`,
  `POST /api/admin/zoho/backfill` (Campaigns backfill of newsletter_opt_in users).

COULD NOT VERIFY: whether there is a rendered admin UI page wired to the CRM
endpoints. I confirmed the API endpoints exist; I did not confirm a dedicated
web admin screen renders them (the handoff mentions admin status screens; I
will confirm/add the UI binding if you want it).

### 1f. Dry-run backfill behavior
`zoho_sync.backfill(dry_run=True)`:
- Partitions ALL users into eligible vs excluded using `is_syncable_user`.
- Returns `eligible_count`, `excluded_count`, `eligible_handles` (HANDLES, never
  emails), and `excluded` (handle + reason). NO network call, nothing sent.
- Stamps `app_meta.zoho_backfill_dryrun.at` so the live run can require a recent
  dry-run.
Live run (`dry_run=False`): refuses unless ZOHO_CRM_ENABLED=true; enqueues every
eligible user with Signup_Source=Alpha Tester and drains the outbox. The upsert
is idempotent (App_User_ID -> email -> Lead-convert), so re-running is safe.

### 1g. Test-account / seed exclusion (never synced)
`is_syncable_user` skips: no email; `@sailmorenow.dev` emails; user_id starting
`tmp_` or `seed_`; "demo" in id/handle (incl. `demohost`); handles in
`ZOHO_CRM_EXCLUDE_HANDLES`; and any name/handle/org containing the managed-seed
markers: psss, puget sound sailing, wtyc, wash n go, willamette. So captain_jenn
real account syncs, but Wash N Go / PSSS / WTYC seed orgs never do.

COULD NOT VERIFY: that this exclusion matches your intent for every real alpha
user. The dry-run output (handles + reasons) is the safe way to review the
partition before any live send.

---

## PART 2 - Newsletter / Zoho Campaigns

### 2a. Does the missing TOPIC_ID block subscribe calls?
NO. `ZOHO_CAMPAIGNS_TOPIC_ID` is optional in `zoho.py`: `topic_id` is only added
to the subscribe/unsubscribe form data when it is set (lines 124-125, 148-149).
With it empty, subscribe/unsubscribe still fire against `ZOHO_CAMPAIGNS_LIST_KEY`
(which IS present here). Topic-based (double) opt-in is simply not applied.
Subscribe is gated ONLY by `ready_for_list_ops` = auth creds + list key, both of
which are satisfied here.

COULD NOT VERIFY: whether your Zoho list is configured to REQUIRE a topic for
compliant opt-in. If it does, add the topic id; the code will use it the moment
it is set, no code change needed.

### 2b. Newsletter default at sign-up
Default is OPTED IN (true) on all sign-up surfaces:
- Web register/onboarding: `newsletter_opt_in: true` (Onboarding.jsx:91).
- Mobile register: `useState(true)` (register.tsx:75); onboarding.tsx:76 true.
- Backend stores whatever the client sends (register.tsx -> body.newsletter_opt_in).

### 2c. Exact wording beside the newsletter toggle (NOT changed)
Web (Onboarding.jsx:280-281) and Mobile (register.tsx:450-451) are IDENTICAL:
- Title:  `Sail More Now — the quarterly digest`
- Body:   `Sailing and community events, educational information, and featured
  Boat Pros. One email a quarter, unsubscribe any time.`

FLAG (your call, NOT changed): the title contains a real em dash character
(`—`) between "Sail More Now" and "the quarterly digest", on BOTH web and
mobile. This violates the no-em-dash rule but you asked me not to change the
newsletter wording, so I left it. Say the word and I will swap it to a hyphen
" - " on both surfaces.

### 2d. Re-subscribe dedupe (opted-in users are NOT re-spammed)
Yes, deduped. In `process_outbox` the Campaigns branch compares the user's
current opt-in to the last-synced state stored on the user doc
(`zoho_campaigns_optin`). If they match, it does NOTHING (no Campaigns call).
It only calls subscribe/unsubscribe when the desired state differs, then writes
the new `zoho_campaigns_optin`. So repeated syncs of an already-opted-in user
make zero Campaigns calls. (The legacy `POST /api/admin/zoho/backfill` Campaigns
endpoint, by contrast, re-subscribes every opted-in user unconditionally; use
the CRM outbox path for deduped behavior.)

COULD NOT VERIFY: live Campaigns acceptance (no end-to-end send performed here).

---

## PART 3 - REFRESH-0 (mobile list freshness) report
Problem: on MOBILE, newly created/edited/deleted items (feed posts,
discussions, events, crew listings) did not appear until a manual pull-to-
refresh. WEB was already fresh (inline forms call load()/optimistic setState).

Fix (mobile only): one shared DeviceEventEmitter signal `CONTENT_CHANGED` in
`mobile/src/lib/events.ts`, payload `{ kind: post|discussion|event|crew,
action: create|edit|delete, item?, id? }`.
- Feed list `app/(tabs)/feed/index.tsx` listens to CONTENT_CHANGED: on a post
  create with `item` it optimistically prepends (guarded by id, only in
  recency-sorted views + matching market), then always refetches and reconciles
  by id (no duplicate).
- Events list `app/(tabs)/events/index.tsx` listens for kind=event and reloads
  (date-sorted, so no top-insert).
- Emitters wired in: new-post (create all types + edit), hub/new (forum/blog),
  new-event (single/series/edit), edit-post, delete-post, crew-listing,
  cancel-event, PostDetailScreen (sold + price).
- `MARKETPLACE_CHANGED` kept for targeted in-place consumers (PostDetailScreen,
  profile listings). Pull-to-refresh unchanged.
Backend: `GET /search` and `GET /posts?q=` are live DB regex queries with no
cache, so items are searchable server-side immediately; no backend change.

VERIFIED: mobile tsc at baseline (17 pre-existing errors, none in changed
files); Expo web bundle compiles and renders.
COULD NOT VERIFY: the authed Feed/Events tab lists (Google OAuth login is not
automatable in the web preview) and native iPhone behavior. Jenn to confirm on
device that a new item shows without a manual refresh.

---

## Open decisions for Jenn (quick list)
1. Approve/adjust the OAuth scopes (1b).
2. Confirm which EXTRA Zoho fields to create vs drop (1c): Contact_Types,
   Market (duplicate of App_Primary_Market?), Subscription_Status,
   Subscription_Plan, Founding_Member, Billing_Cycle, Email_Opt_Out.
3. Decide App_Plan_Tier vs Subscription_Plan/Status as plan source of truth.
4. Add a 3-month Billing_Cycle picklist value if you sell 3-month plans.
5. Newsletter title em dash: leave or change to hyphen (2c flag).
6. Add ZOHO_CAMPAIGNS_TOPIC_ID only if your list requires a topic (2a).
7. When ready, set the production env vars (1a) and ZOHO_CRM_ENABLED=true, then
   I will run a dry-run backfill for your review before any live send.
