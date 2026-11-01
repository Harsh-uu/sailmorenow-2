# PACIFIC-2 follow-up report (time_not_listed flag, Tentative label, repair dry run)

No testing agent. No em dashes. Data repair NOT applied (dry run only, waiting for Jenn's go).
Mobile build stamp bumped rv3a-17 -> rv3a-18.

## 1. Explicit `time_not_listed` flag replaces the midnight-UTC guess
The "no time" decision is now an authoritative stored boolean `time_not_listed` on each
event. Timed events are still stored as true UTC instants; only the flag says whether a
time was given.

- Backend helper `date_utils.event_no_time(ev_or_iso, flag=None)`: returns the stored flag
  when it is a boolean, otherwise falls back to the legacy midnight-UTC sentinel (for older
  rows written before the flag existed). This is the single source of truth.
- Flag is written on every new path:
  - `aggregator.py`: `time_not_listed = True` for VALUE=DATE source events, `False` for timed.
  - `community_router.py` create and PATCH: `time_not_listed = is_date_only(raw starts_at)`
    (the web/mobile "time to be decided" toggle already sends a date-only value).
- Flag is read everywhere for display and sorting:
  - Web `lib/eventCategories.js`: `formatEventDate`, `formatEventWhen`, `eventBadge`,
    `eventDayKey` take the flag; call sites pass `event.time_not_listed` (EventRow,
    EventDetailModal, EventMap, CrewListingPopup, EventCalendar, MyEvents, AdminEvents, Events).
  - Mobile `src/lib/format.ts`: `fmtDate`, `fmtDateTime`, `fmtEventRange`, `fmtBadge`,
    `ptDayKey` take the flag; call sites pass `item.time_not_listed` (events list, event
    detail, my-events, following, directory org).
  - Email `mailer.fmt_event_pt(iso, with_time, time_not_listed)`; blast/digest callers pass
    `e.get("time_not_listed")`.
  - Reminders `scheduler.py` use `event_no_time(ev)`.
  - `follows_router` activity payloads now include `time_not_listed`.

### 00:00:00Z timed events (requested check)
Query of the live DB: of 125 scraped events, 114 sit at exactly `...T00:00:00+00:00`, and
ALL 114 are date-only sentinels (none is a genuine timed event). So there are currently
**0 genuine timed events stored at 00:00:00Z**, and nothing is misclassified today.

Proof the flag protects the real case going forward (backend `fmt_event_pt`):
- `2026-11-07T00:00:00+00:00`, flag absent -> "Sat, Nov 7, 2026 - Time not listed" (sentinel).
- `2026-11-07T00:00:00+00:00`, `time_not_listed=False` -> "Fri, Nov 6, 2026, 4:00 PM PT"
  (a real 4 PM PST event that lands at 00:00Z now shows its real Pacific time).
- `2026-08-21T22:30:00+00:00`, no flag -> "3:30 PM PT" (unchanged).

## 2. Single undo command for the repair
`python /app/backend/pacific2_repair.py --undo <STAMP>` restores starts_at, ends_at and
time_not_listed on every event in that run's backup (the `--apply` run prints the exact
undo line and writes `events_backup_pacific2` + a JSON dump).

## 3. Repair scope for this run
- INCLUDE "Winter Sailing on Sundays (Nov 1)" (its starts_at is admin-locked, but the repair
  overrides time fields ONLY and leaves every other locked field as the admin set it).
- EXCLUDE "OCSA - Tropical Party" entirely (Jenn edits it; its description states a real time).
- Never touch tombstoned events. Writes starts_at / ends_at / time_not_listed only.

## 4. [Draft] -> Tentative label
`eventTitleParts(title)` (web `eventCategories.js` and mobile `format.ts`) strips a leading
`[Draft]` from the DISPLAYED title and returns `tentative: true`. A "Tentative" pill is shown
on the event card and detail (web + mobile). It is derived from the live title at render time,
so it disappears automatically when the source drops the prefix. Events are never hidden.

## 5. Data-repair DRY RUN (current DB, nothing written)
A scheduled scrape has already run the fixed parser, so most historical date-only events are
already stored correctly. The repair's remaining REAL work is now tiny:

- SCRAPED TOTAL: 125; matched date-only: 114, timed: 10.
- WOULD CHANGE: 124, of which:
  - **real date/time corrections: 1** -> Winter Sailing Nov 1:
    `2026-11-01T15:00:00+00:00 | None` -> `2026-11-01T00:00:00+00:00 | None` (date-only).
  - flag-only backfill (no time change): 123 (sets the explicit `time_not_listed` flag on
    rows whose stored times are already correct).
- excluded (Tropical Party): 1; tombstoned skipped: 0; no feed match: 0.
- sarc-48north returns HTTP 403, so its events are not in the recompute set and are untouched.

## Files changed
- backend: date_utils.py (event_no_time), aggregator.py (writes time_not_listed),
  community_router.py (create + PATCH set the flag), mailer.py (fmt_event_pt flag param),
  scheduler.py (event_no_time), follows_router.py (flag in activity payloads),
  pacific2_repair.py (rewritten: flag-aware, excludes Tropical Party, includes Winter Nov 1,
  time fields only, --undo).
- frontend: lib/eventCategories.js (flag params + eventTitleParts), EventRow, EventDetailModal,
  EventMap, CrewListingPopup, EventCalendar, MyEvents, Events (flag + Tentative).
- mobile: src/lib/format.ts (flag params + eventTitleParts), events/index, EventDetailScreen,
  my-events, following, directory/org (flag + Tentative), buildStamp rv3a-18.
