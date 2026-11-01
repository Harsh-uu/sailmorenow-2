"""Review disputes, self-removal, private attachments and the admin decision
queue (REVIEWS-4). Policy copy lives in review_copy.py (doc 92 B/C verbatim).

A disputed review STAYS live and counted until a decision is made. Removing one
side's review never touches the other side's review.
"""
from __future__ import annotations
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, Header, HTTPException, UploadFile, File, Request
from pydantic import BaseModel, Field
from starlette.responses import Response

from deps import db, current_user_from_token, is_admin, rate_limit
from notifications import notify
from storage import put_object, get_object, APP_NAME
import review_copy as RC
import mailer

router = APIRouter()
logger = logging.getLogger("smn.disputes")

LIVE_STATUSES = ("revealed", "accepted", "auto_revealed")


class DisputeCreate(BaseModel):
    session_id: Optional[str] = None       # two-way review session
    review_author_id: Optional[str] = None  # author of the disputed review (two-way)
    review_id: Optional[str] = None         # one-way org review id
    reason: str
    explanation: str = Field(default="", max_length=RC.EXPLANATION_MAX)


class DisputeDecision(BaseModel):
    decision: str                           # stays | removed | kept_with_details_removed
    decision_reason: str = Field(min_length=1, max_length=2000)   # admin's INTERNAL note
    removal_reason_code: Optional[str] = None  # required when decision == removed (admin, not self-removal)


class DisputeContest(BaseModel):
    explanation: str = Field(min_length=1, max_length=RC.EXPLANATION_MAX)


class FlagFilerBody(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


# ------------------------------ helpers --------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _auth(session_token, authorization):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


async def _require_admin(session_token, authorization):
    u = await _auth(session_token, authorization)
    if not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    return u


def _review_key(d: Dict[str, Any]) -> Dict[str, Any]:
    """Mongo match for all dispute requests about the SAME review."""
    if d.get("review_kind") == "one_way":
        return {"review_kind": "one_way", "review_id": d["review_id"]}
    return {"review_kind": "two_way", "session_id": d["session_id"], "review_author_id": d["review_author_id"]}


async def _resolve_target(body: DisputeCreate, user: Dict[str, Any]) -> Dict[str, Any]:
    """Locate the disputed review, confirm the caller may file, and return a
    normalized context dict. Raises 403/404 otherwise."""
    uid = user["user_id"]
    self_removal = body.reason == "remove_my_own_review"

    if body.review_id:  # one-way org review
        rv = await db.reviews.find_one({"id": body.review_id}, {"_id": 0})
        if not rv:
            raise HTTPException(status_code=404, detail="Review not found")
        target_user_id = rv.get("target_id")
        author_id = rv.get("author_id")
        ctx = {"review_kind": "one_way", "review_id": body.review_id, "session_id": None,
               "review_author_id": author_id, "target_user_id": target_user_id,
               "pending_at_file": False, "review_live_at": rv.get("created_at")}
        if self_removal and uid == author_id:
            ctx["filer_role"] = "reviewer_self_removal"
        elif uid == target_user_id or is_admin(user):
            ctx["filer_role"] = "org_admin"
        else:
            raise HTTPException(status_code=403, detail="You can't dispute this review.")
    else:  # two-way session review
        if not body.session_id or not body.review_author_id:
            raise HTTPException(status_code=400, detail="session_id and review_author_id are required")
        s = await db.review_sessions.find_one({"id": body.session_id}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Review not found")
        rv = await db.mutual_reviews.find_one({"session_id": body.session_id, "author_id": body.review_author_id}, {"_id": 0})
        if not rv:
            raise HTTPException(status_code=404, detail="Review not found")
        is_live = s.get("status") in LIVE_STATUSES
        is_pending = s.get("status") == "pending"
        ctx = {"review_kind": "two_way", "session_id": body.session_id, "review_id": None,
               "review_author_id": body.review_author_id, "target_user_id": rv.get("target_id"),
               "pending_at_file": is_pending, "review_live_at": s.get("revealed_at")}
        if self_removal and uid == body.review_author_id:
            if not is_live:
                raise HTTPException(status_code=409, detail="You can only remove a review once it is live.")
            ctx["filer_role"] = "reviewer_self_removal"
        elif uid == rv.get("target_id"):
            ctx["filer_role"] = "reviewee"
        else:
            raise HTTPException(status_code=403, detail="You can't dispute this review.")

    # Self-removal must be within 30 days of the review going live.
    if ctx["filer_role"] == "reviewer_self_removal":
        live_at = ctx.get("review_live_at")
        if not live_at:
            raise HTTPException(status_code=409, detail="You can only remove a review once it is live.")
        try:
            dt = datetime.fromisoformat(live_at)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(status_code=409, detail="You can only remove a review once it is live.")
        if datetime.now(timezone.utc) - dt > timedelta(days=RC.SELF_REMOVAL_DAYS):
            raise HTTPException(status_code=409, detail=f"The {RC.SELF_REMOVAL_DAYS}-day window to remove your review has passed.")
    return ctx


async def _review_snapshot(d: Dict[str, Any]) -> Dict[str, Any]:
    """Read-time snapshot of the disputed review (text + ratings) for the queue."""
    if d.get("review_kind") == "one_way":
        rv = await db.reviews.find_one({"id": d.get("review_id")}, {"_id": 0}) or {}
        return {"comment": rv.get("comment"), "ratings": {"overall": rv.get("rating")}, "exists": bool(rv)}
    rv = await db.mutual_reviews.find_one({"session_id": d.get("session_id"), "author_id": d.get("review_author_id")}, {"_id": 0}) or {}
    return {"comment": rv.get("comment"), "ratings": rv.get("ratings") or {}, "exists": bool(rv)}


async def _name(uid: str) -> str:
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "name": 1})
    return (u or {}).get("name") or "a member"


async def _email_for(uid: str) -> Optional[Dict[str, str]]:
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "email": 1, "name": 1})
    if u and u.get("email"):
        return {"email": u["email"], "name": u.get("name") or "there"}
    return None


def _base_url() -> str:
    """Single configurable app base URL for emails + absolute links. Set
    APP_BASE_URL to the preview now and the live domain at publish."""
    return (os.environ.get("APP_BASE_URL") or os.environ.get("APP_PUBLIC_URL")
            or "https://app.sailmorenow.com").rstrip("/")


def _coc_url() -> str:
    return _base_url() + "/community-guidelines"


def _dest(d: Dict[str, Any], uid: str) -> str:
    """Working 'See the details' link. Everyone involved lands on the Reviews
    page Disputes tab, where the filer sees their request and the other party
    sees the safe 'about a review you are part of' entry."""
    return "/reviews?tab=disputes"


async def _notice(uid: str, body: str, dest: str, heading: str, subject: str):
    """Send one approved notice in-app AND by email, each ending with the
    Code of Conduct link. Fails soft."""
    text = RC.with_coc(body)
    coc = _coc_url()
    try:
        await notify(user_id=uid, kind="review_completed", title=heading, body=text,
                     link=dest, meta={"code_of_conduct_url": coc})
    except Exception:
        logger.exception("dispute notice (in-app) failed uid=%s", uid)
    try:
        em = await _email_for(uid)
        if em:
            html = mailer.dispute_notice_email_html(recipient_name=em["name"], body=text, heading=heading,
                                                    app_url=_base_url(), details_path=dest, coc_url=coc)
            await mailer.send_email(recipient_email=em["email"], subject=subject, html_content=html)
    except Exception:
        logger.exception("dispute notice (email) failed uid=%s", uid)


async def _admin_alert_dispute(d: Dict[str, Any], *, title: str, line: str):
    """One admin email alert for a dispute event, with a deep link to the exact
    item in the moderation queue. Distinct wording per path so the admin can see
    at a glance whether it is a dispute, a self-removal, or a contest. Fails soft
    but logs loudly so a swallowed send error is still visible in the logs."""
    try:
        from admin_notify import admin_notify
        await admin_notify(
            db, kind="dispute",
            subject=f"Sail More Now: {title[0].lower() + title[1:]}",
            title=title, lines=[line],
            deep_link_path=f"/admin/moderation?dispute={d.get('id')}")
    except Exception:
        logger.exception("admin alert (dispute) failed id=%s title=%r", d.get("id"), title)


async def _notify_filed(d: Dict[str, Any]):
    """On filing (not self-removal): tell the filer and the other person a
    dispute exists. Both notices end with the Code of Conduct link."""
    filer = d["filed_by"]
    reviewer = d.get("review_author_id")
    target = d.get("target_user_id")
    other = target if filer == reviewer else reviewer
    await _notice(filer, RC.NOTICE_FILED_FILER, _dest(d, filer),
                  "We got your review request", "We received your review request")
    if other and other != filer:
        await _notice(other, RC.NOTICE_FILED_OTHER, _dest(d, other),
                      "A review you're part of was reported", "A review you're part of was reported")
    await _admin_alert_dispute(
        d, title="New review dispute filed",
        line="A member filed a review dispute that needs a moderator decision.")


# ------------------------------ meta -----------------------------------------
@router.get("/review-disputes/meta")
async def dispute_meta():
    return {
        "reasons": [{"code": c, "label": RC.REASON_LABELS[c]} for c in RC.REASONS],
        "removal_reasons": [{"code": c, "label": RC.REMOVAL_REASON_MESSAGES[c]} for c in RC.REMOVAL_REASON_CODES],
        "explanation_max": RC.EXPLANATION_MAX,
        "max_attachments": RC.MAX_ATTACHMENTS,
        "max_image_mb": RC.MAX_IMAGE_MB,
        "max_pdf_mb": RC.MAX_PDF_MB,
        "self_removal_days": RC.SELF_REMOVAL_DAYS,
        "attachment_notice": RC.ATTACHMENT_NOTICE,
        "attachment_help": RC.ATTACHMENT_HELP,
        "decision_timeline": RC.DECISION_TIMELINE,
        "secondary_email": RC.SECONDARY_EMAIL,
        "secondary_email_note": RC.SECONDARY_EMAIL_NOTE,
        "not_a_reason": RC.NOT_A_REASON,
        "self_removal_note": RC.SELF_REMOVAL_NOTE,
        "misuse_note": RC.MISUSE_NOTE,
        "policy": {"section_b": RC.SECTION_B_REVIEWS_POLICY, "section_c": RC.SECTION_C_DISPUTE_PROCESS},
    }


# ------------------------------ file -----------------------------------------
@router.post("/review-disputes")
async def file_dispute(body: DisputeCreate, request: Request,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    user = await _auth(session_token, authorization)
    if body.reason not in RC.REASON_LABELS:
        raise HTTPException(status_code=400, detail="Unknown reason")
    rate_limit("dispute_file", request, limit=RC.MAX_DISPUTES_PER_DAY, window=86400,
               detail="You've filed too many disputes today. Please try again tomorrow.")
    ctx = await _resolve_target(body, user)

    # Per-filer daily cap (per user, not just IP).
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    todays = await db.review_disputes.count_documents({"filed_by": user["user_id"], "created_at": {"$gte": day_ago}})
    if todays >= RC.MAX_DISPUTES_PER_DAY:
        raise HTTPException(status_code=429, detail="You've filed too many disputes today. Please try again tomorrow.")

    rk = _review_key(ctx)
    # One OPEN dispute per review per filer.
    if await db.review_disputes.find_one({**rk, "filed_by": user["user_id"], "status": "open"}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="You already have an open request for this review.")
    # Max 2 requests total for the same review.
    total = await db.review_disputes.count_documents(rk)
    if total >= RC.MAX_REQUESTS_PER_REVIEW:
        raise HTTPException(status_code=409, detail="We accept no more than two requests for the same review.")

    doc = {
        "id": str(uuid.uuid4()),
        "review_kind": ctx["review_kind"], "session_id": ctx["session_id"],
        "review_author_id": ctx["review_author_id"], "review_id": ctx["review_id"],
        "target_user_id": ctx["target_user_id"], "pending_at_file": ctx["pending_at_file"],
        "filed_by": user["user_id"], "filer_role": ctx["filer_role"],
        "reason": body.reason, "explanation": (body.explanation or "").strip(),
        "attachments": [], "status": "open", "decision": None, "decision_reason": None,
        "decided_by": None, "decided_at": None, "contest_count": total + 1, "is_contest": False,
        "flagged_filer": False,
        "history": [{"action": "filed", "by": user["user_id"], "role": ctx["filer_role"], "reason": body.reason, "at": _now()}],
        "created_at": _now(), "updated_at": _now(),
    }
    await db.review_disputes.insert_one(doc)
    doc.pop("_id", None)
    # Notify admins in-app (reuse generic notify to each admin).
    try:
        async for a in db.users.find({"platform_role": "admin"}, {"_id": 0, "user_id": 1}):
            await notify(user_id=a["user_id"], kind="comment", title="New review dispute",
                         body=f"{RC.REASON_LABELS[body.reason]}. Reviews follow our Code of Conduct.", link="/admin/moderation",
                         meta={"dispute_id": doc["id"], "code_of_conduct_url": _coc_url()})
    except Exception:
        logger.exception("admin dispute notify failed")
    # Notify the two people involved (skip for a reviewer's own self-removal
    # request, which has its own notices only once a removal is approved). The
    # admin, however, is alerted on EVERY filing path - including self-removal -
    # so no admin-needed request is silently left in the queue (EMAIL-FIX-3).
    if ctx["filer_role"] != "reviewer_self_removal":
        await _notify_filed(doc)
    else:
        await _admin_alert_dispute(
            doc, title="Review self-removal request",
            line="A reviewer asked to remove their own review. It stays live until a moderator decides.")
    return {"ok": True, "dispute": _public_dispute(doc)}


def _public_dispute(d: Dict[str, Any]) -> Dict[str, Any]:
    """Filer-facing view (no internal decision_reason)."""
    return {
        "id": d["id"], "reason": d["reason"], "reason_label": RC.REASON_LABELS.get(d["reason"]),
        "explanation": d.get("explanation"), "status": d["status"],
        "decision": d.get("decision"), "decision_label": RC.DECISION_LABELS.get(d.get("decision")),
        "attachment_count": len(d.get("attachments") or []),
        "is_contest": d.get("is_contest", False), "contest_count": d.get("contest_count"),
        "created_at": d.get("created_at"), "decided_at": d.get("decided_at"),
        "review_kind": d.get("review_kind"), "session_id": d.get("session_id"),
        "review_author_id": d.get("review_author_id"), "review_id": d.get("review_id"),
    }


# ------------------------------ attachments ----------------------------------
def _sniff(data: bytes) -> Optional[str]:
    """Return a safe content-type from the file's magic bytes, or None."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:5] == b"%PDF-":
        return "application/pdf"
    return None


@router.post("/review-disputes/{dispute_id}/attachments")
async def add_attachment(dispute_id: str, request: Request, file: UploadFile = File(...),
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    user = await _auth(session_token, authorization)
    rate_limit("dispute_attach", request, limit=30, window=3600)
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    if d["filed_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not allowed")
    if d["status"] != "open":
        raise HTTPException(status_code=409, detail="This dispute is closed.")
    if len(d.get("attachments") or []) >= RC.MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"You can attach up to {RC.MAX_ATTACHMENTS} files.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    kind = _sniff(data)
    if kind is None:
        raise HTTPException(status_code=400, detail="Attach a JPG, PNG, WebP image or a PDF.")
    if kind == "application/pdf":
        if len(data) > RC.MAX_PDF_MB * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"PDF must be {RC.MAX_PDF_MB}MB or smaller.")
        ext = "pdf"
    else:
        if len(data) > RC.MAX_IMAGE_MB * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"Image must be {RC.MAX_IMAGE_MB}MB or smaller.")
        ext = RC.ALLOWED_IMAGE_TYPES[kind]
    idx = len(d.get("attachments") or [])
    # PRIVATE path: never surfaced as /api/files/...; fetched only through the
    # authenticated endpoint below.
    path = f"{APP_NAME}/private/disputes/{dispute_id}/{uuid.uuid4().hex}.{ext}"
    import asyncio
    try:
        result = await asyncio.to_thread(put_object, path, data, kind)
    except Exception:
        logger.exception("dispute attachment upload failed")
        raise HTTPException(status_code=502, detail="Couldn't save the file. Try again.")
    meta = {"path": result.get("path", path), "filename": (file.filename or f"attachment-{idx+1}.{ext}")[:200],
            "content_type": kind, "size": len(data), "uploaded_at": _now()}
    await db.review_disputes.update_one({"id": dispute_id}, {"$push": {"attachments": meta}, "$set": {"updated_at": _now()}})
    return {"ok": True, "index": idx, "attachment": {"filename": meta["filename"], "content_type": kind, "size": meta["size"]}}


@router.get("/review-disputes/{dispute_id}/attachments/{index}")
async def get_attachment(dispute_id: str, index: int,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    user = await _auth(session_token, authorization)
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d["filed_by"] != user["user_id"] and not is_admin(user):
        raise HTTPException(status_code=403, detail="Not allowed")
    atts = d.get("attachments") or []
    if index < 0 or index >= len(atts):
        raise HTTPException(status_code=404, detail="Not found")
    att = atts[index]
    import asyncio
    try:
        data, ct = await asyncio.to_thread(get_object, att["path"])
    except Exception:
        logger.exception("dispute attachment fetch failed")
        raise HTTPException(status_code=404, detail="Not found")
    headers = {"Content-Disposition": f'inline; filename="{att.get("filename", "attachment")}"',
               "Cache-Control": "private, no-store"}
    return Response(content=data, media_type=att.get("content_type") or ct, headers=headers)


# ------------------------------ mine -----------------------------------------
@router.get("/review-disputes/mine")
async def my_disputes(session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    user = await _auth(session_token, authorization)
    uid = user["user_id"]
    rows = await db.review_disputes.find({"filed_by": uid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    out = []
    for d in rows:
        pub = _public_dispute(d)
        total = await db.review_disputes.count_documents(_review_key(d))
        pub["can_contest"] = bool(
            d.get("decision") == "removed" and not d.get("is_contest")
            and d.get("review_author_id") == uid and total < RC.MAX_REQUESTS_PER_REVIEW)
        out.append(pub)
    # Disputes that INVOLVE me but I did not file (I am the reviewer or the
    # reviewee). SAFE fields only: never the filer, their explanation or files.
    about_rows = await db.review_disputes.find(
        {"filed_by": {"$ne": uid}, "$or": [{"review_author_id": uid}, {"target_user_id": uid}]},
        {"_id": 0}).sort("created_at", -1).to_list(100)
    about = []
    for d in about_rows:
        is_my_review = d.get("review_author_id") == uid
        total = await db.review_disputes.count_documents(_review_key(d))
        entry = {
            "id": d["id"], "status": d.get("status"),
            "decision": d.get("decision"), "decision_label": RC.DECISION_LABELS.get(d.get("decision")),
            "review_kind": d.get("review_kind"), "session_id": d.get("session_id"), "review_id": d.get("review_id"),
            "is_about_my_review": is_my_review,
            "created_at": d.get("created_at"), "decided_at": d.get("decided_at"),
            "restored": d.get("restored", False),
            # Standard reason only when MY review was removed (never the filer's note/explanation).
            "removal_reason": (RC.REMOVAL_REASON_MESSAGES.get(d.get("removal_reason_code"))
                               if (is_my_review and d.get("decision") == "removed" and not d.get("restored")) else None),
            "can_contest": bool(is_my_review and d.get("decision") == "removed" and not d.get("restored")
                                and not d.get("is_contest") and total < RC.MAX_REQUESTS_PER_REVIEW),
        }
        about.append(entry)
    return {"disputes": out, "about_me": about}


@router.post("/review-disputes/{dispute_id}/contest")
async def contest_dispute(dispute_id: str, body: DisputeContest,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    user = await _auth(session_token, authorization)
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    if d.get("review_author_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the reviewer can contest this.")
    if d.get("decision") != "removed" or d.get("is_contest"):
        raise HTTPException(status_code=409, detail="There is nothing to contest.")
    rk = _review_key(d)
    total = await db.review_disputes.count_documents(rk)
    if total >= RC.MAX_REQUESTS_PER_REVIEW:
        raise HTTPException(status_code=409, detail="We accept no more than two requests for the same review.")
    doc = {
        "id": str(uuid.uuid4()),
        "review_kind": d["review_kind"], "session_id": d.get("session_id"),
        "review_author_id": d.get("review_author_id"), "review_id": d.get("review_id"),
        "target_user_id": d.get("target_user_id"), "pending_at_file": False,
        "filed_by": user["user_id"], "filer_role": "reviewer_self_removal",
        "reason": "other_rule_violation", "explanation": body.explanation.strip(),
        "attachments": [], "status": "open", "decision": None, "decision_reason": None,
        "decided_by": None, "decided_at": None, "contest_count": total + 1, "is_contest": True,
        "contest_of": d["id"], "flagged_filer": False,
        "history": [{"action": "contested", "by": user["user_id"], "at": _now()}],
        "created_at": _now(), "updated_at": _now(),
    }
    await db.review_disputes.insert_one(doc)
    doc.pop("_id", None)
    # A contest reopens the review for another decision - alert the admin with a
    # deep link so it is not silently left in the queue (EMAIL-FIX-3).
    await _admin_alert_dispute(
        doc, title="Review removal contested",
        line="A reviewer contested a removed review. It needs another moderator decision.")
    return {"ok": True, "dispute": _public_dispute(doc)}


# ------------------------------ admin queue ----------------------------------
@router.get("/admin/review-disputes")
async def admin_list_disputes(status: Optional[str] = None, reason: Optional[str] = None,
                              limit: int = 100, offset: int = 0,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    await _require_admin(session_token, authorization)
    q: Dict[str, Any] = {}
    if status in ("open", "decided"):
        q["status"] = status
    if reason in RC.REASON_LABELS:
        q["reason"] = reason
    limit = max(1, min(int(limit), 200))
    rows = await db.review_disputes.find(q, {"_id": 0}).sort("created_at", -1).skip(max(0, offset)).limit(limit).to_list(limit)
    out = []
    for d in rows:
        snap = await _review_snapshot(d)
        held = False
        if d.get("review_kind") == "two_way" and d.get("session_id"):
            s = await db.review_sessions.find_one({"id": d["session_id"]}, {"_id": 0, "held": 1, "mutual_pair": 1, "status": 1})
            if s:
                held = bool(s.get("held"))
                d["_mutual_pair"] = bool(s.get("mutual_pair"))
                d["_session_status"] = s.get("status")
        out.append({
            **_public_dispute(d),
            "filed_by": d["filed_by"], "filer_name": await _name(d["filed_by"]),
            "filer_role": d.get("filer_role"), "target_user_id": d.get("target_user_id"),
            "target_name": await _name(d.get("target_user_id")) if d.get("target_user_id") else None,
            "pending_at_file": d.get("pending_at_file"),
            "decision_reason": d.get("decision_reason"), "decided_by": d.get("decided_by"),
            "flagged_filer": d.get("flagged_filer", False), "restored": d.get("restored", False),
            "review": snap, "mutual_pair": d.get("_mutual_pair", False),
            "session_status": d.get("_session_status"), "held": held,
            "attachments": [{"index": i, "filename": a.get("filename"), "content_type": a.get("content_type"), "size": a.get("size")}
                            for i, a in enumerate(d.get("attachments") or [])],
            "history": d.get("history") or [],
        })
    total = await db.review_disputes.count_documents(q)
    return {"count": total, "limit": limit, "offset": offset, "disputes": out}


async def _notify_decision(d: Dict[str, Any], decision: str, removal_reason_code: Optional[str]):
    """Approved, neutral in-app + email notices to each party. The reviewer sees
    a STANDARD removal reason only; the admin's internal note is never shared."""
    filer = d["filed_by"]
    reviewer = d.get("review_author_id")
    target = d.get("target_user_id")
    other = target if filer == reviewer else reviewer
    self_removal = d.get("reason") == "remove_my_own_review"
    heading = "A decision about a review"
    subject = "Your review dispute: a decision"

    if decision == "kept_with_details_removed":
        for uid in {x for x in (filer, reviewer, target) if x}:
            await _notice(uid, RC.NOTICE_DETAILS_REMOVED_BOTH, _dest(d, uid), heading, subject)
        return

    if decision == "removed":
        if self_removal:
            # Reviewer asked to remove their own review. No reason is given.
            if reviewer:
                await _notice(reviewer, RC.NOTICE_SELF_REMOVED_REVIEWER, _dest(d, reviewer), heading, subject)
            if other and other != reviewer:
                await _notice(other, RC.NOTICE_SELF_REMOVED_OTHER, _dest(d, other), heading, subject)
            return
        # Admin removal: filer told it was removed; reviewer told the standard reason.
        await _notice(filer, RC.NOTICE_REMOVED_FILER, _dest(d, filer), heading, subject)
        if reviewer and reviewer != filer:
            reason_text = RC.REMOVAL_REASON_MESSAGES.get(removal_reason_code or "other_rule_violation",
                                                         RC.REMOVAL_REASON_MESSAGES["other_rule_violation"])
            body = RC.NOTICE_REMOVED_REVIEWER_PREFIX + reason_text + RC.NOTICE_REMOVED_REVIEWER_SUFFIX
            await _notice(reviewer, body, _dest(d, reviewer), heading, subject)
        return

    # decision == "stays"
    await _notice(filer, RC.NOTICE_STAYS_FILER, _dest(d, filer), heading, subject)
    if reviewer and reviewer != filer:
        await _notice(reviewer, RC.NOTICE_STAYS_REVIEWER, _dest(d, reviewer), heading, subject)


@router.post("/admin/review-disputes/{dispute_id}/decide")
async def decide_dispute(dispute_id: str, body: DisputeDecision,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    admin = await _require_admin(session_token, authorization)
    if body.decision not in RC.DECISION_LABELS:
        raise HTTPException(status_code=400, detail="Unknown decision")
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    if d["status"] == "decided":
        raise HTTPException(status_code=409, detail="This dispute is already decided.")

    # A standard removal reason is required for an admin removal (not self-removal).
    self_removal = d.get("reason") == "remove_my_own_review"
    if body.decision == "removed" and not self_removal:
        if body.removal_reason_code not in RC.REMOVAL_REASON_MESSAGES:
            raise HTTPException(status_code=400, detail="Pick a standard removal reason.")

    if body.decision == "removed":
        # HIDE, do not delete: keep the record + text internally, stop it counting.
        rm = {"removed": True, "removed_at": _now(), "removed_by": admin["user_id"],
              "removed_reason_code": body.removal_reason_code, "removed_via_dispute": dispute_id, "restored": False}
        if d["review_kind"] == "one_way":
            await db.reviews.update_one({"id": d["review_id"]}, {"$set": rm})
        else:
            await db.mutual_reviews.update_one({"session_id": d["session_id"], "author_id": d["review_author_id"]}, {"$set": rm})
            remaining = await db.mutual_reviews.count_documents({"session_id": d["session_id"], "removed": {"$ne": True}})
            if remaining == 0:
                await db.review_sessions.update_one({"id": d["session_id"]}, {"$set": {"status": "removed", "revealed": False}})
            # The OTHER side's review is intentionally left live.
    elif body.decision == "kept_with_details_removed":
        if d["review_kind"] == "one_way":
            await db.reviews.update_one({"id": d["review_id"]}, {"$set": {"comment": RC.REDACTED_COMMENT, "redacted": True}})
        else:
            await db.mutual_reviews.update_one({"session_id": d["session_id"], "author_id": d["review_author_id"]},
                                               {"$set": {"comment": RC.REDACTED_COMMENT, "redacted": True}})

    await db.review_disputes.update_one({"id": dispute_id}, {"$set": {
        "status": "decided", "decision": body.decision, "decision_reason": body.decision_reason,
        "removal_reason_code": body.removal_reason_code,
        "decided_by": admin["user_id"], "decided_at": _now(), "updated_at": _now()},
        "$push": {"history": {"action": "decided", "by": admin["user_id"], "decision": body.decision,
                              "reason": body.decision_reason, "removal_reason_code": body.removal_reason_code, "at": _now()}}})
    await db.admin_actions.insert_one({"id": str(uuid.uuid4()), "admin_id": admin["user_id"],
        "action": f"dispute_{body.decision}", "target_type": "review_dispute", "target_id": dispute_id,
        "reason": body.decision_reason, "created_at": _now()})
    fresh = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    await _notify_decision(fresh, body.decision, body.removal_reason_code)
    return {"ok": True, "decision": body.decision}


@router.post("/admin/review-disputes/{dispute_id}/restore")
async def restore_review(dispute_id: str, body: FlagFilerBody,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Admin-only: bring back a review that a dispute removed. Audit logged,
    reason required; the review counts again and both people get a neutral notice."""
    admin = await _require_admin(session_token, authorization)
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required.")
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    if d.get("decision") != "removed":
        raise HTTPException(status_code=409, detail="This review was not removed.")
    unset = {"removed": "", "removed_at": "", "removed_by": "", "removed_reason_code": "", "removed_via_dispute": ""}
    if d["review_kind"] == "one_way":
        await db.reviews.update_one({"id": d["review_id"]}, {"$set": {"restored": True, "restored_at": _now()}, "$unset": unset})
    else:
        await db.mutual_reviews.update_one({"session_id": d["session_id"], "author_id": d["review_author_id"]},
                                           {"$set": {"restored": True, "restored_at": _now()}, "$unset": unset})
        await db.review_sessions.update_one({"id": d["session_id"]}, {"$set": {"status": "revealed", "revealed": True}})
    await db.review_disputes.update_one({"id": dispute_id}, {"$set": {"restored": True, "updated_at": _now()},
        "$push": {"history": {"action": "restored", "by": admin["user_id"], "reason": body.reason, "at": _now()}}})
    await db.admin_actions.insert_one({"id": str(uuid.uuid4()), "admin_id": admin["user_id"],
        "action": "dispute_restore", "target_type": "review_dispute", "target_id": dispute_id,
        "reason": body.reason, "created_at": _now()})
    # Neutral notice to both parties (no reason text), with the Code of Conduct link.
    filer = d["filed_by"]
    reviewer = d.get("review_author_id")
    target = d.get("target_user_id")
    for uid in {x for x in (filer, reviewer, target) if x}:
        await _notice(uid, RC.NOTICE_RESTORED_BOTH, _dest(d, uid), "A review was restored", "A review was restored")
    return {"ok": True, "restored": True}


@router.post("/admin/review-disputes/{dispute_id}/unflag-filer")
async def unflag_filer(dispute_id: str, body: FlagFilerBody,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    admin = await _require_admin(session_token, authorization)
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    await db.review_disputes.update_one({"id": dispute_id}, {"$set": {"flagged_filer": False, "updated_at": _now()},
        "$push": {"history": {"action": "unflag_filer", "by": admin["user_id"], "reason": body.reason, "at": _now()}}})
    if d.get("flagged_filer"):
        await db.users.update_one({"user_id": d["filed_by"], "dispute_flags": {"$gt": 0}}, {"$inc": {"dispute_flags": -1}})
    await db.admin_actions.insert_one({"id": str(uuid.uuid4()), "admin_id": admin["user_id"],
        "action": "dispute_unflag_filer", "target_type": "user", "target_id": d["filed_by"],
        "reason": body.reason, "created_at": _now()})
    return {"ok": True, "flagged": False}


@router.post("/admin/review-disputes/{dispute_id}/flag-filer")
async def flag_filer(dispute_id: str, body: FlagFilerBody,
                     session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    admin = await _require_admin(session_token, authorization)
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    await db.review_disputes.update_one({"id": dispute_id}, {"$set": {"flagged_filer": True, "updated_at": _now()},
        "$push": {"history": {"action": "flag_filer", "by": admin["user_id"], "reason": body.reason, "at": _now()}}})
    await db.users.update_one({"user_id": d["filed_by"]}, {"$inc": {"dispute_flags": 1}})
    await db.admin_actions.insert_one({"id": str(uuid.uuid4()), "admin_id": admin["user_id"],
        "action": "dispute_flag_filer", "target_type": "user", "target_id": d["filed_by"],
        "reason": body.reason, "created_at": _now()})
    return {"ok": True, "flagged": True}
