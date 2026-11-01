"""Notifications collection + helpers.

Kinds: dm, crew_join, review_request, review_completed, comment,
       post_expiring, subscription_expiring
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from deps import db


async def notify(user_id: str, kind: str, title: str, body: str = "",
                 link: str = "/", meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "link": link,
        "meta": meta or {},
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    # Fire-and-forget browser push for high-signal kinds, respecting per-user preferences.
    if kind in {"dm", "review_request", "review_completed", "review_withdrawn", "review_reply", "comment", "crew_join", "blog_approved", "event_reminder", "event_updated", "event_cancelled", "event_blast"}:
        try:
            user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "push_preferences": 1}) or {}
            prefs = user.get("push_preferences") or {}
            if prefs.get(kind, True):
                import asyncio
                import push as push_mod
                asyncio.create_task(push_mod.send_push_to_user(user_id, {
                    "title": title, "body": body, "url": link, "kind": kind,
                }))
        except Exception:
            import logging
            logging.getLogger("smn.notifications").exception("push fanout failed")
    return doc


def resolve_locked_dm(item: Dict[str, Any], viewer_can_interact: bool) -> Dict[str, Any]:
    """B-1: a "locked" DM/group notification carries the "Upgrade to read and
    reply" text + /pricing link only while the recipient still can't interact.
    Once they are paid/upgraded, recompute at READ time so they never see stale
    upgrade text: show a normal "New message" linking to the thread under
    /messages. Free recipients are unchanged. Returns a copy; never mutates the
    stored record."""
    meta = item.get("meta") or {}
    if not meta.get("locked") or not viewer_can_interact:
        return item
    it = dict(item)
    if meta.get("is_group"):
        it["body"] = "New message in " + (meta.get("group_title") or "a group chat")
    else:
        sender = meta.get("from_name")
        it["body"] = "New message" + (f" from {sender}" if sender else "")
    it["title"] = "You have a new message"
    it["link"] = "/messages"
    nm = dict(meta)
    nm["locked"] = False
    it["meta"] = nm
    return it


def activity_status(last_active_iso: Optional[str]) -> str:
    """Returns 'today' | 'this_week' | 'this_month' | 'dormant' | 'never'."""
    if not last_active_iso:
        return "never"
    try:
        la = datetime.fromisoformat(last_active_iso.replace("Z", "+00:00"))
    except Exception:
        return "never"
    delta = datetime.now(timezone.utc) - la
    if delta.days <= 1:
        return "today"
    if delta.days <= 7:
        return "this_week"
    if delta.days <= 30:
        return "this_month"
    return "dormant"
