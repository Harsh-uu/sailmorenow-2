# PROS-FILTER-1 - Boat Pros "Filter by specialty" shows 0 counts (mobile)

Build stamp rv3a-24 -> rv3a-25 (BUILD_TIME 2026-11-02 UTC, hand-typed). No copy
changes. Hyphens only. testing_agent NOT used.

## What differs between web and mobile (found before changing anything)
- MOBILE specialty picker shows a per-specialty COUNT badge and an "All
  specialties (total)" row. To get those it calls
  `GET /api/boat-pros/category-counts` (optionally `?market=<name>`), reads
  `d.counts` / `d.total`, and swallows any error (`.catch(() => {})`).
- WEB (frontend/src/pages/Directory.jsx) shows NO counts - its specialty options
  are plain `{ value: c, label: c }` and it NEVER calls category-counts. So web
  does not depend on that endpoint, which is why "the same screen works on web".
- Both clients filter the list identically: `GET /api/boat-pros?category=<name>`
  (mobile builds it with URLSearchParams, web with axios params). Same encoding,
  same category strings (both come from `/api/markets` `categories`), e.g.
  "Bottom Paint & Haul-out", "Detailing - Exterior".

## Root cause (BACKEND)
In `backend/routers/directory_router.py` the function `boat_pro_category_counts`
(the handler for `/boat-pros/category-counts`) had LOST its route decorator - it
was defined immediately after `set_active_identity` with no `@router.get(...)`
line above it, so it was never registered as an endpoint. Requests to
`/api/boat-pros/category-counts` therefore fell through to the parameterised
route `@router.get("/boat-pros/{pro_id}")` and returned `{"detail":"Not found"}`.

Proof (before fix):
    GET /api/boat-pros/category-counts            -> {"detail":"Not found"}
    GET /api/boat-pros/category-counts?market=... -> {"detail":"Not found"}
Mobile's `.catch(() => {})` swallowed the 404, leaving `catCounts = {}` and
`total = 0`, so every specialty rendered "0" and "All specialties" showed 0.

The list filter itself was never broken: `GET /api/boat-pros?category=Rigging`
returned its 1 pro before the fix, so "filtering returns nothing" was the
zero-count display, not a second bug.

## Fix (smallest change - one line, backend only)
Restored the decorator above the handler:
    @router.get("/boat-pros/category-counts")
    async def boat_pro_category_counts(market: Optional[str] = None):
It is registered BEFORE `/boat-pros/{pro_id}`, so the specific path matches first.
No other code changed. Nothing changed on the mobile client (its call and count
logic were already correct); only the build stamp was bumped so Jenn can confirm
the latest build.

## Verified in the browser (phone width 390, temp account, after fix)
- category-counts (curl): All markets total 9 (Canvas 3, others 1); Portland/
  Vancouver total 4 (Canvas 2, Detailing - Exterior 1, Detailing - Interior 1).
- Mobile directory, All markets: specialty sheet shows "All specialties 9",
  Canvas 3, Bottom Paint & Haul-out 1, Batteries & Charging 1, and 0 for
  specialties with no pros - matching the data (web shows the same list, just
  without the numbers).
- Mobile directory, single market (Portland/Vancouver): sheet shows "All
  specialties 4", Canvas 2, Detailing - Exterior 1, Detailing - Interior 1, zeros
  elsewhere - matches the backend.
- Tapping Canvas: the picker shows "Canvas (3)" and the list returns exactly the
  3 Canvas pros (Ankor, Riggers R us, River City Canvas). Filtering returns the
  right Boat Pros.

## Code-only (not device-tested)
Nothing material. The fix is a backend route registration verified directly by
curl and by the on-device (web preview) directory at phone width. The change has
no iOS-specific behavior. (The build-stamp bump to rv3a-25 is a mobile file, so a
real-device check just needs to show rv3a-25 in the KB debug strip.)

## Temp account
`jenn+prosfilter@sailmorenow.com` (sailor) created for the signed-in checks and
fully purged afterward (users, signup_events, sessions, zoho_outbox); residue
verified 0.
