# ROUTE-AUDIT-1 - backend route registration audit (REPORT ONLY, nothing changed)

Scope: all 25 routers in `backend/routers/*.py`, mounted in `server.py` with
`prefix="/api"` in a fixed include order. 329 decorated handlers -> 333
method+path routes (api_route entries expand per method). Method used: static
analysis (Python `ast` to read decorators + handler names, git to read history).
No files were modified. Hyphens only. No testing agent.

================================================================================
## (a) Handler-shaped async functions with NO router decorator
Only ONE true orphan existed, and it is the one already fixed:
- `backend/routers/directory_router.py` - `boat_pro_category_counts` (the handler
  for `/boat-pros/category-counts`). At fork-init it had no `@router.get`; it was
  restored in this session. (Listed here for completeness; now registered.)

Every other module-level `async def` without a router decorator is a genuine
helper or middleware, confirmed by internal callers - NOT an orphaned route:
- Middleware: `ipban_router.py:26 ban_middleware` (registered via
  `app.middleware("http")` in server.py:65).
- Startup/seed helpers: `content_router.py:75 seed_faqs` (called server.py:280),
  `ipban_router.py:18 load_bans` (called ipban_router.py:28).
- Internal compute helpers: `reports_router.py:103 get_inaccurate_threshold`
  (called reports_router.py:117,316), `reviews_router.py:485 compute_summary`
  (called from community/directory/reviews routers).
- ~55 underscore-prefixed helpers (`_require`, `_me`, `_notify*`, `_hydrate*`,
  `_handle_event`, etc.) - all internal, all have callers.

FINDING: no remaining orphaned route handlers. Severity: n/a (clean).

================================================================================
## (b) Literal routes shadowed by an earlier dynamic route (same method)
Checked every pair in global registration order: a dynamic `/{param}` segment
registered BEFORE a literal sibling it would swallow.

FINDING: NONE currently shadowed. Severity: n/a.

### (b-latent) Ordering-dependent pairs - correct today, fragile by design
These are the exact category-counts pattern: a literal path that shares a prefix
with a `/{id}` route. They work ONLY because the literal is registered before the
dynamic route in file/registration order. If a future edit reorders them (moves
the `/{id}` handler above the literal, or moves the literal below it), the literal
will be shadowed and return the `/{id}` handler's 404/wrong body. Severity LOW
now, but each is a latent trap worth a guard (keep literals above `/{id}`):

| Method | Literal (file:line)                                   | Dynamic sibling (file:line)                | Screen it would break |
|--------|-------------------------------------------------------|--------------------------------------------|-----------------------|
| GET    | /boat-pros/mine (directory_router.py:286)             | /boat-pros/{pro_id} (directory_router.py:645) | My Boat Pro listing / photos (web + mobile) |
| GET    | /boat-pros/category-counts (directory_router.py:595)  | /boat-pros/{pro_id} (directory_router.py:645) | Mobile Boat Pros "Filter by specialty" (the bug just fixed) |
| GET    | /boat-pros/insights (directory_router.py:613)         | /boat-pros/{pro_id} (directory_router.py:645) | My listing insights |
| GET    | /messages/threads (messaging_router.py:129)           | /messages/{thread_id} (messaging_router.py:275) | Messages inbox list |
| GET    | /messages/unlock-banner (messaging_router.py:196)     | /messages/{thread_id} (messaging_router.py:275) | Messages unlock banner |
| GET    | /review-sessions/mine (reviews_router.py:372)         | /review-sessions/{session_id} (reviews_router.py:394) | Reviews ("My reviews") |
| PATCH  | /admin/events/bulk (admin_router.py:1026)             | /admin/events/{event_id} (admin_router.py:1045) | Admin Events bulk edit |
| POST   | /messages/group (messaging_router.py:481)             | /messages/{recipient_id} (messaging_router.py:583) | Start group message |

All 8 are currently SAFE (literal registered first).

================================================================================
## (c) Duplicate (method, path) pairs
FINDING: NONE. No path is registered twice for the same method anywhere in the 25
routers. Severity: n/a.

================================================================================
## (d) Client calls vs registered routes
Scanned 269 unique method+path `api.<method>(...)` calls across `frontend/src`,
`mobile/src`, `mobile/app`, normalising `${...}` to a wildcard segment and
prefixing `/api` (both clients use baseURL `${BACKEND}/api`). 266 matched a
registered route directly (method + path). The 3 flagged all resolve - there are
NO genuinely missing endpoints:

1. `GET /admin/testimonials` - FALSE POSITIVE (my regex truncated the template
   literal `/admin/testimonials${f ? ...}`). The real call is
   `/admin/testimonials[?status=]`, which IS registered
   (content_router.py:281). No issue. AdminModeration screen.

2. `POST /admin/moderation/{action}` (frontend NotificationsBell.jsx:59) - the
   path is built from a FIXED action set. Registered literals:
   `/admin/moderation/restore` (194), `/hide` (213), `/restore-doc` (225),
   `/remove` (242). The component only passes those values, so every call lands
   on a real route. Severity INFO/LOW: it would 404 only if an `action` outside
   that set is ever passed. Web admin moderation (from the notifications bell).

3. `POST /admin/users/{id}/{action}` (frontend AdminModeration.jsx:64) - `action`
   is `u.banned ? "unban" : "ban"`; both `/admin/users/{uid}/ban` (150) and
   `/unban` (168) exist. Safe. Admin user moderation screen.

FINDING: no client call targets a non-existent route; no method mismatch (would
be 405) detected. Note: 422 (request-body validation) cannot be judged by static
path analysis - it needs body-schema comparison, which is out of scope here;
none were observed from the path/method check.

================================================================================
## Version history - how the category-counts decorator went missing
Git history for this fork is squashed to two commits: `34c8626 "post fork init"`
(the fork baseline) and `48d7f8c` (this session's fix restoring the decorator).

I inspected the fork-init blob directly:
`git show 34c8626:backend/routers/directory_router.py` already shows
`async def boat_pro_category_counts(...)` at line 592 with NO decorator above it
(the line above is the end of `set_active_identity`'s return dict).

CONCLUSION: the decorator was already missing at fork-init, so it was dropped in a
session BEFORE this fork. The platform does not retain the granular pre-fork edit
history, so I cannot identify the exact commit/edit that removed it, nor confirm
what else changed in that same edit. (Observation only, no change: the fork-init
docstring of that function still contains an em-dash "match - and ..."; it is a
code docstring, so it was intentionally left out of the EMDASH-1 copy sweep.)

================================================================================
## Summary of recommendations (for a future BUILD task - not done here)
- P2/LOW: the 8 ordering-dependent pairs in (b-latent) are the same failure class
  as category-counts. Consider a lightweight guard (a startup assertion or a test
  that every literal under a `/{id}` parent resolves) so a reorder or a dropped
  decorator fails loudly instead of silently 404-ing a screen.
- INFO: the two client "dynamic-from-fixed-set" paths in (d) #2/#3 are fine today;
  if those action sets ever grow, keep the backend literals in sync.
- No orphaned routes, duplicates, shadowed literals, or missing endpoints remain.
