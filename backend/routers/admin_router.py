"""Digest preview + admin-per-event recipients endpoints.

Kept in a dedicated router so `/api/digest/preview` and the admin recipients
list are easy to find and test independently of the community router.
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Depends
from pydantic import BaseModel
from categorize import apply_category, CATEGORIES
from schemas import EventAdminUpdate

from deps import db, current_user_from_token, is_admin, require_admin, rate_limit, partner_badge, org_status, ORG_STATUSES
from scheduler import compute_digest_payload, compute_user_saved, compute_reviews_digest

router = APIRouter()


@router.post("/admin/users/verify-email")
async def admin_verify_user_email(body: Dict[str, Any], admin=Depends(require_admin)):
    """Mark an account's email verified by admin (e.g. App Store reviewer demo
    logins). Exempts the account from the verification lock. Audit-logged."""
    email = (body.get("email") or "").strip().lower()
    reason = (body.get("reason") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required.")
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required.")
    target = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="No account with that email.")
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {"email_verified": True, "verified_by_admin": True,
                  "verified_by_admin_by": admin.get("email"),
                  "verified_by_admin_at": datetime.now(timezone.utc).isoformat(),
                  "verified_by_admin_reason": reason[:300]}},
    )
    try:
        from audit import log_admin_action
        await log_admin_action(admin, "verify_email_by_admin", "user", target["user_id"],
                               summary=f"Marked {email} verified by admin", meta={"reason": reason[:300]})
    except Exception:
        logging.getLogger("smn.admin").exception("audit failed for verify_email_by_admin")
    return {"ok": True}



@router.get("/admin/revenue")
async def admin_revenue(admin=Depends(require_admin)):
    """Subscriptions + estimated MRR overview for the admin dashboard.
    Counts active paid subscribers by (account_type, tier) and multiplies by the
    monthly price from SUBSCRIPTION_PACKAGES. `active` = tier != free and
    (subscription_expires is null [lifetime/founding] or in the future)."""
    from constants import SUBSCRIPTION_PACKAGES
    price = {}
    for pkg in SUBSCRIPTION_PACKAGES.values():
        price[(pkg["audience"], pkg["tier"])] = float(pkg.get("monthly") or 0)
    now_iso = datetime.now(timezone.utc).isoformat()
    active_q = {
        "subscription_tier": {"$nin": [None, "free"]},
        "$or": [{"subscription_expires": None}, {"subscription_expires": {"$gt": now_iso}}],
    }
    rows: Dict[tuple, int] = {}
    async for u in db.users.find(active_q, {"_id": 0, "account_type": 1, "subscription_tier": 1}):
        key = (u.get("account_type") or "unknown", u.get("subscription_tier") or "unknown")
        rows[key] = rows.get(key, 0) + 1
    by_tier = []
    mrr_total = 0.0
    active_paid = 0
    for (acct, tier), count in sorted(rows.items()):
        monthly = price.get((acct, tier), 0.0)
        mrr = round(monthly * count, 2)
        mrr_total += mrr
        active_paid += count
        by_tier.append({"account_type": acct, "tier": tier, "count": count,
                        "monthly_price": monthly, "mrr": mrr})
    total_users = await db.users.count_documents({})

    # Month-over-month collected revenue (last 6 months) from paid transactions.
    from calendar import monthrange
    now = datetime.now(timezone.utc)
    months = []
    for i in range(5, -1, -1):
        y = now.year + (now.month - 1 - i) // 12
        m = (now.month - 1 - i) % 12 + 1
        months.append((y, m))
    trend = []
    for (y, m) in months:
        start = datetime(y, m, 1, tzinfo=timezone.utc)
        end = datetime(y, m, monthrange(y, m)[1], 23, 59, 59, tzinfo=timezone.utc)
        total = 0.0
        async for tx in db.payment_transactions.find(
            {"created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()},
             "$or": [{"subscription_applied": True}, {"payment_status": "paid"}]},
            {"_id": 0, "amount": 1},
        ):
            total += float(tx.get("amount") or 0)
        trend.append({"month": f"{y}-{m:02d}", "label": start.strftime("%b"), "amount": round(total, 2)})

    return {
        "currency": "USD",
        "total_users": total_users,
        "active_paid": active_paid,
        "mrr_total": round(mrr_total, 2),
        "arr_total": round(mrr_total * 12, 2),
        "by_tier": by_tier,
        "trend": trend,
    }


@router.get("/admin/payments/review-queue")
async def admin_payment_review_queue(admin=Depends(require_admin)):
    """PLAN-QUEUE-1: completed payments that could not be applied or queued
    (e.g. two paid sessions raced past the 1-plan queue limit). Surfaced here so
    money is never silently dropped. Admin handles each case by hand."""
    rows = await db.payment_transactions.find(
        {"needs_admin_review": True},
        {"_id": 0, "session_id": 1, "user_id": 1, "email": 1, "package_id": 1,
         "amount": 1, "review_reason": 1, "created_at": 1, "applied_at": 1},
    ).sort("applied_at", -1).to_list(500)
    return {"count": len(rows), "transactions": rows}
logger = logging.getLogger("smn.digest")


@router.get("/digest/preview")
async def digest_preview(market: Optional[str] = None,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Return what the caller's next Sunday digest would contain right now.

    - `?market=<name>` — single-market preview.
    - `?market=all` — multi-market preview covering every market the user
      follows (`user.markets` plus `primary_market`).
    - default — single-market preview scoped to `primary_market`.
    """
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    now = datetime.now(timezone.utc)
    followed = list({m for m in ([u.get("primary_market")] + list(u.get("markets") or [])) if m})
    saved = await compute_user_saved(db, u["user_id"])
    reviews = await compute_reviews_digest(db, u["user_id"], now)

    if market == "all":
        if not followed:
            raise HTTPException(status_code=400,
                                detail="Set at least one market on your profile to preview the digest.")
        market_payloads: List[Dict[str, Any]] = []
        for m in followed:
            payload = await compute_digest_payload(db, m, now)
            market_payloads.append({"market": m, **payload})
        all_empty = all(
            (not p["new_crew"] and not p["new_events"] and p["new_comments"] == 0)
            for p in market_payloads
        )
        return {
            "markets": market_payloads,
            "followed_markets": followed,
            "newsletter_opt_in": bool(u.get("newsletter_opt_in", True)),
            "last_sent_at": u.get("digest_sent_at"),
            "send_history": (u.get("digest_send_history") or [])[-12:],
            "engagement": u.get("digest_engagement") or {},
            "empty": all_empty,
            "saved": saved,
            "reviews": reviews,
        }

    m = market or u.get("primary_market")
    if not m:
        raise HTTPException(status_code=400,
                            detail="Set a primary market on your profile to preview the digest.")
    payload = await compute_digest_payload(db, m, now)
    empty = (not payload["new_crew"]
             and not payload["new_events"]
             and payload["new_comments"] == 0)
    return {
        "market": m,
        "followed_markets": followed,
        "newsletter_opt_in": bool(u.get("newsletter_opt_in", True)),
        "last_sent_at": u.get("digest_sent_at"),
        "send_history": (u.get("digest_send_history") or [])[-12:],
        "engagement": u.get("digest_engagement") or {},
        "empty": empty,
        "saved": saved,
        "reviews": reviews,
        **payload,
    }


@router.post("/analytics/hero")
async def analytics_hero(payload: Dict[str, Any], request: Request):
    """Lightweight event sink for landing-hero A/B analytics. Accepts
    `{event: 'shown'|'signup_click', clip: <slug>, session_id: <uuid>}`
    and appends to `db.hero_events`. Public + unauthenticated on purpose —
    landing traffic is anonymous. Bad payloads are dropped silently so a
    hostile client can't crash the endpoint."""
    rate_limit("hero_analytics", request, limit=60, window=60)
    try:
        evt = str(payload.get("event") or "")[:32]
        clip = str(payload.get("clip") or "")[:64]
        session_id = str(payload.get("session_id") or "")[:64]
        if evt not in ("shown", "signup_click") or not clip or not session_id:
            return {"ok": False}
        ip = request.client.host if request.client else None
        await db.hero_events.insert_one({
            "id": str(uuid.uuid4()),
            "event": evt,
            "clip": clip,
            "session_id": session_id,
            "ip": ip,
            "ua": (request.headers.get("user-agent") or "")[:200],
            "at": datetime.now(timezone.utc).isoformat(),
        })
        return {"ok": True}
    except Exception:
        logger.exception("analytics_hero failed")
        return {"ok": False}


PAID_TIERS = ["basic", "featured", "premium", "community_partner", "founding_partner"]


@router.get("/admin/referrals")
async def admin_referrals(period: str = "all",
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Referral leaderboard. `top` is ranked by how many referred members
    actually UPGRADED TO PAID (basic/featured/premium), then by total signups.
    `reward_eligible` flags advocates with >=1 paid conversion so the UI can
    highlight who's earned a reward. `recent` shows each new signup with its
    current tier + `upgraded` flag. `period` = all | month (current calendar month)."""
    await require_admin(session_token, authorization)
    match: Dict[str, Any] = {}
    if period == "month":
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        match = {"created_at": {"$gte": start.isoformat()}}
    top = []
    async for row in db.referrals.aggregate(([{"$match": match}] if match else []) + [
        {"$group": {"_id": {"ref": "$ref", "name": "$referrer_name", "rid": "$referrer_user_id"},
                    "count": {"$sum": 1},
                    "referred_ids": {"$addToSet": "$referred_user_id"}}},
        {"$lookup": {"from": "users", "localField": "referred_ids",
                     "foreignField": "user_id", "as": "ru"}},
        {"$addFields": {"paid": {"$size": {"$filter": {
            "input": "$ru", "as": "u",
            "cond": {"$in": ["$$u.subscription_tier", PAID_TIERS]}}}}}},
        {"$lookup": {"from": "users", "localField": "_id.rid",
                     "foreignField": "user_id", "as": "adv"}},
        {"$addFields": {"advocate_email": {"$arrayElemAt": ["$adv.email", 0]}}},
        {"$sort": {"paid": -1, "count": -1}},
        {"$limit": 50},
    ]):
        top.append({"ref": row["_id"].get("ref"),
                    "referrer_name": row["_id"].get("name"),
                    "referrer_user_id": row["_id"].get("rid"),
                    "referrer_email": row.get("advocate_email"),
                    "count": row["count"],
                    "paid": row.get("paid", 0),
                    "reward_eligible": row.get("paid", 0) > 0})
    recent = await db.referrals.find(
        match, {"_id": 0, "referred_name": 1, "referred_email": 1, "ref": 1,
             "referrer_name": 1, "referred_user_id": 1, "created_at": 1},
    ).sort("created_at", -1).limit(50).to_list(50)
    rec_ids = [r.get("referred_user_id") for r in recent if r.get("referred_user_id")]
    tier_by_id: Dict[str, str] = {}
    if rec_ids:
        async for u in db.users.find({"user_id": {"$in": rec_ids}},
                                     {"_id": 0, "user_id": 1, "subscription_tier": 1}):
            tier_by_id[u["user_id"]] = u.get("subscription_tier") or "free"
    for r in recent:
        tier = tier_by_id.get(r.get("referred_user_id"), "free")
        r["referred_tier"] = tier
        r["upgraded"] = tier in PAID_TIERS
    total = await db.referrals.count_documents(match)
    all_ids = await db.referrals.distinct("referred_user_id", match)
    paid_conversions = 0
    if all_ids:
        paid_conversions = await db.users.count_documents(
            {"user_id": {"$in": all_ids}, "subscription_tier": {"$in": PAID_TIERS}})
    return {"total": total, "paid_conversions": paid_conversions,
            "period": period, "top": top, "recent": recent}



@router.get("/admin/referrals/detail")
async def admin_referral_detail(ref: str, period: str = "all",
                                session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    """Drilldown for one advocate (`ref` tag): the members they referred with each
    member's current tier + `upgraded` flag. Honours the same `period` window."""
    await require_admin(session_token, authorization)
    match: Dict[str, Any] = {"ref": ref}
    if period == "month":
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        match["created_at"] = {"$gte": start.isoformat()}
    rows = await db.referrals.find(
        match, {"_id": 0, "referred_name": 1, "referred_email": 1,
                "referred_user_id": 1, "created_at": 1},
    ).sort("created_at", -1).limit(200).to_list(200)
    ids = [r.get("referred_user_id") for r in rows if r.get("referred_user_id")]
    tier_by_id: Dict[str, str] = {}
    if ids:
        async for u in db.users.find({"user_id": {"$in": ids}},
                                     {"_id": 0, "user_id": 1, "subscription_tier": 1}):
            tier_by_id[u["user_id"]] = u.get("subscription_tier") or "free"
    for r in rows:
        t = tier_by_id.get(r.get("referred_user_id"), "free")
        r["referred_tier"] = t
        r["upgraded"] = t in PAID_TIERS
    return {"ref": ref, "members": rows}


@router.get("/admin/analytics/hero")
async def admin_analytics_hero(session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    """Admin summary: per-clip shown vs signup_click counts + conversion
    rate. Small enough to compute in-process; no aggregation pipeline needed."""
    await require_admin(session_token, authorization)
    pipeline = [
        {"$group": {"_id": {"clip": "$clip", "event": "$event"}, "n": {"$sum": 1}}},
    ]
    rows = await db.hero_events.aggregate(pipeline).to_list(200)
    out: Dict[str, Dict[str, int]] = {}
    for r in rows:
        clip = r["_id"]["clip"]; evt = r["_id"]["event"]
        out.setdefault(clip, {"shown": 0, "signup_click": 0})[evt] = r["n"]
    for clip, v in out.items():
        v["conversion"] = round((v["signup_click"] / v["shown"]) * 100, 2) if v["shown"] else 0.0
    return {"clips": out}


@router.post("/admin/digest/send-now")
async def admin_digest_send_now(dry_run: bool = True,
                                session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    """Run the Sunday digest job on demand.

    - `?dry_run=true` (default) returns the number of users that WOULD receive
      a digest right now, still honouring the same 6-day dedupe window as the
      cron so admins see the real count.
    - `?dry_run=false` actually sends and returns how many users have received
      a digest in the last 6 days (post-send total)."""
    from datetime import timedelta as _td
    from scheduler import _sunday_digest_job
    await require_admin(session_token=session_token, authorization=authorization)
    now = datetime.now(timezone.utc)
    since_cutoff = (now - _td(days=6)).isoformat()
    if dry_run:
        candidates_cursor = db.users.find({
            "newsletter_opt_in": True,
            "email": {"$ne": None},
        }, {"_id": 0, "user_id": 1, "primary_market": 1, "markets": 1, "digest_sent_at": 1})
        would_send = 0
        market_cache: Dict[str, Dict[str, Any]] = {}
        async for user in candidates_cursor:
            if user.get("digest_sent_at") and user["digest_sent_at"] >= since_cutoff:
                continue
            followed = list({m for m in ([user.get("primary_market")] + list(user.get("markets") or [])) if m})
            if not followed:
                continue
            has_content = False
            for m in followed:
                if m not in market_cache:
                    market_cache[m] = await compute_digest_payload(db, m, now)
                p = market_cache[m]
                if p["new_crew"] or p["new_events"] or p["new_comments"]:
                    has_content = True
                    break
            if has_content:
                would_send += 1
        return {"dry_run": True, "would_send": would_send,
                "markets_considered": len(market_cache), "as_of": now.isoformat()}
    # Real send — reuse the scheduler entry point
    await _sunday_digest_job(db)
    total = await db.users.count_documents({"digest_sent_at": {"$gte": since_cutoff}})
    return {"dry_run": False, "sent_in_last_6d": total, "as_of": now.isoformat()}


@router.get("/search")
async def content_search(q: str = "",
                         session_token: Optional[str] = Cookie(default=None),  # noqa: ARG001
                         authorization: Optional[str] = Header(default=None)):  # noqa: ARG001
    """Global search across posts, discussions, events (title/body regex). No
    auth required — everything returned is already public. Limit 5 per bucket."""
    query = (q or "").strip()
    if len(query) < 2:
        return {"q": query, "posts": [], "discussions": [], "events": []}
    import re as _re
    rx = {"$regex": _re.escape(query), "$options": "i"}
    posts = await db.posts.find({"$or": [{"title": rx}, {"body": rx}]},
                                {"_id": 0, "id": 1, "title": 1, "body": 1, "market": 1, "created_at": 1}
                                ).sort("created_at", -1).limit(5).to_list(5)
    discussions = await db.discussions.find({"$or": [{"title": rx}, {"body": rx}]},
                                            {"_id": 0, "id": 1, "title": 1, "body": 1, "kind": 1, "created_at": 1}
                                            ).sort("created_at", -1).limit(5).to_list(5)
    events = await db.events.find({"$or": [{"title": rx}, {"description": rx}, {"location": rx}]},
                                  {"_id": 0, "id": 1, "title": 1, "starts_at": 1, "market": 1, "location": 1}
                                  ).sort("starts_at", 1).limit(5).to_list(5)
    orgs = await db.users.find(
        {"account_type": "partner", "$or": [
            {"name": rx}, {"org_name": rx}, {"bio": rx},
            {"org_categories": rx}, {"org_category": rx}]},
        {"_id": 0, "user_id": 1, "handle": 1, "name": 1, "org_name": 1, "avatar": 1,
         "picture": 1, "logo_url": 1, "bio": 1, "org_category": 1, "org_categories": 1, "primary_market": 1}
    ).limit(5).to_list(5)
    for o in orgs:
        o["logo"] = o.get("logo_url") or o.get("picture") or o.get("avatar")
    return {"q": query, "posts": posts, "discussions": discussions, "events": events, "orgs": orgs}


@router.get("/users/search")
async def users_search(q: str = "", limit: int = 6,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """Prefix-search users by handle or name for @mention autocomplete. Members only
    (prevents anonymous member enumeration): returns user_id, name, handle and avatar. Limit 6."""
    if not await current_user_from_token(session_token, authorization):
        raise HTTPException(status_code=401, detail="Not authenticated")
    query = (q or "").strip().lstrip("@")
    if len(query) < 1:
        return {"users": []}
    import re as _re
    esc = _re.escape(query)
    docs = await db.users.find(
        {"$or": [
            {"handle": {"$regex": f"^{esc}", "$options": "i"}},
            {"name": {"$regex": f"(^|\\s){esc}", "$options": "i"}},
        ]},
        {"_id": 0, "user_id": 1, "name": 1, "handle": 1, "picture": 1, "avatar": 1},
    ).limit(max(1, min(limit, 20))).to_list(20)
    for d in docs:
        d["avatar"] = d.pop("picture", None) or d.get("avatar")
    return {"users": docs}


@router.get("/searches")
async def list_saved_searches(session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    doc = await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0, "saved_searches": 1})
    return {"searches": (doc or {}).get("saved_searches") or []}


@router.post("/searches")
async def save_search(body: Dict[str, Any],
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    import re as _re
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    q = (body.get("q") or "").strip()
    if len(q) < 2 or len(q) > 60:
        raise HTTPException(status_code=400, detail="Query must be 2-60 characters")
    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {"id": str(uuid.uuid4()), "q": q, "created_at": now_iso}
    # Push if not already saved (case-insensitive), cap at 10.
    existing = await db.users.find_one(
        {"user_id": u["user_id"],
         "saved_searches.q": {"$regex": f"^{_re.escape(q)}$", "$options": "i"}},
        {"_id": 1},
    )
    if existing:
        return {"ok": True, "duplicate": True}
    await db.users.update_one(
        {"user_id": u["user_id"]},
        {"$push": {"saved_searches": {"$each": [entry], "$slice": -10}}},
    )
    return {"ok": True, "search": entry}


@router.delete("/searches/{search_id}")
async def delete_saved_search(search_id: str,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    r = await db.users.update_one(
        {"user_id": u["user_id"]},
        {"$pull": {"saved_searches": {"id": search_id}}},
    )
    if r.modified_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


_HANDLE_AVAIL_RATE = {}  # ip -> [ts]


@router.get("/handle/available")
async def handle_available(q: str = "", request: Request = None):  # noqa: RUF013
    """Live availability check for the onboarding handle field. Public but
    lightly rate-limited (30 checks / 60s per IP) so it can't be used to
    enumerate members."""
    import re as _re
    from fastapi import Request as _R  # noqa: F401
    ip = "unknown"
    if request is not None:
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown") or "unknown").split(",")[0].strip()
    now_ts = datetime.now(timezone.utc).timestamp()
    window = 60; limit = 30
    for _ip in list(_HANDLE_AVAIL_RATE.keys()):
        fresh = [t for t in _HANDLE_AVAIL_RATE[_ip] if now_ts - t < window]
        if fresh:
            _HANDLE_AVAIL_RATE[_ip] = fresh
        else:
            _HANDLE_AVAIL_RATE.pop(_ip, None)
    hits = _HANDLE_AVAIL_RATE.get(ip, [])
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="Too many availability checks. Try again in a minute.")
    hits.append(now_ts)
    _HANDLE_AVAIL_RATE[ip] = hits
    raw = (q or "").strip().lstrip("@")
    if not _re.fullmatch(r"[A-Za-z0-9_]{3,20}", raw):
        return {"ok": False, "reason": "invalid", "handle": raw, "suggestions": []}
    exists = await db.users.find_one({"handle": raw.lower()}, {"_id": 1})
    if not exists:
        return {"ok": True, "reason": None, "handle": raw.lower(), "suggestions": []}
    # Log the taken hit for scraping detection (bounded per-IP by throttle).
    try:
        await db.handle_enum_log.insert_one({
            "id": str(uuid.uuid4()), "handle": raw.lower(), "ip": ip,
            "at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    # Suggest 3 variations that aren't yet taken.
    base = raw.lower()
    candidates = [f"{base}{i}" for i in range(2, 20)] + [f"{base}_pnw", f"the{base}", f"{base}sails"]
    suggestions: List[str] = []
    for cand in candidates:
        if len(suggestions) >= 3:
            break
        if not await db.users.find_one({"handle": cand}, {"_id": 1}):
            suggestions.append(cand)
    return {"ok": False, "reason": "taken", "handle": base, "suggestions": suggestions}


@router.post("/admin/contact/{msg_id}/reply")
async def admin_contact_reply(msg_id: str, body: Dict[str, Any],
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Send an email reply to a /contact submission and log the reply back
    onto the contact_messages doc so the queue keeps a full paper trail."""
    from mailer import send_email
    admin_user = await require_admin(session_token=session_token, authorization=authorization)
    msg = await db.contact_messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Contact message not found")
    text = (body.get("body") or "").strip()
    if len(text) < 5:
        raise HTTPException(status_code=400, detail="Reply body must be at least 5 characters")
    if len(text) > 6000:
        raise HTTPException(status_code=400, detail="Reply body too long (max 6000 chars)")
    html = (
        f"<div style='font-family:system-ui,sans-serif; color:#0f172a;'>"
        f"<p>Hi {msg.get('name') or 'there'},</p>"
        f"<div style='white-space:pre-wrap;'>{text.replace('<', '&lt;')}</div>"
        f"<p style='margin-top:20px; color:#64748b; font-size:12px;'>- The Sail More Now team &middot; info@sailmorenow.com</p>"
        f"</div>"
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    ok = False
    try:
        res = await send_email(
            recipient_email=msg["email"],
            subject=f"Re: your note to Sail More Now",
            html_content=html,
            reply_to="info@sailmorenow.com",
        )
        # send_email never raises — it returns {status: ok|error|skipped}.
        # Only 'ok' counts as delivered; 'skipped' (missing key) and 'error'
        # (Resend rejected) both fall through to persisted-but-undelivered.
        ok = isinstance(res, dict) and res.get("status") == "ok"
        if not ok:
            logger.warning("contact reply delivery not ok: %r", res)
    except Exception:
        logger.exception("contact reply send failed")
        ok = False
    entry = {"id": str(uuid.uuid4()), "body": text, "at": now_iso,
             "by": admin_user["user_id"], "by_name": admin_user.get("name"),
             "delivered": ok}
    await db.contact_messages.update_one(
        {"id": msg_id},
        {"$push": {"replies": entry},
         "$set": {"status": "replied", "last_reply_at": now_iso}},
    )
    # Persistence and delivery are independent — the reply is always saved
    # onto the contact_messages doc even if Resend rejects the send, so the
    # UI can show a "saved but delivery failed" state and retry later.
    return {"ok": ok, "persisted": True, "delivered": ok, "reply": entry}


@router.get("/admin/contact")
async def admin_list_contact(limit: int = 100,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    """Admin queue of recent /contact submissions. Deleted (redacted) messages
    are excluded; every message carries a queue_status (new/handled/archived)."""
    await require_admin(session_token=session_token, authorization=authorization)
    docs = await db.contact_messages.find(
        {"deleted": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).limit(max(1, min(limit, 500))).to_list(500)
    total = await db.contact_messages.count_documents({"deleted": {"$ne": True}})
    for d in docs:
        d.setdefault("queue_status", "new")
    # Annotate each message with whether an account exists for that email and
    # its current tier, so the inbox can offer one-tap Community Partner setup.
    emails = list({(d.get("email") or "").lower() for d in docs if d.get("email")})
    umap: Dict[str, Dict[str, Any]] = {}
    if emails:
        async for usr in db.users.find({"email": {"$in": emails}},
                                       {"_id": 0, "user_id": 1, "email": 1, "name": 1,
                                        "account_type": 1, "subscription_tier": 1}):
            umap[(usr.get("email") or "").lower()] = usr
    for d in docs:
        acct = umap.get((d.get("email") or "").lower())
        d["account"] = acct or None
    return {"count": len(docs), "total": total, "messages": docs}


class CommunityPartnerActivate(BaseModel):
    email: str
    months: int = 12
    activate: bool = True


# The two markets that have Founding Partner slots (cap 5 each); every other
# market (or none) is bucketed as "other". Counts are by users.primary_market —
# the exact field the org editor saves.
FOUNDING_MARKETS = ["Portland/Vancouver", "Greater Seattle"]


async def _founding_counts() -> Dict[str, int]:
    """Current Founding Partner count per market (by primary_market)."""
    counts = {m: 0 for m in FOUNDING_MARKETS}
    counts["other"] = 0
    async for u in db.users.find(
        {"account_type": "partner", "subscription_tier": "founding_partner"},
        {"_id": 0, "primary_market": 1}):
        m = u.get("primary_market")
        counts[m if m in FOUNDING_MARKETS else "other"] += 1
    return counts


async def _set_org_status(usr: Dict[str, Any], status: str) -> None:
    """Write the single org status to subscription_tier. Orgs pay off-app, so
    the status is lifetime (subscription_expires = None) and immune to the
    nightly expiry sweep. Does not touch the legacy founding_partner /
    founding_cohort fields."""
    await db.users.update_one(
        {"user_id": usr["user_id"]},
        {"$set": {"subscription_tier": status, "subscription_expires": None}})
    try:
        from zoho_sync import record_sub_event, enqueue as _zq
        label = {"community_partner": "Community Partner", "founding_partner": "Founding Partner", "free": "Free"}.get(status, status)
        today = datetime.now(timezone.utc).date().isoformat()
        await record_sub_event(db, usr["user_id"], f"{today} | Organization {label} | lifetime | Org Status | ends n/a")
        await _zq(db, "org_status", usr["user_id"])
    except Exception:
        logger.exception("zoho crm org-status enqueue failed for %s", usr.get("user_id"))


@router.post("/admin/community-partner/activate")
async def admin_activate_community_partner(body: CommunityPartnerActivate,
                                           session_token: Optional[str] = Cookie(default=None),
                                           authorization: Optional[str] = Header(default=None)):
    """Legacy one-tap from the admin contact inbox: set an org to Community
    Partner (activate) or back to Free. NEVER assigns Founding Partner — that is
    chosen by hand via POST /admin/org-status. Automatic founding assignment and
    the global/seattle cohort logic have been removed."""
    await require_admin(session_token=session_token, authorization=authorization)
    email = (body.email or "").strip().lower()
    usr = await db.users.find_one({"email": email},
                                  {"_id": 0, "user_id": 1, "account_type": 1, "name": 1})
    if not usr:
        raise HTTPException(status_code=404,
                            detail="No account found for that email. Ask them to sign up first.")
    if usr.get("account_type") != "partner":
        raise HTTPException(status_code=400,
                            detail="Only Club/Org accounts can be a Community Partner.")
    if body.activate:
        await _set_org_status(usr, "community_partner")
        try:
            from mailer import send_email, community_partner_welcome_email_html
            html = community_partner_welcome_email_html(
                org_name=usr.get("name") or "", founding=False,
                app_url="https://app.sailmorenow.com")
            await send_email(recipient_email=email,
                             subject="Welcome aboard: you're a Sail More Now Community Partner",
                             html_content=html)
        except Exception:
            logger.exception("community partner welcome email failed")
        return {"ok": True, "tier": "community_partner"}
    await _set_org_status(usr, "free")
    return {"ok": True, "tier": "free"}


class OrgStatusBody(BaseModel):
    email: Optional[str] = None
    user_id: Optional[str] = None
    status: str


@router.post("/admin/org-status")
async def admin_set_org_status(body: OrgStatusBody,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    """Admin-only three-way status setter for a Club/Org account. `status` is
    exactly one of free | community_partner | founding_partner. This is the one
    path that changes an org's standing; it sets exactly the chosen status and
    nothing more (no automatic founding, no cohorts). Boat Pro / owner / sailor
    accounts are rejected — they can never be made a Community or Founding
    Partner. The Founding Partner cap (5 per market) is a client-side WARNING,
    not a server block, so this always saves the chosen status."""
    await require_admin(session_token=session_token, authorization=authorization)
    status = (body.status or "").strip().lower()
    if status not in ORG_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    q: Dict[str, Any] = {"user_id": body.user_id} if body.user_id else {"email": (body.email or "").strip().lower()}
    usr = await db.users.find_one(q, {"_id": 0, "user_id": 1, "account_type": 1,
                                      "name": 1, "email": 1, "primary_market": 1})
    if not usr:
        raise HTTPException(status_code=404, detail="No account found.")
    if usr.get("account_type") != "partner":
        raise HTTPException(status_code=400,
                            detail="Only Club/Org accounts can be a Community or Founding Partner.")
    await _set_org_status(usr, status)
    return {"ok": True, "status": status, "name": usr.get("name") or "",
            "founding_counts": await _founding_counts()}


@router.get("/admin/partners/search")
async def admin_partners_search(q: str = "", limit: int = 20,
                                session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    """Search Club/Org (partner) accounts by name/handle/email so an admin can
    set each org's single status. Returns the current status per org plus the
    per-market Founding Partner counts for the cap warning."""
    await require_admin(session_token=session_token, authorization=authorization)
    import re as _re
    query = (q or "").strip().lstrip("@")
    match = {"account_type": "partner"}
    if query:
        esc = _re.escape(query)
        match["$or"] = [
            {"name": {"$regex": esc, "$options": "i"}},
            {"handle": {"$regex": esc, "$options": "i"}},
            {"email": {"$regex": esc, "$options": "i"}},
        ]
    docs = await db.users.find(match, {
        "_id": 0, "user_id": 1, "name": 1, "handle": 1, "email": 1,
        "logo_url": 1, "picture": 1, "avatar": 1, "primary_market": 1,
        "subscription_tier": 1,
    }).sort("name", 1).limit(max(1, min(limit, 50))).to_list(50)
    for d in docs:
        d["logo"] = d.get("logo_url") or d.get("picture") or d.get("avatar")
        d["status"] = org_status(d)
        d["partner_badge"] = partner_badge(d)
        d["is_community_partner"] = d["status"] in ("community_partner", "founding_partner")
    return {"q": query, "orgs": docs, "founding_counts": await _founding_counts(),
            "founding_markets": FOUNDING_MARKETS, "founding_cap": 5}


@router.get("/searches/suggestions")
async def search_suggestions():
    """Top 5 most-saved (globally) search queries. Public — no auth needed.
    Each entry also carries an 8-week weekly bucket trend so the UI can render
    a sparkline showing whether the topic is climbing or fading."""
    from datetime import timedelta as _td
    pipeline = [
        {"$unwind": "$saved_searches"},
        {"$group": {"_id": {"$toLower": "$saved_searches.q"},
                    "n": {"$sum": 1},
                    "sample": {"$first": "$saved_searches.q"},
                    "created_at": {"$push": "$saved_searches.created_at"}}},
        {"$sort": {"n": -1}},
        {"$limit": 5},
    ]
    now = datetime.now(timezone.utc)
    top: List[Dict[str, Any]] = []
    async for row in db.users.aggregate(pipeline):
        # Bucket the created_at timestamps into 8 weekly slots ascending.
        weekly: List[Dict[str, Any]] = []
        boundaries = []
        for i in range(7, -1, -1):
            wk_start = now - _td(days=(i + 1) * 7 - 1)
            wk_end = now - _td(days=i * 7 - 1) if i > 0 else now
            boundaries.append((wk_start, wk_end))
            weekly.append({"week_start": wk_start.date().isoformat(), "count": 0})
        for ts in row.get("created_at") or []:
            if not ts:
                continue
            for idx, (ws, we) in enumerate(boundaries):
                if ws.isoformat() <= ts < we.isoformat():
                    weekly[idx]["count"] += 1
                    break
        top.append({"q": row["sample"], "count": row["n"], "trend": weekly})
    return {"suggestions": top}


@router.get("/admin/digest/render")
async def admin_render_digest(market: Optional[str] = None,
                              user_id: Optional[str] = None,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Render the exact Sunday-digest HTML a member would receive. Admins can
    preview by explicit market OR by another user's profile. Returns raw HTML."""
    from fastapi.responses import HTMLResponse
    from mailer import community_digest_email_html
    await require_admin(session_token=session_token, authorization=authorization)
    now = datetime.now(timezone.utc)
    target_user = None
    if user_id:
        target_user = await db.users.find_one(
            {"user_id": user_id},
            {"_id": 0, "name": 1, "email": 1, "primary_market": 1, "markets": 1},
        )
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
    markets_to_render: List[str] = []
    if market and market != "all":
        markets_to_render = [market]
    elif target_user:
        seen = set()
        for m in ([target_user.get("primary_market")] + list(target_user.get("markets") or [])):
            if m and m not in seen:
                seen.add(m); markets_to_render.append(m)
    else:
        raise HTTPException(status_code=400, detail="Provide ?market=<name> or ?user_id=<id>")
    if not markets_to_render:
        raise HTTPException(status_code=400,
                            detail="Target user has no primary market or markets set")
    populated: List[Dict[str, Any]] = []
    for m in markets_to_render:
        p = await compute_digest_payload(db, m, now)
        populated.append({"market": m, **p})
    reviews = (await compute_reviews_digest(db, user_id, now)) if user_id else None
    html = community_digest_email_html(
        recipient_name=(target_user or {}).get("name") or "Preview",
        markets=populated,
        reviews=reviews,
        app_url="https://app.sailmorenow.com",
    )
    return HTMLResponse(content=html)


@router.get("/admin/analytics")
async def admin_analytics(session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Admin-only live pulse of members, posts, events, comments, discussions,
    reports, digests. Everything is a lightweight aggregation on demand."""
    from datetime import timedelta as _td
    await require_admin(session_token=session_token, authorization=authorization)
    now = datetime.now(timezone.utc)
    week_ago_iso = (now - _td(days=7)).isoformat()
    month_ago_iso = (now - _td(days=30)).isoformat()

    async def _by(coll, field):
        cur = db[coll].aggregate([{"$group": {"_id": f"${field}", "n": {"$sum": 1}}}])
        return {row["_id"] or "unknown": row["n"] async for row in cur}

    users_total = await db.users.count_documents({})
    users_by_type = await _by("users", "account_type")
    users_by_tier = await _by("users", "subscription_tier")
    users_verified = await db.users.count_documents({"identity_verified": True})
    users_active_7d = await db.users.count_documents({"last_active_at": {"$gte": week_ago_iso}})

    posts_total = await db.posts.count_documents({})
    posts_last_7d = await db.posts.count_documents({"created_at": {"$gte": week_ago_iso}})
    events_total = await db.events.count_documents({})
    events_upcoming = await db.events.count_documents({"starts_at": {"$gte": now.isoformat()}})
    events_by_source = await _by("events", "source")
    events_by_market = await _by("events", "market")

    comments_total = await db.comments.count_documents({})
    comments_last_7d = await db.comments.count_documents({"created_at": {"$gte": week_ago_iso}})

    discussions_total = await db.discussions.count_documents({})
    discussions_pending = await db.discussions.count_documents({"status": "pending"})
    discussions_by_kind = await _by("discussions", "kind")

    reports_open = await db.reports.count_documents({"status": "open"})
    reports_total = await db.reports.count_documents({})

    digest_sent_last_30d = await db.users.count_documents(
        {"digest_sent_at": {"$gte": month_ago_iso}}
    )
    push_subscribers = await db.users.count_documents(
        {"push_subscriptions": {"$exists": True, "$not": {"$size": 0}}}
    )

    # Weekly buckets (last 8 weeks, ascending) for the shared <WeeklyChart/>.
    async def _weekly(coll, field):
        buckets: List[Dict[str, Any]] = []
        for i in range(7, -1, -1):
            wk_start = now - _td(days=(i + 1) * 7 - 1)
            wk_end = now - _td(days=i * 7 - 1) if i > 0 else now
            n = await db[coll].count_documents({
                field: {"$gte": wk_start.isoformat(), "$lt": wk_end.isoformat()},
            })
            buckets.append({"week_start": wk_start.date().isoformat(), "count": n})
        return buckets

    weekly = {
        "posts": await _weekly("posts", "created_at"),
        "events": await _weekly("events", "created_at"),
        "comments": await _weekly("comments", "created_at"),
        "discussions": await _weekly("discussions", "created_at"),
        "users": await _weekly("users", "created_at"),
        "digest": await _weekly("users", "digest_sent_at"),
    }

    return {
        "as_of": now.isoformat(),
        "users": {
            "total": users_total,
            "by_account_type": users_by_type,
            "by_subscription_tier": users_by_tier,
            "verified": users_verified,
            "active_last_7d": users_active_7d,
        },
        "posts": {"total": posts_total, "last_7d": posts_last_7d},
        "events": {
            "total": events_total, "upcoming": events_upcoming,
            "by_source": events_by_source, "by_market": events_by_market,
        },
        "comments": {"total": comments_total, "last_7d": comments_last_7d},
        "discussions": {
            "total": discussions_total, "pending": discussions_pending,
            "by_kind": discussions_by_kind,
        },
        "reports": {"open": reports_open, "total": reports_total},
        "digest": {"sent_last_30d": digest_sent_last_30d},
        "push": {"subscribers": push_subscribers},
        "weekly": weekly,
    }


@router.get("/admin/abuse")
async def admin_abuse(days: int = 7, admin=Depends(require_admin)):
    """Rate-limit blocks grouped by IP (last N days) + the live in-memory bucket pressure."""
    from deps import _RATE_BUCKETS
    from datetime import timedelta as _td
    since = (datetime.now(timezone.utc) - _td(days=max(1, min(days, 90)))).isoformat()
    rows = await db.rate_limit_events.aggregate([
        {"$match": {"at": {"$gte": since}}},
        {"$group": {"_id": "$ip", "blocks": {"$sum": 1}, "last_at": {"$max": "$at"}, "first_at": {"$min": "$at"},
                    "buckets": {"$addToSet": "$bucket"}, "ua": {"$last": "$ua"}}},
        {"$sort": {"blocks": -1}}, {"$limit": 50},
    ]).to_list(50)
    by_ip = [{"ip": r["_id"], "blocks": r["blocks"], "last_at": r["last_at"], "first_at": r["first_at"],
              "buckets": sorted(r["buckets"]), "ua": r.get("ua") or ""} for r in rows]
    by_bucket_rows = await db.rate_limit_events.aggregate([
        {"$match": {"at": {"$gte": since}}},
        {"$group": {"_id": "$bucket", "blocks": {"$sum": 1}, "ips": {"$addToSet": "$ip"}}},
        {"$sort": {"blocks": -1}},
    ]).to_list(20)
    by_bucket = [{"bucket": r["_id"], "blocks": r["blocks"], "unique_ips": len(r["ips"])} for r in by_bucket_rows]
    recent = await db.rate_limit_events.find({}, {"_id": 0}).sort("at", -1).limit(30).to_list(30)
    live = [{"bucket": b, "active_ips": len(ips), "hot_ip": max(ips.items(), key=lambda kv: len(kv[1]))[0] if ips else None,
             "hot_hits": max((len(v) for v in ips.values()), default=0)} for b, ips in _RATE_BUCKETS.items()]
    total = sum(r["blocks"] for r in by_bucket)
    return {"days": days, "total_blocks": total, "by_ip": by_ip, "by_bucket": by_bucket, "recent": recent, "live": live}


@router.get("/admin/events")
async def admin_list_events(session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """Admin-only: list events with organizer + recipient info for the recipients UI."""
    u = await current_user_from_token(session_token, authorization)
    if not u or not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    from aggregator import upcoming_event_predicate
    now_iso = datetime.now(timezone.utc).isoformat()
    q: Dict[str, Any] = upcoming_event_predicate(now_iso)
    # Return the FULL event doc (same source/shape as the public feed) so admin
    # edits to any field — location, RSVP link, flyer, etc. — show immediately.
    docs = await db.events.find(q, {"_id": 0}).sort("starts_at", 1).to_list(500)
    for d in docs:
        d.setdefault("email_recipients", [])
        if not d.get("category"):
            apply_category(d)
    return docs


class CategoryUpdate(BaseModel):
    category: str


@router.patch("/admin/events/{event_id}/category")
async def admin_set_event_category(event_id: str, body: CategoryUpdate, admin=Depends(require_admin)):
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    res = await db.events.update_one({"id": event_id}, {"$set": {
        "category": body.category, "category_manual": True, "category_needs_review": False,
    }})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"id": event_id, "category": body.category, "category_manual": True, "category_needs_review": False}


class EventBulkContact(BaseModel):
    event_ids: List[str] = []
    organizer_name: Optional[str] = None
    organizer_email: Optional[str] = None


@router.post("/admin/import-digest/send")
async def send_import_digest(admin=Depends(require_admin)):
    """Manually run the imported-events-missing-contact digest now."""
    from scheduler import _import_contact_digest_job
    count = await _import_contact_digest_job(db)
    return {"ok": True, "events_missing_contact": count}


@router.patch("/admin/events/bulk")
async def admin_bulk_event_contact(body: EventBulkContact, admin=Depends(require_admin)):
    """Set organizer name / RSVP contact email on many events at once — for
    cleaning up a batch of imported feed events."""
    changes: Dict[str, Any] = {}
    if body.organizer_name is not None:
        changes["organizer_name"] = body.organizer_name.strip()
    if body.organizer_email is not None:
        changes["organizer_email"] = body.organizer_email.strip()
    if not changes:
        raise HTTPException(status_code=400, detail="Provide an organizer name and/or contact email")
    if not body.event_ids:
        raise HTTPException(status_code=400, detail="Select at least one event")
    changes["admin_edited"] = True
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.events.update_many({"id": {"$in": body.event_ids[:500]}}, {"$set": changes})
    return {"ok": True, "updated": res.modified_count}


@router.patch("/admin/events/{event_id}")
async def admin_update_event(event_id: str, body: EventAdminUpdate, admin=Depends(require_admin)):
    """Full admin event edit — works on ANY event, including imported/aggregator
    ones that scraped incorrectly (fix title, organizer, RSVP contact, links,
    time, location, category, flyer) before members flag them."""
    from date_utils import normalize_iso, end_before_start
    from constants import PNW_MARKETS
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if "market" in changes and changes["market"] not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market")
    raw_starts = changes.get("starts_at")
    for k in ("starts_at", "ends_at"):
        if k in changes:
            iso = normalize_iso(changes[k])
            if not (isinstance(iso, str) and "T" in iso and iso.endswith("+00:00")):
                raise HTTPException(status_code=400, detail=f"Invalid {k}")
            changes[k] = iso
    if "category" in changes and changes["category"] not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    # Validate contact email + registration URL (empty string = clear, allowed).
    if changes.get("organizer_email"):
        import re as _re
        changes["organizer_email"] = changes["organizer_email"].strip()
        if not _re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", changes["organizer_email"]):
            raise HTTPException(status_code=400, detail="Invalid contact email")
    if changes.get("registration_url"):
        changes["registration_url"] = changes["registration_url"].strip()
        if not (changes["registration_url"].startswith("http://") or changes["registration_url"].startswith("https://")):
            raise HTTPException(status_code=400, detail="Registration URL must start with http:// or https://")
    if not changes:
        return ev
    eff_starts = changes.get("starts_at", ev.get("starts_at"))
    eff_ends = changes.get("ends_at", ev.get("ends_at"))
    eff_tnl = changes.get("time_not_listed", ev.get("time_not_listed"))
    if end_before_start(eff_starts, eff_ends, eff_tnl):
        raise HTTPException(status_code=400, detail="End time must be after the start time")
    # EVENTS-FIX-1: one shared lock rule (also derives + locks time_not_listed).
    from event_locks import finalize_editor_changes
    changes, locked_fields = finalize_editor_changes(changes, raw_starts)
    update_doc = {"$set": changes}
    if locked_fields:
        update_doc["$addToSet"] = {"admin_locked_fields": {"$each": locked_fields}}
    await db.events.update_one({"id": event_id}, update_doc)
    from audit import log_admin_action
    await log_admin_action(admin, "edit", "event", event_id,
                           summary=f"{ev.get('title') or event_id} - fields: {', '.join(sorted(changes.keys()))}")
    updated = await db.events.find_one({"id": event_id}, {"_id": 0, "email_recipients": 0})
    return updated


# ------------------------------------------------------------------------- #
# EVENTS-ADMIN-BULK-1: bulk delete (recoverable) + mark reviewed + confirm.
# ------------------------------------------------------------------------- #
import re as _re_events


class EventIds(BaseModel):
    event_ids: List[str] = []


@router.post("/admin/events/bulk-delete")
async def admin_bulk_delete_events(body: EventIds, admin=Depends(require_admin)):
    """Soft-delete many events at once. Each event is copied to events_deleted
    (recoverable), aggregator events are tombstoned so the importer never brings
    them back, and the live event + its signups are removed. Writes ONE audit
    entry recording who, when, and which events."""
    from event_recovery import soft_delete_event
    ids = [i for i in (body.event_ids or []) if isinstance(i, str)][:500]
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one event")
    done: List[Dict[str, str]] = []
    for eid in ids:
        ev = await db.events.find_one({"id": eid}, {"_id": 0})
        if not ev:
            continue
        await soft_delete_event(ev, admin)
        done.append({"id": eid, "title": ev.get("title") or eid})
    from audit import log_admin_action
    await log_admin_action(
        admin, "bulk_delete", "event", "bulk",
        summary=f"Deleted {len(done)} event(s): " + ", ".join(d["title"] for d in done)[:160],
        meta={"count": len(done), "events": done})
    return {"ok": True, "deleted": len(done), "events": done}


@router.post("/admin/events/bulk-review")
async def admin_bulk_mark_reviewed(body: EventIds, admin=Depends(require_admin)):
    """Clear the category-needs-review flag on the selected events. Does NOT
    change the category itself."""
    ids = [i for i in (body.event_ids or []) if isinstance(i, str)][:500]
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one event")
    res = await db.events.update_many(
        {"id": {"$in": ids}, "category_needs_review": True},
        {"$set": {"category_needs_review": False,
                  "updated_at": datetime.now(timezone.utc).isoformat()}})
    from audit import log_admin_action
    await log_admin_action(admin, "mark_reviewed", "event", "bulk",
                           summary=f"Marked {res.modified_count} event(s) reviewed",
                           meta={"count": res.modified_count, "event_ids": ids})
    return {"ok": True, "updated": res.modified_count}


@router.post("/admin/events/confirm")
async def admin_confirm_events(body: EventIds, admin=Depends(require_admin)):
    """Mark events confirmed (single or bulk): strip any leading "[Draft]" from
    the title so the Tentative badge disappears, and lock the title so a later
    scrape can never re-add "[Draft]"."""
    ids = [i for i in (body.event_ids or []) if isinstance(i, str)][:500]
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one event")
    confirmed: List[Dict[str, str]] = []
    for eid in ids:
        ev = await db.events.find_one({"id": eid}, {"_id": 0, "title": 1})
        if not ev:
            continue
        new_title = _re_events.sub(r"^\s*\[\s*draft\s*\]\s*", "", ev.get("title") or "", flags=_re_events.I).strip()
        await db.events.update_one(
            {"id": eid},
            {"$set": {"title": new_title, "admin_edited": True,
                      "updated_at": datetime.now(timezone.utc).isoformat()},
             "$addToSet": {"admin_locked_fields": "title"}})
        confirmed.append({"id": eid, "title": new_title})
    from audit import log_admin_action
    await log_admin_action(admin, "confirm", "event", "bulk" if len(confirmed) != 1 else confirmed[0]["id"],
                           summary=f"Confirmed {len(confirmed)} event(s)",
                           meta={"count": len(confirmed), "events": confirmed})
    return {"ok": True, "confirmed": len(confirmed), "events": confirmed}


@router.get("/admin/events/deleted")
async def admin_list_deleted_events(admin=Depends(require_admin)):
    """List soft-deleted events (recoverable copies), newest first."""
    docs = await db.events_deleted.find(
        {}, {"_id": 0, "id": 1, "title": 1, "source": 1, "starts_at": 1,
             "time_not_listed": 1, "market": 1, "deleted_at": 1,
             "deleted_by_name": 1, "recoverable_until": 1}
    ).sort("deleted_at", -1).to_list(500)
    return {"count": len(docs), "events": docs}


@router.post("/admin/events/{event_id}/restore")
async def admin_restore_event(event_id: str, admin=Depends(require_admin)):
    """Restore a soft-deleted event: re-insert it (and its signups) and remove
    its tombstone so it is live again."""
    from event_recovery import restore_event
    recovery = await db.events_deleted.find_one({"id": event_id}, {"_id": 0})
    if not recovery:
        raise HTTPException(status_code=404, detail="Deleted event not found")
    ok = await restore_event(recovery, admin)
    if not ok:
        raise HTTPException(status_code=400, detail="Recovery copy is incomplete")
    return {"ok": True, "restored": event_id}



# ------------------------------------------------------------------------- #
# ADMIN-MAIL-1: Email delivery log (failures + fallbacks). No message bodies.
# ------------------------------------------------------------------------- #
_email_ttl_ready = False


async def _ensure_email_failures_ttl():
    global _email_ttl_ready
    if _email_ttl_ready:
        return
    try:
        await db.email_failures.create_index("expire_at", expireAfterSeconds=0)
        await db.email_failures.create_index([("at", -1)])
        _email_ttl_ready = True
    except Exception:
        logger.exception("email_failures ttl index setup failed")


@router.get("/admin/email-failures")
async def admin_email_failures(status: str = "all", date_from: Optional[str] = None,
                               date_to: Optional[str] = None, limit: int = 200,
                               admin=Depends(require_admin)):
    """List email delivery issues. status: all | failed | fallback. Optional
    date_from/date_to are ISO dates (inclusive). Never returns message bodies."""
    await _ensure_email_failures_ttl()
    q: Dict[str, Any] = {}
    if status == "failed":
        q["kind"] = "EMAIL SEND FAILED"
    elif status == "fallback":
        q["kind"] = "EMAIL FALLBACK"
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            # make the upper bound inclusive of the whole day
            rng["$lte"] = date_to + "T23:59:59.999999+00:00" if len(date_to) == 10 else date_to
        q["at"] = rng
    docs = await db.email_failures.find(
        q, {"_id": 0, "id": 1, "kind": 1, "to": 1, "subject": 1, "reason": 1,
            "at": 1, "resolved": 1}
    ).sort("at", -1).limit(max(1, min(limit, 500))).to_list(500)
    for d in docs:
        d["resolved"] = bool(d.get("resolved"))
        d["route"] = "fallback" if d.get("kind") == "EMAIL FALLBACK" else "failed"
    return {"count": len(docs), "items": docs}


@router.get("/admin/email-failures/summary")
async def admin_email_failures_summary(admin=Depends(require_admin)):
    """Unresolved count for the Admin nav badge."""
    await _ensure_email_failures_ttl()
    unresolved = await db.email_failures.count_documents({"resolved": {"$ne": True}})
    return {"unresolved": unresolved}


@router.post("/admin/email-failures/{fid}/resolve")
async def admin_email_failure_resolve(fid: str, body: Optional[Dict[str, Any]] = None,
                                      admin=Depends(require_admin)):
    resolved = True if body is None else bool(body.get("resolved", True))
    r = await db.email_failures.update_one({"id": fid}, {"$set": {"resolved": resolved}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True, "resolved": resolved}


@router.post("/admin/email-failures/clear-resolved")
async def admin_email_failures_clear(admin=Depends(require_admin)):
    """Delete all resolved delivery-log entries."""
    r = await db.email_failures.delete_many({"resolved": True})
    return {"ok": True, "deleted": r.deleted_count}


# ------------------------------------------------------------------------- #
# ADMIN-MAIL-1: Contact message status / bulk / delete.
# ------------------------------------------------------------------------- #
_CONTACT_STATUSES = {"new", "handled", "archived"}


@router.post("/admin/contact/{msg_id}/status")
async def admin_contact_set_status(msg_id: str, body: Dict[str, Any],
                                   admin=Depends(require_admin)):
    """Set queue_status to new (restore), handled or archived."""
    status = (body.get("status") or "").strip().lower()
    if status not in _CONTACT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    r = await db.contact_messages.update_one(
        {"id": msg_id, "deleted": {"$ne": True}},
        {"$set": {"queue_status": status}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True, "status": status}


async def _redact_contact(msg_id: str, admin: Dict[str, Any]) -> bool:
    """Delete a contact message: strip text + sender PII, keep only a small
    tombstone (id, date, who/when deleted), and write an admin audit entry."""
    doc = await db.contact_messages.find_one({"id": msg_id}, {"_id": 0})
    if not doc or doc.get("deleted"):
        return False
    now = datetime.now(timezone.utc).isoformat()
    await db.contact_messages.replace_one(
        {"id": msg_id},
        {"id": msg_id, "created_at": doc.get("created_at"), "deleted": True,
         "deleted_by": admin.get("user_id"), "deleted_by_name": admin.get("name"),
         "deleted_at": now, "queue_status": "deleted"})
    from audit import log_admin_action
    await log_admin_action(admin, "delete", "contact_message", msg_id,
                           summary=f"Contact message deleted (redacted) on {now[:10]}")
    return True


@router.delete("/admin/contact/{msg_id}")
async def admin_contact_delete(msg_id: str, admin=Depends(require_admin)):
    ok = await _redact_contact(msg_id, admin)
    if not ok:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True}


class ContactBulk(BaseModel):
    ids: List[str]
    action: str  # archive | delete


@router.post("/admin/contact/bulk")
async def admin_contact_bulk(body: ContactBulk, admin=Depends(require_admin)):
    ids = [i for i in (body.ids or []) if isinstance(i, str)][:500]
    if not ids:
        raise HTTPException(status_code=400, detail="No messages selected")
    if body.action == "archive":
        r = await db.contact_messages.update_many(
            {"id": {"$in": ids}, "deleted": {"$ne": True}},
            {"$set": {"queue_status": "archived"}})
        return {"ok": True, "archived": r.modified_count}
    if body.action == "delete":
        n = 0
        for mid in ids:
            if await _redact_contact(mid, admin):
                n += 1
        return {"ok": True, "deleted": n}
    raise HTTPException(status_code=400, detail="Invalid action")


# ---------------- Complimentary (comp) grants [BILLING-3a] ----------------
import billing as _billing
from billing import COMP_TIERS, grant_comp, revoke_comp, _subscription_is_live_user


@router.get("/admin/comps")
async def admin_list_comps(status: str = "active", admin=Depends(require_admin)):
    """List comp grants for the admin Comp page. Joins member name/email/tier."""
    q = {} if status == "all" else {"status": status}
    grants = await db.comp_grants.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    uids = [g["user_id"] for g in grants]
    users = await db.users.find({"user_id": {"$in": uids}},
                                {"_id": 0, "user_id": 1, "name": 1, "email": 1,
                                 "account_type": 1, "subscription_tier": 1,
                                 "subscription_provider": 1}).to_list(500)
    umap = {u["user_id"]: u for u in users}
    out = []
    for g in grants:
        u = umap.get(g["user_id"], {})
        out.append({**g,
                    "member_name": u.get("name"), "member_email": u.get("email"),
                    "account_type": u.get("account_type"),
                    "current_tier": u.get("subscription_tier"),
                    "is_current": u.get("subscription_provider") == "comp" and g.get("status") == "active"})
    return out


@router.post("/admin/comps")
async def admin_grant_comp(body: dict, admin=Depends(require_admin)):
    """Grant a complimentary tier. Requires a reason. Optional end date.
    Blocked if the member has a live Stripe subscription (cancel it first)."""
    email = (body.get("email") or "").strip().lower()
    user_id = body.get("user_id")
    tier = (body.get("tier") or "").strip()
    reason = (body.get("reason") or "").strip()
    end_at = body.get("end_at") or None
    if tier not in COMP_TIERS:
        raise HTTPException(status_code=400, detail="Invalid tier.")
    if not reason:
        raise HTTPException(status_code=400, detail="A reason note is required.")
    q = {"user_id": user_id} if user_id else ({"email": email} if email else None)
    if not q:
        raise HTTPException(status_code=400, detail="Provide the member's email.")
    member = await db.users.find_one(q, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="No member found with that email.")
    if _subscription_is_live_user(member):
        raise HTTPException(status_code=409, detail="This member has an active Stripe subscription. Cancel it before granting comp access.")
    if end_at:
        try:
            datetime.fromisoformat(end_at.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="End date is not a valid date.")
    grant = await grant_comp(member["user_id"], tier, reason, admin, end_at=end_at)
    from audit import log_admin_action
    await log_admin_action(admin, "comp_grant", "user", member["user_id"],
                           summary=f"{tier} comp" + (f" until {end_at[:10]}" if end_at else " (open-ended)"),
                           meta={"tier": tier, "reason": reason, "end_at": end_at})
    return grant


@router.post("/admin/comps/{grant_id}/revoke")
async def admin_revoke_comp(grant_id: str, admin=Depends(require_admin)):
    g = await db.comp_grants.find_one({"id": grant_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Grant not found.")
    ok = await revoke_comp(g["user_id"], grant_id=grant_id, reason="revoked")
    from audit import log_admin_action
    await log_admin_action(admin, "comp_revoke", "user", g["user_id"],
                           summary=f"revoked {g.get('tier')} comp", meta={"grant_id": grant_id})
    return {"ok": ok}
