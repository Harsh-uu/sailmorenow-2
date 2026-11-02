# ACCOUNT-DELETE-1 - Stage B (Build account deletion)

Date: 2026-11-02. Not published. testing_agent NOT used (forbidden by the standing directive, repeated in this task). No em-dashes in customer-facing copy. No schema change. Public /delete-account page NOT built (deferred to store submission).

Pre-run backup (every collection): `/app/backups/predelete_20261102_040549` (db `test_database`).
Restore command: `mongorestore --uri="$MONGO_URL" --nsInclude="test_database.*" --drop /app/backups/predelete_20261102_040549`

## What was built
Backend:
- `account_deletion.py`: `execute_purge()` (idempotent, resumable, per-step log in `account_deletion_jobs`), `resume_pending_jobs()` (startup), plus the Phase 1 `overwrite_object_empty`, dry-run and protected guard. Steps: cancel_stripe -> revoke_comp -> stripe_customer_delete -> zoho_mark_deleted -> overwrite_storage -> edges(events/forum/business) -> delete_rows -> scrub_and_tombstone -> final_email. A failed step sets status=failed, alerts admin@, never half-deletes silently.
- `routers/account_router.py`: `GET /api/account/delete/preview`, `POST /api/account/delete/send-code`, `POST /api/account/delete/confirm`. Code = 6 digits, 15 min expiry, 5 wrong attempts then invalidated, resend after 60s, max 3 codes/hour per account and per IP. Confirm requires the typed word DELETE. Instant ack: kill sessions, block login, hide, then background purge.
- `mailer.py`: `account_delete_code_email_html` + `account_deleted_email_html` built on the shared `_billing_shell` so `send_email` applies the same navy banner, round logo header and footer as every other transactional email.
- `deps.py`: deleted/tombstoned users are treated as logged-out everywhere (cannot sign in).
- `server.py`: registered the router + startup resume. `content_router.py`: added the FAQ entry "How do I delete my account?" (seeded to the single public FAQ list used by web and mobile).

Web (`/app/frontend`): `components/DeleteAccountSection.jsx` rendered at the VERY END of `pages/Profile.jsx` (below Legal), Danger zone, two-step modal (explainer + store/plan/business warnings + Privacy link -> code + typed DELETE), resend cooldown.

Mobile (`/app/mobile`): `src/components/DeleteAccountSheet.tsx` rendered at the bottom of `app/(tabs)/profile/index.tsx` (below everything), same flow in a bottom sheet, `maxFontSizeMultiplier` auto-fit for Large font / 3-button nav.

## Purge behaviour (per the Step 0 table + edges)
- DELETE: posts, own comments, reactions, reviews (by/about), crew_bank(_standalone), event_registrations (own), follows, saved_*, listing_views, notifications (own), push_subscriptions, dm_messages (sent), comp_grants (own), promo_attempts, signup_events, referrals, hires, identity_sessions, user_sessions, email_verifications/verify_sends/email_failures/password_reset*, zoho_outbox.
- KEEP (opaque id only): payment_transactions, reports, review_disputes, admin_actions.
- SCRUB: users tombstone (name "Former member", email+handle unset, all PII cleared), discussions -> placeholder "This post was removed" (keeps others' replies), events with other registrants -> organizer "Former member" + email cleared (deleted if none), boat_pros listing scrubbed/hidden.
- Denormalized names NAMES-1 does not refresh, scrubbed to "Former member": notifications.from_name, comp_grants.granted_by_name, events_deleted (embedded organizer/registrations/crew/deleted_by), events_backup_bodfix.organizer. (dm_thread labels resolve live from users -> show "Former member" via the tombstone; dm_messages sent are deleted.)
- Stripe: immediate cancel (`stripe.Subscription.cancel`), then `stripe.Customer.delete`; both tolerate resource_missing so a gone object never fails the deletion. Store (Apple/Google) plans: screen shows cancel-in-store steps and the purge proceeds without a Stripe call.
- Zoho: sets member_status="deleted" and enqueues; sync marks App_Account_Status Deleted and keeps the contact.

## Edge cases (Step 0 (a)-(g)) + business/org (#8)
(a) event with other registrants -> KEPT, organizer scrubbed [verified]. (b) forum thread -> placeholder, replies kept [verified]. (d) last admin / protected -> blocked. (e) store plans -> message + proceed. (f) comp revoked + queued term cleared. (g) Stripe missing -> graceful [verified].
Business/org (#8): self-serve for everyone with a stronger confirmation screen (listing, reviews about them, followers, immediate no-refund cancellation). The data model has a single owner (boat_pros.user_id) with NO shared-managers/admins field, so there is no shared org/listing to preserve - the listing is scrubbed/hidden with the owner. REPORTED: if a shared-manager model is added later, revisit to keep the shared record and only remove the person.

## Verification (temp accounts only; emails jenn+<tag>@sailmorenow.com so sends land in jenn@; all temp data + scripts deleted; zero residue)
- API-verified (30/30): endpoint refuses platform admin; send-code returns ok and sent a real email to jenn+tag@ (not blocked, not bounced); confirm rejects lowercase "delete"; confirm ok + instant ack; background purge completed all 9 steps; post/own-comment/dm/own-RSVP/crew deleted; payment_transaction kept; forum placeholder + other's reply kept; other's RSVP kept; event kept + organizer scrubbed; notification/comp_grants/events_deleted scrubs; tombstone name "Former member" with email+handle unset and deleted flag; storage objects read back 0 bytes; Stripe missing handled gracefully; deleted session rejected (401); regex scan finds no real name on any kept record; the same email registers again as a brand-new account; both emails contain the navy banner (#1F3F5B) and the round logo.
- Browser-verified (web): Danger zone renders at the very bottom of Profile; the modal explainer and "Email me a code" button work.
- Code-only (mobile, not device-tested): `tsc --noEmit` clean for the new component; Metro bundles clean (iOS + web), no error overlay. The bottom-sheet flow was not run on a device (standing mobile rule). Could not safely inject a mobile auth session into the Expo web preview for a screenshot.

## Honest caveats
- The REAL Stripe immediate-cancel against a live test subscription was not exercised (that needs a live test sub). The cancel code path and the graceful resource_missing path are verified; the happy-path live cancel is code-only. The Stripe test webhook still points at the old job (does not affect cancel, which applies synchronously).
- Inbox rendering of the two emails is for Jenn to confirm in her inbox (sends go to jenn+tag@ -> jenn@). The HTML was asserted to carry the shared navy banner + round logo.
- Object storage has no delete API; purge overwrites objects to zero bytes (verified). A few leftover zero-byte probe/test objects exist under `_tmp_*` prefixes and cannot be removed.
