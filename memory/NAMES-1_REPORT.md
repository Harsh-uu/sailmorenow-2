# NAMES-1 - Show current author names everywhere (Option A)

Date: 2026-11-02. Backend-only (shared API). No publish. testing_agent NOT used (forbidden). No schema change, no backfill, no data touched beyond temp. No em-dashes in copy. Notification titles left as written.

## What changed (read-time refresh of the live display name)
Every read path that already refreshed the author HANDLE now also refreshes the live display NAME from the `users` collection. Business-identity posts keep their stored business name. If the user record is missing (deleted account), it falls back to the stored name, so it is never blank.

Files / paths:
1. `routers/community_router.py` `list_posts` (`GET /api/posts`) - `author_name` (personal only; business branch untouched).
2. `routers/community_router.py` `list_comments` (`GET /api/posts/{id}/comments`) - `author_name` (skips business).
3. `routers/hub_router.py` `list_discussions` (`GET /api/discussions`) + `get_discussion` (`GET /api/discussions/{id}`) - `author_name` (non-business).
4. `routers/community_router.py` `_hydrate_crew_verified` (used by `GET /api/crew-bank/standalone` and `GET /api/crew-bank/open`) - `user_name`.
5. `routers/community_router.py` `list_event_crew` (`GET /api/events/{id}/crew`) - `user_name`.
6. `routers/community_router.py` `list_registrations` (`GET /api/events/{id}/registrations`) - `user_name` (RSVP list).
7. `routers/messaging_router.py` `list_messages` (`GET /api/messages/{thread_id}`) - group-bubble `from_name` (non-business; deleted sender falls back to stored).
8. `routers/reviews_router.py` `reviews_list` (`GET /api/reviews/list/{target}`) - the stored `reply.author_name` ("Reply from ...") now shows the reviewed party's live name.

## Already correct (no change needed)
Review AUTHOR names already read live: `reviews_list` builds `author.name = users.name`, and `mutual_reviews_for` sets `author_name = users.name`. One-way org reviews are rendered through `/api/reviews/list`, so they were already current; only the reply line (item 8) still stored a name, now refreshed.

## Named extra surfaces - status
- Event RSVP in-app list: COVERED (item 6).
- Event crew pool list: COVERED (item 5).
- Stored message sender names: COVERED for the surface that displays them (group message bubbles, item 7). 1:1 thread headers and group member rows were already live (`_member_summary`, live `other` user).
- Review types storing author_name at creation (one-way org reviews): the review author name was already live on the rendered endpoint; the only stored-and-shown bit (reply author line) is now refreshed (item 8).
- `GET /api/crew-bank/open-opportunities` returns raw posts with a stored `author_name` and does NOT refresh the handle, so it is outside the stated scope. It is also not called by web or mobile, so it renders nowhere. Left unchanged (reported, not skipped silently).

Nothing from the named list was left unaddressed on any surface that actually displays a name.

## Verification (temp accounts only, all temp data + scripts deleted, zero residue)
API (covers mobile, which reads these same endpoints) - 9/9 PASS after renaming the temp account:
feed post, comment, forum list, forum detail, org review author, standalone crew, event crew, event RSVP, group message sender - all showed the NEW name; old name gone.
WEB (browser, `/community` with the temp session) - the renamed name "Tempalpha WebRenamed" rendered on the feed post, old name absent. [BROWSER VERIFIED]

Code-only / not device-tested: native mobile app UI was not run on a device; mobile correctness is inferred from the shared API (verified) since mobile renders `author_name`/`user_name`/`from_name` straight from these responses. No mobile code was changed.
