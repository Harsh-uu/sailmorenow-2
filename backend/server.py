"""Sail More Now — FastAPI backend entrypoint.

Routers:
  auth_router       — /api/auth/*, /api/admin/zoho/*, /api/admin/scheduler/*
  directory_router  — /api/markets/*, /api/boat-pros/*, /api/reviews, /api/crew-positions
  community_router  — /api/posts, /api/events (incl. registrations, crew bank, aggregator admin)
  messaging_router  — /api/messages/*, /api/ws/{user_id}
  payments_router   — /api/payments/*, /api/webhook/stripe
  seed_router       — /api/, /api/seed
"""
from pathlib import Path
from dotenv import load_dotenv
import asyncio
import logging

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI  # noqa: E402
from starlette.responses import Response  # noqa: E402
import os  # noqa: E402

from deps import db, client  # noqa: E402 — must import so mongo connection binds at boot
from datetime import datetime, timezone  # noqa: E402
from scheduler import start_scheduler  # noqa: E402
from routers.auth_router import router as auth_router  # noqa: E402
from routers.directory_router import router as directory_router  # noqa: E402
from routers.community_router import router as community_router  # noqa: E402
from routers.messaging_router import router as messaging_router  # noqa: E402
from routers.payments_router import router as payments_router  # noqa: E402
from routers.seed_router import router as seed_router  # noqa: E402
from routers.notifications_router import router as notifications_router  # noqa: E402
from routers.reviews_router import router as reviews_router  # noqa: E402
from routers.admin_router import router as admin_router  # noqa: E402
from routers.hub_router import router as hub_router  # noqa: E402
from routers.reports_router import router as reports_router  # noqa: E402
from routers.ipban_router import router as ipban_router, ban_middleware  # noqa: E402
from routers.identity_router import router as identity_router  # noqa: E402
from routers.reactions_router import router as reactions_router  # noqa: E402
from routers.storage_router import router as storage_router  # noqa: E402
from routers.follows_router import router as follows_router  # noqa: E402
from routers.admin_content_router import router as admin_content_router  # noqa: E402
from routers.content_router import router as content_router  # noqa: E402
from routers.demo_router import router as demo_router  # noqa: E402
from routers.sponsors_router import router as sponsors_router  # noqa: E402
from routers.event_sources_router import router as event_sources_router  # noqa: E402
from routers.plans_router import router as plans_router  # noqa: E402
from routers.review_disputes_router import router as review_disputes_router  # noqa: E402
from routers.admin_access_router import router as admin_access_router  # noqa: E402

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
logger = logging.getLogger("smn")

app = FastAPI(title="Sail More Now API")

for r in (auth_router, directory_router, community_router,
          messaging_router, payments_router, seed_router, notifications_router,
          reviews_router, admin_router, hub_router, reports_router, ipban_router, identity_router,
          reactions_router, storage_router, follows_router, admin_content_router,
          content_router, demo_router, sponsors_router, event_sources_router,
          plans_router, review_disputes_router, admin_access_router):
    app.include_router(r, prefix="/api")

app.middleware("http")(ban_middleware)

# --- CORS -------------------------------------------------------------------
# The mobile app authenticates with a Bearer token (no cookies) while the web
# app uses an httpOnly cookie. A single credentialed CORSMiddleware can't echo
# a wildcard, and some preview edges rewrite the browser Origin header, which
# breaks credentialed origin-echo for the (non-credentialed) mobile preview.
# So: when a request carries our session cookie (web, credentialed) we echo the
# Origin and allow credentials; otherwise (mobile Bearer / same-origin) we
# return a wildcard, which browsers accept for non-credentialed requests.
@app.middleware("http")
async def cors_middleware(request, call_next):
    origin = request.headers.get("origin")
    is_preflight = request.method == "OPTIONS" and request.headers.get("access-control-request-method")
    if is_preflight:
        resp = Response(status_code=204)
    else:
        resp = await call_next(request)
    if origin:
        has_cookie = "session_token=" in (request.headers.get("cookie") or "")
        if has_cookie:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Vary"] = "Origin"
        else:
            resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = request.headers.get("access-control-request-headers") or "*"
        resp.headers["Access-Control-Expose-Headers"] = "*"
    return resp


@app.on_event("startup")
async def _startup():
    try:
        await db.users.create_index("user_id", unique=True)
        await db.review_sessions.create_index("participants.user_id")
        await db.review_sessions.create_index("reveal_at")
        await db.review_sessions.create_index("revealed")
        await db.mutual_reviews.create_index([("session_id", 1), ("author_id", 1)], unique=True)
        await db.mutual_reviews.create_index("target_id")
        await db.comments.create_index("post_id")
        await db.comments.create_index("parent_id")
        await db.password_resets.create_index("token_hash")
        await db.password_resets.create_index("user_id")
        await db.password_reset_requests.create_index("created_at")
        # TTL: auto-purge expired sessions and stale abuse logs (30-day retention).
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.rate_limit_events.create_index("created_at", expireAfterSeconds=30 * 24 * 3600)
        await db.users.create_index("email", unique=True, sparse=True)
        await db.login_attempts.create_index("identifier", unique=True)
    except Exception:
        logger.exception("failed to ensure indexes")
    # Bootstrap the first admin (Google-only) and enforce that NO admin account
    # has a password login. ADMIN_EMAILS is used only to create/promote the first
    # admin on an empty database; admin status is otherwise DB-authoritative.
    try:
        from deps import admin_emails
        import uuid as _uuid
        admins = admin_emails()
        if admins:
            admin_email = sorted(admins)[0]
            existing = await db.users.find_one({"email": admin_email})
            if not existing:
                await db.users.insert_one({
                    "user_id": f"user_{_uuid.uuid4().hex[:12]}", "email": admin_email,
                    "name": "SMN Admin", "first_name": "SMN", "last_name": "Admin",
                    "handle": "smnadmin",
                    "platform_role": "admin", "account_type": "partner",
                    "auth_google": True, "email_verified": True,
                    "primary_market": None, "markets": [], "reasons": [],
                    "avatar": None, "bio": None, "subscription_tier": "free",
                    "newsletter_opt_in": False, "policies_agreed": True, "onboarding_complete": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info("bootstrapped Google-only admin account %s", admin_email)
            elif existing.get("platform_role") != "admin":
                await db.users.update_one({"email": admin_email},
                                          {"$set": {"platform_role": "admin"}})
                logger.info("promoted bootstrap admin %s", admin_email)
        # Admins are Google-only: strip any stored password hash from admin accounts.
        await db.users.update_many({"platform_role": "admin", "password_hash": {"$exists": True}},
                                   {"$unset": {"password_hash": ""}})
    except Exception:
        logger.exception("failed to bootstrap admin account")
    # One-shot migration: strip raw HTML from previously-imported aggregator events.
    try:
        from aggregator import _strip_html, past_event_predicate
        from date_utils import normalize_iso
        cur = db.events.find(
            {"source": "aggregator", "description": {"$regex": "<[a-zA-Z][^>]*>"}},
            {"_id": 0, "id": 1, "description": 1},
        )
        fixed = 0
        async for ev in cur:
            clean = _strip_html(ev.get("description") or "", max_len=800)
            await db.events.update_one({"id": ev["id"]}, {"$set": {"description": clean}})
            fixed += 1
        if fixed:
            logger.info("stripped HTML from %s aggregator event descriptions", fixed)
        # Normalize any legacy starts_at/ends_at strings to canonical UTC ISO so
        # read-time string comparisons behave correctly. Skip already-canonical
        # rows to keep this O(legacy) on subsequent boots.
        from date_utils import is_date_only, end_of_day_iso
        norm_cur = db.events.find(
            {"$or": [
                {"starts_at": {"$not": {"$regex": r"\+00:00$"}}},
                {"ends_at": ""},  # empty-string legacy rows we need to null out
                {"ends_at": {"$exists": True, "$ne": None, "$not": {"$regex": r"\+00:00$"}}},
            ]},
            {"_id": 0, "id": 1, "starts_at": 1, "ends_at": 1},
        )
        normalized = 0
        async for ev in norm_cur:
            raw_starts = ev.get("starts_at")
            raw_ends = ev.get("ends_at")
            s = normalize_iso(raw_starts)
            # Empty-string / whitespace ends_at → drop to null so $ifNull works.
            if isinstance(raw_ends, str) and not raw_ends.strip():
                e = None
                clear_ends = True
            else:
                e = normalize_iso(raw_ends) if raw_ends else None
                clear_ends = False
            # All-day event with no ends_at → expand ends_at to next-day midnight
            if is_date_only(raw_starts) and not e:
                e = end_of_day_iso(raw_starts)
            update = {}
            if s and s != raw_starts:
                update["starts_at"] = s
            if e and e != raw_ends:
                update["ends_at"] = e
            elif clear_ends:
                update["ends_at"] = None
            if update:
                await db.events.update_one({"id": ev["id"]}, {"$set": update})
                normalized += 1
        if normalized:
            logger.info("normalized ISO timestamps on %s legacy events", normalized)
        # Purge stale past aggregator events on startup.
        purged = await db.events.delete_many(past_event_predicate(datetime.now(timezone.utc).date().isoformat()))
        if purged.deleted_count:
            logger.info("purged %s stale past aggregator events on startup", purged.deleted_count)
    except Exception:
        logger.exception("aggregator description migration failed")
    try:
        start_scheduler(db)
    except Exception:
        logger.exception("failed to start scheduler")
    # Seed the event-source registry and, if the aggregator has not run in the
    # last 8 days (e.g. the pod slept through the Sunday 03:00 PT job), run a catch-up
    # ONCE in the background without blocking startup or overlapping other runs.
    try:
        from event_sources import seed_default_sources
        seeded = await seed_default_sources(db)
        if seeded:
            logger.info("seeded %s default event sources", seeded)
        import asyncio as _asyncio
        from datetime import datetime as _dt, timezone as _tz, timedelta as _tdelta

        async def _aggregator_catchup():
            try:
                last = await db.app_meta.find_one({"key": "aggregator_last_run"})
                run_at = (last or {}).get("run_at")
                stale = True
                if run_at:
                    try:
                        prev = _dt.fromisoformat(run_at)
                        if prev.tzinfo is None:
                            prev = prev.replace(tzinfo=_tz.utc)
                        stale = prev < _dt.now(_tz.utc) - _tdelta(days=8)
                    except Exception:
                        stale = True
                if not stale:
                    return
                # Simple overlap guard via a lock doc (TTL-ish by timestamp).
                lock = await db.app_meta.find_one_and_update(
                    {"key": "aggregator_lock", "$or": [
                        {"locked": {"$ne": True}},
                        {"locked_at": {"$lt": (_dt.now(_tz.utc) - _tdelta(minutes=15)).isoformat()}},
                    ]},
                    {"$set": {"key": "aggregator_lock", "locked": True,
                              "locked_at": _dt.now(_tz.utc).isoformat()}},
                    upsert=True, return_document=True,
                )
                try:
                    from aggregator import run_aggregator
                    res = await run_aggregator(db, trigger="startup_catchup")
                    logger.info("[startup] aggregator catch-up: %s", res)
                finally:
                    await db.app_meta.update_one({"key": "aggregator_lock"}, {"$set": {"locked": False}})
            except Exception:
                logger.exception("aggregator startup catch-up failed")

        _asyncio.create_task(_aggregator_catchup())
    except Exception:
        logger.exception("failed to schedule aggregator catch-up")
    # Zoho outbox startup catch-up: drain anything queued while the pod was down
    # (no-op when both integrations are inactive). Non-blocking.
    try:
        import asyncio as _aio

        async def _zoho_catchup():
            try:
                from zoho_sync import process_outbox
                res = await process_outbox(db, limit=500)
                logger.info("[startup] zoho outbox catch-up: %s", res)
            except Exception:
                logger.exception("zoho startup catch-up failed")

        _aio.create_task(_zoho_catchup())
    except Exception:
        logger.exception("failed to schedule zoho catch-up")
    try:
        from routers.content_router import seed_faqs
        n = await seed_faqs(db)
        if n:
            logger.info("seeded %s FAQ entries", n)
        await db.testimonials.create_index("status")
    except Exception:
        logger.exception("failed to seed FAQs")
    try:
        from storage import init_storage
        await asyncio.to_thread(init_storage)
        logger.info("object storage initialized")
    except Exception:
        logger.exception("object storage init failed (avatar uploads will retry lazily)")
    try:
        # Idempotent Boat Pro category normalization (legacy → current taxonomy).
        # Runs every boot so re-seeds / leftover docs stay on the new category names.
        legacy_map = {
            "Sails & Canvas": ["Sails", "Canvas"],
            "Cleaning & Detailing": ["Detailing - Exterior"],
            "Exterior boat detailing": ["Detailing - Exterior"],
            "Interior detailing": ["Detailing - Interior"],
            "Engine & Mechanical": ["Diesel Engine Specialist"],
            "Waxing & Polishing": [],
            "Navigation & Instruments Calibration": [],
        }
        normalized = 0
        async for p in db.boat_pros.find({}, {"_id": 0, "id": 1, "user_id": 1, "categories": 1}):
            cats = p.get("categories") or []
            if not any(c in legacy_map for c in cats):
                continue
            new: list = []
            for c in cats:
                for v in (legacy_map[c] if c in legacy_map else [c]):
                    if v not in new:
                        new.append(v)
            key = {"id": p["id"]} if p.get("id") else {"user_id": p.get("user_id")}
            await db.boat_pros.update_one(key, {"$set": {"categories": new}})
            normalized += 1
        if normalized:
            logger.info("normalized boat-pro categories on %s listings", normalized)
    except Exception:
        logger.exception("boat-pro category normalization failed")
    try:
        # Idempotent org-category normalization + migrate single org_category → org_categories list.
        from constants import ORG_CATEGORY_LEGACY_MAP
        fixed = 0
        async for u in db.users.find({"account_type": "partner"},
                                     {"_id": 0, "user_id": 1, "org_category": 1, "org_categories": 1}):
            cur = u.get("org_categories")
            if not cur:
                oc = u.get("org_category")
                cur = [oc] if oc else []
            new_list: list = []
            for c in cur:
                v = ORG_CATEGORY_LEGACY_MAP.get(c, c)
                if v and v not in new_list:
                    new_list.append(v)
            primary = new_list[0] if new_list else None
            if new_list != (u.get("org_categories") or []) or primary != u.get("org_category"):
                await db.users.update_one({"user_id": u["user_id"]},
                                          {"$set": {"org_categories": new_list, "org_category": primary}})
                fixed += 1
        if fixed:
            logger.info("normalized org categories on %s partners", fixed)
    except Exception:
        logger.exception("org category normalization failed")
    try:
        from geocode import backfill
        asyncio.create_task(backfill(db))
    except Exception:
        logger.exception("failed to schedule event geocode backfill")
    # Handle backfill + unique index. Any user missing a handle gets one derived
    # from their name (or 'sailor'). We do this before creating the unique index
    # so index creation can't fail on legacy rows.
    try:
        import re as _re
        taken = set()
        async for u in db.users.find({"handle": {"$exists": True, "$ne": None}}, {"handle": 1}):
            taken.add(u["handle"])
        async for u in db.users.find(
            {"$or": [{"handle": {"$exists": False}}, {"handle": None}, {"handle": ""}]},
            {"user_id": 1, "name": 1},
        ):
            base = _re.sub(r"[^A-Za-z0-9]+", "", (u.get("name") or "")).lower()[:20] or "sailor"
            candidate = base; i = 2
            while candidate in taken:
                candidate = f"{base}{i}"; i += 1
            taken.add(candidate)
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"handle": candidate}})
        await db.users.create_index("handle", unique=True, sparse=True)
    except Exception:
        logger.exception("failed to backfill user handles")
    # Ensure the admin-email-digest claim index exists exactly once at startup.
    # Any pre-existing duplicates (from the earlier broken upsert code) are
    # collapsed first so create_index cannot fail on legacy data.
    try:
        pipeline = [
            {"$group": {"_id": "$key", "ids": {"$push": "$_id"},
                        "keep": {"$max": "$sent_at"}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]
        async for row in db.admin_email_digests.aggregate(pipeline):
            # Keep the doc with the latest sent_at, delete the rest.
            latest = None
            latest_sent = None
            async for d in db.admin_email_digests.find({"key": row["_id"]},
                                                       {"_id": 1, "sent_at": 1}):
                if latest is None or (d.get("sent_at") or "") >= (latest_sent or ""):
                    latest, latest_sent = d["_id"], d.get("sent_at")
            if latest is not None:
                await db.admin_email_digests.delete_many({"key": row["_id"],
                                                         "_id": {"$ne": latest}})
        await db.admin_email_digests.create_index("key", unique=True)
    except Exception:
        logger.exception("failed to ensure admin_email_digests unique index")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
