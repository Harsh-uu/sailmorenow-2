# HANDOFF - Events aggregator (EVENTS-FIX series)

Last updated: 2026-11-01 (EVENTS-FIX-3). Plain language, no em-dashes.

## Undo commands (with stamps)
Run from /app/backend. Each took a backup before writing.
- EVENTS-FIX-3 dedup + source_uid backfill:
  `python /app/backend/dedup_apply.py --undo 20261101T194047Z`
  (drops the unique index, restores the 3 removed losers, reverts the 4 survivors'
  source_uid, re-inserts the Fireside tombstone. Backup: collection
  events_backup_dedup + /app/backend/dedup_backup_20261101T194047Z.json)
- Board of Directors Dec 9 start fix (EVENTS-FIX-2):
  `python /app/backend/bod_fix.py --undo 20261101T190042Z`
- Tropical Party time_not_listed fix (EVENTS-FIX-1):
  `python /app/backend/tropical_fix.py --undo 20261101T030326Z`
- Category recategorize backfill (EVENTS-FIX-1):
  `python /app/backend/events_recat.py --undo 20261101T030422Z`

## Standing rules given in this chat (keep following)
- The automated testing_agent is FORBIDDEN. Test manually (python scripts, curl, screenshots).
- No em-dashes anywhere in code, UI, or email copy. Use hyphens.
- Never print any password, hash, token, key, or email verification link in chat, logs, or reports.
- Every data change: back up first, then provide the exact --undo command with its stamp.
  Never drop databases or collections. Deletes must be narrowly id-scoped and user-approved.
- If any survivor pick or match is ambiguous, STOP and report before writing. Do not guess.
- Do not ask questions mid-task unless truly blocked.
- Zoho Campaigns kill switch stays OFF. Do not turn it on.
- Respond in English only.

## Current event-matching design (live)
- aggregator.run_aggregator matches an existing row by STABLE identity
  {source_key, source_uid, recurrence_id}; updates it in place and KEEPS its id;
  inserts a new row only when nothing matches. Ids are never renamed/re-keyed.
  - OWSA: source_uid = event page url (e.g. https://owsa.net/event/nauti-drinks-26); recurrence_id absent.
  - OCSA: source_uid = iCal UID; recurrence_id = RECURRENCE-ID (one row per occurrence).
  - Legacy fallback: if an incoming event has no source_uid, match by the old
    date-based id agg_{source_key}_{external_id}.
- Tombstone check uses the same identity OR the legacy id. The admin delete path
  now stores source_uid + recurrence_id on new tombstones so future deletes block by identity.
- Admin-locked fields (admin_locked_fields) are never overwritten by a scrape.
- Partial unique index `agg_source_identity` on (source_key, source_uid, recurrence_id),
  partialFilterExpression {source: "aggregator", source_uid: {$type: "string"}}, so a
  third duplicate copy can never be inserted.
- Startup catch-up (server.py): on boot, if the aggregator has not run in 8 days it runs
  once (trigger startup_catchup) behind an overlap lock. Scheduler: weekly Sunday 03:00 PT.

## Done in EVENTS-FIX-3
- In-place source-key matching (above). Tombstone fields extended. 8-day catch-up threshold.
- Deduped the 3 OWSA pairs (removed losers c6159083/d97881ca/3abdcd31, no tombstone),
  backfilled survivors' source_uid (Nauti d4d93f, Holiday d40c9c, Game 5bb2d3), Fireside
  23f690 adopted fireside-8 url + stale Fireside tombstone dropped, unique index added.
- Admin single-box editor (AdminControls.jsx) got an "End (optional)" box using the same
  Pacific helpers + an end-after-start check. A save that does not touch End leaves it unchanged.

## Open / not done
- 48 North (sarc-48north) stays DISABLED, awaiting Joe Cline permission (SARC-1).
- Legacy tombstones (Book online x4, Board of Directors x4, Tropical Party) carry no
  source_uid. Harmless under the new matching (they only match a title/legacy id the
  url/uid feed never regenerates). Left as-is on purpose.
- Admin single-box End box is verified CODE-ONLY (admin sign-in is Google-only, no test
  creds), not browser-tested end to end.
- Optional later: extract a shared Starts/Ends component instead of the FIELD_DEFS line.
- Wider backlog untouched: CREWBANK-OPP-1, ACCOUNT-DELETE-1 STAGE B (needs object-storage
  delete first), BILLING-3b reward codes, IAP-0, REVIEWS-3b/4m, mobile Free price parity,
  Google-vs-password duplicate-account detection, mobile plan comparison previews.

## Verification (EVENTS-FIX-3): live vs code-only
- LIVE (DB + read-only feed fetch): counts 124->121 aggregator / 143->140 all; the 3 titles
  appear once each; 0 duplicate identities; 0 docs missing source_uid; Winter Sailing Nov 1
  still "Time not listed"; Tropical Party still Nov 6 5:00 PM PT; BoD Dec 9 still 6:30 PM PT;
  no survivor field changed except source_uid; Holiday Party volunteer RSVP still points at
  its event; next-scrape simulation = 0 inserts / 121 in-place updates / 0 "Book online";
  48 North disabled; unique index present.
- CODE-ONLY: the admin single-box End box (Google-only admin, no browser test).

## Key files
backend/aggregator.py, backend/server.py (startup catch-up), backend/scheduler.py,
backend/routers/admin_content_router.py (tombstone fields),
backend/routers/admin_router.py (admin event PATCH), frontend/src/components/AdminControls.jsx.
Scripts: dedup_apply.py (apply/undo), dedup_verify.py (read-only checks), bod_fix.py,
tropical_fix.py, events_recat.py, dedup_report.py, events_rekey.py, events_fieldcheck.py.
