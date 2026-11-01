"""Follow clubs/organizations + a dedicated per-org activity feed.

An "org" is any user account (partners/orgs surfaced in the Clubs directory).
Follows live in the `follows` collection: {user_id, org_id, created_at}.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, Header, HTTPException

from deps import db, current_user_from_token, partner_badge
try:
    from notifications import notify
except Exception:  # pragma: no cover
    notify = None

router = APIRouter()


async def _me(session_token, authorization) -> Dict[str, Any]:
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


async def _org_summary(org_id: str) -> Optional[Dict[str, Any]]:
    o = await db.users.find_one(
        {"user_id": org_id},
        {"_id": 0, "user_id": 1, "handle": 1, "name": 1, "avatar": 1, "picture": 1,
         "bio": 1, "primary_market": 1, "markets": 1, "account_type": 1, "founding_partner": 1, "subscription_tier": 1},
    )
    if o:
        o["partner_badge"] = partner_badge(o)
    return o


async def _blocked_ids(user_id: str) -> set:
    """All user_ids that are in a block relationship with this user (either direction)."""
    ids = set()
    async for b in db.follow_blocks.find({"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]}, {"_id": 0}):
        ids.add(b["blocked_id"] if b["blocker_id"] == user_id else b["blocker_id"])
    return ids


@router.get("/follows")
async def my_follows(session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    """List orgs the current user follows (with a summary of each)."""
    u = await _me(session_token, authorization)
    rows = await db.follows.find({"user_id": u["user_id"]}, {"_id": 0, "org_id": 1}).to_list(500)
    ids = [r["org_id"] for r in rows]
    orgs = []
    for oid in ids:
        s = await _org_summary(oid)
        if s:
            s["following"] = True
            orgs.append(s)
    return {"count": len(orgs), "ids": ids, "orgs": orgs}


@router.get("/follows/suggestions")
async def follow_suggestions(limit: int = 6, session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    """Suggested clubs/orgs + sailors to follow (not already followed). Orgs first,
    then by follower count — used to fill out a short Following list."""
    u = await _me(session_token, authorization)
    rows = await db.follows.find({"user_id": u["user_id"]}, {"_id": 0, "org_id": 1}).to_list(500)
    dismissed = {d["dismissed_id"] async for d in db.follow_dismissals.find({"user_id": u["user_id"]}, {"_id": 0, "dismissed_id": 1})}
    blocked = await _blocked_ids(u["user_id"])
    exclude = {r["org_id"] for r in rows} | {u["user_id"]} | dismissed | blocked
    my_market = u.get("primary_market")
    docs = await db.users.find(
        {"user_id": {"$nin": list(exclude)}, "handle": {"$nin": [None, ""]}},
        {"_id": 0, "user_id": 1, "handle": 1, "name": 1, "avatar": 1, "picture": 1,
         "bio": 1, "primary_market": 1, "markets": 1, "account_type": 1, "founding_partner": 1, "subscription_tier": 1},
    ).limit(80).to_list(80)
    org_types = {"partner", "community_partner", "boat_pro"}
    for d in docs:
        d["partner_badge"] = partner_badge(d)
        d["follower_count"] = await db.follows.count_documents({"org_id": d["user_id"]})
        d["is_org"] = d.get("account_type") in org_types or bool(d.get("partner_badge"))
        d["same_market"] = bool(my_market and (d.get("primary_market") == my_market or my_market in (d.get("markets") or [])))
        if d["same_market"]:
            d["reason"] = f"In {my_market}"
        elif d["follower_count"] >= 5:
            d["reason"] = f"Popular · {d['follower_count']} followers"
        elif d["is_org"]:
            d["reason"] = "Community organization"
        else:
            d["reason"] = "New to the community"
    docs.sort(key=lambda d: (not d["same_market"], not d["is_org"], -d["follower_count"], d.get("name") or ""))
    n = max(1, min(limit, 12))
    return {"suggestions": docs[:n]}


@router.post("/follows/suggestions/{target_id}/dismiss")
async def dismiss_suggestion(target_id: str, session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    await db.follow_dismissals.update_one(
        {"user_id": u["user_id"], "dismissed_id": target_id},
        {"$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"ok": True, "dismissed": target_id}


@router.post("/follows/{org_id}")
async def follow_org(org_id: str, session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    # Following is open to any signed-in account (including free individuals);
    # it is not a Premium feature. Other actions (posting, commenting, messaging,
    # events) keep their own require_interaction gates.
    if org_id == u["user_id"]:
        raise HTTPException(status_code=400, detail="You can't follow yourself")
    org = await db.users.find_one({"user_id": org_id}, {"_id": 0, "user_id": 1})
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if await db.follow_blocks.find_one({"blocker_id": org_id, "blocked_id": u["user_id"]}):
        raise HTTPException(status_code=403, detail="You can't follow this account")
    if await db.follow_blocks.find_one({"blocker_id": u["user_id"], "blocked_id": org_id}):
        raise HTTPException(status_code=400, detail="Unblock this account before following")
    result = await db.follows.update_one(
        {"user_id": u["user_id"], "org_id": org_id},
        {"$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    count = await db.follows.count_documents({"org_id": org_id})
    if result.upserted_id is not None and notify:
        try:
            await notify(org_id, "new_follower", "New follower",
                         f"{u.get('name') or 'A sailor'} started following you.",
                         link="/dashboard", meta={"actor_id": u["user_id"]})
        except Exception:
            pass
    return {"following": True, "org_id": org_id, "follower_count": count}


@router.get("/follows/feed")
async def following_feed(limit: int = 60, session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Combined home feed: upcoming events + recent posts across ALL followed accounts (people and orgs)."""
    u = await _me(session_token, authorization)
    rows = await db.follows.find({"user_id": u["user_id"]}, {"_id": 0, "org_id": 1}).to_list(500)
    ids = [r["org_id"] for r in rows]
    if not ids:
        return {"count": 0, "following_count": 0, "activity": []}
    orgmap: Dict[str, Any] = {}
    for oid in ids:
        s = await _org_summary(oid)
        if s:
            orgmap[oid] = {"user_id": oid, "name": s.get("name"), "handle": s.get("handle"),
                           "avatar": s.get("picture") or s.get("avatar")}
    now_iso = datetime.now(timezone.utc).isoformat()
    events = await db.events.find(
        {"organizer_id": {"$in": ids}, "starts_at": {"$gte": now_iso}},
        {"_id": 0, "organizer_email": 0, "email_recipients": 0},
    ).sort("starts_at", 1).to_list(limit)
    posts = await db.posts.find(
        {"author_id": {"$in": ids}, "status": {"$ne": "removed"}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    activity: List[Dict[str, Any]] = []
    for e in events:
        activity.append({"kind": "event", "id": e.get("id"), "title": e.get("title"),
                         "when": e.get("starts_at"), "market": e.get("market"),
                         "time_not_listed": e.get("time_not_listed"),
                         "category": e.get("category"), "location": e.get("location"),
                         "org": orgmap.get(e.get("organizer_id"))})
    for p in posts:
        activity.append({"kind": "post", "id": p.get("id"), "title": p.get("title"),
                         "body": p.get("body"), "when": p.get("created_at"),
                         "post_type": p.get("type"), "image_url": p.get("image_url"),
                         "org": orgmap.get(p.get("author_id"))})
    activity.sort(key=lambda a: a.get("when") or "", reverse=True)
    return {"count": len(activity), "following_count": len(ids), "activity": activity[:limit]}


@router.delete("/follows/{org_id}")
async def unfollow_org(org_id: str, session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    await db.follows.delete_one({"user_id": u["user_id"], "org_id": org_id})
    count = await db.follows.count_documents({"org_id": org_id})
    return {"following": False, "org_id": org_id, "follower_count": count}


@router.get("/follows/followers")
async def my_followers(session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """People who follow the current user."""
    u = await _me(session_token, authorization)
    rows = await db.follows.find({"org_id": u["user_id"]}, {"_id": 0, "user_id": 1, "created_at": 1}).to_list(1000)
    followers = []
    for r in rows:
        s = await _org_summary(r["user_id"])
        if s:
            s["followed_at"] = r.get("created_at")
            followers.append(s)
    return {"count": len(followers), "followers": followers}


@router.get("/follows/blocked")
async def my_blocked(session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    rows = await db.follow_blocks.find({"blocker_id": u["user_id"]}, {"_id": 0, "blocked_id": 1}).to_list(500)
    blocked = []
    for r in rows:
        s = await _org_summary(r["blocked_id"])
        if s:
            blocked.append(s)
    return {"count": len(blocked), "blocked": blocked}


@router.post("/follows/block/{user_id}")
async def block_user(user_id: str, session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    """Block a user: removes their follow of you (and yours of them) and prevents re-following."""
    u = await _me(session_token, authorization)
    if user_id == u["user_id"]:
        raise HTTPException(status_code=400, detail="You can't block yourself")
    await db.follow_blocks.update_one(
        {"blocker_id": u["user_id"], "blocked_id": user_id},
        {"$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await db.follows.delete_many({"$or": [
        {"user_id": user_id, "org_id": u["user_id"]},
        {"user_id": u["user_id"], "org_id": user_id},
    ]})
    return {"ok": True, "blocked": user_id}


@router.delete("/follows/block/{user_id}")
async def unblock_user(user_id: str, session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    await db.follow_blocks.delete_one({"blocker_id": u["user_id"], "blocked_id": user_id})
    return {"ok": True, "unblocked": user_id}




@router.get("/follows/{org_id}/activity")
async def org_activity(org_id: str, session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """Dedicated activity feed for one org: upcoming events + recent posts, merged."""
    org = await _org_summary(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    now_iso = datetime.now(timezone.utc).isoformat()

    following = False
    u = await current_user_from_token(session_token, authorization)
    if u:
        following = bool(await db.follows.find_one({"user_id": u["user_id"], "org_id": org_id}))
    follower_count = await db.follows.count_documents({"org_id": org_id})

    events = await db.events.find(
        {"organizer_id": org_id, "starts_at": {"$gte": now_iso}},
        {"_id": 0, "organizer_email": 0, "email_recipients": 0},
    ).sort("starts_at", 1).to_list(50)

    posts = await db.posts.find(
        {"author_id": org_id, "status": {"$ne": "removed"}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)

    activity: List[Dict[str, Any]] = []
    for e in events:
        activity.append({"kind": "event", "id": e.get("id"), "title": e.get("title"),
                         "when": e.get("starts_at"), "market": e.get("market"),
                         "time_not_listed": e.get("time_not_listed"),
                         "category": e.get("category"), "location": e.get("location")})
    for p in posts:
        activity.append({"kind": "post", "id": p.get("id"), "title": p.get("title"),
                         "body": p.get("body"), "when": p.get("created_at"),
                         "post_type": p.get("type"), "image_url": p.get("image_url")})
    activity.sort(key=lambda a: a.get("when") or "", reverse=True)
    return {"org": org, "following": following, "follower_count": follower_count,
            "upcoming_events": len(events), "recent_posts": len(posts), "activity": activity}
