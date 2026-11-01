"""Stripe Identity verification + profile photo. Verified status is only granted from a
server-side Stripe read (webhook or retrieve), never from the browser."""
from __future__ import annotations
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Cookie, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from deps import db, current_user_from_token, STRIPE_API_KEY, rate_limit, is_paid_subscriber, UPGRADE_REQUIRED
from constants import MAX_PHOTO_URL_CHARS

logger = logging.getLogger("identity")
router = APIRouter()
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or STRIPE_API_KEY
stripe.api_version = os.environ.get("STRIPE_API_VERSION", "2024-06-20")


async def _me(session_token, authorization):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


async def _apply_session(sess) -> str:
    status = sess["status"]
    uid = (sess.get("metadata") or {}).get("user_id")
    await db.identity_sessions.update_one({"stripe_session_id": sess["id"]},
                                          {"$set": {"status": status, "user_id": uid, "updated_at": datetime.now(timezone.utc).isoformat()}},
                                          upsert=True)
    if status == "verified" and uid:
        await db.users.update_one({"user_id": uid}, {"$set": {"identity_verified": True,
                                                             "identity_verified_at": datetime.now(timezone.utc).isoformat()}})
        try:
            from zoho_sync import enqueue as _zq
            await _zq(db, "identity_verified", uid)
        except Exception:
            pass
    return status


@router.post("/identity/session")
async def create_identity_session(request: Request,
                                  session_token: Optional[str] = Cookie(default=None),
                                  authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    if u.get("identity_verified"):
        return {"already_verified": True}
    # ID verification is a personal-profile feature and a paid perk. Any paid
    # account, including Basic Boat Pros (on their personal profile), is eligible.
    # Free accounts must upgrade first.
    if not is_paid_subscriber(u):
        raise HTTPException(status_code=402, detail=UPGRADE_REQUIRED)
    rate_limit("identity_session", request, limit=5, window=3600)
    body_origin = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            body_origin = body.get("origin_url")
    except Exception:
        body_origin = None
    origin = (body_origin or request.headers.get("origin") or "https://app.sailmorenow.com").rstrip("/")
    try:
        sess = stripe.identity.VerificationSession.create(
            type="document", metadata={"user_id": u["user_id"]},
            return_url=f"{origin}/verify/return",
            provided_details={"email": u.get("email")} if u.get("email") else None,
        )
    except stripe.error.StripeError as e:
        logger.warning("identity session create failed: %s", getattr(e, "user_message", None) or e)
        raise HTTPException(status_code=409, detail="Stripe Identity isn't available yet — a real Stripe secret key with Identity enabled must be set as STRIPE_API_KEY.")
    await db.identity_sessions.insert_one({"stripe_session_id": sess.id, "user_id": u["user_id"], "status": sess.status,
                                           "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": sess.id, "url": sess.url}


@router.get("/identity/status")
async def identity_status(session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Refresh from Stripe (server-side) so the badge appears even without a webhook configured."""
    u = await _me(session_token, authorization)
    if u.get("identity_verified"):
        return {"verified": True, "status": "verified"}
    rec = await db.identity_sessions.find_one({"user_id": u["user_id"]}, sort=[("created_at", -1)])
    if not rec:
        return {"verified": False, "status": "none"}
    status = rec.get("status")
    if status not in ("verified", "canceled"):
        try:
            sess = stripe.identity.VerificationSession.retrieve(rec["stripe_session_id"])
            status = await _apply_session(sess)
        except stripe.error.StripeError:
            pass
    return {"verified": status == "verified", "status": status}


@router.post("/identity/webhook")
async def identity_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    secret = os.environ.get("STRIPE_IDENTITY_WEBHOOK_SECRET")
    if not secret:
        return JSONResponse({"received": False, "reason": "no_secret"}, status_code=400)
    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        return JSONResponse({"received": False}, status_code=400)
    if event["type"].startswith("identity.verification_session."):
        await _apply_session(event["data"]["object"])
    return {"received": True}


class PhotoBody(BaseModel):
    picture: Optional[str] = None  # data URL (cropped client-side) or None to clear
    avatar: Optional[str] = None   # preset icon key


@router.patch("/profile/photo")
async def set_profile_photo(body: PhotoBody,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    u = await _me(session_token, authorization)
    if body.picture and (len(body.picture) > MAX_PHOTO_URL_CHARS or not body.picture.startswith("data:image/")):
        raise HTTPException(status_code=400, detail="Photo too large or invalid")
    update = {}
    if body.picture is not None or body.avatar is not None:
        update["picture"] = body.picture or None
    if body.avatar is not None:
        update["avatar"] = body.avatar[:40]
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    return {"ok": True, **update}
