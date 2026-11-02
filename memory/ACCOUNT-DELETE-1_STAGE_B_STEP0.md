# ACCOUNT-DELETE-1 - STAGE B / STEP 0 (REPORT ONLY - nothing built, nothing published, no real data touched)

Date: 2026-11-02. Stage A decisions still stand (see ACCOUNT-DELETE-1_STAGE_A.md). testing_agent NOT used (forbidden). No em-dashes in customer-facing copy. The only runtime action taken was a throwaway storage probe on a temp object (see section 2).

---
## 1. What changed since Stage A (new collections / fields / flows that hold member data)

Full current collection set was re-enumerated by grepping every `db.<collection>` in the backend. New since Stage A's table, with the delete/keep decision:

| Collection | Member key | Holds | Decision |
|---|---|---|---|
| `comp_grants` | user_id (their plan) / granted_by (if they are an admin) | complimentary plan grants, `granted_by_name` | DELETE rows where user_id == member (revoke first). For grants the member ISSUED as admin: KEEP but scrub `granted_by_name` -> "Former member" |
| `events_deleted` | embedded `event.organizer_*`, `registrations[].user_name/user_id`, `crew[].user_name/user_id`, `deleted_by_name` | **recovery copies of soft-deleted events WITH embedded RSVPs + crew + organizer PII** | OTHER (high risk): pull the member's rows out of the embedded `registrations[]`/`crew[]`; if the member was the organizer, scrub organizer name/email to "Former member"; scrub `deleted_by_name` if the member was the deleting admin. This surface was NOT in Stage A. |
| `event_tombstones` | none (aggregator source identity only) | source_key/source_uid/recurrence_id | KEEP (no member PII) |
| `events_backup_bodfix` | organizer_* (migration backup) | one-off event-body backup | OTHER: scrub organizer name/email if organizer == member; else keep |
| `promo_attempts` | user_id | signup promo-code attempts | DELETE member rows |
| `signup_events` | user_id | signup funnel analytics | DELETE member rows |
| `stripe_events` | none (Stripe event ids) | webhook idempotency log | KEEP (financial/idempotency; no our-PII) |
| `email_verifications`, `verify_sends`, `email_failures` | email | email-verify + send/failure logs | DELETE member rows (transient, like password_resets) |
| `app_settings`, `app_meta`, `aggregator_runs`, `admin_alert_log`, `admin_email_digests` | admin/system | config + run logs (admin recipients only) | KEEP (no member PII; confirm digests hold only admin emails) |
| `identity_sessions` | user_id | Stripe Identity verification sessions | DELETE our rows (already in Stage A) |

New `users` fields (billing, from BILLING-1 / comp): `stripe_customer_id`, `stripe_subscription_id`, `subscription_status/provider/package_id/expires/cancel_at_period_end/free_until`, `comp_grant_id`, `trial_used`, `trial_end`, `had_paid_plan`, `is_promo`, `welcome_sent`, `platform_role`. Handled by: cancel the Stripe sub using `stripe_subscription_id` FIRST, revoke any comp grant, then tombstone (clear/zero these; keep `payment_transactions` for the financial record).

New FLOWS since Stage A that matter:
- **Soft-delete/restore of events** (`event_recovery.py`) -> the `events_deleted` embedded-PII surface above.
- **Stripe subscriptions** (`billing.py` + `payments_router.py`) -> real recurring subs now exist (Stage A noted only one-time payments). Cancel path matters (section 7).
- **Comp grants** (`billing.grant_comp/revoke_comp`) -> `comp_grants` + user fields.
- **NAMES-1 read-time name refresh** -> section 3 (important interaction).
- Crew pools (`crew_bank`, `crew_bank_standalone`) and group messages (`dm_messages` with `from_name`, `dm_threads`) already in Stage A but now also read through NAMES-1 (section 3).

---
## 2. Storage - provider, keying, and the delete method (probed on a temp object)

- **Provider:** Emergent Object Storage, via `backend/storage.py` -> `INTEGRATION_PROXY_URL` + `/objstore/api/v1/storage`, authed with a session `X-Storage-Key` minted from `EMERGENT_LLM_KEY`.
- **How objects are keyed to a user:** path prefixes `sailmorenow/...`:
  - avatars: `sailmorenow/avatars/{user_id}/{uuid}.ext` (user-keyed)
  - org logos/cover: `sailmorenow/org/{user_id}/{uuid}.ext` (user-keyed)
  - dispute files: `sailmorenow/private/disputes/{dispute_id}/{uuid}.ext` (KEEP - safety)
  - sponsors: `sailmorenow/sponsors/{uuid}.ext` (admin, not member)
  - The canonical reference lives in the DB (post.image_urls, boat_pros.photos/logo_url/logo_original_url, users.picture, discussions.image_url, crew photos) as `/api/files/{path}` URLs.
- **The exact delete method - THERE IS NONE.** I probed on a throwaway temp object: `PUT` upload succeeded, `GET` returned the bytes, and `DELETE /objects/{path}` returned **HTTP 405 Method Not Allowed**; the object was still readable (GET 200) afterward. The authoritative integration playbook confirms: **"No delete API - implement soft-delete in your DB."** Writes to an existing path OVERWRITE it; there is no list/bulk delete beyond prefix listing (max 1000).
- **Therefore the purge method I will use:** for every object path we can derive from the member's DB rows, call `put_object(path, b"", "application/octet-stream")` to **overwrite the object to zero bytes** (destroys the original image content at that path), AND remove/scrub the DB reference so `/api/files/{path}` (which checks the DB) stops serving it. This is the only way to physically neutralize the stored PII image. External image URLs (image_selector / off-site) are not ours and cannot be overwritten - note that in the privacy copy. Overwrite-to-empty is confirmed available (PUT overwrites); I recommend building and verifying this `purge_object` helper FIRST (your stated order).
- Honest note: the temp probe left one harmless 9-byte object at `sailmorenow/_tmp_probe/<uuid>.txt`. Because there is no delete API I could not remove it; it carries no data and is outside any user prefix. The Stage B purge helper (overwrite-to-empty) is exactly what would neutralize such an object.

---
## 3. NAMES-1 interaction (must get this right)

NAMES-1 refreshes the display name at READ time from the live `users` row, and **falls back to the STORED denormalized name when the user row is missing**. Consequence for deletion:

- If we HARD-deleted the `users` row, every kept record that NAMES-1 reads (comments under a kept thread, group-message `from_name`, review reply line, crew/RSVP on kept events, forum author) would fall back to the member's REAL stored name -> a privacy leak.
- **Fix (recommended):** keep the **tombstone** `users` row with `name = "Former member"` (and `handle`/`picture`/`email` cleared), `member_status="deleted"`. Then every NAMES-1 read path resolves the live row and shows **"Former member"** automatically - posts, comments, forum list/detail, crew pools, RSVP list, group-message sender, and the review reply line. This is the clean way to show "Former member" everywhere NAMES-1 touches.
- **Plus** scrub the denormalized name copies on KEPT records that NAMES-1 does NOT refresh, so even the stored value is safe: `notifications` body text ("X replied"), `dm_threads` participant labels, `comp_grants.granted_by_name`, `events_deleted` embedded names, and any kept safety record (`review_disputes`, `reports`) which must reference only the opaque `user_id`.
- Business-identity branch: NAMES-1 keeps the STORED business name for business-identity posts (it skips the refresh). Those posts are the member's own and are DELETED with them, so no leak. Kept records never carry a business identity for a deleted personal member.
- **Confirmation:** after purge, no stored name/email/photo survives on any kept record - enforced by (a) tombstone name="Former member", (b) explicit scrub of the non-NAMES-1 fields above, and (c) a regression regex scan (section 8) for the temp name/email across ALL collections that must return only "Former member"/empty.

---
## 4. Edge cases (recommendation each - you decide)

(a) **Member-created events with other registrants.** Plain members cannot create events today (event creation is closed to Sailors/Boat Owners; only orgs/pros create). If one exists with other RSVPs: RECOMMEND keep the event, scrub organizer -> "Former member" + clear organizer_email, so others keep their RSVP; delete the event only if it has no other registrants. (Org/pro owners -> case c.)
(b) **Replies by others under a deleted forum thread's first post.** RECOMMEND Stage A's rule: replace the first post body + author with a placeholder ("This post was removed", author "Former member"), KEEP the thread shell and all other replies.
(c) **Member is an org owner or a Boat Pro business owner.** Their public listing, active paid plan, reviews and followers would vanish. RECOMMEND: block self-serve deletion for accounts that own a Boat Pro listing or are an org/partner with an active plan; show "Contact us / cancel your plan first" and route to admin-assisted deletion. At minimum require explicit confirmation + cancel the plan first. Your call on hard-block vs assisted.
(d) **The last admin.** Never deletable. Enforce: if the account has `platform_role=="admin"` (or email in ADMIN_EMAILS) and is the only remaining admin, refuse. Also covered by the protected list (section 6).
(e) **Members with Apple or Google (store) plans.** We cannot cancel store subscriptions server-side. RECOMMEND: detect `subscription_provider` in (apple/google IAP) and show store-cancel steps in the flow; proceed with app-data deletion; do NOT attempt a Stripe cancel. (Apple SIWA not present yet.)
(f) **Pending/queued plans and comp grants.** RECOMMEND: before tombstone, `revoke_comp()` any active grant and clear `subscription_scheduled`/queued term changes; cancel the Stripe sub immediately.
(g) **Stripe customer/subscription already gone.** RECOMMEND: wrap the cancel in a try/except for Stripe `resource_missing` (InvalidRequestError) and proceed; a missing Stripe object must never fail the account deletion.

---
## 5. Flow design (screens + copy; numbers for your approval)

**Entry - Profile (web Settings + mobile Profile):** a "Delete account" item in a Danger zone. Copy: "Delete your account. This permanently removes your profile and personal data. It cannot be undone."

**Explainer screen (shared copy):** "Deleting your account removes your profile, posts, comments, listings, reviews, messages and photos. We keep a small set of records we are legally required to retain, with your name and contact details removed. If you pay through the App Store or Google Play, cancel that subscription in the store. This cannot be undone." + a "Privacy Policy" link.

**Step 1 - verify by email code:** button "Email me a code". Code = **6 digits**, **expiry 15 minutes**, **max 5 wrong attempts** then the code is invalidated, **resend allowed after 60 seconds**, **max 3 codes per hour** per account and per IP.

**Step 2 - confirm:** enter the 6-digit code AND type **DELETE** (exact, uppercase). Button "Delete my account". On success: sessions killed, re-login blocked, message "Your account has been deleted." A final confirmation email is sent when the background purge completes.

**Public web page (no login) at `/delete-account`:** names "Sail More Now", links the Privacy Policy, explains the store-cancel steps, and runs the same code + DELETE flow. **Anti-enumeration:** after submitting an email it ALWAYS shows "If an account exists for that email, we have sent a 6-digit code." (same response and timing whether or not the account exists); the email is sent only if the account exists; IP + email rate limits apply.

(All copy above uses hyphens only, no em-dashes. Final wording is yours to approve.)

---
## 6. Protected accounts (never deletable by this flow)

Proposed protected set, enforced in BOTH the request endpoint and the worker (refuse + log the attempt, never partially purge):
1. Emails in `ADMIN_EMAILS` env (includes **jenn@sailmorenow.com**).
2. Any user with `platform_role == "admin"` (DB-authoritative) - and additionally the **last admin** is never deletable even if somehow not in the list.
3. Demo / App Store reviewer logins: `is_demo == True` or email ending `@sailmorenow.demo` (demo_seed.py). These are needed for store review.
Add a small hard-coded `PROTECTED_EMAILS` constant as a backstop so a misconfigured env can never expose jenn@ or the reviewer logins. The check runs before any code is emailed.

---
## 7. Stripe test mode (does cancel need the webhook?)

- **No, the cancel step does not depend on the webhook.** The plan is an **immediate** cancel (`stripe.Subscription.cancel(sub_id)` / delete - note today's `/payments/subscription/cancel` only sets `cancel_at_period_end=True`, which is NOT "cancel at once"; Stage B adds an immediate-cancel path). Our code applies entitlement **synchronously from the returned Subscription object** via `apply_subscription_entitlement`, exactly like the existing cancel/resume endpoints. So the user row flips to free/canceled without the webhook.
- **The misconfigured test webhook only affects out-of-band reconciliation** (a cancellation/expiry initiated in the Stripe dashboard, card failures, `customer.subscription.deleted` idempotency via `stripe_events`).
- **Verifiable now (without fixing the webhook):** create a Stripe test subscription on a temp account, call our immediate-cancel, and confirm (i) Stripe shows the sub canceled and (ii) our `users` row shows tier=free/status=canceled from the direct apply.
- **Not verifiable until the webhook points at this job:** that an externally initiated cancel/expiry auto-reconciles, and the `subscription.deleted` idempotency path. RECOMMEND re-pointing the Stripe test webhook to this environment's `/api/stripe/webhook` (with this env's `STRIPE_WEBHOOK_SECRET`) before final QA - not a blocker for building/verifying the cancel itself.

---
## 8. Testing plan (temp accounts only; dry-run first; delete after - zero residue)

- **Seed** a temp member across every collection: post, comment, a forum thread with another temp user's reply, reactions, an event + RSVP + crew sign-up, a Boat Pro listing with an uploaded photo (real storage object), a `crew_bank_standalone` listing, reviews in both directions, a 1:1 DM and a group DM (as sender), follows/follow_blocks, notifications (incl. one "X replied" about them), saved_items, saved_searches, listing_views, push_subscriptions, promo_attempts, signup_events, email_verifications, a comp_grant, and a Stripe TEST subscription.
- **Dry-run mode (build this):** `purge(user_id, dry_run=True)` returns a per-collection report of how many rows WOULD be deleted vs scrubbed vs kept, plus the list of storage paths that would be overwritten - writing nothing. This is the safe inventory you approve before any real purge.
- **Prove per collection after a real run on the temp account:** deleted collections return 0 member rows; kept collections (`payment_transactions`, `reports`, `review_disputes`, `ip_bans`, `admin_actions`, `audit_logs`, `stripe_events`) retain the row but reference only the opaque user_id; a **regex scan of the temp name + email across ALL collections** returns only "Former member"/empty; every seeded storage object now returns zero bytes; the forum first post shows the placeholder with replies intact; group-message/comment/crew/RSVP surfaces show "Former member" (NAMES-1 via the tombstone); admin tabs render without a 500; Stripe sub shows canceled and the user row is free. Then delete every temp row + overwrite every temp object.
- **Public page + rate limits:** loads without login, neutral anti-enumeration response, code expiry/attempt/resend limits behave as approved.

---
## 9. Effort, risks, and recommended build order

Effort: storage purge helper **S-M**; dry-run inventory **S**; background purge worker across ~45 collections incl. the new PII surfaces **M-L**; immediate Stripe cancel + edge cases **S-M**; confirmation flow (web + mobile + public page) **M**; protected list + last-admin + business-owner guard **S**; completion email **S**.

Top risks: (1) storage has **no delete API** - purge = overwrite-to-empty, and external image URLs can't be neutralized; (2) embedded PII inside `events_deleted` (and `events_backup_bodfix`); (3) NAMES-1 fallback leaking the real name if we hard-delete the user row instead of tombstoning; (4) business/org owners losing a public presence; (5) the test webhook pointing at the old job.

**Recommended build order (matches your "storage delete first"):**
1. `purge_object` helper (overwrite-to-empty) + verify on a temp object.
2. Dry-run inventory/counter (no writes) across all collections + storage paths.
3. Background purge worker: tombstone user -> "Former member", delete authored content, overwrite objects, forum placeholder, scrub the non-NAMES-1 denormalized names, enqueue Zoho mark-deleted.
4. Immediate Stripe cancel + edge cases (f)/(g) and store-sub detection (e).
5. Confirmation flow (code + DELETE) on web + mobile + protected list + last-admin/business-owner guards.
6. Public `/delete-account` page (anti-enumeration).
7. Completion email.

STOP. Awaiting your go before building anything, in the order above (or your reorder).
