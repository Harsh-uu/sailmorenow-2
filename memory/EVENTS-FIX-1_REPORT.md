# EVENTS-FIX-1 report

No testing agent. No em dashes. Plain-language summary below; details here.

## What changed

### 1. One shared lock rule (LIVE)
New `backend/event_locks.py :: finalize_editor_changes()` is now used by BOTH the admin
editor (`admin_router.admin_update_event`) and the org/owner edit path
(`community_router.update_event`). Every field an editor changes is added to
`admin_locked_fields` and `admin_edited=True`. `time_not_listed` is derived from the edited
start value (real time -> False, date-only -> True) and is itself locked. The importer
already skips every field in `admin_locked_fields`, so a locked `time_not_listed` can no
longer be flipped by a scrape.
Verified by unit call: timed edit -> `time_not_listed=False`, locks `[starts_at,
time_not_listed, title]`; date-only edit -> `time_not_listed=True`, locks `[starts_at,
time_not_listed]`.

### 2. Tropical Party record fixed (APPLIED)
`tropical_fix.py --apply` set `time_not_listed=False` and locked `time_not_listed` and
`ends_at` (nothing else touched). Backup taken. Live API now returns Tropical Party with
`time_not_listed=False`, `category=social`, start 5:00 PM PT, no end. Display string:
"Fri, Nov 6, 2026, 5:00 PM PT".
UNDO: `python /app/backend/tropical_fix.py --undo 20261101T030326Z`

### 3. ID-based matching (DRY RUN ONLY, nothing written)
Proposed key = `hash(source_key, source_UID, occurrence)` ignoring the start date. OCSA uses
the iCal UID plus RECURRENCE-ID (so a recurring series keeps one row per occurrence); OWSA
uses the event page URL; tombstones would use the same new id. Added `source_uid` and
`recurrence_id` (OCSA) / `source_uid` + `source_tag` (OWSA) to the imported event record so
the key can be built. `events_rekey.py` dry run against live feeds:
- current scraped docs 124, feed events 121, unique proposed ids 121
- RE-LINK (same event, id string changes): 120
- MERGE (2+ current docs collapse into one): 0 groups, 0 removed  (recurrence_id prevents series collapse)
- NEW INSERT (feed event with no current doc): 1
- ORPHAN (current doc not in the feed now): 4 (all OWSA: Nauti Drinks, Holiday Party, Fireside, Game & Art Night)
Not applied. Applying (on "go") means re-keying existing doc ids + tombstones and flipping
the aggregator to the new key together, with an --undo.

### 4. OWSA "Book online" (LIVE parser fix)
The OWSA parser now skips any anchor whose text is "book online" (case-insensitive, trimmed)
and, when present in the same row, uses that link as the event's `registration_url` (the
importer still respects a locked `registration_url`). Current count of "Book online" rows: 0,
so there is nothing to clean up now; this prevents them going forward.
Why they used to reappear: the "Book online" registration link is itself an `/event/...`
anchor, so the old parser created a separate event from it; and because the old match key was
title + date, a deleted copy whose parsed date shifted got a new id that the tombstone (keyed
to the old id) did not catch, so it returned on the next scrape.

### 5. Category keywords + source tags (APPLIED backfill + new rules)
`categorize.py` rewritten. Title is checked first, first match wins, in this order: social
(dinner, party, awards, banquet, drinks, potluck, social, fireside), education (seminar,
workshop, clinic), racing (regatta, race, opening day, cup, series), other (meeting). Then the
source tag (OWSA type: social/fireside -> social, board meeting/meeting -> other, etc.).
Unmatched stays "other" and flagged for review. Only applied where `category_manual` is not
set, so admin/owner edits are never overridden.
IMPORTANT behavior change: the old blanket "every OCSA event = racing" default was REMOVED
(it was forcing socials like Tropical Party to racing). `events_recat.py --apply` backfilled
112 non-manual scraped events; 44 changed: 41 racing->other (non-race OCSA items like Winter
Sailing on Sundays and Delta Cruise, now flagged for review), 2 racing->social, 1
cruising->other. Live category counts now: racing 68, other 43, social 11, education 1,
volunteering 1.
Note: Jenn's keyword list has no CRUISING title words, so cruise-type titles fall to
"other + review" unless the source tag says cruising. Say the word and I can add cruising
keywords or keep a per-source default to shrink the review pile.
UNDO: `python /app/backend/events_recat.py --undo 20261101T030422Z`

## Verified in the live app vs only in code
- Live (DB + external API): Tropical Party fields and 5 PM display; category backfill counts;
  events API returns 200 with the new fields.
- Code/unit only: the shared lock derivation (function call) and the importer's lock-respect
  (existing logic). I did NOT browser-test the admin editor end to end because admin sign-in
  is Google-only and there are no test credentials.
- Not observed on real data: the OWSA "Book online" skip (0 such rows exist now) and the
  ID-based re-key (dry run only, not applied).
- Not re-checked: 48 North remains 403 (unchanged, waiting on Joe Cline). No live scrape was
  run, so the aggregator code changes take effect on Jenn's next scrape.
