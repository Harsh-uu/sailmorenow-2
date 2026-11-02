"""Push subscription + Blog/Forum discussions router.

Two feature groups kept together because they're both small and share the
common admin gating + notify plumbing. Blog posts require admin approval to
publish; forum topics are published immediately. Comments on a discussion
reuse the existing /api/posts/{id}/comments endpoints by using the
discussion's `id` as the post_id (comments collection is generic).
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, Header, HTTPException, Request
from pydantic import BaseModel

from deps import db, current_user_from_token, is_admin, business_listing_for, resolve_author_identity, author_fields, is_paid_subscriber, require_interaction, purge_content, org_status
from constants import PNW_MARKETS, MAX_PHOTO_URL_CHARS
from notifications import notify
import push as push_mod
import base64
import hashlib
import hmac as _hmac
import os as _os
import time as _time

router = APIRouter()
logger = logging.getLogger("smn.hub")


async def _notify_admins_blog_pending(title: str, disc_id: str, author_id: str):
    """In-app only (kind 'blog_pending' is not in the push whitelist, so notify()
    sends no push or email). Notify every admin except the author that a blog
    draft needs review. Body is the blog title only, no author PII."""
    try:
        from routers.reports_router import _admin_user_ids
        for uid in await _admin_user_ids():
            if uid == author_id:
                continue
            await notify(user_id=uid, kind="blog_pending",
                         title="Blog draft awaiting review",
                         body=title,
                         link="/community?tab=blog",
                         meta={"discussion_id": disc_id})
    except Exception:
        logger.exception("notify admins (blog pending) failed")


# ---------- Push notifications ----------
class PushSubscribeBody(BaseModel):
    subscription: Dict[str, Any]  # {endpoint, keys:{p256dh, auth}}


class PushPreferencesBody(BaseModel):
    # per-kind opt-out map: {dm:true, comment:false, ...}. Missing keys default true.
    preferences: Dict[str, bool]
    reminder_timing: Optional[str] = None  # "morning_of" | "day_before" | "both"
    reminder_hour: Optional[int] = None    # 0-23, Pacific time


REMINDER_TIMINGS = ("morning_of", "day_before", "both")


PUSH_KINDS = ("dm", "review_request", "review_completed", "review_withdrawn", "review_reply", "comment", "mention", "crew_join", "blog_approved", "event_reminder", "review_nudge")


@router.get("/push/vapid-public-key")
async def push_vapid_public_key():
    return {"public_key": await push_mod.get_public_key()}


class ReviewNudgePrefBody(BaseModel):
    action: str  # "snooze" | "off" | "on"


@router.post("/review-nudge/preference")
async def review_nudge_preference(body: ReviewNudgePrefBody,
                                  session_token: Optional[str] = Cookie(default=None),
                                  authorization: Optional[str] = Header(default=None)):
    """Member controls the 'leave a review' reminder: snooze 14 days, turn off,
    or turn back on."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.action not in {"snooze", "off", "on"}:
        raise HTTPException(status_code=400, detail="Invalid action")
    prefs = dict(u.get("push_preferences") or {})
    update: Dict[str, Any] = {}
    if body.action == "off":
        prefs["review_nudge"] = False
        update["push_preferences"] = prefs
    elif body.action == "on":
        prefs["review_nudge"] = True
        update["push_preferences"] = prefs
        update["review_nudge_snooze_until"] = None
    else:  # snooze
        from datetime import timedelta as _td
        update["review_nudge_snooze_until"] = (datetime.now(timezone.utc) + _td(days=14)).isoformat()
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    return {"ok": True, "action": body.action}


@router.post("/push/subscribe")
async def push_subscribe(body: PushSubscribeBody,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sub = body.subscription
    if not isinstance(sub, dict) or not sub.get("endpoint"):
        raise HTTPException(status_code=400, detail="Invalid subscription")
    endpoint = sub["endpoint"]
    await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {"user_id": u["user_id"], "subscription": sub,
                  "updated_at": datetime.now(timezone.utc).isoformat()},
         "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/push/unsubscribe")
async def push_unsubscribe(body: PushSubscribeBody,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.push_subscriptions.delete_one(
        {"endpoint": body.subscription.get("endpoint"), "user_id": u["user_id"]}
    )
    return {"ok": True}


@router.post("/push/test")
async def push_test(session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    n = await push_mod.send_push_to_user(u["user_id"], {
        "title": "Sail More Now — push test",
        "body": "You're subscribed. Fair winds!",
        "url": "/",
    })
    return {"sent": n}


@router.get("/push/preferences")
async def push_get_preferences(session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    prefs = u.get("push_preferences") or {}
    return {"kinds": list(PUSH_KINDS), "preferences": {k: prefs.get(k, True) for k in PUSH_KINDS},
            "reminder_timing": u.get("reminder_timing") or "morning_of", "reminder_timings": list(REMINDER_TIMINGS),
            "reminder_hour": u.get("reminder_hour") if u.get("reminder_hour") is not None else 7}


@router.patch("/push/preferences")
async def push_set_preferences(body: PushPreferencesBody,
                                session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    cleaned = {k: bool(v) for k, v in (body.preferences or {}).items() if k in PUSH_KINDS}
    update: Dict[str, Any] = {"push_preferences": cleaned}
    if body.reminder_timing is not None:
        if body.reminder_timing not in REMINDER_TIMINGS:
            raise HTTPException(status_code=400, detail="Invalid reminder_timing")
        update["reminder_timing"] = body.reminder_timing
    if body.reminder_hour is not None:
        if not 0 <= body.reminder_hour <= 23:
            raise HTTPException(status_code=400, detail="Invalid reminder_hour")
        update["reminder_hour"] = body.reminder_hour
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    return {"preferences": {k: cleaned.get(k, True) for k in PUSH_KINDS},
            "reminder_timing": update.get("reminder_timing") or u.get("reminder_timing") or "morning_of",
            "reminder_hour": update.get("reminder_hour", u.get("reminder_hour", 7))}


# ---------- Resend digest webhook (open/click tracking) ----------
def _verify_svix_signature(request: Request, body: bytes) -> bool:
    """Verify a Svix / Resend webhook signature. Returns True if either:
    - RESEND_WEBHOOK_SECRET is unset (dev bypass; logs a warning), OR
    - The `svix-signature` header (format 'v1,<b64_sig> v1,<b64_sig>...') matches
      HMAC-SHA256 over `${svix_id}.${svix_timestamp}.${body}` keyed with the
      raw secret bytes (Svix strips the 'whsec_' prefix + base64-decodes)."""
    secret = _os.environ.get("RESEND_WEBHOOK_SECRET", "").strip()
    if not secret:
        logger.warning("[resend-webhook] RESEND_WEBHOOK_SECRET unset — accepting unsigned event")
        return True
    svix_id = request.headers.get("svix-id", "")
    svix_ts = request.headers.get("svix-timestamp", "")
    svix_sig_header = request.headers.get("svix-signature", "")
    if not (svix_id and svix_ts and svix_sig_header):
        return False
    # Timestamp freshness: reject anything more than 5 minutes off to prevent
    # replay of intercepted signatures (Svix recommendation).
    try:
        skew = abs(int(_time.time()) - int(svix_ts))
        if skew > 300:
            return False
    except (TypeError, ValueError):
        return False
    key_b64 = secret.split("_", 1)[1] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(key_b64)
    except Exception:
        key = secret.encode()
    payload = f"{svix_id}.{svix_ts}.{body.decode('utf-8', errors='replace')}".encode()
    expected = base64.b64encode(_hmac.new(key, payload, hashlib.sha256).digest()).decode()
    for part in svix_sig_header.split():
        if part.startswith("v1,") and _hmac.compare_digest(part[3:], expected):
            return True
    return False


@router.post("/webhooks/resend/digest")
async def resend_digest_webhook(request: Request):
    raw = await request.body()
    if not _verify_svix_signature(request, raw):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        import json as _json
        body = _json.loads(raw or b"{}")
        etype = body.get("type") or ""
        data = body.get("data") or {}
        to_list = data.get("to") or []
        if isinstance(to_list, str):
            to_list = [to_list]
        created_at = data.get("created_at") or datetime.now(timezone.utc).isoformat()
        if not to_list or etype not in {"email.opened", "email.clicked", "email.delivered"}:
            return {"ok": True, "ignored": True}
        field = {"email.opened": "opened_at", "email.clicked": "clicked_at",
                 "email.delivered": "delivered_at"}[etype]
        for email in to_list:
            u = await db.users.find_one(
                {"email": email},
                {"_id": 0, "user_id": 1, "digest_send_history": 1, "digest_engagement": 1},
            )
            if not u or not u.get("digest_send_history"):
                continue
            last_sent = u["digest_send_history"][-1]
            eng = u.get("digest_engagement") or {}
            eng.setdefault(last_sent, {})[field] = created_at
            await db.users.update_one({"user_id": u["user_id"]},
                                       {"$set": {"digest_engagement": eng}})
    except Exception:
        logger.exception("resend webhook failed")
    return {"ok": True}


# ---------- Discussions (blog + forum) ----------
class DiscussionCreate(BaseModel):
    kind: str  # "blog" | "forum"
    title: str
    body: str
    market: Optional[str] = None
    tags: List[str] = []
    image_url: Optional[str] = None
    identity: Optional[str] = None


class DiscussionUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    tags: Optional[List[str]] = None
    image_url: Optional[str] = None


@router.get("/discussions")
async def list_discussions(kind: Optional[str] = None, market: Optional[str] = None,
                            markets: Optional[str] = None,
                            status: Optional[str] = "published",
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    q: Dict[str, Any] = {}
    if kind in {"blog", "forum"}:
        q["kind"] = kind
    _mk = [m.strip() for m in (markets or "").split(",") if m.strip()]
    if _mk:
        q["market"] = {"$in": _mk + [None]}
    elif market and market != "all":
        q["market"] = {"$in": [market, None]}
    u = await current_user_from_token(session_token, authorization)
    admin = bool(u and is_admin(u))
    # Only admins can list drafts / pending; everyone else sees published only.
    if status and status != "all":
        if status in {"draft", "pending"} and not admin:
            raise HTTPException(status_code=403, detail="Admin only")
        q["status"] = status
    else:
        q["status"] = "published"
    # Published blog sorts by created_at (the authoring date) so posts appear in
    # the order they were written, not the order an admin approved them. Forum
    # keeps published_at, which equals created_at for auto-published topics.
    # Pending/draft lists have null published_at, so they sort by created_at too.
    if q.get("status") == "published":
        sort_field = "created_at" if kind == "blog" else "published_at"
    else:
        sort_field = "created_at"
    if not admin:
        q["hidden_pending_review"] = {"$ne": True}
    docs = await db.discussions.find(q, {"_id": 0}).sort(sort_field, -1).to_list(200)
    disc_ids = [d.get("id") for d in docs if d.get("id")]
    if disc_ids:
        cursor = db.comments.aggregate([
            {"$match": {"post_id": {"$in": disc_ids}}},
            {"$group": {"_id": "$post_id", "n": {"$sum": 1}}},
        ])
        counts = {row["_id"]: row["n"] async for row in cursor}
        for d in docs:
            d["comment_count"] = counts.get(d.get("id"), 0)
    author_ids = list({d.get("author_id") for d in docs if d.get("author_id")})
    if author_ids:
        rows = {r["user_id"]: r async for r in db.users.find(
            {"user_id": {"$in": author_ids}}, {"_id": 0, "user_id": 1, "handle": 1, "name": 1})}
        for d in docs:
            row = rows.get(d.get("author_id")) or {}
            d["author_handle"] = row.get("handle")
            # Business-identity posts keep their stored business name; personal
            # posts show the live display name, falling back to the stored name.
            if d.get("author_identity") != "business":
                d["author_name"] = row.get("name") or d.get("author_name")
    uid = u["user_id"] if u else None
    for d in docs:
        mine = bool(uid and d.get("author_id") == uid)
        d["can_edit"] = mine
        d["can_delete"] = mine
    return docs


@router.get("/discussions/{disc_id}")
async def get_discussion(disc_id: str,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    d = await db.discussions.find_one({"id": disc_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d.get("hidden_pending_review") or d.get("status") != "published":
        u = await current_user_from_token(session_token, authorization)
        if not u or (d.get("author_id") != u["user_id"] and not is_admin(u)):
            raise HTTPException(status_code=404, detail="Not found")
    d["comment_count"] = await db.comments.count_documents({"post_id": disc_id})
    if d.get("author_id") and d.get("author_identity") != "business":
        au = await db.users.find_one({"user_id": d["author_id"]}, {"_id": 0, "handle": 1, "name": 1})
        d["author_handle"] = (au or {}).get("handle")
        d["author_name"] = (au or {}).get("name") or d.get("author_name")
    _viewer = await current_user_from_token(session_token, authorization)
    _mine = bool(_viewer and d.get("author_id") == _viewer["user_id"])
    d["can_edit"] = _mine
    d["can_delete"] = _mine
    return d


@router.post("/discussions")
async def create_discussion(body: DiscussionCreate,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.kind not in {"blog", "forum"}:
        raise HTTPException(status_code=400, detail="kind must be 'blog' or 'forum'")
    if not body.title.strip() or not body.body.strip():
        raise HTTPException(status_code=400, detail="Title and body are required")
    if body.market and body.market != "all" and body.market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail=f"Invalid market: {body.market}")
    if len(body.image_url or "") > MAX_PHOTO_URL_CHARS:
        raise HTTPException(status_code=400, detail="Photo too large")
    # Free individuals cannot create forum topics or blog posts (same gate as
    # feed posts). Organizations: only Community Partner / Founding Partner can
    # post forums or blogs; free organizations are blocked. Paid members and
    # Boat Pros (paid tier) are unaffected.
    if u.get("account_type") == "partner":
        if org_status(u) == "free":
            raise HTTPException(status_code=403, detail={
                "code": "upgrade_required",
                "message": "Free organizations cannot post forums or blogs. Community Partner organizations can.",
            })
    elif not is_paid_subscriber(u):
        require_interaction(u)
    now = datetime.now(timezone.utc)
    # Forum topics publish immediately; blog posts require admin approval.
    status = "published" if body.kind == "forum" else "pending"
    _pro = await business_listing_for(u)
    _identity = await resolve_author_identity(u, body.identity, _pro)
    doc = {
        "id": str(uuid.uuid4()),
        "kind": body.kind,
        "title": body.title.strip()[:200],
        "body": body.body.strip()[:20000],
        "author_id": u["user_id"],
        **(await author_fields(u, _identity, _pro)),
        "market": body.market,
        "tags": [t.strip()[:40] for t in (body.tags or []) if t.strip()][:8],
        "image_url": body.image_url or None,
        "status": status,
        "allow_comments": True,
        "created_at": now.isoformat(),
        "published_at": now.isoformat() if status == "published" else None,
        "approved_by": None,
    }
    await db.discussions.insert_one(doc)
    doc.pop("_id", None)
    if status == "pending" and body.kind == "blog":
        await _notify_admins_blog_pending(doc["title"], doc["id"], u["user_id"])
    return doc


@router.post("/discussions/{disc_id}/approve")
async def approve_discussion(disc_id: str,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u or not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    d = await db.discussions.find_one({"id": disc_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.discussions.update_one(
        {"id": disc_id},
        {"$set": {"status": "published", "published_at": now,
                  "approved_by": u["user_id"]}},
    )
    try:
        if d.get("author_id") and d["author_id"] != u["user_id"]:
            await notify(user_id=d["author_id"], kind="blog_approved",
                          title=f"Your blog post '{d.get('title')}' is live",
                          body="Approved by an admin. Head to Community Hub to see it.",
                          link="/community-hub", meta={"discussion_id": disc_id})
    except Exception:
        logger.exception("blog_approved notify failed")
    return {"ok": True}


@router.patch("/discussions/{disc_id}")
async def edit_discussion(disc_id: str, body: DiscussionUpdate,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Author edits their own forum topic or blog post: title, body, tags and
    cover image. kind, market, author, identity and created_at are not editable.
    Editing a PUBLISHED blog keeps it published (no re-review, no admin notify);
    a still-pending blog just updates the draft. Plan gating is NOT applied to
    editing content a user already owns."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    d = await db.discussions.find_one({"id": disc_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d.get("author_id") != u["user_id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own post")
    changes: Dict[str, Any] = {}
    text_changed = False
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(status_code=400, detail="Title is required")
        changes["title"] = t[:200]
        text_changed = True
    if body.body is not None:
        b = body.body.strip()
        if not b:
            raise HTTPException(status_code=400, detail="Body is required")
        changes["body"] = b[:20000]
        text_changed = True
    if body.tags is not None:
        changes["tags"] = [tg.strip()[:40] for tg in (body.tags or []) if tg.strip()][:8]
    if body.image_url is not None:
        if len(body.image_url or "") > MAX_PHOTO_URL_CHARS:
            raise HTTPException(status_code=400, detail="Photo too large")
        changes["image_url"] = body.image_url or None
    if not changes:
        return d
    if text_changed:
        changes["edited_at"] = datetime.now(timezone.utc).isoformat()
    await db.discussions.update_one({"id": disc_id}, {"$set": changes})
    return await db.discussions.find_one({"id": disc_id}, {"_id": 0})


@router.delete("/discussions/{disc_id}")
async def delete_discussion(disc_id: str,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    d = await db.discussions.find_one({"id": disc_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d.get("author_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Not yours")
    await db.discussions.delete_one({"id": disc_id})
    await purge_content("discussion", disc_id, u["user_id"])
    return {"ok": True}
