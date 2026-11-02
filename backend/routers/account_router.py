"""Account deletion flow (ACCOUNT-DELETE-1 Stage B).

Self-serve, irreversible. Email a 6-digit code, require typing DELETE, then run
an idempotent background purge. Protected accounts are refused. No public page
(deferred). Approved numbers: 6-digit code, 15 min expiry, 5 wrong attempts then
invalidated, resend after 60s, max 3 codes/hour per account and per IP.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Cookie, Header, HTTPException, Request
from pydantic import BaseModel

from deps import db, current_user_from_token
import account_deletion as AD

router = APIRouter()
logger = logging.getLogger("smn.account_delete")

CODE_TTL_MIN = 15
MAX_ATTEMPTS = 5
RESEND_AFTER_SEC = 60
MAX_SENDS_PER_HOUR = 3


def _now():
    return datetime.now(timezone.utc)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


async def _require(session_token, authorization):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


class ConfirmBody(BaseModel):
    code: str
    confirm_text: str


@router.get("/account/delete/preview")
async def delete_preview(session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await _require(session_token, authorization)
    reason = await AD.protected_reason(db, u)
    owns_listing = bool(await db.boat_pros.count_documents({"user_id": u["user_id"]}))
    is_org = (u.get("account_type") or "") in ("partner", "organization", "community_partner", "club", "org")
    provider = (u.get("subscription_provider") or "").lower()
    report = await AD.dry_run_inventory(db, u["user_id"]) if not reason else {"ok": False}
    return {
        "protected": bool(reason),
        "protected_reason": reason,
        "owns_listing": owns_listing,
        "is_org": is_org,
        "store_plan": provider in ("apple", "google", "iap"),
        "has_active_plan": (u.get("subscription_tier") or "free") != "free",
        "totals": report.get("totals") if report.get("ok") else None,
    }


@router.post("/account/delete/send-code")
async def send_code(request: Request,
                    session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    u = await _require(session_token, authorization)
    reason = await AD.protected_reason(db, u)
    if reason:
        raise HTTPException(status_code=403, detail=f"This account cannot be deleted ({reason}).")
    email = (u.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="No email on file for this account.")

    ip = (request.client.host if request.client else "") or "?"
    hour_ago = _now() - timedelta(hours=1)
    sends_acct = await db.account_delete_codes.count_documents(
        {"user_id": u["user_id"], "created_at": {"$gte": hour_ago.isoformat()}})
    sends_ip = await db.account_delete_codes.count_documents(
        {"ip": ip, "created_at": {"$gte": hour_ago.isoformat()}})
    if sends_acct >= MAX_SENDS_PER_HOUR or sends_ip >= MAX_SENDS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many codes requested. Please try again later.")

    last = await db.account_delete_codes.find_one({"user_id": u["user_id"]}, sort=[("created_at", -1)])
    if last:
        try:
            lc = datetime.fromisoformat(last["created_at"])
            if (_now() - lc).total_seconds() < RESEND_AFTER_SEC:
                wait = int(RESEND_AFTER_SEC - (_now() - lc).total_seconds())
                raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds before requesting another code.")
        except (ValueError, TypeError):
            pass

    code = f"{secrets.randbelow(1000000):06d}"
    await db.account_delete_codes.insert_one({
        "id": uuid.uuid4().hex, "user_id": u["user_id"], "ip": ip,
        "code_hash": _hash(code), "attempts": 0, "used": False,
        "created_at": _now().isoformat(),
        "expires_at": (_now() + timedelta(minutes=CODE_TTL_MIN)).isoformat(),
    })
    from mailer import send_email, account_delete_code_email_html
    res = await send_email(recipient_email=email, subject="Your account deletion code",
                           html_content=account_delete_code_email_html(code=code, name=u.get("name")))
    if res.get("status") not in ("ok",):
        logger.warning("delete code email not confirmed sent: %s", res)
    return {"ok": True, "sent_to": email, "expires_in_minutes": CODE_TTL_MIN}


@router.post("/account/delete/confirm")
async def confirm_delete(body: ConfirmBody,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await _require(session_token, authorization)
    reason = await AD.protected_reason(db, u)
    if reason:
        raise HTTPException(status_code=403, detail=f"This account cannot be deleted ({reason}).")
    if (body.confirm_text or "").strip() != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm.")

    rec = await db.account_delete_codes.find_one(
        {"user_id": u["user_id"], "used": False}, sort=[("created_at", -1)])
    if not rec:
        raise HTTPException(status_code=400, detail="Request a code first.")
    if datetime.fromisoformat(rec["expires_at"]) < _now():
        raise HTTPException(status_code=400, detail="That code has expired. Request a new one.")
    if rec.get("attempts", 0) >= MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many attempts. Request a new code.")
    if _hash((body.code or "").strip()) != rec["code_hash"]:
        await db.account_delete_codes.update_one({"id": rec["id"]}, {"$inc": {"attempts": 1}})
        left = MAX_ATTEMPTS - (rec.get("attempts", 0) + 1)
        raise HTTPException(status_code=400, detail=f"That code is not correct. {max(left,0)} tries left.")

    await db.account_delete_codes.update_one({"id": rec["id"]}, {"$set": {"used": True}})
    uid = u["user_id"]
    email = (u.get("email") or "").strip().lower()
    # Acknowledge instantly: block login + hide, then purge in the background.
    await db.users.update_one({"user_id": uid}, {"$set": {
        "deletion_pending": True, "member_status": "deleted", "deleted": True,
        "hidden": True, "deleted_at": _now().isoformat()}})
    await db.user_sessions.delete_many({"user_id": uid})

    async def _bg():
        try:
            await AD.execute_purge(db, uid, email_hint=email)
        except Exception:
            logger.exception("background purge failed for %s", uid)

    asyncio.create_task(_bg())
    return {"ok": True, "message": "Your account has been deleted."}
