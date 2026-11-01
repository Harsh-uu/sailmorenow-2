"""Community abuse-report queue.

Any signed-in member can flag a `discussion`, `comment`, or `post`. Admins
review the queue and either dismiss, resolve, or resolve-and-delete the
target in one step. Reports are idempotent per (reporter, target).
"""
from __future__ import annotations
import os
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, Header, HTTPException, Depends
from pydantic import BaseModel

from deps import db, current_user_from_token, require_admin, admin_emails

router = APIRouter()
logger = logging.getLogger("smn.reports")


def _coc_url() -> str:
    base = (os.environ.get("APP_BASE_URL") or os.environ.get("APP_PUBLIC_URL")
            or "https://app.sailmorenow.com").rstrip("/")
    return base + "/community-guidelines"


async def _admin_user_ids() -> set:
    ids = set()
    async for u in db.users.find({"platform_role": "admin"}, {"_id": 0, "user_id": 1}):
        ids.add(u["user_id"])
    emails = list(admin_emails())
    if emails:
        async for u in db.users.find({"email": {"$in": emails}}, {"_id": 0, "user_id": 1}):
            ids.add(u["user_id"])
    return ids


async def _notify_admins_hidden(target_type: str, target_id: str, why: str):
    try:
        from notifications import notify
        for uid in await _admin_user_ids():
            await notify(user_id=uid, kind="content_hidden",
                         title="Content auto-hidden for review",
                         body=f"A {target_type} was hidden ({why}). Tap to review. Content follows our Code of Conduct.",
                         link="/admin/reports",
                         meta={"target_type": target_type, "target_id": target_id, "why": why, "code_of_conduct_url": _coc_url()})
        from admin_notify import admin_notify
        await admin_notify(
            db, kind="content_hidden",
            subject="Sail More Now: content auto-hidden for review",
            title="Content auto-hidden for review",
            lines=[f"A <b>{target_type}</b> was automatically hidden ({why}) and is waiting for a moderator."],
            deep_link_path=f"/admin/reports?focus={target_id}")
    except Exception:
        logger.exception("notify admins (hidden) failed")


async def _notify_admins_new_report(report: Optional[dict] = None):
    """In-app only (kind 'report_new' is not in the push whitelist, so notify()
    sends no push or email). One rolling notification per admin: the first reads
    "New report to review"; each later unread one bumps the count to "N new
    reports to review" and refreshes the time, instead of adding another row.
    A single-channel admin email also goes to ADMIN_NOTIFY_EMAIL (burst-guarded)."""
    try:
        from notifications import notify
        now_iso = datetime.now(timezone.utc).isoformat()
        for uid in await _admin_user_ids():
            existing = await db.notifications.find_one(
                {"user_id": uid, "kind": "report_new", "read": False}, {"_id": 0})
            if existing:
                count = int((existing.get("meta") or {}).get("count", 1)) + 1
                await db.notifications.update_one(
                    {"id": existing["id"]},
                    {"$set": {
                        "title": f"{count} new reports to review",
                        "body": "Tap to review.",
                        "link": "/admin/reports",
                        "created_at": now_iso,
                        "meta": {**(existing.get("meta") or {}), "count": count, "code_of_conduct_url": _coc_url()},
                    }},
                )
            else:
                await notify(user_id=uid, kind="report_new",
                             title="New report to review",
                             body="Tap to review.",
                             link="/admin/reports",
                             meta={"count": 1, "code_of_conduct_url": _coc_url()})
        if report:
            from admin_notify import admin_notify
            await admin_notify(
                db, kind="report",
                subject="Sail More Now: new report to review",
                title="New report to review",
                lines=[f"A member reported a <b>{report.get('target_type')}</b>.",
                       f"Reason: {(report.get('reason') or '')[:200]}"],
                deep_link_path=f"/admin/reports?focus={report.get('id')}")
    except Exception:
        logger.exception("notify admins (new report) failed")


async def get_inaccurate_threshold() -> int:
    doc = await db.app_settings.find_one({"id": "moderation"}, {"_id": 0})
    try:
        return int((doc or {}).get("inaccurate_auto_hide_threshold", 0) or 0)
    except (TypeError, ValueError):
        return 0


class ModerationSettings(BaseModel):
    inaccurate_auto_hide_threshold: int = 0


@router.get("/admin/moderation-settings")
async def get_moderation_settings(admin=Depends(require_admin)):
    return {"inaccurate_auto_hide_threshold": await get_inaccurate_threshold()}


@router.put("/admin/moderation-settings")
async def set_moderation_settings(body: ModerationSettings, admin=Depends(require_admin)):
    n = max(0, min(int(body.inaccurate_auto_hide_threshold or 0), 100))
    await db.app_settings.update_one(
        {"id": "moderation"},
        {"$set": {"id": "moderation", "inaccurate_auto_hide_threshold": n}},
        upsert=True,
    )
    return {"ok": True, "inaccurate_auto_hide_threshold": n}

VALID_TARGETS = {"discussion", "comment", "post", "event"}
VALID_STATUSES = {"open", "resolved", "dismissed"}
TARGET_COLLECTION = {
    "discussion": "discussions",
    "comment": "comments",
    "post": "posts",
    "event": "events",
}
# Reasons that indicate the content is inappropriate → auto-hidden from public
# view until an admin reviews it.
HIDE_CATEGORIES = {"inappropriate"}


class ReportCreate(BaseModel):
    target_type: str
    target_id: str
    reason: str
    category: Optional[str] = None  # inappropriate | inaccurate | other


class ReportResolution(BaseModel):
    status: str  # resolved | dismissed
    delete_target: bool = False
    notes: Optional[str] = None


async def _hydrate_target(r: Dict[str, Any]) -> Dict[str, Any]:
    coll = TARGET_COLLECTION.get(r["target_type"])
    target = None
    if coll:
        target = await db[coll].find_one({"id": r["target_id"]}, {"_id": 0}) or None
    # Admin-only: for content authored as a business identity, surface the
    # account holder behind it (name + personal handle). Never exposed publicly.
    if target and target.get("author_identity") == "business" and target.get("author_id"):
        holder = await db.users.find_one({"user_id": target["author_id"]},
                                         {"_id": 0, "name": 1, "handle": 1})
        if holder:
            target["author_holder_name"] = holder.get("name")
            target["author_holder_handle"] = holder.get("handle")
    # For a reported comment, cheaply resolve what it is attached to so the
    # admin can see the context without opening anything.
    if r["target_type"] == "comment" and target:
        parent_id = target.get("post_id")
        if parent_id:
            parent = await db.discussions.find_one(
                {"id": parent_id}, {"_id": 0, "title": 1, "kind": 1})
            if parent:
                r["parent_type"] = parent.get("kind") or "discussion"
                r["parent_title"] = parent.get("title")
            else:
                parent = await db.posts.find_one(
                    {"id": parent_id}, {"_id": 0, "title": 1, "body": 1})
                if parent:
                    r["parent_type"] = "post"
                    r["parent_title"] = parent.get("title") or (parent.get("body") or "")[:80]
    r["target"] = target
    return r


class ModTarget(BaseModel):
    target_type: str
    target_id: str


@router.post("/admin/moderation/restore")
async def moderation_restore(body: ModTarget, admin=Depends(require_admin)):
    """Un-hide an auto-hidden item and dismiss its open reports (one-tap from the alert)."""
    coll = TARGET_COLLECTION.get(body.target_type)
    if not coll:
        raise HTTPException(status_code=400, detail="Unknown target type")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db[coll].update_one(
        {"id": body.target_id},
        {"$unset": {"hidden_pending_review": "", "hidden_at": "", "hidden_reason": ""}},
    )
    await db.reports.update_many(
        {"target_type": body.target_type, "target_id": body.target_id, "status": "open"},
        {"$set": {"status": "dismissed", "resolved_by": admin["user_id"],
                  "resolved_at": now_iso, "resolution_notes": "restored from alert"}},
    )
    return {"ok": True, "restored": True}


@router.post("/admin/moderation/hide")
async def moderation_hide(body: ModTarget, admin=Depends(require_admin)):
    """Re-hide a target (used to undo an accidental Restore)."""
    coll = TARGET_COLLECTION.get(body.target_type)
    if not coll:
        raise HTTPException(status_code=400, detail="Unknown target type")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db[coll].update_one({"id": body.target_id},
                              {"$set": {"hidden_pending_review": True, "hidden_at": now_iso, "hidden_reason": "re-hidden"}})
    return {"ok": True, "hidden": True}


@router.post("/admin/moderation/restore-doc")
async def moderation_restore_doc(body: Dict[str, Any], admin=Depends(require_admin)):
    """Re-insert a previously removed item (used to undo an accidental Remove)."""
    target_type = body.get("target_type")
    snapshot = body.get("snapshot") or {}
    coll = TARGET_COLLECTION.get(target_type)
    if not coll or not snapshot.get("id"):
        raise HTTPException(status_code=400, detail="Nothing to restore")
    snapshot.pop("_id", None)
    exists = await db[coll].find_one({"id": snapshot["id"]}, {"_id": 0, "id": 1})
    if not exists:
        await db[coll].insert_one(dict(snapshot))
    await db[coll].update_one({"id": snapshot["id"]},
                              {"$unset": {"hidden_pending_review": "", "hidden_at": "", "hidden_reason": ""}})
    return {"ok": True, "restored": snapshot["id"]}


@router.post("/admin/moderation/remove")
async def moderation_remove(body: ModTarget, admin=Depends(require_admin)):
    """Permanently remove an auto-hidden item and resolve its reports (one-tap from the alert).
    Returns a snapshot so the action can be undone."""
    coll = TARGET_COLLECTION.get(body.target_type)
    if not coll:
        raise HTTPException(status_code=400, detail="Unknown target type")
    now_iso = datetime.now(timezone.utc).isoformat()
    snapshot = await db[coll].find_one({"id": body.target_id}, {"_id": 0})
    await db[coll].delete_one({"id": body.target_id})
    if body.target_type == "comment":
        await db.comments.delete_many({"parent_id": body.target_id})
    await db.reports.update_many(
        {"target_type": body.target_type, "target_id": body.target_id, "status": "open"},
        {"$set": {"status": "resolved", "target_deleted": True, "resolved_by": admin["user_id"],
                  "resolved_at": now_iso, "resolution_notes": "removed from alert"}},
    )
    return {"ok": True, "removed": True, "snapshot": snapshot, "target_type": body.target_type}



@router.post("/reports")
async def create_report(body: ReportCreate,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.target_type not in VALID_TARGETS:
        raise HTTPException(status_code=400, detail="Invalid target_type")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Reason is required")
    if len(reason) > 500:
        raise HTTPException(status_code=400, detail="Reason too long (max 500 chars)")
    # Verify target exists
    coll = TARGET_COLLECTION[body.target_type]
    target = await db[coll].find_one({"id": body.target_id}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    # Idempotent per (reporter, target)
    existing = await db.reports.find_one(
        {"reporter_id": u["user_id"], "target_type": body.target_type,
         "target_id": body.target_id, "status": "open"},
        {"_id": 0},
    )
    if existing:
        return {"ok": True, "report": existing, "duplicate": True}
    now_iso = datetime.now(timezone.utc).isoformat()
    category = (body.category or "").strip().lower() or None
    doc = {
        "id": str(uuid.uuid4()),
        "reporter_id": u["user_id"],
        "reporter_name": u.get("name"),
        "target_type": body.target_type,
        "target_id": body.target_id,
        "reason": reason,
        "category": category,
        "status": "open",
        "created_at": now_iso,
        "resolved_at": None,
        "resolved_by": None,
        "resolution_notes": None,
    }
    await db.reports.insert_one(doc)
    doc.pop("_id", None)
    await _notify_admins_new_report(doc)
    # "Inappropriate" reports auto-hide the target immediately. "Inaccurate"
    # reports auto-hide once they reach the admin-configured threshold.
    hidden = False
    coll = TARGET_COLLECTION.get(body.target_type)
    should_hide = category in HIDE_CATEGORIES
    why = "inappropriate"
    if not should_hide and category == "inaccurate":
        threshold = await get_inaccurate_threshold()
        if threshold > 0:
            count = await db.reports.count_documents({
                "target_type": body.target_type, "target_id": body.target_id,
                "category": "inaccurate", "status": "open",
            })
            if count >= threshold:
                should_hide = True
                why = f"{count} inaccurate reports"
    if should_hide and coll:
        already = await db[coll].find_one({"id": body.target_id, "hidden_pending_review": True}, {"_id": 0, "id": 1})
        await db[coll].update_one(
            {"id": body.target_id},
            {"$set": {"hidden_pending_review": True, "hidden_at": now_iso, "hidden_reason": why}},
        )
        hidden = True
        if not already:
            await _notify_admins_hidden(body.target_type, body.target_id, why)
    return {"ok": True, "report": doc, "duplicate": False, "hidden": hidden}


@router.get("/admin/reports")
async def admin_list_reports(status: Optional[str] = "open",
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    admin_user = await require_admin(session_token=session_token, authorization=authorization)
    q: Dict[str, Any] = {}
    if status and status != "all":
        if status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status filter")
        q["status"] = status
    docs = await db.reports.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for r in docs:
        await _hydrate_target(r)
    # --- Insights (independent of the current status filter) ---
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    weeks: List[Dict[str, Any]] = []
    for i in range(7, -1, -1):
        wk_start = now - _td(days=(i + 1) * 7 - 1)
        wk_end = now - _td(days=i * 7 - 1) if i > 0 else now
        n = await db.reports.count_documents({
            "created_at": {"$gte": wk_start.isoformat(), "$lt": wk_end.isoformat()},
        })
        weeks.append({"week_start": wk_start.date().isoformat(), "count": n})
    top_cursor = db.reports.aggregate([
        {"$sort": {"created_at": 1}},
        {"$group": {"_id": {"t": "$target_type", "id": "$target_id"},
                    "count": {"$sum": 1},
                    "last_reason": {"$last": "$reason"}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ])
    top_targets: List[Dict[str, Any]] = []
    async for row in top_cursor:
        tt = row["_id"]["t"]
        tid = row["_id"]["id"]
        coll = TARGET_COLLECTION.get(tt)
        preview_doc = None
        if coll:
            preview_doc = await db[coll].find_one({"id": tid}, {"_id": 0, "title": 1, "body": 1})
        top_targets.append({
            "target_type": tt, "target_id": tid, "count": row["count"],
            "last_reason": row["last_reason"],
            "preview": ((preview_doc or {}).get("title") or (preview_doc or {}).get("body") or "[deleted]")[:120],
        })
    total_open = await db.reports.count_documents({"status": "open"})
    return {
        "count": len(docs), "reports": docs, "admin_id": admin_user["user_id"],
        "insights": {"weekly": weeks, "top_targets": top_targets, "open_total": total_open},
    }


@router.patch("/admin/reports/{report_id}")
async def admin_resolve_report(report_id: str, body: ReportResolution,
                                session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    admin_user = await require_admin(session_token=session_token, authorization=authorization)
    if body.status not in {"resolved", "dismissed"}:
        raise HTTPException(status_code=400, detail="status must be resolved or dismissed")
    r = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    updates: Dict[str, Any] = {
        "status": body.status,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "resolved_by": admin_user["user_id"],
        "resolution_notes": (body.notes or "").strip()[:500] or None,
    }
    coll = TARGET_COLLECTION.get(r["target_type"])
    if body.delete_target and body.status == "resolved":
        if coll:
            await db[coll].delete_one({"id": r["target_id"]})
            if r["target_type"] == "comment":
                # cascade one level like DELETE /comments/{id}
                await db.comments.delete_many({"parent_id": r["target_id"]})
            # Auto-resolve all other open reports on the same target
            await db.reports.update_many(
                {"target_type": r["target_type"], "target_id": r["target_id"],
                 "status": "open", "id": {"$ne": report_id}},
                {"$set": {**updates, "resolution_notes": "auto-resolved with target"}},
            )
        updates["target_deleted"] = True
    else:
        # Restore: dismiss or resolve-without-delete un-hides an auto-hidden target.
        if coll:
            await db[coll].update_one(
                {"id": r["target_id"]},
                {"$unset": {"hidden_pending_review": "", "hidden_at": "", "hidden_reason": ""}},
            )
    await db.reports.update_one({"id": report_id}, {"$set": updates})
    return {"ok": True}
