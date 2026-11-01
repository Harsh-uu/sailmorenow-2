"""Direct messaging: threads, message history, REST send, WebSocket push."""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, Tuple

from fastapi import APIRouter, Body, Cookie, Header, HTTPException, Query, WebSocket, WebSocketDisconnect

from deps import db, current_user_from_token, require_interaction, ws_manager, can_interact, business_listing_for, resolve_author_identity, author_fields, can_act_as_business
from schemas import MessageSend, GroupCreate

router = APIRouter()
logger = logging.getLogger("smn.messaging")


def _thread_id(a: str, b: str, to_identity: str = "personal") -> str:
    base = "-".join(sorted([a, b]))
    # Business-identity threads get a distinct id so a person's personal thread
    # with the same two accounts is never merged. Personal threads keep the
    # legacy id so existing conversations are untouched.
    return f"{base}~b" if to_identity == "business" else base


async def _thread_peer_label(thread: Dict[str, Any], other_id: str) -> Dict[str, Any]:
    """Resolve how the OTHER participant of a 1:1 thread is shown: a business
    identity renders the business name + logo and labels the row with the
    business name; otherwise it labels 'Personal'. Existing threads with no
    stored identities default to personal."""
    identities = (thread or {}).get("identities") or {}
    peer_identity = identities.get(other_id, "personal")
    if peer_identity == "business":
        pro = await db.boat_pros.find_one({"user_id": other_id},
                                          {"_id": 0, "company_name": 1, "logo_url": 1, "business_handle": 1})
        if pro:
            return {"peer_identity": "business", "label": pro.get("company_name") or "Business",
                    "business_name": pro.get("company_name"), "business_logo": pro.get("logo_url")}
    return {"peer_identity": "personal", "label": "Personal"}


async def _member_summary(uid: str):
    return await db.users.find_one(
        {"user_id": uid},
        {"_id": 0, "user_id": 1, "name": 1, "handle": 1, "avatar": 1, "picture": 1},
    )


async def _maybe_locked_email(rec: Dict[str, Any], sender: Dict[str, Any]):
    """Email a free-tier recipient that they have a locked message, throttled to
    once per 24h (via user.locked_dm_email_at). Sends live via Resend."""
    email = rec.get("email")
    if not email:
        return
    now = datetime.now(timezone.utc)
    last = rec.get("locked_dm_email_at")
    if last:
        try:
            if datetime.fromisoformat(last) > now - timedelta(hours=24):
                return
        except Exception:
            pass
    await db.users.update_one({"user_id": rec["user_id"]},
                              {"$set": {"locked_dm_email_at": now.isoformat()}})
    try:
        from mailer import send_email, locked_message_email_html
        await send_email(
            recipient_email=email,
            subject="You have a new message on Sail More Now",
            html_content=locked_message_email_html(
                recipient_name=rec.get("name") or "",
                sender_name=sender.get("name") or "A member",
                app_url="https://app.sailmorenow.com",
            ),
        )
    except Exception:
        logger.exception("locked dm email failed for %s", rec.get("user_id"))


async def _notify_recipient(sender: Dict[str, Any], recipient_id: str, body_txt: str,
                            is_group: bool = False, group_title: Optional[str] = None,
                            thread_id: Optional[str] = None, channel: str = "personal",
                            business_name: Optional[str] = None, sender_identity: str = "personal",
                            pro_involved: bool = False) -> Tuple[bool, Optional[str]]:
    """Notify a DM recipient. Free-tier recipients get an upgrade-prompt
    notification + throttled email and the message stays locked until they
    upgrade. Returns (locked, recipient_name)."""
    rec = await db.users.find_one(
        {"user_id": recipient_id},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "subscription_tier": 1, "founding_partner": 1, "locked_dm_email_at": 1},
    )
    if not rec:
        return (False, None)
    free = not can_interact(rec)
    from notifications import notify
    if free:
        body = ("New message in " + (group_title or "a group chat") + ". Upgrade to read and reply."
                if is_group else "Upgrade to read and reply.")
        await notify(user_id=recipient_id, kind="dm", title="You have a new message",
                     body=body, link="/pricing",
                     meta={"locked": True, "from_id": sender["user_id"], "from_name": sender.get("name"),
                           "is_group": is_group, "group_title": group_title, "thread_id": thread_id})
        await _maybe_locked_email(rec, sender)
    elif is_group:
        await notify(user_id=recipient_id, kind="dm",
                     title=f"{sender.get('name')} · {group_title or 'group chat'}",
                     body=(body_txt or "")[:140], link="/messages",
                     meta={"thread_id": thread_id, "is_group": True})
    else:
        if channel == "business":
            if sender_identity == "business":
                # Boat Pro (as the business) messaged the member.
                title = f"{business_name or sender.get('name')} messaged you"
            else:
                # Member messaged the Boat Pro's business.
                title = f"{sender.get('name')} messaged {business_name or 'the business'}"
        elif pro_involved:
            title = f"{sender.get('name')} messaged you"
        else:
            title = f"New message from {sender.get('name')}"
        await notify(user_id=recipient_id, kind="dm",
                     title=title,
                     body=(body_txt or "")[:140],
                     link=(f"/messages?thread={thread_id}" if thread_id else f"/messages?to={sender['user_id']}"),
                     meta={"from_id": sender["user_id"], "from_name": sender.get("name"), "thread_id": thread_id})
    return (free, rec.get("name"))


@router.get("/messages/threads")
async def list_threads(session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Threads the caller deleted "for me" are hidden from their inbox only; the
    # other participants keep their copy. A new message re-surfaces the thread
    # (send paths $pull the recipients from deleted_for).
    threads = await db.dm_threads.find(
        {"participants": u["user_id"], "deleted_for": {"$ne": u["user_id"]}}, {"_id": 0},
    ).sort("updated_at", -1).to_list(100)
    viewer_is_pro = (u.get("account_type") == "boat_pro")
    for t in threads:
        parts = t.get("participants", [])
        if t.get("is_group"):
            members = []
            for pid in parts:
                s = await _member_summary(pid)
                if s:
                    members.append(s)
            t["members"] = members
            t["is_group"] = True
            reads = t.get("reads") or {}
            since = reads.get(u["user_id"])
            unread_q = {"thread_id": t.get("thread_id"), "from_id": {"$ne": u["user_id"]}}
            if since:
                unread_q["created_at"] = {"$gt": since}
            t["unread"] = await db.dm_messages.count_documents(unread_q)
        else:
            other_id = next((p for p in parts if p != u["user_id"]), u["user_id"])
            other = await db.users.find_one({"user_id": other_id}, {"_id": 0, "email": 0})
            peer = await _thread_peer_label(t, other_id)
            # When the other side is a business identity, present the row as the
            # business (name + logo) rather than the person.
            if peer["peer_identity"] == "business" and other is not None:
                other = {**other, "name": peer.get("business_name") or other.get("name"),
                         "avatar": peer.get("business_logo"), "picture": peer.get("business_logo")}
            t["other_user"] = other
            t["identity_label"] = peer["label"]
            t["peer_identity"] = peer["peer_identity"]
            t["my_identity"] = ((t.get("identities") or {}).get(u["user_id"]) or "personal")
            # New label model (single source for web + mobile): the pill reflects
            # the thread CHANNEL and the Boat Pro VIEWER, not the peer's identity.
            channel = "business" if (t.get("thread_id") or "").endswith("~b") else "personal"
            business_name = None
            if channel == "business":
                ids_map = t.get("identities") or {}
                biz_uid = next((uid for uid, idn in ids_map.items() if idn == "business"), None)
                if not biz_uid:  # legacy thread without identities: pro party = the boat_pro
                    for pid in parts:
                        if await db.boat_pros.find_one({"user_id": pid}, {"_id": 1}):
                            biz_uid = pid
                            break
                if biz_uid:
                    pr = await db.boat_pros.find_one({"user_id": biz_uid}, {"_id": 0, "company_name": 1})
                    business_name = (pr or {}).get("company_name")
            t["channel"] = channel
            t["business_name"] = business_name
            t["viewer_is_boat_pro"] = viewer_is_pro
            t.pop("identities", None)
            t["unread"] = await db.dm_messages.count_documents({
                "thread_id": t.get("thread_id"), "to_id": u["user_id"], "read_at": None,
            })
    return threads


@router.get("/messages/unlock-banner")
async def unlock_banner(session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    """'You have N messages waiting' banner for members who upgraded. Shows only
    while there are UNREAD messages that arrived while the account was free; it
    goes away once those threads are opened (notifications read) or dismissed
    (inbox_unlock_ack). 'Arrived while free' = a locked DM notification, whether
    still flagged (meta.locked) or already reconciled on upgrade (meta.relocked_at)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not can_interact(u) or u.get("inbox_unlock_ack"):
        return {"show": False, "count": 0}
    count = await db.notifications.count_documents({
        "user_id": u["user_id"], "kind": "dm", "read": False,
        "$or": [{"meta.locked": True}, {"meta.relocked_at": {"$exists": True}}],
    })
    return {"show": count > 0, "count": count}


@router.get("/messages/peer/{user_id}")
async def peer_summary(user_id: str,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """Display name/handle/avatar for a 1:1 peer so a brand-new thread opened via
    ?to= shows the real name immediately instead of a generic fallback. Members
    only, and exposes only the same non-sensitive fields as user search."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await _member_summary(user_id)
    if not s:
        raise HTTPException(status_code=404, detail="Not found")
    s["avatar"] = s.pop("picture", None) or s.get("avatar")
    return s


@router.get("/messages/thread-meta/{thread_id}")
async def thread_meta(thread_id: str,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """Label/header source for a single thread so a screen opened from a
    notification shows the same label as from the inbox list (does not depend on
    route params). Boat Pro viewer only: business thread -> business name pill,
    personal -> 'Personal'; everyone else: no pill."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    viewer_is_pro = (u.get("account_type") == "boat_pro")
    t = await db.dm_threads.find_one({"thread_id": thread_id, "participants": u["user_id"]}, {"_id": 0})
    if not t:
        return {"channel": "personal", "business_name": None, "viewer_is_boat_pro": viewer_is_pro,
                "is_group": False, "other_name": None, "other_avatar": None}
    if t.get("is_group"):
        return {"channel": "group", "business_name": None, "viewer_is_boat_pro": viewer_is_pro,
                "is_group": True, "other_name": t.get("title"), "other_avatar": None}
    parts = t.get("participants", [])
    other_id = next((p for p in parts if p != u["user_id"]), u["user_id"])
    other = await db.users.find_one({"user_id": other_id}, {"_id": 0, "name": 1, "avatar": 1, "picture": 1})
    peer = await _thread_peer_label(t, other_id)
    channel = "business" if thread_id.endswith("~b") else "personal"
    business_name = None
    if channel == "business":
        ids_map = t.get("identities") or {}
        biz_uid = next((uid for uid, idn in ids_map.items() if idn == "business"), None)
        if not biz_uid:
            for pid in parts:
                if await db.boat_pros.find_one({"user_id": pid}, {"_id": 1}):
                    biz_uid = pid
                    break
        if biz_uid:
            pr = await db.boat_pros.find_one({"user_id": biz_uid}, {"_id": 0, "company_name": 1})
            business_name = (pr or {}).get("company_name")
    other_name = peer.get("business_name") if peer["peer_identity"] == "business" else (other or {}).get("name")
    other_avatar = peer.get("business_logo") if peer["peer_identity"] == "business" else ((other or {}).get("picture") or (other or {}).get("avatar"))
    return {"channel": channel, "business_name": business_name, "viewer_is_boat_pro": viewer_is_pro,
            "is_group": False, "other_name": other_name, "other_avatar": other_avatar}


@router.get("/messages/{thread_id}")
async def list_messages(thread_id: str,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # A brand-new conversation has no thread doc yet (it's created on first
    # send), so there are no messages and nothing to protect. Return empty
    # instead of 403 — the old code split the thread_id on "-", which wrongly
    # rejected business threads (the "~b" suffix) and UUID user_ids.
    thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0, "participants": 1})
    if not thread:
        return []
    if u["user_id"] not in (thread.get("participants") or []):
        raise HTTPException(status_code=403, detail="Forbidden")
    msgs = await db.dm_messages.find({"thread_id": thread_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    # Hide messages the caller deleted "for me"; keep "deleted for everyone" rows
    # (with an empty body) so the client can render "This message was deleted".
    return [m for m in msgs if u["user_id"] not in (m.get("deleted_for") or [])]


@router.delete("/messages/item/{message_id}")
async def delete_message(message_id: str, scope: str = "me",
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Delete a message. scope=me hides it only for the caller; scope=everyone
    (sender only, any time) soft-deletes it for all participants."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    msg = await db.dm_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    thread = await db.dm_threads.find_one({"thread_id": msg.get("thread_id")}, {"_id": 0, "participants": 1})
    parts = thread.get("participants") if thread else (msg.get("thread_id") or "").split("-")
    if u["user_id"] not in (parts or []):
        raise HTTPException(status_code=403, detail="Forbidden")
    if scope == "everyone":
        if msg.get("from_id") != u["user_id"]:
            raise HTTPException(status_code=403, detail="Only the sender can delete for everyone")
        await db.dm_messages.update_one(
            {"id": message_id},
            {"$set": {"deleted_for_all": True, "body": "", "last_message": None}},
        )
        payload = {"type": "message.deleted", "thread_id": msg.get("thread_id"),
                   "message_id": message_id, "scope": "everyone"}
        for pid in (parts or []):
            try:
                await ws_manager.send(pid, payload)
            except Exception:
                pass
        return {"ok": True, "scope": "everyone"}
    await db.dm_messages.update_one({"id": message_id}, {"$addToSet": {"deleted_for": u["user_id"]}})
    return {"ok": True, "scope": "me"}


@router.patch("/messages/item/{message_id}")
async def edit_message(message_id: str, body: Dict[str, Any] = Body(...),
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """Edit a message's text. Sender only; sets edited_at and broadcasts message.edited."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    new_body = (body.get("body") or "").strip()
    if not new_body:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    msg = await db.dm_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("from_id") != u["user_id"]:
        raise HTTPException(status_code=403, detail="Only the sender can edit this message")
    if msg.get("deleted_for_all"):
        raise HTTPException(status_code=400, detail="Deleted messages can't be edited")
    edited_at = datetime.now(timezone.utc).isoformat()
    await db.dm_messages.update_one({"id": message_id}, {"$set": {"body": new_body, "edited_at": edited_at}})
    thread = await db.dm_threads.find_one({"thread_id": msg.get("thread_id")}, {"_id": 0, "participants": 1})
    parts = thread.get("participants") if thread else (msg.get("thread_id") or "").split("-")
    payload = {"type": "message.edited", "thread_id": msg.get("thread_id"),
               "message_id": message_id, "body": new_body, "edited_at": edited_at}
    for pid in (parts or []):
        try:
            await ws_manager.send(pid, payload)
        except Exception:
            pass
    return {"ok": True, "body": new_body, "edited_at": edited_at}


@router.delete("/messages/thread/{thread_id}")
async def delete_thread(thread_id: str,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    """Delete a whole conversation from the CALLER's inbox only. The other
    participants keep their copy; a later message re-surfaces the thread."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0, "participants": 1})
    parts = thread.get("participants") if thread else thread_id.split("-")
    if u["user_id"] not in (parts or []):
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.dm_threads.update_one({"thread_id": thread_id}, {"$addToSet": {"deleted_for": u["user_id"]}})
    return {"ok": True}


@router.get("/messages/{thread_id}/info")
async def thread_info(thread_id: str,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """Lightweight thread metadata (participants/title) for the chat header.
    Used by mobile to render the group participant list."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0})
    if not thread:
        return {"thread_id": thread_id, "is_group": False, "members": []}
    if u["user_id"] not in (thread.get("participants") or []):
        raise HTTPException(status_code=403, detail="Forbidden")
    members = []
    for pid in thread.get("participants", []):
        s = await db.users.find_one(
            {"user_id": pid},
            {"_id": 0, "user_id": 1, "name": 1, "handle": 1, "avatar": 1, "picture": 1, "subscription_tier": 1},
        )
        if s:
            s["is_free"] = (s.get("subscription_tier") or "free") == "free"
            s.pop("subscription_tier", None)
            members.append(s)
    out = {"thread_id": thread_id, "is_group": bool(thread.get("is_group")),
           "title": thread.get("title"), "members": members}
    if not thread.get("is_group"):
        other_id = next((p for p in thread.get("participants", []) if p != u["user_id"]), None)
        if other_id:
            peer = await _thread_peer_label(thread, other_id)
            out["identity_label"] = peer["label"]
            out["peer_identity"] = peer["peer_identity"]
            out["my_identity"] = ((thread.get("identities") or {}).get(u["user_id"]) or "personal")
    return out


@router.post("/messages/{thread_id}/read")
async def mark_thread_read(thread_id: str,
                           session_token: Optional[str] = Cookie(default=None),
                           authorization: Optional[str] = Header(default=None)):
    """Mark every message in this thread SENT TO the caller as read. Broadcasts
    a `message.read` event to both participants so both sides update live."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0, "participants": 1, "is_group": 1})
    if not thread:
        # Not-yet-created thread: nothing to mark read. Not a permission error.
        return {"ok": True}
    if u["user_id"] not in (thread.get("participants") or []):
        raise HTTPException(status_code=403, detail="Forbidden")
    # Opening the thread clears any "arrived while free" banner notification for it.
    await db.notifications.update_many(
        {"user_id": u["user_id"], "kind": "dm", "read": False, "meta.thread_id": thread_id,
         "$or": [{"meta.locked": True}, {"meta.relocked_at": {"$exists": True}}]},
        {"$set": {"read": True}},
    )
    now = datetime.now(timezone.utc).isoformat()
    if thread and thread.get("is_group"):
        await db.dm_threads.update_one({"thread_id": thread_id}, {"$set": {f"reads.{u['user_id']}": now}})
        return {"ok": True, "group": True}
    res = await db.dm_messages.update_many(
        {"thread_id": thread_id, "to_id": u["user_id"], "read_at": None},
        {"$set": {"read_at": now}},
    )
    if res.modified_count:
        other = next((p for p in (thread.get("participants") or []) if p != u["user_id"]), None)
        try:
            payload = {"type": "message.read", "thread_id": thread_id,
                       "reader_id": u["user_id"], "read_at": now}
            await ws_manager.send(u["user_id"], payload)
            if other:
                await ws_manager.send(other, payload)
        except Exception:
            pass
    return {"ok": True, "marked": res.modified_count}


@router.post("/messages/unlock-banner/ack")
async def unlock_banner_ack(session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"inbox_unlock_ack": True}})
    return {"ok": True}


@router.post("/messages/group")
async def create_group(body: GroupCreate,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    require_interaction(u)
    # Business identity is always one-to-one: a group with a business identity is
    # rejected. Groups are always authored as the personal identity.
    if (body.identity or "personal") == "business":
        raise HTTPException(status_code=400, detail="Business messages are one-to-one. Switch to You to start a group.")
    ids = []
    for pid in body.participant_ids:
        if pid and pid != u["user_id"] and pid not in ids:
            ids.append(pid)
    if len(ids) < 2:
        raise HTTPException(status_code=400, detail="Pick at least 2 people for a group chat")
    if len(ids) > 20:
        raise HTTPException(status_code=400, detail="Groups are limited to 20 people")
    found = await db.users.count_documents({"user_id": {"$in": ids}})
    if found != len(ids):
        raise HTTPException(status_code=404, detail="Some recipients weren't found")
    body_txt = (body.body or "").strip()
    if not body_txt:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    participants = [u["user_id"], *ids]
    title = (body.title or "").strip()[:80] or None
    now = datetime.now(timezone.utc).isoformat()
    thread_id = "group_" + uuid.uuid4().hex
    msg = {"id": str(uuid.uuid4()), "thread_id": thread_id, "from_id": u["user_id"],
           "from_name": u.get("name"), "to_id": None, "body": body_txt, "created_at": now, "read_at": None,
           "author_identity": "personal", "author_business_id": None}
    await db.dm_messages.insert_one(msg)
    msg.pop("_id", None)
    await db.dm_threads.insert_one({
        "thread_id": thread_id, "is_group": True, "title": title, "participants": participants,
        "created_by": u["user_id"], "created_at": now, "updated_at": now,
        "author_identity": "personal",
        "last_message": body_txt, "reads": {u["user_id"]: now},
    })
    locked_members = []
    for pid in ids:
        try:
            await ws_manager.send(pid, {"type": "message", "message": msg})
        except Exception:
            pass
        try:
            locked, nm = await _notify_recipient(u, pid, body_txt, is_group=True,
                                                 group_title=title, thread_id=thread_id)
            if locked and nm:
                locked_members.append(nm)
        except Exception:
            logger.exception("group create notify failed for %s", pid)
    return {"thread_id": thread_id, "is_group": True, "title": title,
            "participants": participants, "locked_members": locked_members}


@router.post("/messages/group/{thread_id}")
async def send_group_message(thread_id: str, body: MessageSend,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0})
    if not thread or not thread.get("is_group"):
        raise HTTPException(status_code=404, detail="Group not found")
    if u["user_id"] not in thread.get("participants", []):
        raise HTTPException(status_code=403, detail="Forbidden")
    require_interaction(u)
    # Business identity can never be added to a group.
    if (body.identity or "personal") == "business":
        raise HTTPException(status_code=400, detail="Business messages are one-to-one. Switch to You to start a group.")
    now = datetime.now(timezone.utc).isoformat()
    msg = {"id": str(uuid.uuid4()), "thread_id": thread_id, "from_id": u["user_id"],
           "from_name": u.get("name"), "to_id": None, "body": body.body, "created_at": now, "read_at": None,
           "author_identity": "personal", "author_business_id": None}
    await db.dm_messages.insert_one(msg)
    msg.pop("_id", None)
    await db.dm_threads.update_one(
        {"thread_id": thread_id},
        {"$set": {"updated_at": now, "last_message": body.body, f"reads.{u['user_id']}": now},
         "$pull": {"deleted_for": {"$in": thread.get("participants", [])}}},
    )
    others = [p for p in thread.get("participants", []) if p != u["user_id"]]
    locked_members = []
    for pid in others:
        try:
            await ws_manager.send(pid, {"type": "message", "message": msg})
        except Exception:
            pass
        try:
            locked, nm = await _notify_recipient(u, pid, body.body, is_group=True,
                                                 group_title=thread.get("title"), thread_id=thread_id)
            if locked and nm:
                locked_members.append(nm)
        except Exception:
            logger.exception("group send notify failed for %s", pid)
    return {**msg, "locked_members": locked_members}


@router.post("/messages/{recipient_id}")
async def send_message(recipient_id: str, body: MessageSend,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if recipient_id == u["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    require_interaction(u)
    # The conversation's channel (personal vs the Boat Pro's business) is decided
    # ONCE when the thread starts and then stored. A reply targets its thread via
    # body.thread_id and the identity is read from the thread, never re-decided
    # from the recipient, so business and personal threads never merge or split.
    rec_user = await db.users.find_one({"user_id": recipient_id}, {"_id": 0})
    _pro = await business_listing_for(u)
    base = "-".join(sorted([u["user_id"], recipient_id]))

    existing = None
    if body.thread_id:
        existing = await db.dm_threads.find_one({"thread_id": body.thread_id}, {"_id": 0})
        if existing and u["user_id"] not in (existing.get("participants") or []):
            existing = None  # not the caller's thread — ignore and start fresh

    if existing:
        thread_id = existing["thread_id"]
        channel_business = thread_id.endswith("~b")
        identities = dict(existing.get("identities") or {})
        # Identity is locked to an existing thread: a business thread always sends
        # as the business and a personal thread as the person. Reject a client
        # that tries to post under a different identity.
        locked_ident = identities.get(u["user_id"], "business" if channel_business and await can_act_as_business(u) else "personal")
        if body.identity in ("personal", "business") and body.identity != locked_ident:
            raise HTTPException(status_code=409, detail="Identity is locked to this conversation")
    else:
        # Starting (or re-opening) a conversation. An explicit thread_id from the
        # client defines the channel (web always sends it). Otherwise (e.g. the
        # New-message composer) decide from the picker/recipient.
        _identity = await resolve_author_identity(u, body.identity, _pro)
        if body.thread_id == base:
            channel_business = False
        elif body.thread_id == f"{base}~b":
            channel_business = True
        else:
            wants_biz = (body.to_identity == "business")
            sender_is_biz = (_identity == "business") and await can_act_as_business(u)
            channel_business = bool(wants_biz or sender_is_biz)
        biz_party = None
        if channel_business:
            if rec_user and await can_act_as_business(rec_user):
                biz_party = recipient_id
            elif await can_act_as_business(u):
                biz_party = u["user_id"]
            else:
                channel_business = False  # neither side can be a business
        thread_id = f"{base}~b" if channel_business else base
        if channel_business:
            identities = {u["user_id"]: ("business" if u["user_id"] == biz_party else "personal"),
                          recipient_id: ("business" if recipient_id == biz_party else "personal")}
        else:
            identities = {u["user_id"]: "personal", recipient_id: "personal"}

    # The sender's identity for THIS message is fixed by the thread, not the picker.
    sender_identity = identities.get(u["user_id"], "personal")
    af = await author_fields(u, sender_identity, _pro)
    now = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": str(uuid.uuid4()), "thread_id": thread_id,
        "from_id": u["user_id"], "from_name": af["author_name"],
        "to_id": recipient_id, "body": body.body, "created_at": now,
        "read_at": None,
        "author_identity": sender_identity, "author_business_id": af["author_business_id"],
    }
    await db.dm_messages.insert_one(msg)
    msg.pop("_id", None)
    await db.dm_threads.update_one(
        {"thread_id": thread_id},
        {
            "$set": {"updated_at": now, "last_message": body.body, "participants": [u["user_id"], recipient_id]},
            "$setOnInsert": {"thread_id": thread_id, "created_at": now, "identities": identities},
            "$pull": {"deleted_for": {"$in": [u["user_id"], recipient_id]}},
        },
        upsert=True,
    )
    await ws_manager.send(recipient_id, {"type": "message", "message": msg})
    # In-app notification for the recipient; free-tier recipients get an
    # upgrade-prompt + email and the message stays locked until they upgrade.
    locked = False
    rname = None
    try:
        business_name = None
        if channel_business:
            biz_uid = next((uid for uid, idn in identities.items() if idn == "business"), None)
            if biz_uid:
                pr = await db.boat_pros.find_one({"user_id": biz_uid}, {"_id": 0, "company_name": 1})
                business_name = (pr or {}).get("company_name")
        pro_involved = (await can_act_as_business(u)) or bool(rec_user and await can_act_as_business(rec_user))
        locked, rname = await _notify_recipient(
            u, recipient_id, body.body, thread_id=thread_id,
            channel="business" if channel_business else "personal",
            business_name=business_name, sender_identity=sender_identity, pro_involved=pro_involved)
    except Exception:
        logger.exception("dm notify failed for %s", recipient_id)
    return {**msg, "recipient_locked": locked, "recipient_name": rname}


@router.websocket("/ws/{user_id}")
async def ws_endpoint(websocket: WebSocket, user_id: str, token: str = Query(default="")):
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session or session.get("user_id") != user_id:
        await websocket.close(code=4401)
        return
    await ws_manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(user_id, websocket)
