"""Auth + newsletter + admin (Zoho + scheduler) endpoints."""
from __future__ import annotations
import uuid
import logging
import secrets
import hashlib
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import bcrypt
import httpx
from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Response, Depends

from deps import db, current_user_from_token, require_admin, admin_emails, handle_taken, clean_avatar, rate_limit, is_admin, verification_state
from disposable_domains import is_disposable_email
import break_glass
from schemas import OnboardingBody, NewsletterToggle, AccountTypeSwap, RegisterBody, LoginBody, BoatDetailsUpdate, ProfileSelfUpdate
from constants import EMERGENT_AUTH_SESSION_URL, PNW_MARKETS, ORG_CATEGORIES
from zoho import zoho
from zoho_sync import enqueue as _zoho_enqueue
from scheduler import next_run

logger = logging.getLogger("smn.auth")

# Email verification.
VERIFY_TOKEN_TTL_DAYS = 7
VERIFY_RESEND_MAX_PER_ACCOUNT = 3   # per hour
VERIFY_RESEND_MAX_PER_IP = 10       # per hour
# Signup anti-abuse.
SIGNUP_MAX_PER_IP = 10              # per hour
SIGNUP_MAX_PER_DOMAIN = 20          # per hour, per email domain
SIGNUP_MIN_FILL_MS = 3000           # forms filled faster than this look like bots

router = APIRouter()

# Tiered brute-force lockout for login. Each tier is an independent counter in
# db.login_attempts keyed by a prefixed identifier; hitting any tier's limit
# locks that key for its window. "combo" stops a single IP guessing one account,
# "acct" stops a targeted account across rotating IPs, "ip" stops one IP spraying
# many accounts. A successful login clears all three for that IP+email.
MAX_LOGIN_ATTEMPTS = 5          # combo (ip+email)
LOCKOUT_MINUTES = 15            # combo window
ACCT_MAX_ATTEMPTS = 10          # per account (email), across IPs
ACCT_LOCKOUT_MINUTES = 30
IP_MAX_ATTEMPTS = 30            # per IP, across accounts
IP_LOCKOUT_MINUTES = 60
MAX_BOAT_FIELD_CHARS = 80
POLICIES_VERSION = "coc-2026-10-17-v5"


def _validate_password_strength(password: str) -> None:
    """8+ chars with at least one uppercase letter, one number, one special char."""
    import re as _re
    if (len(password) < 8 or not _re.search(r"[A-Z]", password)
            or not _re.search(r"[0-9]", password) or not _re.search(r"[^A-Za-z0-9]", password)):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters and include an uppercase letter, a number, and a special character.",
        )


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), (hashed or "").encode("utf-8"))
    except Exception:
        return False


async def _issue_session(user_id: str, response: Response) -> str:
    """Create an opaque session_token in user_sessions (same model Google uses)
    and set it as an httpOnly cookie. Returned so mobile can store it as Bearer."""
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": expires_at, "created_at": datetime.now(timezone.utc),
    })
    response.set_cookie(
        key="session_token", value=token, httponly=True, secure=True,
        samesite="none", path="/", max_age=7 * 24 * 3600,
    )
    return token


def _slugify_handle(name: str) -> str:
    """Convert a display name to a URL-safe lowercase handle candidate."""
    import re as _re
    s = _re.sub(r"[^A-Za-z0-9]+", "", (name or "")).lower()[:20]
    return s or "sailor"


async def _generate_unique_handle(name: str, taken: Optional[set] = None) -> str:
    base = _slugify_handle(name)
    # Try `base`, then `base2`, `base3`, ... until we find one free across the
    # SHARED handle namespace (personal handles + business handles).
    for suffix in [""] + [str(i) for i in range(2, 999)]:
        candidate = f"{base}{suffix}"
        if taken and candidate in taken:
            continue
        if not await handle_taken(candidate):
            return candidate
    return f"{base}{uuid.uuid4().hex[:6]}"


@router.post("/auth/session")
async def create_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id") if isinstance(body, dict) else None
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient(timeout=15.0) as httpc:
        r = await httpc.get(EMERGENT_AUTH_SESSION_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = (data.get("email") or "").strip().lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        now_iso = datetime.now(timezone.utc).isoformat()
        # Google sign-in marks a verified-Google identity and stamps a fresh
        # re-auth time (used to gate sensitive admin actions). Promote-only: the
        # env bootstrap list may grant admin, but we NEVER demote a DB-granted
        # admin on login. Name/picture are not overwritten (user may have edited).
        updates = {"auth_google": True, "email_verified": True, "last_reauth_at": now_iso}
        if email in admin_emails() and existing.get("platform_role") != "admin":
            updates["platform_role"] = "admin"
        # Seed a picture only if the account has neither a Google picture nor an
        # uploaded avatar yet.
        if not existing.get("picture") and not existing.get("avatar") and data.get("picture"):
            updates["picture"] = data.get("picture")
        if not existing.get("handle"):
            updates["handle"] = await _generate_unique_handle(data["name"])
        await db.users.update_one({"user_id": user_id}, {"$set": updates})
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        handle = await _generate_unique_handle(data["name"])
        _name_parts = (data["name"] or "").split(" ", 1)
        _first = _name_parts[0]
        _last = _name_parts[1] if len(_name_parts) > 1 else ""
        user = {
            "user_id": user_id, "email": email, "name": data["name"], "picture": data.get("picture"),
            "first_name": _first, "last_name": _last,
            "handle": handle,
            "platform_role": "admin" if email.lower() in admin_emails() else None,
            "auth_google": True, "email_verified": True,
            "last_reauth_at": datetime.now(timezone.utc).isoformat(),
            "account_type": None, "primary_market": None, "markets": [], "reasons": [],
            "avatar": None, "bio": None, "subscription_tier": "free", "subscription_expires": None,
            "member_status": "active",
            "last_identity": "personal",
            "newsletter_opt_in": True, "policies_agreed": False, "onboarding_complete": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
        user.pop("_id", None)
        # Active member — not routed through the Zoho waitlist path. The welcome
        # email is sent once profile setup completes (see /auth/onboarding).
        await _zoho_enqueue(db, "signup_google", user_id)
    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id, "session_token": session_token,
        "expires_at": expires_at, "created_at": datetime.now(timezone.utc),
    })
    response.set_cookie(
        key="session_token", value=session_token, httponly=True, secure=True,
        samesite="none", path="/", max_age=7 * 24 * 3600,
    )
    return {"user": user, "session_token": session_token}


@router.get("/auth/check-email")
async def check_email(email: str = ""):
    """Lightweight availability check used by the sign-up form before advancing,
    so a new user is not asked to fill in the whole form before learning the
    email is taken. Normalizes (trim + lowercase) exactly like register."""
    e = (email or "").strip().lower()
    if not e:
        return {"available": True, "email": e}
    exists = await db.users.find_one({"email": e}, {"_id": 1})
    return {"available": not bool(exists), "email": e}


@router.post("/auth/register")
async def register(body: RegisterBody, request: Request, response: Response):
    email = body.email.strip().lower()
    ip = (request.client.host if request.client else "unknown")
    # --- Invisible anti-abuse (free protections) ---
    if (body.company_website or "").strip():
        # Honeypot: real users never fill this hidden field.
        raise HTTPException(status_code=400, detail="Could not create account.")
    if body.form_elapsed_ms is not None and 0 <= body.form_elapsed_ms < SIGNUP_MIN_FILL_MS:
        raise HTTPException(status_code=400, detail="That was a bit too quick. Please try again.")
    if is_disposable_email(email):
        raise HTTPException(status_code=400, detail="Please use a permanent email address (disposable email domains are not allowed).")
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=1)
    ip_count = await db.signup_events.count_documents({"ip": ip, "at": {"$gte": since.isoformat()}})
    if ip_count >= SIGNUP_MAX_PER_IP:
        raise HTTPException(status_code=429, detail="Too many sign-ups from this network. Please try again later.")
    domain = email.rsplit("@", 1)[-1]
    dom_count = await db.signup_events.count_documents({"domain": domain, "at": {"$gte": since.isoformat()}})
    if dom_count >= SIGNUP_MAX_PER_DOMAIN:
        raise HTTPException(status_code=429, detail="Too many sign-ups right now. Please try again later.")
    if body.account_type not in {"sailor", "boat_owner", "boat_pro", "partner"}:
        raise HTTPException(status_code=400, detail="Invalid account_type")
    if body.primary_market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid primary_market")
    if not body.agreed_to_guidelines:
        raise HTTPException(status_code=400, detail="You must confirm you are 18 or older and agree to the Code of Conduct.")
    _validate_password_strength(body.password)
    existing = await db.users.find_one({"email": email}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in or use Forgot password.")
    name = f"{body.first_name.strip()} {body.last_name.strip()}".strip()
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    org_name = (body.org_name or "").strip() or None
    # Organizations present publicly as the ORGANIZATION (name + handle + the
    # /partners/<slug> URL), not the person who registered. The registrant's
    # name is kept as first_name/last_name for contact. The display `name`
    # stays editable later as roles change.
    display_name = org_name if (body.account_type == "partner" and org_name) else name
    handle = await _generate_unique_handle(display_name)
    ref = (body.referred_by or "").strip() or None
    referrer = None
    if ref:
        referrer = await db.users.find_one(
            {"$or": [{"handle": ref}, {"handle": ref.lstrip("@")}, {"name": ref}]},
            {"_id": 0, "user_id": 1, "name": 1, "handle": 1},
        )
    org_cats = None
    org_cat_primary = None
    if body.account_type == "partner":
        raw = body.org_categories if body.org_categories is not None else ([body.org_category] if body.org_category else [])
        org_cats = [c for c in (raw or []) if c in ORG_CATEGORIES]
        org_cat_primary = org_cats[0] if org_cats else None
    user = {
        "user_id": user_id, "email": email, "name": display_name,
        "first_name": body.first_name.strip(), "last_name": body.last_name.strip(),
        "password_hash": _hash_password(body.password),
        "picture": None, "handle": handle,
        "platform_role": "admin" if email in admin_emails() else None,
        "account_type": body.account_type, "primary_market": body.primary_market,
        "markets": [body.primary_market], "reasons": [],
        "boat_name": (body.boat_name or "").strip()[:MAX_BOAT_FIELD_CHARS] or None,
        "boat_make_model": (body.boat_make_model or "").strip()[:MAX_BOAT_FIELD_CHARS] or None,
        "company_name": (body.company_name or "").strip() or None,
        "org_name": org_name,
        "org_category": org_cat_primary,
        "org_categories": org_cats,
        "avatar": None, "bio": None, "subscription_tier": "free", "subscription_expires": None,
        "member_status": "active",
        "email_verified": False, "auth_google": False,
        "last_identity": "personal",
        "newsletter_opt_in": body.newsletter_opt_in, "policies_agreed": True,
        "policies_agreed_at": datetime.now(timezone.utc).isoformat(),
        "policies_version": POLICIES_VERSION,
        "onboarding_complete": True,
        "referred_by": ref,
        "referrer_user_id": (referrer or {}).get("user_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    user.pop("_id", None)
    try:
        await db.signup_events.insert_one({
            "ip": ip, "domain": domain, "user_id": user_id,
            "at": datetime.now(timezone.utc).isoformat(),
            "expire_at": datetime.now(timezone.utc) + timedelta(days=2),
        })
    except Exception:
        logger.exception("failed to record signup event")
    await _zoho_enqueue(db, "signup_email", user_id)
    if ref:
        try:
            await db.referrals.insert_one({
                "ref": ref,
                "referrer_user_id": (referrer or {}).get("user_id"),
                "referrer_name": (referrer or {}).get("name"),
                "referred_user_id": user_id,
                "referred_name": name,
                "referred_email": email,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            logger.exception("failed to record referral for %s", email)
    # App signups are ACTIVE members — they do NOT go through the Zoho waitlist
    # path (that stays for the website waitlist form only). Their newsletter
    # opt-in is stored in the DB and can be backfilled to Zoho once it's enabled.
    # Send an active-member welcome email via Resend.
    try:
        from mailer import send_email, welcome_member_email_html
        await send_email(
            recipient_email=email,
            subject="Welcome to the Sail More Now Community",
            html_content=welcome_member_email_html(
                account_type=user.get("account_type"),
                first_name=user.get("first_name"),
                company_name=user.get("company_name"),
                org_name=user.get("org_name"),
                display_name=user.get("name"),
                app_url="https://app.sailmorenow.com",
            ),
            from_email="notifications@notifications.sailmorenow.com",
        )
    except Exception:
        logger.exception("welcome email failed on register for %s", email)
    try:
        await _send_verification_email(user_id, email, user.get("first_name") or user.get("name"))
    except Exception:
        logger.exception("verification email failed on register for %s", email)
    token = await _issue_session(user_id, response)
    user.pop("password_hash", None)
    user.pop("_id", None)
    from deps import account_identity_payload
    user.update(await account_identity_payload(user))
    return {"user": user, "session_token": token}


async def _send_verification_email(user_id: str, email: str, name: Optional[str]) -> None:
    """Create a single-use 7-day token and email the verification link via the
    existing Resend setup. Never logs the token or the link."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db.email_verifications.insert_one({
        "token": token, "user_id": user_id, "email": email,
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(days=VERIFY_TOKEN_TTL_DAYS),  # BSON date for TTL
        "used": False,
    })
    from mailer import send_email, verification_email_html, app_public_url, log_email_sent
    verify_url = f"{app_public_url()}/verify-email?token={token}"
    await send_email(
        recipient_email=email,
        subject="Verify your email for Sail More Now",
        html_content=verification_email_html(name=name or "there", verify_url=verify_url, hours=24),
        from_email="notifications@notifications.sailmorenow.com",
    )
    await log_email_sent(email, "Verify your email for Sail More Now", "verification link")


async def _verify_rate_ok(email: str, ip: str) -> bool:
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    acct = await db.verify_sends.count_documents({"email": email, "at": {"$gte": since.isoformat()}})
    if acct >= VERIFY_RESEND_MAX_PER_ACCOUNT:
        return False
    byip = await db.verify_sends.count_documents({"ip": ip, "at": {"$gte": since.isoformat()}})
    if byip >= VERIFY_RESEND_MAX_PER_IP:
        return False
    return True


@router.post("/auth/send-verification")
async def send_verification(request: Request,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    user = await current_user_from_token(session_token, authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in first.")
    email = (user.get("email") or "").lower()
    if verification_state(user).get("verified"):
        return {"ok": True, "already_verified": True}
    ip = (request.client.host if request.client else "unknown")
    if not await _verify_rate_ok(email, ip):
        raise HTTPException(status_code=429, detail="You've requested too many verification emails. Please wait an hour and try again.")
    await db.verify_sends.insert_one({"email": email, "ip": ip,
                                      "at": datetime.now(timezone.utc).isoformat(),
                                      "expire_at": datetime.now(timezone.utc) + timedelta(hours=2)})
    await _send_verification_email(user["user_id"], email, user.get("first_name") or user.get("name"))
    return {"ok": True, "hours_remaining": verification_state(user).get("hours_remaining")}


def _mask_email(email: Optional[str]) -> str:
    """j***@domain.com - enough to recognize your own address, not to reveal it."""
    email = (email or "").strip()
    if "@" not in email:
        return "your email"
    local, _, domain = email.partition("@")
    masked_local = (local[0] + "***") if local else "***"
    return f"{masked_local}@{domain}"


@router.post("/auth/verify-email/peek")
async def verify_email_peek(body: Dict[str, Any]):
    """Read-only: identify which account a verification link belongs to WITHOUT
    consuming the token. The page calls this first so it can compare the link's
    account to the signed-in account before doing the real (single-use)
    verification. Takes no session and changes nothing."""
    token = (body.get("token") or "").strip()
    if not token:
        return {"valid": False, "reason": "invalid"}
    rec = await db.email_verifications.find_one({"token": token})
    if not rec:
        return {"valid": False, "reason": "invalid"}
    user = await db.users.find_one({"user_id": rec["user_id"]}, {"_id": 0, "email": 1, "email_verified": 1})
    if user and user.get("email_verified"):
        return {"valid": True, "already_verified": True, "user_id": rec["user_id"],
                "email_masked": _mask_email(user.get("email"))}
    exp = rec.get("expires_at")
    try:
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except AttributeError:
        exp = None
    if rec.get("used") or (exp and datetime.now(timezone.utc) > exp):
        return {"valid": False, "reason": "expired"}
    return {"valid": True, "already_verified": False, "user_id": rec["user_id"],
            "email_masked": _mask_email(user.get("email") if user else None)}


@router.post("/auth/verify-email")
async def verify_email(body: Dict[str, Any]):
    """Consume a verification token. No auth required (the token is the proof), so
    the link works in a new tab or on another device."""
    token = (body.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing token.")
    rec = await db.email_verifications.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=400, detail="This verification link is invalid.")
    user = await db.users.find_one({"user_id": rec["user_id"]}, {"_id": 0, "email": 1, "email_verified": 1})
    masked = _mask_email(user.get("email") if user else None)
    if user and (user.get("email_verified")):
        return {"ok": True, "already_verified": True, "user_id": rec["user_id"], "email_masked": masked}
    exp = rec.get("expires_at")
    try:
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except AttributeError:
        exp = None
    if rec.get("used") or (exp and datetime.now(timezone.utc) > exp):
        raise HTTPException(status_code=400, detail="This verification link has expired. Please request a new one.")
    await db.users.update_one({"user_id": rec["user_id"]},
                              {"$set": {"email_verified": True,
                                        "email_verified_at": datetime.now(timezone.utc).isoformat()}})
    await db.email_verifications.update_one({"token": token}, {"$set": {"used": True}})
    return {"ok": True, "user_id": rec["user_id"], "email_masked": masked}


@router.post("/auth/change-email")
async def change_email(body: Dict[str, Any], request: Request,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """'Wrong email? Fix it' - change an unverified account's email and send a new
    verification link to the new address."""
    user = await current_user_from_token(session_token, authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in first.")
    if verification_state(user).get("verified"):
        raise HTTPException(status_code=400, detail="Your email is already verified.")
    new_email = (body.get("email") or "").strip().lower()
    if not new_email or "@" not in new_email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if is_disposable_email(new_email):
        raise HTTPException(status_code=400, detail="Please use a permanent email address.")
    if new_email == (user.get("email") or "").lower():
        raise HTTPException(status_code=400, detail="That's already your email.")
    clash = await db.users.find_one({"email": new_email, "user_id": {"$ne": user["user_id"]}}, {"_id": 1})
    if clash:
        raise HTTPException(status_code=409, detail="Another account already uses that email.")
    ip = (request.client.host if request.client else "unknown")
    if not await _verify_rate_ok(new_email, ip):
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait an hour and try again.")
    await db.users.update_one({"user_id": user["user_id"]},
                              {"$set": {"email": new_email, "email_verified": False}})
    # Invalidate any outstanding tokens for this account.
    await db.email_verifications.update_many({"user_id": user["user_id"], "used": False},
                                             {"$set": {"used": True}})
    await db.verify_sends.insert_one({"email": new_email, "ip": ip,
                                      "at": datetime.now(timezone.utc).isoformat(),
                                      "expire_at": datetime.now(timezone.utc) + timedelta(hours=2)})
    await _send_verification_email(user["user_id"], new_email, user.get("first_name") or user.get("name"))
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    from deps import account_identity_payload
    fresh.update(await account_identity_payload(fresh))
    return {"ok": True, "user": fresh}



@router.post("/auth/login")
async def login(body: LoginBody, request: Request, response: Response):
    email = body.email.strip().lower()
    ip = (request.client.host if request.client else "unknown")
    now = datetime.now(timezone.utc)
    # Tiered lockout: (identifier, max, window_minutes).
    tiers = [
        (f"combo:{ip}:{email}", MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES),
        (f"acct:{email}", ACCT_MAX_ATTEMPTS, ACCT_LOCKOUT_MINUTES),
        (f"ip:{ip}", IP_MAX_ATTEMPTS, IP_LOCKOUT_MINUTES),
    ]
    for ident, limit, window in tiers:
        rec = await db.login_attempts.find_one({"identifier": ident})
        if rec and rec.get("count", 0) >= limit:
            la = rec.get("last_attempt") or now
            if la.tzinfo is None:
                la = la.replace(tzinfo=timezone.utc)
            locked_until = la + timedelta(minutes=window)
            if now < locked_until:
                raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
            await db.login_attempts.delete_one({"identifier": ident})
    user = await db.users.find_one({"email": email})

    async def _record_fail():
        for ident, _l, _w in tiers:
            await db.login_attempts.update_one(
                {"identifier": ident},
                {"$inc": {"count": 1}, "$set": {"last_attempt": now}},
                upsert=True,
            )

    async def _clear_attempts():
        for ident, _l, _w in tiers:
            await db.login_attempts.delete_one({"identifier": ident})

    async def _finish_login():
        token = await _issue_session(user["user_id"], response)
        fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
        from deps import account_identity_payload
        fresh.update(await account_identity_payload(fresh))
        return {"user": fresh, "session_token": token}

    # Admin accounts are Google-only. The password form can never reach an admin
    # account unless the off-by-default break-glass switch is armed for this exact
    # email (and then only with the fresh env-held password hash).
    if user and is_admin(user):
        bg_active, _reason = await break_glass.status_for(email)
        if bg_active and break_glass.verify_password(body.password):
            await _clear_attempts()
            await _break_glass_alert(user, ip)
            return await _finish_login()
        await _record_fail()
        raise HTTPException(status_code=401,
                            detail="Admin accounts sign in with Google. Tap 'Continue with Google'.")

    if not user or not user.get("password_hash") or not _verify_password(body.password, user["password_hash"]):
        await _record_fail()
        if user and not user.get("password_hash"):
            raise HTTPException(status_code=401, detail="This account uses Google sign-in. Tap 'Continue with Google'.")
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    await _clear_attempts()
    # Promote-only bootstrap: the env list may grant admin, but it never demotes a
    # DB-granted admin. (Admins can't reach here - they are blocked above.)
    if email in admin_emails() and user.get("platform_role") != "admin":
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"platform_role": "admin"}})
    return await _finish_login()


async def _break_glass_alert(user: Dict[str, Any], ip: str) -> None:
    try:
        from audit import log_admin_action
        await log_admin_action(user, "break_glass_login", "admin_account",
                               user.get("user_id"), summary=f"Break-glass password login from {ip}")
    except Exception:
        logger.exception("break-glass audit failed")
    try:
        from mailer import send_email, admin_alert_email_html, app_public_url
        from admin_notify import admin_notify_email
        html = admin_alert_email_html(
            title="Break-glass admin login used",
            lines=[f"A break-glass password login succeeded for an admin account from IP {ip}.",
                   "If this was not you, clear the BREAK_GLASS_* environment settings now."],
            action_url=f"{app_public_url()}/admin", action_label="Open admin")
        await send_email(recipient_email=admin_notify_email(),
                         subject="Sail More Now: break-glass admin login used", html_content=html)
    except Exception:
        logger.exception("break-glass notify failed")


RESET_TTL_MIN = 60
RESET_MAX_PER_EMAIL = 3
RESET_MAX_PER_IP = 10
RESET_GENERIC_MSG = "If an account exists for that email, we sent a reset link."


def _sha256(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


@router.post("/auth/forgot-password")
async def forgot_password(body: Dict[str, Any], request: Request):
    """Always returns the same 200 and message, whether the email is unknown,
    Google-only or normal. Never reveals which."""
    email = (body.get("email") or "").strip().lower()
    ip = request.client.host if request.client else "unknown"
    generic = {"message": RESET_GENERIC_MSG}
    if not email or "@" not in email:
        return generic
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    hour_ago_iso = (now - timedelta(hours=1)).isoformat()
    # Log the request first so repeated calls keep counting toward the limit.
    await db.password_reset_requests.insert_one({"email": email, "ip": ip, "created_at": now_iso})
    email_count = await db.password_reset_requests.count_documents({"email": email, "created_at": {"$gte": hour_ago_iso}})
    ip_count = await db.password_reset_requests.count_documents({"ip": ip, "created_at": {"$gte": hour_ago_iso}})
    if email_count > RESET_MAX_PER_EMAIL or ip_count > RESET_MAX_PER_IP:
        logger.info("[reset] rate-limited; sending nothing")
        return generic
    user = await db.users.find_one({"email": email})
    if not user:
        return generic
    try:
        from mailer import (send_email, app_public_url,
                            password_reset_email_html, password_reset_google_email_html)
        base = app_public_url()
        name = (user.get("first_name") or (user.get("name") or "").split(" ")[0] or "")
        if not user.get("password_hash"):
            # Google-only account: no token, friendly nudge to use Continue with Google.
            await send_email(
                recipient_email=email,
                subject="Reset your Sail More Now password",
                html_content=password_reset_google_email_html(name=name, app_url=base),
                from_email="notifications@notifications.sailmorenow.com",
            )
            return generic
        # Normal account: invalidate prior unused tokens, mint a fresh single-use one.
        await db.password_resets.update_many(
            {"user_id": user["user_id"], "used": False},
            {"$set": {"used": True, "invalidated_at": now_iso}},
        )
        raw = secrets.token_urlsafe(32)
        await db.password_resets.insert_one({
            "user_id": user["user_id"],
            "token_hash": _sha256(raw),
            "expires_at": (now + timedelta(minutes=RESET_TTL_MIN)).isoformat(),
            "used": False,
            "created_at": now_iso,
        })
        reset_url = f"{base}/reset-password?token={raw}"
        await send_email(
            recipient_email=email,
            subject="Reset your Sail More Now password",
            html_content=password_reset_email_html(name=name, reset_url=reset_url, app_url=base),
            from_email="notifications@notifications.sailmorenow.com",
        )
    except Exception:
        logger.exception("[reset] forgot-password send failed")
    return generic


@router.post("/auth/reset-password")
async def reset_password(body: Dict[str, Any]):
    token = (body.get("token") or "").strip()
    new_password = body.get("new_password") or ""
    bad = HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    if not token or not new_password:
        raise bad
    now_iso = datetime.now(timezone.utc).isoformat()
    rec = await db.password_resets.find_one({"token_hash": _sha256(token), "used": False})
    if not rec or (rec.get("expires_at") or "") < now_iso:
        raise bad
    _validate_password_strength(new_password)  # same rules as register; raises its own 400
    user = await db.users.find_one({"user_id": rec["user_id"]})
    if not user:
        raise bad
    await db.users.update_one({"user_id": rec["user_id"]},
                              {"$set": {"password_hash": _hash_password(new_password)}})
    await db.password_resets.update_one({"_id": rec["_id"]},
                                        {"$set": {"used": True, "used_at": now_iso}})
    # Clear brute-force lockout counters for this email (identifier = "{ip}:{email}").
    try:
        await db.login_attempts.delete_many({"identifier": {"$regex": ":" + re.escape(user.get("email") or "") + "$"}})
    except Exception:
        logger.exception("[reset] clear lockout failed")
    # Invalidate every existing session so the old password can't keep one alive.
    await db.user_sessions.delete_many({"user_id": rec["user_id"]})
    return {"message": "Your password has been reset. You can sign in now."}


@router.patch("/auth/markets")
async def update_followed_markets(body: Dict[str, Any],
                                  session_token: Optional[str] = Cookie(default=None),
                                  authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    raw = body.get("markets") or []
    markets = [m for m in raw if m in PNW_MARKETS]
    # Keep the primary market in the followed set and cap the list.
    primary = u.get("primary_market")
    if primary and primary not in markets:
        markets.insert(0, primary)
    markets = list(dict.fromkeys(markets))[:12]
    if not markets:
        raise HTTPException(status_code=400, detail="Pick at least one market")
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"markets": markets}})
    await _zoho_enqueue(db, "profile_markets", u["user_id"])
    return {"markets": markets}


@router.get("/auth/me")
async def auth_me(session_token: Optional[str] = Cookie(default=None),
                  authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from deps import account_identity_payload
    u.update(await account_identity_payload(u))
    return u


@router.get("/auth/ws-token")
async def ws_token(session_token: Optional[str] = Cookie(default=None),
                   authorization: Optional[str] = Header(default=None)):
    """Return the caller's session token so the browser can attach it as a
    query param when opening the WebSocket (session cookies are HTTP-only)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = session_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="No session token")
    return {"user_id": u["user_id"], "token": token}


@router.post("/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(default=None)):
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@router.patch("/auth/handle")
async def update_handle(body: Dict[str, Any],
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    """Change the caller's @-handle. Handles are 3-20 chars, [A-Za-z0-9_], and
    globally unique (case-insensitive). Returns the updated user."""
    import re as _re
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    raw = (body.get("handle") or "").strip().lstrip("@")
    if not _re.fullmatch(r"[A-Za-z0-9_]{3,20}", raw):
        raise HTTPException(status_code=400,
                            detail="Username must be 3-20 letters, numbers or _")
    handle = raw.lower()
    if await handle_taken(handle, exclude_user_id=u["user_id"]):
        raise HTTPException(status_code=409, detail="That username is already taken")
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"handle": handle}})
    updated = await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0})
    await _zoho_enqueue(db, "profile_handle", u["user_id"])
    return updated


@router.patch("/auth/newsletter")
async def toggle_newsletter(body: NewsletterToggle,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"newsletter_opt_in": body.newsletter_opt_in}})
    zoho_result = await zoho.sync(email=u["email"], opt_in=body.newsletter_opt_in,
                                  first_name=u.get("name", ""), subscription=u.get("subscription_tier", "free"))
    await _zoho_enqueue(db, "newsletter", u["user_id"])
    return {"newsletter_opt_in": body.newsletter_opt_in, "zoho": zoho_result}


@router.patch("/auth/account-type")
async def swap_account_type(body: AccountTypeSwap,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """Self-serve owner<->sailor role swap. Cannot switch to/from boat_pro or partner."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.account_type not in {"sailor", "boat_owner"}:
        raise HTTPException(status_code=400, detail="Self-serve swap only supports sailor <-> boat_owner")
    if u.get("account_type") not in {"sailor", "boat_owner"}:
        raise HTTPException(status_code=400, detail="Contact support to change your account type")
    update: Dict[str, Any] = {"account_type": body.account_type}
    if body.account_type == "boat_owner":
        if body.boat_name is not None:
            update["boat_name"] = (body.boat_name or "").strip()[:MAX_BOAT_FIELD_CHARS] or None
        if body.boat_make_model is not None:
            update["boat_make_model"] = (body.boat_make_model or "").strip()[:MAX_BOAT_FIELD_CHARS] or None
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    await _zoho_enqueue(db, "profile_account_type", u["user_id"])
    return await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0})


@router.patch("/auth/profile")
async def update_self_profile(body: ProfileSelfUpdate,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Members can edit their own display name and email."""
    import re as _re
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    update: Dict[str, Any] = {}
    if body.name is not None:
        name = body.name.strip()[:80]
        if not name:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        update["name"] = name
    if body.first_name is not None or body.last_name is not None:
        fn = (body.first_name if body.first_name is not None else u.get("first_name") or "").strip()[:60]
        ln = (body.last_name if body.last_name is not None else u.get("last_name") or "").strip()[:60]
        if not fn and not ln:
            # Both blank: keep the existing name/first/last — never blank the name.
            pass
        elif not fn:
            raise HTTPException(status_code=400, detail="Please enter your first name — it can't be blank.")
        else:
            update["first_name"] = fn
            update["last_name"] = ln
            if u.get("account_type") != "partner":
                update["name"] = f"{fn} {ln}".strip()
    if body.company_name is not None:
        update["company_name"] = body.company_name.strip()[:120] or None
    if body.bio is not None:
        trimmed = body.bio.strip()
        if len(trimmed) > 300:
            raise HTTPException(status_code=400, detail="Bio must be 300 characters or less")
        update["bio"] = trimmed or None
    if body.website is not None:
        update["website"] = body.website.strip()[:200] or None
    if body.org_name is not None and u.get("account_type") == "partner":
        on = body.org_name.strip()[:120]
        update["org_name"] = on or None
        if on:
            update["name"] = on
    if body.email is not None:
        email = body.email.strip().lower()
        if not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=400, detail="Enter a valid email")
        if email != (u.get("email") or "").lower():
            clash = await db.users.find_one({"email": email, "user_id": {"$ne": u["user_id"]}}, {"_id": 1})
            if clash:
                raise HTTPException(status_code=400, detail="That email is already in use")
        update["email"] = email
    add_market = None
    if body.primary_market is not None:
        if body.primary_market not in PNW_MARKETS:
            raise HTTPException(status_code=400, detail="Invalid home market")
        update["primary_market"] = body.primary_market
        add_market = body.primary_market  # auto-follow the new home market
    if (body.org_categories is not None or body.org_category is not None) and u.get("account_type") == "partner":
        raw = body.org_categories if body.org_categories is not None else ([body.org_category] if body.org_category else [])
        cats = [c for c in (raw or []) if c in ORG_CATEGORIES]
        update["org_categories"] = cats
        update["org_category"] = cats[0] if cats else None
    if not update and add_market is None:
        return await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0})
    ops: Dict[str, Any] = {}
    if update:
        ops["$set"] = update
    if add_market is not None:
        ops["$addToSet"] = {"markets": add_market}
    await db.users.update_one({"user_id": u["user_id"]}, ops)
    await _zoho_enqueue(db, "profile_update", u["user_id"])
    return await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0})


@router.patch("/auth/boat-details")
async def update_boat_details(body: BoatDetailsUpdate,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Owners can add or change their boat name / make & model later."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    update = {
        "boat_name": (body.boat_name or "").strip()[:MAX_BOAT_FIELD_CHARS] or None,
        "boat_make_model": (body.boat_make_model or "").strip()[:MAX_BOAT_FIELD_CHARS] or None,
    }
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    return await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0})


@router.patch("/auth/onboarding")
async def onboarding(body: OnboardingBody,
                     session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not body.policies_agreed:
        raise HTTPException(status_code=400, detail="Must agree to policies")
    if body.account_type not in {"sailor", "boat_owner", "boat_pro", "partner"}:
        raise HTTPException(status_code=400, detail="Invalid account_type")
    if body.primary_market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid primary_market")
    markets = list({body.primary_market, *body.markets})
    first_completion = not u.get("onboarding_complete")
    update = {
        "account_type": body.account_type, "primary_market": body.primary_market, "markets": markets,
        "reasons": body.reasons, "avatar": clean_avatar(body.avatar), "username": body.username, "bio": body.bio,
        "newsletter_opt_in": body.newsletter_opt_in, "policies_agreed": True, "onboarding_complete": True,
        "policies_agreed_at": datetime.now(timezone.utc).isoformat(),
        "policies_version": POLICIES_VERSION,
        "member_status": "active",
    }
    if body.account_type == "partner" and body.org_category is not None:
        update["org_category"] = body.org_category or None
    # Optional handle claim during onboarding — validate + case-insensitive uniqueness check.
    if body.handle:
        import re as _re
        raw = body.handle.strip().lstrip("@")
        if not _re.fullmatch(r"[A-Za-z0-9_]{3,20}", raw):
            raise HTTPException(status_code=400,
                                detail="Username must be 3-20 letters, numbers or _")
        h = raw.lower()
        if await handle_taken(h, exclude_user_id=u["user_id"]):
            raise HTTPException(status_code=409, detail="That username is already taken")
        update["handle"] = h
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    updated = await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0})
    # First time a (Google) signup finishes setup → active-member welcome email
    # via Resend. App signups never go through the Zoho waitlist path; the
    # newsletter opt-in is kept in the DB for a later Zoho backfill.
    if first_completion:
        try:
            from mailer import send_email, welcome_member_email_html
            fname = (updated.get("name") or "").split(" ")[0]
            await send_email(
                recipient_email=updated["email"],
                subject="Welcome to the Sail More Now Community",
                html_content=welcome_member_email_html(
                    account_type=updated.get("account_type"),
                    first_name=updated.get("first_name") or fname,
                    company_name=updated.get("company_name"),
                    org_name=updated.get("org_name"),
                    display_name=updated.get("name"),
                    app_url="https://app.sailmorenow.com",
                ),
                from_email="notifications@notifications.sailmorenow.com",
            )
        except Exception:
            logger.exception("welcome email failed on onboarding for %s", updated.get("email"))
    await _zoho_enqueue(db, "onboarding", u["user_id"])
    return updated


# --- Admin: Zoho + scheduler ------------------------------------------------
@router.get("/admin/zoho/lists")
async def admin_zoho_lists(admin=Depends(require_admin)):
    return await zoho.list_mailing_lists()


@router.get("/admin/zoho/status")
async def admin_zoho_status(admin=Depends(require_admin)):
    cfg = zoho.cfg
    return {
        "ready_for_auth": cfg.ready_for_auth,
        "ready_for_list_ops": cfg.ready_for_list_ops,
        "has_list_key": bool(cfg.list_key),
        "has_topic_id": bool(cfg.topic_id),
        "unsubscribe_on_opt_out": cfg.unsubscribe_on_opt_out,
        "api_root": cfg.api_root,
    }


@router.post("/admin/zoho/backfill")
async def admin_zoho_backfill(admin=Depends(require_admin)):
    cursor = db.users.find({"newsletter_opt_in": True}, {"_id": 0, "email": 1, "name": 1})
    synced = 0
    skipped = 0
    errors = 0
    async for u in cursor:
        email = (u.get("email") or "").lower()
        if not email or email.endswith("@sailmorenow.dev"):
            skipped += 1
            continue
        r = await zoho.sync(email=email, opt_in=True, first_name=u.get("name", ""))
        if r.get("status") == "ok":
            synced += 1
        else:
            errors += 1
    return {"synced": synced, "skipped_seed": skipped, "errors": errors}


# --- Admin: Zoho CRM (Contacts) sync -----------------------------------------
async def _zoho_audit(admin, action: str):
    try:
        from audit import log_admin_action
        await log_admin_action(admin, action, "zoho_crm", "connection", summary=action)
    except Exception:
        logger.exception("zoho audit failed")


@router.get("/admin/zoho/crm/status")
async def admin_zoho_crm_status(admin=Depends(require_admin)):
    from zoho_crm import crm
    from zoho_sync import outbox_counts, recent_failures, _exclude_handles, _SEED_NAME_MARKERS, refresh_exclusions
    from zoho_secrets import sync_enabled, token_present, token_updated_at, token_source, last_conn_test, campaigns_enabled
    await refresh_exclusions(db)
    dry = await db.app_meta.find_one({"key": "zoho_backfill_dryrun"}, {"_id": 0, "at": 1})
    has_token = await token_present(db)
    client_present = bool(crm.cfg.client_id and crm.cfg.client_secret and crm.cfg.accounts_url)
    return {
        "crm_enabled": await sync_enabled(db),
        "campaigns_enabled": await campaigns_enabled(db),
        "credentials_present": client_present and has_token,
        "client_present": client_present,
        "token_present": has_token,
        "token_source": await token_source(db),
        "token_updated_at": await token_updated_at(db),
        "last_conn_test": await last_conn_test(db),
        "accounts_url": crm.cfg.accounts_url,
        "api_domain": crm.cfg.api_domain,
        "outbox": await outbox_counts(db),
        "recent_failures": await recent_failures(db),
        "last_dry_run_at": (dry or {}).get("at"),
        "exclusions": {"handles": sorted(_exclude_handles()), "name_markers": _SEED_NAME_MARKERS,
                       "rules": ["@sailmorenow.dev emails", "ids starting tmp_/seed_", "demo in id/handle"]},
    }


# --- Admin: Zoho CRM connection (secure credential screen) --------------------
_EXCHANGE_ERRORS = {
    "missing_client": "No Zoho client id/secret is configured in this environment. Add them first.",
    "network": "Could not reach Zoho. Check the data center (ZOHO_ACCOUNTS_URL) and try again.",
    "invalid_code": "That grant code is expired or was already used. Generate a fresh code in the Zoho Self Client and paste it within a few minutes.",
    "invalid_client": "The client id/secret here do not match the Zoho app that created the code. Use the same Self Client.",
    "invalid_grant": "That grant code is expired or was already used. Generate a fresh one and paste it right away.",
    "no_refresh_token": "Zoho did not return a refresh token. Make sure the Self Client code was generated with the CRM scopes (Contacts, Leads, settings fields) and pick 'Generate Code'.",
}


def _exchange_message(code: str) -> str:
    if code in _EXCHANGE_ERRORS:
        return _EXCHANGE_ERRORS[code]
    if code.startswith("http_"):
        return f"Zoho rejected the request ({code}). Check the client, data center and scopes, then try a fresh code."
    return "The exchange failed. Generate a fresh grant code and try again."


@router.get("/admin/zoho/crm/connection")
async def admin_zoho_crm_connection(admin=Depends(require_admin)):
    from zoho_crm import crm
    from zoho_secrets import sync_enabled, token_present, token_updated_at, token_source, last_conn_test
    return {
        "sync_enabled": await sync_enabled(db),
        "token_present": await token_present(db),
        "token_source": await token_source(db),
        "token_updated_at": await token_updated_at(db),
        "client_present": bool(crm.cfg.client_id and crm.cfg.client_secret and crm.cfg.accounts_url),
        "accounts_url": crm.cfg.accounts_url,
        "api_domain": crm.cfg.api_domain,
        "last_conn_test": await last_conn_test(db),
    }


@router.post("/admin/zoho/crm/exchange-code")
async def admin_zoho_crm_exchange(body: Dict[str, Any], request: Request, admin=Depends(require_admin)):
    rate_limit("zoho_crm_secret", request, 10, 600, "Too many attempts. Wait a few minutes.")
    code = (body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Paste the grant code from the Zoho Self Client.")
    from zoho_secrets import exchange_grant_code, store_refresh_token
    res = await exchange_grant_code(code)
    if not res.get("ok"):
        await _zoho_audit(admin, f"exchange_code_failed:{res.get('error')}")
        raise HTTPException(status_code=400, detail=_exchange_message(res.get("error") or ""))
    stored = await store_refresh_token(db, res["refresh_token"])
    if not stored:
        await _zoho_audit(admin, "exchange_code_store_failed")
        raise HTTPException(status_code=500, detail="Got the token but could not store it. ZOHO_SECRETS_KEY may be missing.")
    await _zoho_audit(admin, "exchange_code_ok")
    return {"ok": True, "token_present": True}


@router.post("/admin/zoho/crm/set-token")
async def admin_zoho_crm_set_token(body: Dict[str, Any], request: Request, admin=Depends(require_admin)):
    rate_limit("zoho_crm_secret", request, 10, 600, "Too many attempts. Wait a few minutes.")
    tok = (body.get("refresh_token") or "").strip()
    if not tok:
        raise HTTPException(status_code=400, detail="Paste a Zoho refresh token.")
    from zoho_secrets import store_refresh_token
    if not await store_refresh_token(db, tok):
        await _zoho_audit(admin, "set_token_store_failed")
        raise HTTPException(status_code=500, detail="Could not store the token. ZOHO_SECRETS_KEY may be missing.")
    await _zoho_audit(admin, "set_token_ok")
    return {"ok": True, "token_present": True}


@router.post("/admin/zoho/crm/disconnect")
async def admin_zoho_crm_disconnect(request: Request, admin=Depends(require_admin)):
    rate_limit("zoho_crm_secret", request, 20, 600, "Too many attempts. Wait a few minutes.")
    from zoho_secrets import delete_refresh_token, set_sync_enabled
    await delete_refresh_token(db)
    await set_sync_enabled(db, False)  # safety: cannot stay ON with no token
    await _zoho_audit(admin, "disconnect")
    return {"ok": True, "token_present": False, "sync_enabled": False}


@router.post("/admin/zoho/crm/test")
async def admin_zoho_crm_test(request: Request, admin=Depends(require_admin)):
    rate_limit("zoho_crm_test", request, 20, 600, "Too many tests. Wait a few minutes.")
    from zoho_crm import crm, ZohoCRMError
    from zoho_secrets import get_refresh_token, record_conn_test
    from zoho_sync import market_preview
    crm.set_refresh_token(await get_refresh_token(db) or "")
    if not crm.cfg.ready:
        await record_conn_test(db, False)
        return {"connected": False, "error": "No client credentials or refresh token yet."}
    crm._picklists = None
    try:
        await crm.load_picklists()  # read-only Contacts field metadata
    except ZohoCRMError as e:
        await record_conn_test(db, False)
        msg = str(e)
        if "401" in msg or "no_token" in msg:
            friendly = "Zoho rejected the token. Reconnect with a fresh grant code."
        elif "fields" in msg or "403" in msg:
            friendly = "Connected, but the token is missing the settings.fields.READ scope. Regenerate with CRM scopes."
        else:
            friendly = "Could not reach Zoho CRM. Check the data center and try again."
        await _zoho_audit(admin, "conn_test_failed")
        return {"connected": False, "error": friendly}
    await record_conn_test(db, True)
    await _zoho_audit(admin, "conn_test_ok")
    return {"connected": True, "market_map": await market_preview()}


@router.post("/admin/zoho/crm/sync-toggle")
async def admin_zoho_crm_sync_toggle(body: Dict[str, Any], request: Request, admin=Depends(require_admin)):
    rate_limit("zoho_crm_secret", request, 30, 600, "Too many changes. Wait a few minutes.")
    on = bool(body.get("on"))
    from zoho_secrets import set_sync_enabled, last_conn_test, token_present
    if on:
        if not await token_present(db):
            raise HTTPException(status_code=400, detail="Connect a Zoho token before turning sync on.")
        lt = await last_conn_test(db)
        fresh = bool(lt and lt.get("ok") and lt.get("at", "") >= (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
        if not fresh:
            raise HTTPException(status_code=400, detail="Run a successful connection test in the last hour before turning sync on.")
    await set_sync_enabled(db, on)
    await _zoho_audit(admin, f"sync_toggle:{'on' if on else 'off'}")
    return {"ok": True, "sync_enabled": on}


@router.post("/admin/zoho/campaigns/toggle")
async def admin_zoho_campaigns_toggle(body: Dict[str, Any], request: Request, admin=Depends(require_admin)):
    """Zoho Campaigns kill switch. Default OFF = no Campaigns calls, so Zoho
    cannot send any confirmation or marketing email. Turning ON is a deliberate
    admin choice (the UI shows a warning first)."""
    rate_limit("zoho_crm_secret", request, 30, 600, "Too many changes. Wait a few minutes.")
    on = bool(body.get("on"))
    from zoho_secrets import set_campaigns_enabled
    await set_campaigns_enabled(db, on)
    await _zoho_audit(admin, f"campaigns_toggle:{'on' if on else 'off'}")
    return {"ok": True, "campaigns_enabled": on}


@router.post("/admin/zoho/crm/retry-failed")
async def admin_zoho_crm_retry(admin=Depends(require_admin)):
    from zoho_sync import requeue_failed
    n = await requeue_failed(db)
    await _zoho_audit(admin, f"retry_failed:{n}")
    return {"ok": True, "requeued": n, "note": "Requeued to pending; the drain worker sends them within ~2 minutes."}


@router.post("/admin/zoho/crm/reconcile")
async def admin_zoho_crm_reconcile(admin=Depends(require_admin)):
    from zoho_sync import start_job
    started = await start_job(db, "reconcile")
    if not started:
        raise HTTPException(status_code=409, detail="A Zoho job is already running.")
    await _zoho_audit(admin, "reconcile_started")
    return {"started": True}


@router.get("/admin/zoho/crm/job")
async def admin_zoho_crm_job(admin=Depends(require_admin)):
    from zoho_sync import job_status
    return await job_status(db)


@router.post("/admin/zoho/crm/exclude")
async def admin_zoho_crm_exclude(body: Dict[str, Any], request: Request, admin=Depends(require_admin)):
    rate_limit("zoho_crm_secret", request, 30, 600, "Too many changes. Wait a few minutes.")
    from zoho_sync import add_exclude_handle
    h = (body.get("handle") or "").strip()
    if not h:
        raise HTTPException(status_code=400, detail="Provide a username.")
    handles = await add_exclude_handle(db, h, remove=bool(body.get("remove")))
    await _zoho_audit(admin, f"exclude_{'remove' if body.get('remove') else 'add'}:{h}")
    return {"ok": True, "handles": handles}


@router.post("/admin/zoho/crm/backfill/dry-run")
async def admin_zoho_crm_backfill_dry(admin=Depends(require_admin)):
    from zoho_sync import backfill
    return await backfill(db, dry_run=True)


@router.post("/admin/zoho/crm/backfill/run")
async def admin_zoho_crm_backfill_run(admin=Depends(require_admin)):
    from zoho_sync import start_job
    from zoho_secrets import sync_enabled
    if not await sync_enabled(db):
        raise HTTPException(status_code=400, detail="CRM sync is OFF; turn it on first.")
    dry = await db.app_meta.find_one({"key": "zoho_backfill_dryrun"}, {"_id": 0, "at": 1})
    at = (dry or {}).get("at")
    if not at or at < (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat():
        raise HTTPException(status_code=400, detail="Run a dry-run within the last hour before a live backfill.")
    started = await start_job(db, "backfill")
    if not started:
        raise HTTPException(status_code=409, detail="A Zoho job is already running.")
    await _zoho_audit(admin, "live_backfill_started")
    return {"started": True}


@router.get("/admin/zoho/campaigns/check")
async def admin_zoho_campaigns_check(admin=Depends(require_admin)):
    """Safe, read-only Campaigns connection check: connected yes/no + list names
    (never secrets). Uses the existing getmailinglists call."""
    cfg = zoho.cfg
    missing = [k for k, v in {
        "ZOHO_ACCOUNTS_URL": cfg.accounts_url, "ZOHO_CLIENT_ID": cfg.client_id,
        "ZOHO_CLIENT_SECRET": cfg.client_secret, "ZOHO_REFRESH_TOKEN": cfg.refresh_token,
        "ZOHO_CAMPAIGNS_LIST_KEY": cfg.list_key,
    }.items() if not v]
    result = await zoho.list_mailing_lists() if cfg.ready_for_auth else {"status": "error", "reason": "no_auth"}
    lists = []
    body = result.get("body") if isinstance(result, dict) else None
    if isinstance(body, dict):
        for lst in (body.get("list_of_details") or []):
            if isinstance(lst, dict) and lst.get("listname"):
                lists.append(lst.get("listname"))
    return {"connected": result.get("status") == "ok", "missing_env": missing,
            "has_list_key": bool(cfg.list_key), "list_names": lists}



@router.get("/admin/scheduler/status")
async def admin_scheduler_status(admin=Depends(require_admin)):
    return {"next_run": next_run(), "cron": "Sundays 03:00 America/Los_Angeles"}
