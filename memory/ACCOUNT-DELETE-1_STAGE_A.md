# ACCOUNT-DELETE-1 — STAGE A (REPORT + PLAN ONLY)

Status: REPORT + PLAN ONLY. No code written, nothing published, Campaigns OFF, no emails sent, no data changed. STOP after this for Jenn's approval.
Policy anchors: Apple 5.1.1(v) https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/ ; Google https://support.google.com/googleplay/android-developer/answer/13327111 ; Apple 4.8 https://developer.apple.com/app-store/review/guidelines/#sign-in-with-apple .

---
## 1. Data inventory - every place a member's data lives

Keyed to the member's `user_id` (and `handle`/`email`). Action column = what STAGE B does.

| Collection | Member key | Holds | Action |
|---|---|---|---|
| `users` | user_id | profile, email, name, picture, password_hash, markets, newsletter_opt_in, zoho_* | Tombstone: clear PII, name->"Former member", keep opaque user_id + member_status="deleted" |
| `user_sessions` | user_id | login sessions | Delete all (logs out everywhere) |
| `login_attempts`, `password_resets`, `password_reset_requests`, `rate_limit_events` | email/user_id | auth/security transients | Delete (security retention minimal; see keep-list) |
| `posts` | author_id | marketplace + general posts, `image_urls` | Delete (+ purge photos from storage) |
| `comments` | author_id | comments | Delete; if a forum thread's first post goes, replies stay under a "deleted post" placeholder |
| `discussions` | author_id | hub forum/blog threads, `image_url` | Delete first-post; keep thread shell + others' replies as placeholder |
| `reactions` | user_id | likes/reactions | Delete |
| `events` | organizer_id (+name/email) | events they created | Delete |
| `event_registrations` | user_id | their RSVPs | Delete |
| `event_blasts`, `hero_events` | organizer/event ref | derived | Clean refs to deleted events |
| `boat_pros` | user_id | business listing, `photos`, `logo_url`, `logo_original_url` | Delete (+ purge photos) |
| `crew_bank`, `crew_bank_standalone` | user_id | crew listing, photos | Delete (+ purge photos) |
| `hires` | pro_id / user_id | hire records | Delete rows referencing them |
| `reviews`, `mutual_reviews`, `review_sessions` | reviewer/reviewee/participants | reviews they wrote AND about them | Delete both sides (reviews about them go with the profile) |
| `review_disputes` | parties | safety/moderation | KEEP (safety) - reference by user_id only |
| `reports` | reporter_id / target_id | abuse reports | KEEP (safety/abuse) |
| `dm_messages` | from_id / to_id | messages | Delete messages they SENT; received copies handled per thread |
| `dm_threads` | participants | conversations | Rewrite participant to "Former member"; drop thread if empty |
| `notifications` | user_id | their notifications | Delete theirs; scrub notifications about them |
| `follows`, `follow_blocks`, `follow_dismissals` | follower/following / blocker_id/blocked_id | graph | Delete rows involving them |
| `saved_items`, `saved_searches`, `listing_views` | user_id | personal data | Delete |
| `push_subscriptions` | user_id | push tokens | Delete |
| `referrals` | ref/referrer | referral links | Delete/scrub referrer |
| `payment_transactions` | user_id | payment records | KEEP (financial/legal) |
| `identity_sessions` | user_id | Stripe Identity verification sessions | Delete our rows; Stripe side handled via Stripe |
| `ip_bans` | user_id/ip | ban records | KEEP (abuse/security) |
| `admin_actions`, `audit_logs`, `handle_enum_log` | actor/subject user_id | moderation audit | KEEP (audit) - reference by user_id |
| `zoho_outbox` | user_id | CRM sync queue | Enqueue a "mark deleted" event, then clear pending rows |
| `settings`, `saved_*`, `market_requests`, `contact_messages`, `testimonials`, `sponsors`, `faqs` | user_id / author | misc | Delete member-authored rows; leave global config |
| Object storage (`storage.py`, Emergent) | URLs in posts/boat_pros/crew_bank/users/discussions/org-listings | uploaded photos/originals | Delete every referenced object (SEE RISK: storage.py has no delete fn today) |
| Third parties | - | Zoho CRM contact; Stripe customer; Resend (transactional only) | Zoho: mark Contact "Deleted" (non-destructive, already supported). Stripe: cancel sub + request Customer delete. Resend: no stored list (Campaigns OFF; weekly digest is our own, gated by `newsletter_opt_in`, removed with the user) |

## 2. What could break on removal (must be handled)
- Forum/hub thread losing its first post -> show a "deleted post" placeholder so replies survive (Jenn's rule).
- Reviews currently in a dispute -> deletion must not destroy the `review_disputes` safety record (keep it, reference by user_id).
- DM threads with a Boat Pro -> the other side keeps the conversation with "Former member"; unread counters recomputed; empty threads dropped.
- Counters/aggregates: review averages, follower counts, event registration counts, Founding-Partner-per-market counts (admin), feed/market digests - all recompute or skip deleted users.
- Admin tabs (moderation, partners, crew, directory, reports) must render "Former member" and not 500 on a missing user.
- Orphaned photos in object storage if we only delete DB references (see §8 risk).
- Notifications referencing the deleted user (e.g., "X replied") must be scrubbed.
- Referral chains and `follow_blocks` pointing at the deleted user.

## 3. Login methods today
- **Password** (`/auth/register`, `/auth/login`; `password_hash`) - web + mobile.
- **Google** (`/auth/session`; mobile `GoogleButton` + web Google button) - web + mobile.
- **Sign in with Apple: NOT present anywhere** (confirmed; only `-apple-system` fonts and a Mac user-agent string exist). A password-less account is detected only by absence of `password_hash`.

## 4. Sign in with Apple scoping (required by Guideline 4.8 because we offer Google)

- **Libraries:** native iOS = `expo-apple-authentication` (iOS ONLY; needs `ios.usesAppleSignIn:true` + plugin + `expo prebuild`; works only in a **development build** on a **real device**, not Expo Go/simulator) - https://docs.expo.dev/versions/latest/sdk/apple-authentication . Web + Android = a **Services ID** + registered domain + return URLs with `expo-auth-session` hitting Apple's OAuth endpoints; the `.p8` client secret stays server-side (backend token exchange).
- **Jenn's Apple Developer setup:** App ID with Sign in with Apple capability; a **Services ID** (for web/Android) with the web domain + **Return URLs**; a **Sign in with Apple key (.p8)** + Key ID + Team ID; and **Private Email Relay** sources (register our sending domain + the exact "from" address) so relayed mail is delivered.
- **Hide My Email relay (critical for our 6-digit code):** users can pick a `@privaterelay.appleid.com` alias; our transactional sender (Emergent Resend domain/address) **must be registered in Apple's Private Email Relay Service** or the deletion code, newsletter and any mail will **bounce**. Map users by Apple **`sub`**, never email (email is null after first sign-in). Zoho: store the relay alias as the contact email; it still forwards while the account exists.
- **Duplicate-account prevention (Google vs Apple same person):** link by verified **email** when Apple returns a real email on first sign-in; when it's a relay alias, we can't match on email, so offer account-linking in-app ("You already have an account - link it?") and store the Apple `sub` on the existing user. Residual risk: relay-only users may create a second account.
- **Token revocation on deletion:** call Apple's **`auth/revoke`** REST API with the stored refresh token during deletion (TN3194 https://developer.apple.com/documentation/technotes/tn3194 ). Google: no server token to revoke beyond dropping our session.
- **Effort:** backend OAuth + token exchange + revoke + relay/email config = **M**; native iOS button + dev build = **M**; web/Android Services ID flow = **M**. Overall **M-L** and it **requires a dev build** (not testable in Expo Go).
- **Alternative - remove Google sign-in:** if we drop Google entirely (password-only + optionally Apple), **4.8 no longer forces Apple**. Cost: existing Google-only users (no `password_hash`) would need a password-set/migration path, and we lose one-tap Google convenience on both platforms. This avoids all Apple-SIWA work but is a real UX regression and a migration project of its own.

## 5. Delete order + execution model + member notice
Runs as: **instant acknowledgement + background job** (fan-out across ~30 collections + object-storage deletes exceed a request window).
1. Verify confirmation: valid **6-digit emailed code** AND the member typed **DELETE**.
2. Immediately set `member_status="deleting"`, delete all `user_sessions` (logged out everywhere), block re-login.
3. Cancel active **Stripe** subscription now (no refund). For **Apple/Google** subs we cannot cancel - the screen already tells them to cancel in the store.
4. Revoke **Apple** tokens via `auth/revoke` (if SIWA exists); drop Google session.
5. Background worker: delete authored content; purge referenced **object-storage** files; apply forum "deleted post" placeholders; delete reviews by/about them; remove boat_pro + crew listings; clear follows/reactions/notifications/saved/registrations; rewrite DM participants to "Former member"; enqueue **Zoho mark-deleted**; enqueue **Stripe customer delete**; finally **tombstone** `users` (clear PII, keep opaque user_id + `member_status="deleted"`).
6. Member told: on submit, "Your account has been deleted." (session already dead, login blocked); a final confirmation email is sent when the purge completes (usually within minutes).

## 6. Exact records kept (for counsel)
- `payment_transactions` - financial/tax record of real payments.
- `review_disputes` - safety/moderation outcomes.
- `reports` - abuse reports (reporter + target references).
- `ip_bans` (+ ban flags) - abuse/fraud prevention.
- `admin_actions`, `audit_logs`, `handle_enum_log` - moderation/audit trail.
All kept records reference only the opaque `user_id`; names/emails/photos are cleared. Everything retained for "security, fraud prevention or regulatory reasons" must be named in the **Privacy Policy** (Google requirement). Retention window + legal basis to be set by counsel.

## 7. What an admin sees afterward
- A **tombstone** user: `member_status="deleted"`, opaque user_id, PII cleared, shown as **"Former member"** across moderation/partners/crew/directory/reports tabs (no 500s).
- The retained safety/payment/audit rows above, referencing that user_id.
- Zoho CRM Contact flagged **App_Account_Status = "Deleted"** (not hard-deleted).
- No recovery/undelete (Jenn: cannot be undone).

## 8. Test plan (temp accounts, delete after; TESTING AGENT FORBIDDEN -> manual curl/python/screenshot)
- Create temp **password** user + temp **Google-style** user (+ temp **Apple** user once SIWA exists); seed each with a post, comment, photo upload, review (both directions), a DM thread with a temp Boat Pro, an event, a crew listing, a boat_pro listing, follows, notifications.
- Run the flow: request code -> wrong code rejected -> correct code + "DELETE" -> deletion.
- Verify: all authored content gone; photos removed from storage; forum first-post shows placeholder with replies intact; reviews by/about gone; DM shows "Former member"; counters recomputed; admin tabs render; `payment_transactions`/`reports`/`review_disputes`/bans retained; Zoho outbox has a mark-deleted event; Stripe sub cancelled (test mode).
- Public web page: loads without login, names "Sail More Now", completes deletion by email code without the app, links Privacy Policy, explains store-cancel steps.
- Apple relay: send the code to a `@privaterelay.appleid.com` alias in sandbox and confirm delivery once relay is registered.
- Clean up every temp account/row/photo afterward.

## Could not verify
- **Whether Emergent object storage (`storage.py`) supports deletion** - it only has `init/put_object/get_object` today; STAGE B must add a delete call or confirm the provider API, else photos persist after DB references are removed. (Key open item.)
- Whether **Stripe Customer delete** applies now (current model is one-time payments with no persistent customer; it becomes relevant under BILLING-PLAN-1).
- Exact **retention periods / legal basis** for the keep-list (counsel to confirm and add to Privacy Policy).
- Real **Apple relay** delivery and **auth/revoke** behaviour (need Apple setup + a dev build on a real device).
- Google's exact current web-page acceptance criteria beyond the cited page (verify at submission).

## Files read
- `backend/routers/auth_router.py` (login methods, Google, member_status, password reset), `backend/zoho_sync.py` (mark_account_deleted, App_Account_Status, unsubscribe gating), `backend/storage.py` (Emergent object storage; no delete fn), `backend/mailer.py` (Emergent Resend transactional only), plus `grep` of all `db.<collection>` references and authorship fields across `backend/routers/*.py`.
- `mobile/src/context/AuthContext.tsx` + `mobile/app/{signin,register,index}.tsx`, `mobile/src/components/GoogleButton.tsx` (mobile login methods; no Apple).
- `memory/IAP-0_REPORT.md`, `memory/BILLING-PLAN-1.md` (store deletion + Stripe context).
- Official Apple/Google/Expo pages cited inline.
