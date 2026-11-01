"""Notifications router + activity ping."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, Header, HTTPException

from deps import db, current_user_from_token, can_interact
from notifications import activity_status, resolve_locked_dm

router = APIRouter()


@router.get("/notifications")
async def list_notifications(limit: int = 50, skip: int = 0,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Touch last_active_at on every notifications poll — cheap activity ping
    await db.users.update_one(
        {"user_id": u["user_id"]},
        {"$set": {"last_active_at": datetime.now(timezone.utc).isoformat()}},
    )
    limit = max(1, min(limit, 50))
    skip = max(0, skip)
    cursor = db.notifications.find({"user_id": u["user_id"]}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit + 1)
    items = await cursor.to_list(limit + 1)
    has_more = len(items) > limit
    items = items[:limit]
    # B-1: recompute any locked-DM prompt from the recipient's CURRENT tier.
    can = can_interact(u)
    items = [resolve_locked_dm(x, can) for x in items]
    unread = await db.notifications.count_documents({"user_id": u["user_id"], "read": False})
    return {"items": items, "unread": unread, "has_more": has_more}


@router.patch("/notifications/{notif_id}/read")
async def mark_read(notif_id: str,
                    session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.notifications.update_one({"id": notif_id, "user_id": u["user_id"]}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/notifications/mark-all-read")
async def mark_all_read(session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    r = await db.notifications.update_many({"user_id": u["user_id"], "read": False}, {"$set": {"read": True}})
    return {"marked": r.modified_count}


@router.get("/activity/{user_id}")
async def user_activity(user_id: str):
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "last_active_at": 1})
    return {"user_id": user_id, "status": activity_status((u or {}).get("last_active_at"))}
