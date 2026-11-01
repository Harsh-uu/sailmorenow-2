"""Admin access management: grant / revoke FULL admin, list current admins.

Admin status lives in the DATABASE (users.platform_role == "admin"). The
ADMIN_EMAILS env list is only a bootstrap for the very first admin on an empty
database (see server.py); it no longer grants access at request time.

Every grant/revoke requires the acting admin to have re-authenticated with Google
within the last REAUTH_WINDOW_SECONDS (the frontend sends them through a fresh
Google sign-in right before the action; /auth/session stamps last_reauth_at). The
last remaining admin can never be removed. All actions are audit-logged and
emailed to ADMIN_NOTIFY_EMAIL.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from deps import db, require_admin, count_admins
from audit import log_admin_action

logger = logging.getLogger("smn.admin_access")
router = APIRouter()

REAUTH_WINDOW_SECONDS = 120


async def _require_fresh_reauth(admin: Dict[str, Any]) -> None:
    lra = admin.get("last_reauth_at")
    ok = False
    if lra:
        try:
            dt = datetime.fromisoformat(lra)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            ok = (datetime.now(timezone.utc) - dt).total_seconds() <= REAUTH_WINDOW_SECONDS
        except Exception:
            ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="reauth_required")


async def _notify(subject: str, title: str, lines: list) -> None:
    try:
        from mailer import send_email, admin_alert_email_html, app_public_url
        from admin_notify import admin_notify_email
        html = admin_alert_email_html(
            title=title, lines=lines,
            action_url=f"{app_public_url()}/admin/access", action_label="Open Admin access")
        await send_email(recipient_email=admin_notify_email(), subject=subject, html_content=html)
    except Exception:
        logger.exception("admin access notify failed")


@router.get("/admin/admins")
async def list_admins(admin: Dict[str, Any] = Depends(require_admin)):
    out = []
    async for u in db.users.find(
        {"platform_role": "admin"},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "handle": 1,
         "admin_granted_by": 1, "admin_granted_at": 1, "created_at": 1},
    ):
        out.append({
            "user_id": u.get("user_id"),
            "email": u.get("email"),
            "name": u.get("name") or u.get("handle"),
            "handle": u.get("handle"),
            "granted_by": u.get("admin_granted_by") or "bootstrap",
            "granted_at": u.get("admin_granted_at") or u.get("created_at"),
        })
    out.sort(key=lambda r: (r.get("granted_at") or ""))
    return {"admins": out, "count": len(out)}


@router.post("/admin/admins/grant")
async def grant_admin(body: Dict[str, Any], admin: Dict[str, Any] = Depends(require_admin)):
    await _require_fresh_reauth(admin)
    email = (body.get("email") or "").strip().lower()
    reason = (body.get("reason") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required.")
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required.")
    target = await db.users.find_one({"email": email}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="No account exists with that email.")
    if not target.get("auth_google") or not target.get("email_verified"):
        raise HTTPException(status_code=400,
                            detail="That person must sign in with Google (verified email) at least once first.")
    if target.get("platform_role") == "admin":
        raise HTTPException(status_code=400, detail="That account is already an admin.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {"platform_role": "admin",
                  "admin_granted_by": admin.get("email"),
                  "admin_granted_by_id": admin.get("user_id"),
                  "admin_granted_at": now_iso,
                  "admin_grant_reason": reason[:300]},
         "$unset": {"password_hash": ""}},  # admins are Google-only
    )
    await log_admin_action(admin, "admin_grant", "user", target["user_id"],
                           summary=f"Granted FULL admin to {email}", meta={"reason": reason[:300]})
    await _notify(
        subject="Sail More Now: admin access granted",
        title="Admin access granted",
        lines=[f"{admin.get('email')} granted FULL admin to {email}.",
               f"Reason: {reason[:300]}"])
    return {"ok": True}


@router.post("/admin/admins/revoke")
async def revoke_admin(body: Dict[str, Any], admin: Dict[str, Any] = Depends(require_admin)):
    await _require_fresh_reauth(admin)
    email = (body.get("email") or "").strip().lower()
    reason = (body.get("reason") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="An email is required.")
    target = await db.users.find_one({"email": email}, {"_id": 0})
    if not target or target.get("platform_role") != "admin":
        raise HTTPException(status_code=404, detail="That account is not an admin.")
    if await count_admins() <= 1:
        raise HTTPException(status_code=400, detail="You can't remove the last remaining admin.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {"platform_role": None,
                  "admin_revoked_by": admin.get("email"),
                  "admin_revoked_at": now_iso,
                  "admin_revoke_reason": reason[:300]}},
    )
    await log_admin_action(admin, "admin_revoke", "user", target["user_id"],
                           summary=f"Revoked admin from {email}", meta={"reason": reason[:300]})
    await _notify(
        subject="Sail More Now: admin access revoked",
        title="Admin access revoked",
        lines=[f"{admin.get('email')} revoked admin from {email}.",
               f"Reason: {reason[:300] or '(none given)'}"])
    return {"ok": True}
