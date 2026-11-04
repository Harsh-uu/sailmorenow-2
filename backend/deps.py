"""Shared FastAPI dependencies + DB client + auth helpers + WS manager."""
from __future__ import annotations
import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from fastapi import Cookie, Header, HTTPException, WebSocket
from motor.motor_asyncio import AsyncIOMotorClient

from date_utils import add_months

logger = logging.getLogger("smn.deps")

# --- DB ---------------------------------------------------------------------
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_MODE = os.environ.get("STRIPE_MODE", "")


def stripe_mode() -> Dict[str, Any]:
    """Return the currently-configured Stripe mode. At go-live only STRIPE_MODE
    and STRIPE_SECRET_KEY switch to live (STRIPE_API_KEY stays on the sandbox
    key), so mode is read from STRIPE_MODE when set and only falls back to the
    STRIPE_API_KEY prefix for preview/local where STRIPE_MODE is unset. Also
    exposes whether a webhook signing secret is present so the /pricing UI can
    show a 'Test mode' banner and the payments router can decide whether to
    enforce Stripe-Signature verification."""
    env_mode = (STRIPE_MODE or "").strip().lower()
    if env_mode in ("live", "test"):
        mode = env_mode
    else:
        key = STRIPE_API_KEY or ""
        if key.startswith("sk_live_"):
            mode = "live"
        elif key.startswith("sk_test_"):
            mode = "test"
        else:
            mode = "unknown"
    return {
        "mode": mode,
        "webhook_secret_configured": bool(os.environ.get("STRIPE_WEBHOOK_SECRET")),
    }


# Boot assertion: in live mode the effective outgoing secret (STRIPE_SECRET_KEY,
# else STRIPE_API_KEY) MUST be a live key, or real billing calls could hit the
# test account. Logged loudly (not fatal) so boot is never blocked.
if (STRIPE_MODE or "").strip().lower() == "live":
    import logging as _lg
    _eff_secret = STRIPE_SECRET_KEY or STRIPE_API_KEY or ""
    if not _eff_secret.startswith("sk_live_"):
        _lg.getLogger("smn").error(
            "STRIPE_MODE=live but the effective Stripe secret is not a live key "
            "(sk_live_*). Real payment calls could hit the TEST account - set a live "
            "STRIPE_SECRET_KEY before taking live payments.")



# ---------- Per-IP sliding-window rate limiter (in-process) ----------
_RATE_BUCKETS: Dict[str, Dict[str, list]] = {}


def client_ip(request) -> str:
    if request is None:
        return "unknown"
    fwd = request.headers.get("x-forwarded-for")
    return ((fwd or (request.client.host if request.client else "") or "unknown").split(",")[0].strip()) or "unknown"


def rate_limit(bucket: str, request, limit: int, window: int, detail: str = "Too many requests. Please slow down.") -> None:
    """Raise 429 when `ip` exceeds `limit` hits within `window` seconds for `bucket`."""
    ip = client_ip(request)
    now_ts = datetime.now(timezone.utc).timestamp()
    hits_by_ip = _RATE_BUCKETS.setdefault(bucket, {})
    for _ip in list(hits_by_ip.keys()):
        fresh = [t for t in hits_by_ip[_ip] if now_ts - t < window]
        if fresh:
            hits_by_ip[_ip] = fresh
        else:
            hits_by_ip.pop(_ip, None)
    hits = hits_by_ip.get(ip, [])
    if len(hits) >= limit:
        # Persist the block for the admin abuse panel (fire-and-forget).
        try:
            import asyncio
            asyncio.get_running_loop().create_task(db.rate_limit_events.insert_one({
                "bucket": bucket, "ip": ip, "path": str(getattr(request, "url", "")).split("?")[0][-120:],
                "ua": (request.headers.get("user-agent") or "")[:160],
                "at": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc),
            }))
        except Exception:
            pass
        raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": str(window)})
    hits.append(now_ts)
    hits_by_ip[ip] = hits


# --- Auth helpers -----------------------------------------------------------
def _parse_iso(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value) if isinstance(value, str) else value
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def promote_or_lapse(user: Dict[str, Any]) -> Dict[str, Any]:
    """Called when a user's paid plan has lapsed (expiry in the past). If a
    queued plan exists (PLAN-QUEUE-1 / RULE 1) PROMOTE it: start = the old
    expiry instant (never the future), end = add_months(start, months), re-run
    tier side effects, write a Started/Renewed history line + Zoho event. If the
    queue is empty, drop to free and write a Lapsed line. Atomic + idempotent:
    the promote pulls the queued plan by session_id and the lapse guards on a
    non-free tier, so two concurrent callers can never double-apply. Banned
    users are never promoted here (they are treated as logged-out upstream and
    skipped by the nightly job); promotion happens on unban. Mutates and returns
    `user`."""
    uid = user["user_id"]
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    queue = user.get("queued_plans") or []
    # Defensive: callers only invoke this on a lapsed plan. If the current plan
    # is a non-free tier that has NOT expired yet, there is nothing to do (never
    # shorten an active plan or lapse a freshly promoted one).
    tier_now = (user.get("subscription_tier") or "free").lower()
    exp_now = _parse_iso(user.get("subscription_expires"))
    if tier_now != "free" and not (exp_now and exp_now < now):
        return user
    if queue:
        q = queue[0]
        months = int(q.get("months") or 0)
        # start = old expiry if it is in the past, else now (safety).
        exp_dt = _parse_iso(user.get("subscription_expires"))
        start_dt = exp_dt if (exp_dt and exp_dt <= now) else now
        start_iso = start_dt.isoformat()
        end_iso = add_months(start_dt, months).isoformat()
        aud = q.get("audience")
        new_tier = "premium" if aud in ("sailor", "boat_owner") else (q.get("tier") or "free")
        prev_tier = (user.get("subscription_tier") or "free").lower()
        res = await db.users.update_one(
            {"user_id": uid, "queued_plans.session_id": q.get("session_id")},
            {"$set": {"subscription_tier": new_tier, "subscription_expires": end_iso,
                      "subscription_started_at": start_iso, "zoho_plan_term_months": months,
                      "subscription_package_id": q.get("package_id")},
             "$pull": {"queued_plans": {"session_id": q.get("session_id")}}},
        )
        if res.modified_count == 1:
            user["subscription_tier"] = new_tier
            user["subscription_expires"] = end_iso
            user["subscription_started_at"] = start_iso
            user["queued_plans"] = []
            if aud == "boat_pro":
                try:
                    from routers.payments_router import _ensure_boat_pro_listing
                    await _ensure_boat_pro_listing(uid, q.get("tier"))
                except Exception:
                    logger.exception("promote: boat pro listing ensure failed for %s", uid)
            try:
                from zoho_sync import record_sub_event, sub_history_line, enqueue as _zq
                action = "Renewed" if prev_tier == new_tier else "Started"
                note = "(Stripe test mode)" if str(q.get("session_id") or "").startswith("cs_test_") else ""
                fresh = await db.users.find_one({"user_id": uid}, {"_id": 0})
                await record_sub_event(db, uid, sub_history_line(fresh, action, note))
                await _zq(db, "plan_purchase", uid)
            except Exception:
                logger.exception("promote: zoho enqueue failed for %s", uid)
        return user

    # No queue -> lapse to free (guard so Lapsed is recorded once).
    res = await db.users.update_one(
        {"user_id": uid, "subscription_tier": {"$ne": "free"}},
        {"$set": {"subscription_tier": "free"}},
    )
    user["subscription_tier"] = "free"
    if res.modified_count == 1:
        try:
            from zoho_sync import record_sub_event, enqueue as _zq
            today = now.date().isoformat()
            await record_sub_event(db, uid, f"{today} | - | - | Lapsed | ends {today}")
            await _zq(db, "plan_lapsed", uid)
        except Exception:
            logger.exception("lapse: zoho enqueue failed for %s", uid)
    return user


async def current_user_from_token(
    session_token_cookie: Optional[str] = None,
    authorization: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    token = session_token_cookie
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        return None
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    # Deactivated/banned accounts are treated as logged-out everywhere (recoverable
    # by an admin clearing the flag).
    if user and user.get("banned"):
        return None
    # Deleted (tombstoned) accounts are logged-out everywhere and cannot sign in.
    if user and (user.get("deleted") or user.get("member_status") == "deleted"):
        return None
    # Lazy promote/lapse: if a paid subscription has lapsed, either promote a
    # queued plan (RULE 1) or revert to free, on access. Not reached for banned
    # users (returned as logged-out above), so a banned user's queue is held.
    if user and (user.get("subscription_tier") or "free") != "free":
        exp = user.get("subscription_expires")
        try:
            expd = datetime.fromisoformat(exp) if isinstance(exp, str) else exp
            if expd and expd.tzinfo is None:
                expd = expd.replace(tzinfo=timezone.utc)
            if expd and expd < datetime.now(timezone.utc):
                await promote_or_lapse(user)
        except Exception:
            logger.exception("lazy promote/lapse failed for %s", user.get("user_id"))
    return user


async def optional_user(
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> Optional[Dict[str, Any]]:
    return await current_user_from_token(session_token, authorization)


async def require_user(
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    user = await current_user_from_token(session_token, authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def admin_emails() -> set:
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin(user: Optional[Dict[str, Any]]) -> bool:
    # Admin status is DB-authoritative (users.platform_role). The ADMIN_EMAILS env
    # list only bootstraps the first admin on an empty database (see server.py); it
    # no longer grants access at request time.
    if not user:
        return False
    return user.get("platform_role") == "admin"


async def count_admins() -> int:
    return await db.users.count_documents({"platform_role": "admin"})


async def require_admin(
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    user = await current_user_from_token(session_token, authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not is_admin(user):
        logger.warning("admin denied: user=%s email=%s", user.get("user_id"), user.get("email"))
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def purge_content(report_target_type: str, target_id: str, actor_id: str) -> None:
    """Shared cleanup when a post or discussion is removed by its author. Mirrors
    the admin delete flows (for-sale delete + report remove): drop the item's
    comments, reactions and bookmarks, remove notifications that point at it, and
    close any open report with target_deleted so the moderation queue does not
    dangle. Collections absent for a given type simply match nothing. The caller
    deletes the item document itself."""
    await db.comments.delete_many({"post_id": target_id})
    await db.reactions.delete_many({"target_id": target_id})
    await db.saved_items.delete_many({"target_id": target_id})
    await db.notifications.delete_many({"meta.post_id": target_id})
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.reports.update_many(
        {"target_type": report_target_type, "target_id": target_id, "status": "open"},
        {"$set": {"status": "resolved", "target_deleted": True,
                  "resolved_by": actor_id, "resolved_at": now_iso,
                  "resolution_notes": "author deleted the content"}},
    )



def is_paid_subscriber(user: Optional[Dict[str, Any]]) -> bool:
    # Back-compat alias — all callers now resolve through the single can_interact() helper.
    return can_interact(user)


# Tiers that count as paid. Kept here as the single list other modules can reuse.
PAID_TIERS = frozenset({"basic", "featured", "premium", "community_partner", "founding_partner"})

# The three allowed org/club statuses, stored in users.subscription_tier. This is
# the single source of truth for an org account's standing.
ORG_STATUSES = ("free", "community_partner", "founding_partner")

# SINGLE shared entitlement definition for org/club accounts: Community Partner
# and Founding Partner grant the EXACT SAME access (unlimited events, feed posts,
# messaging, reviews, etc.). They are deliberately identical and must never be
# split. All access gates resolve through can_interact()/is_paid_subscriber()
# (any non-free tier); this frozenset names the two entitled org statuses
# explicitly so a future tier rename/addition cannot accidentally give one
# partner tier access the other lacks. Founding Partner's only extra is cosmetic
# (the gold badge + public honor-roll), handled by partner_badge(), not here.
ENTITLED_ORG_STATUSES = frozenset({"community_partner", "founding_partner"})


def org_status(user_like: Optional[Dict[str, Any]]) -> str:
    """SINGLE source of truth for an org/club account's status: exactly one of
    'free', 'community_partner', 'founding_partner', read from
    subscription_tier. The legacy `founding_partner` boolean and
    `founding_cohort` fields are NOT read here (kept in the DB but no longer
    authoritative), so a stale flag can never add a second badge. Only orgs ever
    carry the community_partner/founding_partner tiers, so this is safe to call
    on any account."""
    if not user_like:
        return "free"
    tier = (user_like.get("subscription_tier") or "free").lower()
    return tier if tier in ("community_partner", "founding_partner") else "free"


def can_interact(user_like: Optional[Dict[str, Any]]) -> bool:
    """SINGLE source of truth for whether an account may actively participate:
    direct messages, group chat, Crew messages, posts, comments, reactions,
    reviews, events and Crew listings. Any paid tier qualifies (basic/featured/
    premium for members and Boat Pros; community_partner/founding_partner for
    orgs). Free accounts may browse/read only. account_type rules (e.g.
    organizations are never in the Crew Bank) are enforced separately by each
    caller."""
    if not user_like:
        return False
    tier = (user_like.get("subscription_tier") or "free").lower()
    return tier != "free"


def can_review(user_like: Optional[Dict[str, Any]]) -> bool:
    """Stricter paid check used ONLY for WRITING reviews: the tier must be one of
    PAID_TIERS (so a missing / None / "" tier counts as free), and an expired
    subscription is treated as free (same lapse rule the directory applies). This
    is intentionally stricter than can_interact(), whose plain `!= "free"` string
    compare would pass any non-empty tier string and ignores expiry. Accepting or
    rejecting a review about you is NOT gated by this."""
    if not user_like:
        return False
    tier = (user_like.get("subscription_tier") or "free").lower()
    if tier not in PAID_TIERS:
        return False
    exp = user_like.get("subscription_expires")
    if exp and exp < datetime.now(timezone.utc).isoformat():
        return False
    return True


# Structured upgrade payload so both clients can detect "needs upgrade" and show
# an upgrade prompt instead of a generic error. Returned as HTTP 403.
UPGRADE_REQUIRED = {
    "code": "upgrade_required",
    "message": "This is a Premium feature. Upgrade your account to message, write reviews, list yourself in the Crew Bank and verify your ID.",
}


VERIFY_GRACE_HOURS = 24


def verify_exempt(user: Optional[Dict[str, Any]]) -> bool:
    """Accounts exempt from the email-verification lock: the primary admin(s), any
    account an admin marked verified, and complimentary / demo accounts (needed for
    App Store reviewer logins)."""
    if not user:
        return False
    if (user.get("email") or "").lower() in admin_emails():
        return True
    if user.get("verified_by_admin"):
        return True
    if user.get("is_comp") or user.get("comp"):
        return True
    if (user.get("subscription_tier") or "").lower() in {"comp", "complimentary"}:
        return True
    return False


def verification_state(user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Email-verification status for a user. Google sign-ins and exempt accounts are
    always verified. A password account is 'required' until verified, and 'locked'
    once the 24h grace window since signup has elapsed."""
    if not user:
        return {"verified": True, "required": False, "locked": False, "exempt": False,
                "hours_remaining": None, "email": None}
    email = user.get("email")
    verified = bool(user.get("email_verified")) or bool(user.get("auth_google"))
    if verify_exempt(user):
        return {"verified": True, "required": False, "locked": False, "exempt": True,
                "hours_remaining": None, "email": email}
    if verified:
        return {"verified": True, "required": False, "locked": False, "exempt": False,
                "hours_remaining": None, "email": email}
    created = user.get("created_at")
    elapsed_h = 0.0
    try:
        dt = datetime.fromisoformat(created)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        elapsed_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
    except Exception:
        elapsed_h = 0.0
    locked = elapsed_h >= VERIFY_GRACE_HOURS
    remaining = max(0.0, VERIFY_GRACE_HOURS - elapsed_h)
    return {"verified": False, "required": True, "locked": locked, "exempt": False,
            "hours_remaining": round(remaining, 1), "email": email}


def require_not_locked(user: Optional[Dict[str, Any]]) -> None:
    if verification_state(user).get("locked"):
        raise HTTPException(status_code=403, detail="VERIFY_EMAIL_REQUIRED")


def require_interaction(user: Optional[Dict[str, Any]]) -> None:
    """Gate community interaction (DMs, posting, comments, reactions, reviews,
    crew listings) behind any paid tier. Free accounts can browse/read. A locked
    (long-unverified) account is blocked first with a verify-email message."""
    require_not_locked(user)
    if not is_paid_subscriber(user):
        raise HTTPException(status_code=403, detail=UPGRADE_REQUIRED)


# Account types (individuals) that may POST, COMMENT and REACT for free. A free
# Boat Pro cannot hold a public directory listing, so "free Boat Pro" always
# means "no listing". Organizations are NOT included: free orgs keep their own
# per-month post limit and stay blocked from comments/reactions/hub.
PARTICIPATION_ACCOUNT_TYPES = frozenset({"sailor", "boat_owner", "boat_pro"})


def can_participate(user_like: Optional[Dict[str, Any]]) -> bool:
    """Whether an account may post, comment and react. Any paid tier qualifies;
    free Sailors, Boat Owners and Boat Pros also qualify. Free organizations and
    anonymous users do not."""
    if not user_like:
        return False
    if can_interact(user_like):
        return True
    return (user_like.get("account_type") or "").lower() in PARTICIPATION_ACCOUNT_TYPES


def require_participation(user: Optional[Dict[str, Any]]) -> None:
    """Gate feed posts, comments, reactions and hub authoring. Free Sailors, Boat
    Owners and Boat Pros are allowed; free organizations and anonymous users are
    not. The 24-hour unverified-email lock still applies first (same as
    require_interaction), so a long-unverified account is blocked until it
    confirms its email."""
    require_not_locked(user)
    if not can_participate(user):
        raise HTTPException(status_code=403, detail=UPGRADE_REQUIRED)


def partner_badge(user_like: Optional[Dict[str, Any]]) -> Optional[str]:
    """Return the single partner badge kind for an org account, or None.
    'founding' = Founding Partner; 'partner' = Community Partner; None = Free.
    Derived ONLY from org_status() (i.e. subscription_tier), so an account can
    show exactly one badge and a stale legacy founding_partner flag can never
    add a second one."""
    status = org_status(user_like)
    if status == "founding_partner":
        return "founding"
    if status == "community_partner":
        return "partner"
    return None


def display_image(user_like: Optional[Dict[str, Any]]) -> Optional[str]:
    """Single source of truth for an account's displayed image, used by every
    screen that shows an account (profile headers, public page, directory/Clubs
    cards, feed posts & comments, messages, followers, search).

    Org/club (partner) accounts show their directory logo everywhere, falling
    back to the profile picture when only one of the two exists (no data is
    changed to make this work). All other account types use their uploaded
    picture, falling back to their chosen emoji avatar glyph."""
    if not user_like:
        return None
    if user_like.get("account_type") == "partner":
        return user_like.get("logo_url") or user_like.get("picture") or None
    return user_like.get("picture") or user_like.get("avatar") or None


AVATAR_MAX_CHARS = 40


def clean_avatar(value: Optional[str]) -> Optional[str]:
    """`avatar` holds a short emoji/glyph only, never an image URL or base64
    data URI (those belong in `picture`/`logo_url`). Reject data:/http values
    and cap the length so large payloads can never bloat a user record."""
    if not value:
        return None
    v = value.strip()
    low = v.lower()
    if low.startswith("data:") or low.startswith("http://") or low.startswith("https://"):
        return None
    return v[:AVATAR_MAX_CHARS] or None



async def handle_taken(handle: str, exclude_user_id: Optional[str] = None) -> bool:
    """One shared @-handle namespace across personal handles (users.handle) and
    business handles (boat_pros.business_handle). Returns True if `handle` is
    already used by anyone other than `exclude_user_id`."""
    h = (handle or "").strip().lstrip("@").lower()
    if not h:
        return False
    uq: Dict[str, Any] = {"handle": h}
    bq: Dict[str, Any] = {"business_handle": h}
    if exclude_user_id:
        uq["user_id"] = {"$ne": exclude_user_id}
        bq["user_id"] = {"$ne": exclude_user_id}
    if await db.users.find_one(uq, {"_id": 1}):
        return True
    if await db.boat_pros.find_one(bq, {"_id": 1}):
        return True
    return False


async def resolve_handle_user(handle: str) -> Optional[Dict[str, Any]]:
    """Resolve a handle (personal OR business) to the owning user document.
    Personal handles live on users.handle; business handles on
    boat_pros.business_handle. Used by @mentions and /u/<handle>."""
    h = (handle or "").strip().lstrip("@").lower()
    if not h:
        return None
    u = await db.users.find_one({"handle": h}, {"_id": 0})
    if u:
        return u
    pro = await db.boat_pros.find_one({"business_handle": h}, {"_id": 0, "user_id": 1})
    if pro and pro.get("user_id"):
        return await db.users.find_one({"user_id": pro["user_id"]}, {"_id": 0})
    return None


# --- Personal / business identity (Step 8a) --------------------------------
# An account authors content and acts as one of two identities: "personal"
# (the person) or "business" (their Boat Pro listing). The person's active
# identity is stored on users.last_identity and follows them across devices.

async def business_listing_for(u: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The caller's own Boat Pro listing document, or None. Only Boat Pro
    accounts can have one."""
    if not u or u.get("account_type") != "boat_pro":
        return None
    return await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})


async def can_act_as_business(u: Optional[Dict[str, Any]],
                              pro: Optional[Dict[str, Any]] = None) -> bool:
    """Eligible to act/author as the business identity when the account is a
    Boat Pro, a listing exists (created after payment), and the subscription is
    paid and not lapsed. Uses the SAME paid/not-expired check the review rules
    use (can_review) so the two never disagree; Basic counts as paid."""
    if not u or u.get("account_type") != "boat_pro":
        return False
    if pro is None:
        pro = await business_listing_for(u)
    return pro is not None and can_review(u)


async def resolve_active_identity(u: Optional[Dict[str, Any]],
                                  pro: Optional[Dict[str, Any]] = None) -> str:
    """The account's active identity, forcing "personal" whenever the account is
    not (or no longer) eligible for business — e.g. a lapsed plan."""
    want = (u or {}).get("last_identity") or "personal"
    if want == "business" and await can_act_as_business(u, pro):
        return "business"
    return "personal"


async def resolve_author_identity(u: Dict[str, Any], requested: Optional[str],
                                  pro: Optional[Dict[str, Any]] = None) -> str:
    """Resolve the identity a new item is authored as. `requested` (from the
    composer) wins when present; otherwise the account's active identity is
    used. Business is rejected (400) for accounts that cannot use it."""
    want = requested if requested in ("personal", "business") else None
    if requested is not None and want is None:
        raise HTTPException(status_code=400, detail="identity must be 'personal' or 'business'")
    if want is None:
        return await resolve_active_identity(u, pro)
    if want == "business":
        if not await can_act_as_business(u, pro):
            raise HTTPException(status_code=400, detail="This account can't post as a business.")
        return "business"
    return "personal"


async def author_fields(u: Dict[str, Any], identity: str,
                        pro: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """SINGLE source of truth for the denormalized author block stored on every
    new item (post, comment, discussion, DM). Personal uses the person's name,
    photo and handle (linking to /u/<handle>); business uses the listing's
    company name, logo and business handle (linking to /directory/<listing id>).
    No tier names are ever included."""
    if identity == "business":
        if pro is None:
            pro = await business_listing_for(u)
        pro = pro or {}
        return {
            "author_identity": "business",
            "author_business_id": u["user_id"],
            "author_name": pro.get("company_name") or u.get("name"),
            "author_avatar": pro.get("logo_url") or None,
            "author_handle": pro.get("business_handle") or u.get("handle"),
            "author_account_type": u.get("account_type"),
        }
    return {
        "author_identity": "personal",
        "author_business_id": None,
        "author_name": u.get("name"),
        "author_avatar": display_image(u),
        "author_handle": u.get("handle"),
        "author_account_type": u.get("account_type"),
    }


async def account_identity_payload(u: Dict[str, Any]) -> Dict[str, Any]:
    """Identity fields merged into the /auth/me user payload so the web client
    knows whether to show the 'Acting as' switcher and what to label it."""
    pro = await business_listing_for(u)
    eligible = await can_act_as_business(u, pro)
    active = await resolve_active_identity(u, pro)
    return {
        "active_identity": active,
        "can_use_business": eligible,
        "business_name": (pro or {}).get("company_name") if eligible else None,
        "business_logo": (pro or {}).get("logo_url") if eligible else None,
        "business_listing_id": u["user_id"] if eligible else None,
        "verification": verification_state(u),
    }




# --- WebSocket manager -----------------------------------------------------
class WSManager:
    def __init__(self):
        # user_id -> set of open WebSockets (multiple tabs / components per user).
        self.active: Dict[str, set] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: str, ws: Optional[WebSocket] = None):
        """Remove either a specific WebSocket or (legacy) all sockets for user."""
        bucket = self.active.get(user_id)
        if not bucket:
            return
        if ws is None:
            self.active.pop(user_id, None)
            return
        bucket.discard(ws)
        if not bucket:
            self.active.pop(user_id, None)

    async def send(self, user_id: str, payload: Dict[str, Any]):
        bucket = list(self.active.get(user_id, set()))
        text = json.dumps(payload)
        for ws in bucket:
            try:
                await ws.send_text(text)
            except Exception:
                self.disconnect(user_id, ws)

    async def broadcast(self, payload: Dict[str, Any]):
        text = json.dumps(payload)
        for uid, bucket in list(self.active.items()):
            for ws in list(bucket):
                try:
                    await ws.send_text(text)
                except Exception:
                    self.disconnect(uid, ws)


ws_manager = WSManager()
