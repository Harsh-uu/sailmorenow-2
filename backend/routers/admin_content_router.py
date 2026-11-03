"""Admin moderation: edit/delete content across entity types, deactivate/ban
profiles, and read the audit log. Every change is recorded in `audit_logs`."""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from deps import db, require_admin, is_paid_subscriber
from audit import log_admin_action

router = APIRouter()

ENTITY_COLL = {
    "post": "posts",
    "discussion": "discussions",
    "comment": "comments",
    "review": "reviews",
}
EDITABLE = {
    "post": {"title", "body", "price", "condition", "market", "image_urls"},
    "discussion": {"title", "body", "market"},
    "comment": {"body"},
    "review": {"rating", "comment"},
}

USER_SAFE_FIELDS = {"name", "handle", "short_bio", "bio", "primary_market",
                    "markets", "boat_name", "boat_make_model",
                    "subscription_tier", "account_type"}


def _coll(entity: str):
    if entity not in ENTITY_COLL:
        raise HTTPException(status_code=400, detail="Unknown entity type")
    return db[ENTITY_COLL[entity]]


def _summarize(entity: str, doc: Dict[str, Any]) -> str:
    return (doc.get("title") or doc.get("body") or doc.get("comment") or doc.get("name") or doc.get("id") or "")[:120]


@router.patch("/admin/content/{entity}/{item_id}")
async def admin_edit_content(entity: str, item_id: str,
                             body: Dict[str, Any] = Body(default={}),
                             admin=Depends(require_admin)):
    coll = _coll(entity)
    doc = await coll.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    allowed = EDITABLE[entity]
    changes = {k: v for k, v in body.items() if k in allowed and v is not None}
    if entity == "review" and "rating" in changes:
        try:
            r = int(changes["rating"])
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid rating")
        changes["rating"] = max(1, min(5, r))
    if entity == "post" and "price" in changes:
        try:
            if float(changes["price"]) < 0:
                raise ValueError()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid price")
    if not changes:
        return doc
    changes["admin_edited"] = True
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    await coll.update_one({"id": item_id}, {"$set": changes})
    await log_admin_action(admin, "edit", entity, item_id,
                           summary=f"{_summarize(entity, doc)} — fields: {', '.join(sorted(changes.keys()))}")
    return await coll.find_one({"id": item_id}, {"_id": 0})


@router.delete("/admin/content/{entity}/{item_id}")
async def admin_delete_content(entity: str, item_id: str, admin=Depends(require_admin)):
    if entity == "event":
        ev = await db.events.find_one({"id": item_id}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Not found")
        # Aggregated (feed) events get a tombstone keyed by their stable id
        # (agg_{source_key}_{external_id}) so the importer never re-imports them.
        if ev.get("source") == "aggregator":
            await db.event_tombstones.update_one(
                {"id": item_id},
                {"$set": {
                    "id": item_id, "source": "aggregator",
                    "source_key": ev.get("source_key"), "external_id": ev.get("external_id"),
                    "source_uid": ev.get("source_uid"), "recurrence_id": ev.get("recurrence_id"),
                    "title": ev.get("title"),
                    "removed_by": admin.get("user_id"),
                    "removed_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
        await db.events.delete_one({"id": item_id})
        await db.event_registrations.delete_many({"event_id": item_id})
        await db.crew_bank.delete_many({"event_id": item_id})
        await log_admin_action(admin, "delete", "event", item_id, summary=ev.get("title") or item_id)
        return {"ok": True}
    coll = _coll(entity)
    doc = await coll.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await coll.delete_one({"id": item_id})
    # Cascade: posts & discussions own comments + reactions; comments own replies.
    if entity in ("post", "discussion"):
        await db.comments.delete_many({"post_id": item_id})
        await db.reactions.delete_many({"target_id": item_id})
        await db.saved_items.delete_many({"target_id": item_id})
    elif entity == "comment":
        await db.comments.delete_many({"parent_id": item_id})
    await log_admin_action(admin, "delete", entity, item_id, summary=_summarize(entity, doc))
    return {"ok": True}


# ---------- Profiles ----------
@router.get("/admin/users/search")
async def admin_user_search(q: str = "", limit: int = 25, admin=Depends(require_admin)):
    import re as _re
    query: Dict[str, Any] = {}
    if q.strip():
        rx = {"$regex": _re.escape(q.strip()), "$options": "i"}
        query = {"$or": [{"name": rx}, {"email": rx}, {"handle": rx}]}
    docs = await db.users.find(query, {
        "_id": 0, "user_id": 1, "name": 1, "email": 1, "handle": 1,
        "primary_market": 1, "account_type": 1, "subscription_tier": 1,
        "short_bio": 1, "boat_name": 1, "boat_make_model": 1, "banned": 1, "created_at": 1,
    }).sort("created_at", -1).to_list(min(max(limit, 1), 100))
    return docs


@router.patch("/admin/users/{uid}")
async def admin_edit_user(uid: str, body: Dict[str, Any] = Body(default={}),
                          admin=Depends(require_admin)):
    user = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    changes = {k: v for k, v in body.items() if k in USER_SAFE_FIELDS and v is not None}
    if "subscription_tier" in changes and changes["subscription_tier"] not in {"free", "premium", "boat_pro", "partner"}:
        raise HTTPException(status_code=400, detail="Invalid tier")
    if not changes:
        return user
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": uid}, {"$set": changes})
    await log_admin_action(admin, "edit", "profile", uid,
                           summary=f"{user.get('name') or user.get('email')} — {', '.join(sorted(changes.keys()))}")
    return await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})


@router.post("/admin/users/{uid}/ban")
async def admin_ban_user(uid: str, admin=Depends(require_admin)):
    user = await db.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if uid == admin.get("user_id"):
        raise HTTPException(status_code=400, detail="You can't deactivate your own account")
    await db.users.update_one({"user_id": uid},
                              {"$set": {"banned": True, "banned_at": datetime.now(timezone.utc).isoformat()}})
    await log_admin_action(admin, "ban", "profile", uid, summary=user.get("name") or user.get("email") or uid)
    try:
        from zoho_sync import enqueue as _zq
        await _zq(db, "account_banned", uid)
    except Exception:
        pass
    return {"ok": True, "banned": True}


@router.post("/admin/users/{uid}/unban")
async def admin_unban_user(uid: str, admin=Depends(require_admin)):
    user = await db.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"user_id": uid}, {"$set": {"banned": False}, "$unset": {"banned_at": ""}})
    await log_admin_action(admin, "unban", "profile", uid, summary=user.get("name") or user.get("email") or uid)
    try:
        from zoho_sync import enqueue as _zq
        await _zq(db, "account_unbanned", uid)
    except Exception:
        pass
    return {"ok": True, "banned": False}


# ---------- High-activity / spam-volume visibility ----------
# Admin-only, read-only aggregation: which accounts post/comment/react/author hub
# content at spam-like volume over a recent window. No enforcement, no hard limits -
# this is VISIBILITY only, so admins can review and use the existing Deactivate,
# Flag and content-delete actions. Free members' abilities are unchanged.
@router.get("/admin/activity-volume")
async def admin_activity_volume(days: int = 7, min_total: int = 10, new_days: int = 7,
                                limit: int = 100, admin=Depends(require_admin)):
    days = max(1, min(days, 90))
    new_days = max(1, min(new_days, 90))
    min_total = max(1, min(min_total, 10000))
    limit = max(1, min(limit, 300))
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=days)).isoformat()
    new_cutoff = (now - timedelta(days=new_days)).isoformat()

    async def tally(coll: str, author_field: str, time_field: str) -> Dict[str, int]:
        out: Dict[str, int] = {}
        async for r in db[coll].aggregate([
            {"$match": {time_field: {"$gte": cutoff}, author_field: {"$ne": None}}},
            {"$group": {"_id": f"${author_field}", "n": {"$sum": 1}}},
        ]):
            if r["_id"]:
                out[r["_id"]] = r["n"]
        return out

    posts = await tally("posts", "author_id", "created_at")
    comments = await tally("comments", "author_id", "created_at")
    hub = await tally("discussions", "author_id", "created_at")
    reactions = await tally("reactions", "user_id", "updated_at")  # reactions store updated_at

    ids = set(posts) | set(comments) | set(hub) | set(reactions)
    rows = []
    for uid in ids:
        p, c, h, rx = posts.get(uid, 0), comments.get(uid, 0), hub.get(uid, 0), reactions.get(uid, 0)
        total = p + c + h + rx
        if total < min_total:
            continue
        rows.append({"user_id": uid, "posts": p, "comments": c, "hub": h,
                     "reactions": rx, "total": total})
    rows.sort(key=lambda x: x["total"], reverse=True)
    rows = rows[:limit]

    uids = [r["user_id"] for r in rows]
    users: Dict[str, Dict[str, Any]] = {}
    if uids:
        async for u in db.users.find({"user_id": {"$in": uids}}, {
            "_id": 0, "user_id": 1, "name": 1, "email": 1, "handle": 1,
            "account_type": 1, "subscription_tier": 1, "subscription_expires": 1,
            "created_at": 1, "banned": 1, "flagged_high_volume": 1, "comped_until": 1,
        }):
            users[u["user_id"]] = u
    for r in rows:
        u = users.get(r["user_id"], {})
        r["name"] = u.get("name")
        r["email"] = u.get("email")
        r["handle"] = u.get("handle")
        r["account_type"] = u.get("account_type")
        r["subscription_tier"] = u.get("subscription_tier") or "free"
        r["created_at"] = u.get("created_at")
        r["banned"] = bool(u.get("banned"))
        r["flagged"] = bool(u.get("flagged_high_volume"))
        r["is_free"] = not is_paid_subscriber(u) if u else True
        r["is_new"] = bool(u.get("created_at") and str(u.get("created_at")) >= new_cutoff)
    return {"window_days": days, "min_total": min_total, "new_days": new_days,
            "count": len(rows), "rows": rows}


@router.post("/admin/users/{uid}/flag-volume")
async def admin_flag_volume(uid: str, body: Dict[str, Any] = Body(default={}),
                            admin=Depends(require_admin)):
    """Soft triage flag only - marks an account for admin review. It does NOT
    block, throttle or change anything the member can do."""
    user = await db.users.find_one({"user_id": uid}, {"_id": 0, "name": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    flagged = bool(body.get("flagged", True))
    if flagged:
        await db.users.update_one({"user_id": uid}, {"$set": {
            "flagged_high_volume": True,
            "flagged_high_volume_at": datetime.now(timezone.utc).isoformat()}})
    else:
        await db.users.update_one({"user_id": uid}, {
            "$set": {"flagged_high_volume": False},
            "$unset": {"flagged_high_volume_at": ""}})
    label = (user.get("name") or user.get("email") or uid) + " - high volume"
    await log_admin_action(admin, "flag" if flagged else "unflag", "profile", uid, summary=label)
    return {"ok": True, "flagged": flagged}


# ---------- Audit log ----------
@router.get("/admin/audit-logs")
async def admin_audit_logs(entity: Optional[str] = None, limit: int = 300,
                           admin=Depends(require_admin)):
    q: Dict[str, Any] = {}
    if entity:
        q["entity_type"] = entity
    return await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 500))
