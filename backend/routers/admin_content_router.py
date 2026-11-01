"""Admin moderation: edit/delete content across entity types, deactivate/ban
profiles, and read the audit log. Every change is recorded in `audit_logs`."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from deps import db, require_admin
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


# ---------- Audit log ----------
@router.get("/admin/audit-logs")
async def admin_audit_logs(entity: Optional[str] = None, limit: int = 300,
                           admin=Depends(require_admin)):
    q: Dict[str, Any] = {}
    if entity:
        q["entity_type"] = entity
    return await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 500))
