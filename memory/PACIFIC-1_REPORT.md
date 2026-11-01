# PACIFIC-1 Report (event times in Pacific, web + mobile + emails)

Rules honored: NO testing agent (render checks, Node logic checks, screenshots, server-side checks),
no em dashes, no stored data rewritten. Temporary checks only; nothing persisted. Build stamp bumped
(mobile rv3a-15 -> rv3a-16; the email footer stamp was not touched here, this is not an email-copy change).

## 1. What now shows in Pacific time (America/Los_Angeles, DST-aware) with a "PT" label
A single Pacific-anchored formatter was added on each surface; all event date/time displays use it.
- Web (`frontend/src/lib/eventCategories.js`): `formatEventDate` (date + time + "PT"), `formatEventTimePT`
  (end time), `eventBadge` (month/day in PT), `eventDayKey` (PT calendar day for calendar + day filter).
  Wired into `EventRow.jsx` (list cards + date badge), `EventDetailModal.jsx` (detail + end time),
  `EventCalendar.jsx` / `Events.jsx` (calendar grouping and day selection), `AdminEvents.jsx`
  (admin list + editor display).
- Mobile (`mobile/src/lib/format.ts`): `fmtDate`, `fmtDateTime` (+ "PT"), `fmtEventRange` (start-end,
  one "PT"), `fmtBadge`, `ptDayKey`. Wired into `EventDetailScreen.tsx`, `events/index.tsx`
  (list badge, calendar grouping, day filter), `my-events.tsx`, `my-crew-listings.tsx`.
- Emails (`backend/mailer.py`): new `fmt_event_pt()` (date + time + "PT", DST-aware; all-day = date only).
  Wired into crew-join, event-blast, and the digests (category review, imported-contact digest,
  community digest). All-day events show the date with no misleading time.

All-day events (stored as midnight UTC) are shown as a date only, with no timezone shift.

## 2. How event times are stored, and how creator input is interpreted
STORAGE (unchanged by this task; reported as requested):
- Manually created events: stored as a canonical ISO string. The create path runs values through
  `date_utils.normalize_iso`, which converts any timezone-aware input to UTC. A naive input (no offset)
  was previously assumed to be UTC.
- Scraped events: the ICS path stores canonical UTC (via `normalize_iso`). The HTML-scrape path
  previously built the time with a FIXED -08:00 offset (ignoring daylight saving) and stored that aware
  ISO. This task changed only that scraper to use `America/Los_Angeles` (DST-aware) so future scrapes
  are correct; existing summer HTML-scraped rows may read 1 hour early until the next scrape refresh.

CREATOR INPUT (changed so typed times are treated as Pacific, as you asked):
- The web form (`datetime-local`), the mobile form (`new-event.tsx`), and the admin editor all take a
  wall-clock the creator types. PREVIOUSLY these were interpreted inconsistently (web: as UTC; mobile and
  admin: in the device timezone). NOW all three convert the typed wall-clock as Pacific -> true UTC
  (DST-aware) before saving (`ptInputToISO`), and edit screens repopulate the field from UTC back to
  Pacific wall-clock (`isoToPTInput` / `isoToPTDate` / `isoToPTTime`). So a creator who types 3:30 PM gets
  3:30 PM Pacific, stored correctly and shown as "3:30 PM PT" to everyone regardless of their device.

DATA NOT REWRITTEN (needs your go-ahead):
- Any manual event created BEFORE this change was stored as the typed wall-clock digits parked in a UTC
  field (not a true Pacific instant). With PT display now on, those specific old rows will read shifted by
  the Pacific offset. I did NOT migrate anything. In the current data this is low impact: of 138 events,
  119 are scraped (true instants, display correctly) and 19 are seed/demo rows (left untouched per the
  no-seed rule). If you want, I can run a one-time migration that reinterprets each pre-change manual
  (non-scraped) timed event as Pacific and rewrites it to true UTC. Say the word and I will, on a copy
  check first.

## 3. Daylight-saving boundary (Sunday Nov 1, 2026) - verified
Using the real formatters:
- Before the change (PDT, UTC-7): `2026-10-31T20:00:00Z` -> "Sat, Oct 31, 2026, 1:00 PM PT".
- After the change (PST, UTC-8): `2026-11-02T20:00:00Z` -> "Mon, Nov 2, 2026, 12:00 PM PT".
Round-trip of creator input also respects DST: typing 3:30 PM on Aug 21 stores 22:30Z (PDT), on Dec 21
stores 23:30Z (PST), and both display back as "3:30 PM PT".

## 4. Widths + what is browser-verified vs code-only
- Only short time strings changed; no layout/structure changed, so laptop/tablet/phone layouts are
  unaffected. The mobile app was loaded at 390px (phone) and renders with no bundling error.
- The signed-out web Events page is gated behind "Create an account", and the authenticated event list
  requires a login (admin is Google-only, no stored test credentials), so the logged-in list/detail were
  NOT browser-verified at each width.

BROWSER-VERIFIED: web app and mobile app both load with no crash/red-box after the changes (web /events
gate screen; mobile 390px landing).
CODE / LOGIC-VERIFIED (not in a live logged-in view): the PT formatters and the Pacific<->UTC conversion
on all three surfaces, including the Nov 1 2026 DST boundary, checked with Node and Python against the
exact code; the email `fmt_event_pt` output (PDT/PST/all-day) and that crew-join renders "PT"; Expo SDK 58
(Hermes) supports the Intl timezone the mobile dayjs timezone plugin relies on, and the dayjs tz logic was
confirmed.
NOT VERIFIED: pixel rendering inside the authenticated web event list/detail and the mobile events tab
(no login available); real inbox rendering of the event emails.

## Files changed
- backend/mailer.py (fmt_event_pt + crew-join/event-blast/digests), backend/aggregator.py (HTML scraper
  fixed -8 -> America/Los_Angeles).
- frontend/src/lib/eventCategories.js, components/EventRow.jsx, components/EventDetailModal.jsx,
  pages/Events.jsx, pages/AdminEvents.jsx.
- mobile/src/lib/format.ts, src/screens/EventDetailScreen.tsx, app/(tabs)/events/index.tsx,
  app/(tabs)/my-events.tsx, app/new-event.tsx, app/my-crew-listings.tsx, src/lib/buildStamp.ts.
