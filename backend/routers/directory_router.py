"""Directory endpoints: markets, Boat Pros, reviews, crew positions."""
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, File, Header, HTTPException, Request, UploadFile

from deps import db, current_user_from_token, partner_badge, org_status, rate_limit, client_ip, require_interaction, handle_taken, display_image, can_review, business_listing_for, can_act_as_business, resolve_active_identity, is_admin, purge_content, clean_avatar
from storage import put_object, APP_NAME
from schemas import BoatProUpsert, BoatProListingUpdate, ReviewCreate, ReviewUpdate, MarketRequest, OrgListingUpdate, OrgReviewCreate, PersonalIdentityUpdate
from constants import PNW_MARKETS, BOAT_PRO_CATEGORIES, SAILOR_REASONS, CREW_POSITIONS, TIER_RANK, MAX_PHOTO_URL_CHARS, ORG_CATEGORIES, EXPERIENCE_TYPES, SAILING_STYLE_AXES

router = APIRouter()
logger = logging.getLogger("smn.directory")


@router.get("/markets")
async def list_markets():
    return {"markets": PNW_MARKETS, "categories": sorted(BOAT_PRO_CATEGORIES) + ["Other"],
            "reasons": SAILOR_REASONS, "org_categories": ORG_CATEGORIES,
            "experience_types": EXPERIENCE_TYPES, "sailing_style_axes": SAILING_STYLE_AXES}


@router.post("/markets/request")
async def request_market(body: MarketRequest):
    doc = {
        "id": str(uuid.uuid4()),
        "market_name": body.market_name,
        "requester_email": body.requester_email,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.market_requests.insert_one(doc)
    doc.pop("_id", None)
    # Admin alert: a market request is an admin-needed action that otherwise sat
    # silently in the DB with no notification (missed-alert fix, EMAIL-FIX-3).
    try:
        from admin_notify import admin_notify
        mkt = (body.market_name or "").replace("<", "&lt;")[:120]
        req = (body.requester_email or "").replace("<", "&lt;")[:200]
        await admin_notify(
            db, kind="market_request",
            subject="Sail More Now: new market request",
            title="New market request",
            lines=[f"A member asked to add the market <b>{mkt or 'Unnamed'}</b>.",
                   f"Requester: {req or 'not provided'}"],
            deep_link_path="/admin")
    except Exception:
        logger.exception("admin notify (market request) failed")
    return doc


@router.get("/crew-positions")
async def crew_positions():
    return {"positions": CREW_POSITIONS}


REVIEW_CATEGORIES = ["personality", "skill", "promptness", "communication"]
TIER_MAX_MARKETS = {"basic": 1, "featured": 2, "premium": 999}
CONTACT_FIELDS = ("contact_email", "contact_phone", "website")


CREDENTIAL_FIELDS = ("certifications", "licenses", "insurance")
CREDENTIALS_PREMIUM_MSG = "Credentials are included with Premium. Upgrade to add credentials."


def _norm_cred(raw) -> List[str]:
    """Normalize a credential list (certifications/licenses/insurance) for storage
    and for change-detection: strip whitespace, drop blanks, cap length."""
    out: List[str] = []
    for x in (raw or []):
        s = str(x).strip()[:200]
        if s and s not in out:
            out.append(s)
        if len(out) >= 50:
            break
    return out


def _apply_tier_visibility(pro: Dict[str, Any], tier: str, owner_view: bool = False) -> Dict[str, Any]:
    """Enforce the Plans and Pricing tier matrix on a Boat Pro payload.

    Entitlements: Basic = no logo/cover/gallery/credentials, 1 market;
    Featured = logo + cover, 2 markets, no gallery, no credentials;
    Premium = logo + cover + 5 gallery photos, unlimited markets, credentials.

    Data below its tier is KEPT in storage and never deleted. On a PUBLIC read
    the over-tier values are removed from the payload; on an OWNER read they are
    retained so the editor can show them with an upgrade nudge. Either way the
    hidden fields are reported in `locked_fields` (+ `hidden_photo_count`) so the
    UI can prompt an upgrade. Everything reappears automatically when the tier
    rises."""
    if not pro:
        return pro
    caps = _pro_tier_caps(tier)
    locked: List[str] = []

    # Trust and credentials — Premium only.
    if (tier or "basic").lower() != "premium":
        if any((pro.get(k) or []) for k in CREDENTIAL_FIELDS):
            locked.append("credentials")
        if not owner_view:
            for k in CREDENTIAL_FIELDS:
                pro.pop(k, None)

    # Logo — Featured and Premium only.
    if not caps["can_logo"]:
        if (pro.get("logo_url") or "").strip():
            locked.append("logo")
        if not owner_view:
            pro["logo_url"] = None
            pro.pop("logo_original_url", None)

    # Cover — Featured and Premium only.
    if not caps["can_cover"]:
        if (pro.get("cover_url") or "").strip():
            locked.append("cover")
        if not owner_view:
            pro["cover_url"] = None
            pro.pop("cover_original_url", None)

    # Gallery photos — Premium only, capped at max_photos (5).
    photos = pro.get("photos") or []
    hidden = max(0, len(photos) - caps["max_photos"])
    pro["hidden_photo_count"] = hidden
    if hidden:
        locked.append("gallery")
        if not owner_view:
            pro["photos"] = photos[:caps["max_photos"]]

    # Markets over the tier cap are kept but hidden publicly.
    max_m = TIER_MAX_MARKETS.get((tier or "basic").lower(), 1)
    mk = pro.get("markets") or []
    if len(mk) > max_m:
        locked.append("markets")
        if not owner_view:
            pro["markets"] = mk[:max_m]

    pro["locked_fields"] = locked
    return pro


def _lock_contact_for_guest(pro: Dict[str, Any], viewer: Optional[Dict[str, Any]]) -> None:
    """Signed-out visitors cannot see contact details."""
    if viewer:
        pro["contact_locked"] = False
        return
    for k in CONTACT_FIELDS:
        pro.pop(k, None)
    pro["contact_locked"] = True


@router.get("/boat-pros")
async def list_boat_pros(market: Optional[str] = None, category: Optional[str] = None, q: Optional[str] = None,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    viewer = await current_user_from_token(session_token, authorization)
    query: Dict[str, Any] = {}
    if market and market != "all":
        query["markets"] = market
    if category:
        query["categories"] = category
    if q:
        query["$or"] = [
            {"company_name": {"$regex": q, "$options": "i"}},
            {"short_bio": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.boat_pros.find(query, {"_id": 0}).to_list(500)
    # Attach the user's @-handle so directory cards can link to /u/:handle, and
    # hide listings whose owner's paid subscription has lapsed.
    user_ids = [d["user_id"] for d in docs if d.get("user_id")]
    handles = {}
    verified_ids = set()
    sub_tiers: Dict[str, str] = {}
    lapsed = set()
    now_iso = datetime.now(timezone.utc).isoformat()
    if user_ids:
        from deps import promote_or_lapse
        async for u in db.users.find({"user_id": {"$in": user_ids}},
                                     {"_id": 0, "user_id": 1, "handle": 1, "subscription_expires": 1, "identity_verified": 1, "subscription_tier": 1, "queued_plans": 1, "banned": 1}):
            if u.get("handle"):
                handles[u["user_id"]] = u["handle"]
            if u.get("identity_verified"):
                verified_ids.add(u["user_id"])
            exp = u.get("subscription_expires")
            # Expired stored end date: if a plan is queued (and not banned),
            # promote it now so the user is not briefly shown as lapsed before
            # the nightly job runs (DIR-GAP-1). Otherwise they are lapsed.
            if exp and exp < now_iso and (u.get("queued_plans")) and not u.get("banned"):
                await promote_or_lapse(u)
                exp = u.get("subscription_expires")
            sub_tiers[u["user_id"]] = (u.get("subscription_tier") or "free").lower()
            if exp and exp < now_iso:
                lapsed.add(u["user_id"])
    docs = [d for d in docs if d.get("user_id") not in lapsed]

    def _auth_tier(uid):
        t = sub_tiers.get(uid, "free")
        return t if t in {"basic", "featured", "premium"} else "basic"

    for d in docs:
        d["handle"] = handles.get(d.get("user_id"))
        d["identity_verified"] = d.get("user_id") in verified_ids
        d["tier"] = _auth_tier(d.get("user_id"))  # person's subscription is authoritative
        d["_rank"] = TIER_RANK.get(d["tier"], 3)
    docs.sort(key=lambda d: (d["_rank"], (d.get("company_name") or "")))
    from routers.reviews_router import compute_summary, _live_session_ids
    live_rows = await _live_session_ids()
    for d in docs:
        d.pop("_rank", None)
        _pro_public_images(d)
        summ = await compute_summary(d["user_id"], live_rows)
        d["rating"] = summ.get("overall")
        d["review_count"] = summ.get("count", 0)
        d["is_complete"] = bool(d.get("company_name") and d.get("short_bio") and (d.get("categories") or []) and (d.get("markets") or []) and len(d.get("photos") or []) >= 3)
        _apply_tier_visibility(d, d["tier"])
        _lock_contact_for_guest(d, viewer)
    return docs


def _pro_tier_caps(tier: str) -> Dict[str, Any]:
    """Boat Pro image entitlements by tier: Basic = none; Featured = logo + cover;
    Premium = logo + cover + 5-photo gallery."""
    t = (tier or "basic").lower()
    if t == "premium":
        return {"can_logo": True, "can_cover": True, "max_photos": 5}
    if t == "featured":
        return {"can_logo": True, "can_cover": True, "max_photos": 0}
    return {"can_logo": False, "can_cover": False, "max_photos": 0}


def _norm_pro_photos(raw):
    """Normalize a Boat Pro gallery to [{url, original}] (no captions), accepting
    legacy plain-string entries. `original` preserves the uncropped source."""
    out = []
    for p in (raw or []):
        if isinstance(p, str):
            s = p.strip()
            if s:
                out.append({"url": s, "original": s})
        elif isinstance(p, dict) and (p.get("url") or "").strip():
            url = str(p["url"]).strip()
            out.append({"url": url, "original": (str(p.get("original") or "").strip() or url)})
    return out


def _pro_public_images(pro):
    """Read-time image normalization for public Boat Pro payloads (parity with orgs):
    expose cover_url + logo_url + gallery objects. A legacy `photo_url` hero becomes the
    cover for not-yet-migrated pros. `photo_url` stays as a back-compat alias so existing
    directory cards keep rendering."""
    if not pro:
        return pro
    gallery = _norm_pro_photos(pro.get("photos"))
    cover = (pro.get("cover_url") or "").strip()
    if not pro.get("cover_migrated") and not cover and (pro.get("photo_url") or "").strip():
        cover = pro["photo_url"].strip()
    pro["cover_url"] = cover or None
    pro["photo_url"] = cover or (pro.get("photo_url") or None)
    pro["logo_url"] = pro.get("logo_url") or None
    pro["photos"] = [{"url": p["url"]} for p in gallery]
    return pro


def _derive_pro_tier(pro, u) -> str:
    """The person's subscription_tier is the single source of truth. boat_pros.tier
    is only a cached mirror and is intentionally ignored for gating decisions."""
    sub = (u.get("subscription_tier") or "free").lower()
    return sub if sub in {"basic", "featured", "premium"} else "basic"


def _business_identity(pro, u) -> Dict[str, Any]:
    """Derive the business identity's handle/email with the documented fallbacks:
    business_handle falls back to the account's current handle (pre-migration);
    business_email falls back to the account login email when blank."""
    return {
        "business_handle": pro.get("business_handle") or u.get("handle"),
        "business_email": pro.get("business_email") or None,
        "business_email_effective": pro.get("business_email") or u.get("email"),
    }


@router.get("/boat-pros/mine")
async def get_my_boat_pro(session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Return the caller's own Boat Pro listing enriched with tier image caps,
    normalized cover/logo/gallery, and category/market option lists — the same shape
    the dedicated listing editor consumes (parity with /org-listing/mine)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    pro = await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})
    if not pro:
        raise HTTPException(status_code=404, detail="No Boat Pro listing yet")
    tier = _derive_pro_tier(pro, u)
    caps = _pro_tier_caps(tier)
    gallery = _norm_pro_photos(pro.get("photos"))
    # One-time legacy migration (idempotent): promote the old hero `photo_url` to the
    # dedicated cover field, coerce string photos to objects, then flag it so a later
    # cleared cover isn't re-promoted on subsequent loads.
    if not pro.get("cover_migrated"):
        cover = (pro.get("cover_url") or "").strip()
        cover_orig = (pro.get("cover_original_url") or "").strip()
        if not cover and (pro.get("photo_url") or "").strip():
            cover = pro["photo_url"].strip()
            cover_orig = cover_orig or cover
        await db.boat_pros.update_one({"user_id": u["user_id"]}, {"$set": {
            "cover_url": cover or None, "cover_original_url": cover_orig or None,
            "photos": gallery, "cover_migrated": True,
        }})
        pro["cover_url"] = cover or None
        pro["cover_original_url"] = cover_orig or None
    pro["photos"] = gallery
    pro["cover_url"] = pro.get("cover_url") or None
    pro["cover_original_url"] = pro.get("cover_original_url") or None
    pro["logo_url"] = pro.get("logo_url") or None
    pro["logo_original_url"] = pro.get("logo_original_url") or None
    pro["tier"] = tier
    pro.update(caps)
    pro.update(_business_identity(pro, u))
    # Owner view: keep every field, but report what's hidden below the current
    # tier so the editor can show an upgrade nudge.
    _apply_tier_visibility(pro, tier, owner_view=True)
    pro["categories_all"] = sorted(BOAT_PRO_CATEGORIES) + ["Other"]
    pro["markets_all"] = PNW_MARKETS
    return pro


@router.api_route("/boat-pros/listing", methods=["PUT", "PATCH"])
async def update_boat_pro_listing(body: BoatProListingUpdate,
                                  session_token: Optional[str] = Cookie(default=None),
                                  authorization: Optional[str] = Header(default=None)):
    """Partial editor for the Boat Pro public listing — mirrors PATCH /org-listing.
    Updates only provided fields; image fields are tier-gated server-side so a cleared
    or cropped logo/cover/gallery is persisted exactly, never clobbered."""
    import re as _re
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") != "boat_pro":
        raise HTTPException(status_code=403, detail="Only Boat Pro accounts have a directory listing")
    pro = await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})
    if not pro:
        raise HTTPException(status_code=404, detail="Set up your Boat Pro listing first")
    tier = _derive_pro_tier(pro, u)
    caps = _pro_tier_caps(tier)

    def _img(val):
        v = (val or "").strip()
        if v and len(v) > MAX_PHOTO_URL_CHARS:
            raise HTTPException(status_code=400, detail="That image is too large — please choose a smaller one")
        return v

    update: Dict[str, Any] = {}
    if body.company_name is not None:
        cn = body.company_name.strip()[:120]
        if not cn:
            raise HTTPException(status_code=400, detail="Business name is required")
        update["company_name"] = cn
    if body.short_bio is not None:
        update["short_bio"] = body.short_bio.strip()[:2000] or None
    if body.website is not None:
        update["website"] = body.website.strip()[:200] or None
    if body.contact_email is not None:
        ce = body.contact_email.strip().lower()
        if ce and not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", ce):
            raise HTTPException(status_code=400, detail="Enter a valid contact email")
        update["contact_email"] = ce or None
    if body.contact_phone is not None:
        update["contact_phone"] = body.contact_phone.strip()[:40] or None
    if body.categories is not None:
        cats: List[str] = []
        for c in body.categories:
            s = str(c).strip()[:60]
            if s and s not in cats:
                cats.append(s)
            if len(cats) >= 12:
                break
        update["categories"] = cats
    # Markets are a HARD per-tier limit (Basic 1, Featured 2, Premium unlimited) —
    # nothing is stored hidden. Validate the EFFECTIVE market set: the incoming
    # list if provided, otherwise the already-stored list. This means an account
    # that is over its limit (e.g. after a downgrade) is refused on ANY save until
    # it brings its markets within the limit — we never silently drop a market.
    max_m = TIER_MAX_MARKETS.get(tier, 1)
    effective_markets = ([m for m in body.markets if m in PNW_MARKETS]
                         if body.markets is not None else (pro.get("markets") or []))
    if len(effective_markets) > max_m:
        raise HTTPException(status_code=400, detail={
            "code": "tier_limit",
            "message": f"Your plan includes {max_m} market{'s' if max_m != 1 else ''}. Upgrade to add more.",
        })
    if body.markets is not None:
        update["markets"] = effective_markets
    # Image fields are tier-gated. When the tier does not permit a field we SKIP
    # the write entirely (never null it) so a downgraded account keeps its data
    # hidden-but-intact and it reappears on upgrade.
    if body.logo_url is not None and caps["can_logo"]:
        update["logo_url"] = _img(body.logo_url) or None
    if body.logo_original_url is not None and caps["can_logo"]:
        update["logo_original_url"] = _img(body.logo_original_url) or None
    if body.cover_url is not None and caps["can_cover"]:
        update["cover_url"] = _img(body.cover_url) or None
    if body.cover_original_url is not None and caps["can_cover"]:
        update["cover_original_url"] = _img(body.cover_original_url) or None
    if body.photos is not None and caps["max_photos"] > 0:
        photos: List[Dict[str, str]] = []
        seen = set()
        for p in body.photos:
            if len(photos) >= caps["max_photos"]:
                break
            if isinstance(p, str):
                url, original = p.strip(), p.strip()
            elif isinstance(p, dict):
                url = str(p.get("url") or "").strip()
                original = str(p.get("original") or "").strip() or url
            else:
                continue
            if not url or url in seen:
                continue
            _img(url)
            _img(original)
            seen.add(url)
            photos.append({"url": url, "original": original})
        update["photos"] = photos
    if body.business_handle is not None:
        raw = body.business_handle.strip().lstrip("@")
        if not _re.fullmatch(r"[A-Za-z0-9_]{3,20}", raw):
            raise HTTPException(status_code=400, detail="Business username must be 3-20 letters, numbers or _")
        bh = raw.lower()
        if await handle_taken(bh, exclude_user_id=u["user_id"]):
            raise HTTPException(status_code=409, detail="That username is already taken")
        update["business_handle"] = bh
    if body.business_email is not None:
        be = body.business_email.strip().lower()
        if be and not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", be):
            raise HTTPException(status_code=400, detail="Enter a valid business email")
        update["business_email"] = be or None
    # Credentials (certifications/licenses/insurance) are Premium-only. A save that
    # ADDS or CHANGES any credential field is rejected unless the account is Premium.
    # Omitted fields (None) or an unchanged list are allowed, so a Basic/Featured pro
    # can keep saving everything else without touching credentials already on file.
    is_premium = (tier or "").lower() == "premium"
    for fld in CREDENTIAL_FIELDS:
        incoming = getattr(body, fld)
        if incoming is None:
            continue
        normalized = _norm_cred(incoming)
        if normalized == _norm_cred(pro.get(fld)):
            continue  # unchanged — allow
        if not is_premium:
            raise HTTPException(status_code=400, detail=CREDENTIALS_PREMIUM_MSG)
        update[fld] = normalized
    if not update:
        raise HTTPException(status_code=400, detail="No changes provided")
    update["cover_migrated"] = True
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.boat_pros.update_one({"user_id": u["user_id"]}, {"$set": update})
    try:
        from zoho_sync import enqueue as _zq
        await _zq(db, "listing_boat_pro", u["user_id"])
    except Exception:
        pass
    return await get_my_boat_pro(session_token=session_token, authorization=authorization)


@router.get("/account/identities")
async def get_account_identities(session_token: Optional[str] = Cookie(default=None),
                                 authorization: Optional[str] = Header(default=None)):
    """Return the account holder's PERSONAL identity and (for Boat Pros) their
    BUSINESS identity. The subscription/tier belongs to the person; the business
    features follow it. No switching UI yet — this is a read surface only."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    personal = {
        "user_id": u["user_id"],
        "first_name": u.get("first_name"),
        "last_name": u.get("last_name"),
        "name": u.get("name"),
        "handle": u.get("handle"),
        "handle_pending": bool(u.get("personal_handle_pending")),
        "email": u.get("email"),
        "photo": display_image(u),
        "subscription_tier": u.get("subscription_tier") or "free",
        "subscription_expires": u.get("subscription_expires"),
        "last_identity": u.get("last_identity") or "personal",
    }
    business = None
    if u.get("account_type") == "boat_pro":
        pro = await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})
        if pro:
            tier = _derive_pro_tier(pro, u)
            _pro_public_images(pro)
            pro["tier"] = tier
            pro.update(_pro_tier_caps(tier))
            pro.update(_business_identity(pro, u))
            _apply_tier_visibility(pro, tier, owner_view=True)
            business = pro
    return {"personal": personal, "business": business,
            "last_identity": u.get("last_identity") or "personal"}


@router.api_route("/account/personal", methods=["PUT", "PATCH"])
async def update_personal_identity(body: PersonalIdentityUpdate,
                                   session_token: Optional[str] = Cookie(default=None),
                                   authorization: Optional[str] = Header(default=None)):
    """Edit the account holder's PERSONAL identity: first/last name, personal
    handle (shared namespace with business handles), personal photo, and the
    last-used identity. Login email, billing and tier are not touched here."""
    import re as _re
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    update: Dict[str, Any] = {}
    if body.first_name is not None:
        update["first_name"] = body.first_name.strip()[:80]
    if body.last_name is not None:
        update["last_name"] = body.last_name.strip()[:80]
    if body.first_name is not None or body.last_name is not None:
        fn = (update.get("first_name") if "first_name" in update else u.get("first_name")) or ""
        ln = (update.get("last_name") if "last_name" in update else u.get("last_name")) or ""
        nm = f"{fn} {ln}".strip()
        if nm:
            update["name"] = nm
    if body.handle is not None:
        raw = body.handle.strip().lstrip("@")
        if not _re.fullmatch(r"[A-Za-z0-9_]{3,20}", raw):
            raise HTTPException(status_code=400, detail="Username must be 3-20 letters, numbers or _")
        hl = raw.lower()
        if await handle_taken(hl, exclude_user_id=u["user_id"]):
            raise HTTPException(status_code=409, detail="That username is already taken")
        update["handle"] = hl
        update["personal_handle_pending"] = False  # confirmed by an explicit edit
    if body.avatar is not None:
        update["avatar"] = clean_avatar(body.avatar)
    if body.last_identity is not None:
        if body.last_identity not in {"personal", "business"}:
            raise HTTPException(status_code=400, detail="last_identity must be 'personal' or 'business'")
        update["last_identity"] = body.last_identity
    if not update:
        raise HTTPException(status_code=400, detail="No changes provided")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    return await get_account_identities(session_token=session_token, authorization=authorization)


@router.get("/account/active-identity")
async def get_active_identity(session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Read the caller's active identity. Forces 'personal' when the account is
    not (or no longer) eligible for business, and reports eligibility so the web
    switcher knows whether to render."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    pro = await business_listing_for(u)
    eligible = await can_act_as_business(u, pro)
    return {
        "active_identity": await resolve_active_identity(u, pro),
        "can_use_business": eligible,
        "business_name": (pro or {}).get("company_name") if eligible else None,
        "business_listing_id": u["user_id"] if eligible else None,
    }


@router.api_route("/account/active-identity", methods=["PUT", "PATCH"])
async def set_active_identity(body: Dict[str, Any],
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Change the caller's active identity. Business is only allowed for a Boat
    Pro with an active (paid, not lapsed) listing; the server rejects business
    for anyone else with a 400 and otherwise stores 'personal'."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    want = body.get("identity") or body.get("active_identity")
    if want not in {"personal", "business"}:
        raise HTTPException(status_code=400, detail="identity must be 'personal' or 'business'")
    pro = await business_listing_for(u)
    if want == "business" and not await can_act_as_business(u, pro):
        raise HTTPException(status_code=400, detail="This account can't act as a business.")
    await db.users.update_one({"user_id": u["user_id"]},
                              {"$set": {"last_identity": want,
                                        "updated_at": datetime.now(timezone.utc).isoformat()}})
    eligible = await can_act_as_business(u, pro)
    return {"active_identity": want, "can_use_business": eligible,
            "business_name": (pro or {}).get("company_name") if eligible else None,
            "business_listing_id": u["user_id"] if eligible else None}


@router.get("/boat-pros/category-counts")
async def boat_pro_category_counts(market: Optional[str] = None):
    """Count of Boat Pros per specialty (respecting the selected market) so the
    mobile filter dropdown can show how many pros match — and which are empty."""
    query: Dict[str, Any] = {}
    if market and market != "all":
        query["markets"] = market
    counts: Dict[str, int] = {}
    async for row in db.boat_pros.aggregate([
        {"$match": query},
        {"$unwind": "$categories"},
        {"$group": {"_id": "$categories", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    total = await db.boat_pros.count_documents(query)
    return {"counts": counts, "total": total}


@router.get("/boat-pros/insights")
async def boat_pro_insights(months: int = 6,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """This-month listing performance for the caller's own Boat Pro listing:
    profile views (logged on the public detail fetch) + unique people who DM'd them.
    `views_by_month` / `contacts_by_month` cover the last `months` (6 or 12)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from datetime import datetime, timezone
    n = 12 if months == 12 else 6
    now = datetime.now(timezone.utc)
    buckets = []
    cbuckets = []
    for i in range(n - 1, -1, -1):
        mm, yy = now.month - i, now.year
        while mm <= 0:
            mm += 12
            yy -= 1
        start = datetime(yy, mm, 1, tzinfo=timezone.utc)
        nm, ny = (mm + 1, yy) if mm < 12 else (1, yy + 1)
        end = datetime(ny, nm, 1, tzinfo=timezone.utc)
        rng = {"$gte": start.isoformat(), "$lt": end.isoformat()}
        v = await db.listing_views.count_documents({"pro_id": u["user_id"], "created_at": rng})
        cs = await db.dm_messages.distinct("from_id", {"to_id": u["user_id"], "created_at": rng})
        buckets.append({"month": start.strftime("%b"), "count": v})
        cbuckets.append({"month": start.strftime("%b"), "count": len(cs)})
    return {"views_this_month": buckets[-1]["count"], "contacts_this_month": cbuckets[-1]["count"],
            "views_by_month": buckets, "contacts_by_month": cbuckets}


@router.get("/boat-pros/{pro_id}")
async def get_boat_pro(pro_id: str,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    pro = await db.boat_pros.find_one({"user_id": pro_id}, {"_id": 0})
    if not pro:
        raise HTTPException(status_code=404, detail="Not found")
    viewer = await current_user_from_token(session_token, authorization)
    try:
        if not viewer or viewer.get("user_id") != pro_id:
            from datetime import datetime, timezone
            await db.listing_views.insert_one({"pro_id": pro_id, "created_at": datetime.now(timezone.utc).isoformat()})
    except Exception:
        pass
    _pro_public_images(pro)
    pro["is_complete"] = bool(pro.get("company_name") and pro.get("short_bio") and (pro.get("categories") or []) and (pro.get("markets") or []) and len(pro.get("photos") or []) >= 3)
    owner = await db.users.find_one({"user_id": pro_id}, {"_id": 0, "subscription_tier": 1, "handle": 1, "email": 1})
    tier = _derive_pro_tier(pro, owner or {})
    pro["tier"] = tier
    pro.update(_business_identity(pro, owner or {}))
    _apply_tier_visibility(pro, tier)
    _lock_contact_for_guest(pro, viewer)
    pro["hire_count"] = await db.hires.count_documents({"pro_id": pro_id})
    pro["viewer_hired"] = bool(viewer and await db.hires.find_one({"pro_id": pro_id, "user_id": viewer["user_id"]}))
    from routers.reviews_router import compute_summary
    summ = await compute_summary(pro_id)
    pro["rating"] = summ.get("overall")
    pro["review_count"] = summ.get("count", 0)
    reviews = await db.reviews.find({"target_id": pro_id, "removed": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    # Recent activity on the public listing is BUSINESS-identity only: posts the
    # account authored while acting as this business. Personal posts never show.
    biz_posts = await db.posts.find(
        {"author_id": pro_id, "author_identity": "business"},
        {"_id": 0, "id": 1, "title": 1, "market": 1, "created_at": 1, "type": 1},
    ).sort("created_at", -1).limit(5).to_list(5)
    biz_discs = await db.discussions.find(
        {"author_id": pro_id, "author_identity": "business"},
        {"_id": 0, "id": 1, "title": 1, "kind": 1, "market": 1, "created_at": 1},
    ).sort("created_at", -1).limit(5).to_list(5)
    for d in biz_discs:
        d["type"] = d.get("kind") or "forum"
    activity = biz_posts + biz_discs
    activity.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"pro": pro, "reviews": reviews, "rating": summ.get("overall"),
            "review_count": summ.get("count", 0), "review_summary": summ,
            "recent_posts": activity[:6]}




@router.post("/contact")
async def contact_form(body: Dict[str, Any], request: Request):
    """Public "send us a note" form. Delivers via Resend to CONTACT_EMAIL.
    Per-IP throttle: 3 submissions / 10 minutes."""
    from mailer import send_email
    ip = client_ip(request)
    name = (body.get("name") or "").strip()[:120]
    email = (body.get("email") or "").strip()[:200]
    message = (body.get("message") or "").strip()
    subject = (body.get("subject") or "").strip()[:120]
    if not name or not email or len(message) < 10:
        raise HTTPException(status_code=400,
                            detail="Name, email and a message of ≥10 chars are required.")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Message too long (max 4000 chars)")
    import re as _re
    if not _re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email")
    # Rate limit AFTER validation so invalid submissions don't lock a user out.
    rate_limit("contact", request, limit=3, window=600, detail="Too many requests. Please try again in a few minutes.")
    label = subject or "Contact form"
    msg_id = str(uuid.uuid4())
    await db.contact_messages.insert_one({
        "id": msg_id,
        "name": name, "email": email, "message": message, "ip": ip,
        "subject": subject or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    import os
    from mailer import app_public_url, contact_message_email_html
    # ONE branded email to the shared contact inbox. Reply-To is the sender, so a
    # reply reaches the member directly. No separate admin alert (admin@ is an
    # alias of this inbox, so a second alert would be a duplicate in one inbox).
    contact_inbox = (os.environ.get("CONTACT_INBOX_EMAIL") or "customersupport@sailmorenow.com").strip()
    html = contact_message_email_html(
        name=name, email=email, subject=subject, message=message,
        action_url=f"{app_public_url()}/admin/contact?msg={msg_id}",
        source_label="Contact form")
    try:
        res = await send_email(
            recipient_email=contact_inbox,
            subject=f"[Sail More Now] {label}: {name}",
            html_content=html,
            reply_to=email,
        )
        if (res or {}).get("status") not in ("ok", "skipped"):
            logger.warning("contact form delivery not ok: %r", res)
    except Exception:
        logger.exception("contact form send failed")
    return {"ok": True}


@router.get("/email/unsubscribe")
async def email_unsubscribe(u: str, t: str):
    """One-click unsubscribe from newsletter/digest emails (List-Unsubscribe + link)."""
    from fastapi.responses import HTMLResponse
    from mailer import verify_unsub_token
    ok = bool(u) and verify_unsub_token(u, t)
    if ok:
        await db.users.update_one({"user_id": u}, {"$set": {"newsletter_opt_in": False}})
    msg = ("You're unsubscribed from Sail More Now digest emails. You can re-enable them any time in your profile."
           if ok else "This unsubscribe link is invalid or expired.")
    html = (f"<!DOCTYPE html><html><body style=\"font-family:system-ui,sans-serif;background:#f7fafc;"
            f"margin:0;padding:48px 16px;text-align:center;color:#0f172a;\">"
            f"<div style=\"max-width:460px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;"
            f"box-shadow:0 6px 24px rgba(15,23,42,0.08);\">"
            f"<h1 style=\"font-size:20px;color:#1F3F5B;margin:0 0 10px;\">Email preferences</h1>"
            f"<p style=\"font-size:14px;color:#475569;line-height:1.6;margin:0;\">{msg}</p></div></body></html>")
    return HTMLResponse(content=html, status_code=200)


@router.post("/support/contact")
async def support_contact(body: Dict[str, Any], request: Request,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Signed-in "Contact Us" form from the Profile screen. Delivers to the
    customer support inbox (distinct from the public /contact -> info@)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Please sign in to contact support")
    from mailer import send_email
    name = (u.get("name") or "").strip()[:120] or "Sail More Now member"
    email = (u.get("email") or "").strip()
    subject = (body.get("subject") or "").strip()[:120]
    message = (body.get("message") or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Please add a subject")
    if len(message) < 10:
        raise HTTPException(status_code=400, detail="Please add a message of at least 10 characters")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Message too long (max 4000 chars)")
    rate_limit("support_contact", request, limit=5, window=600,
               detail="Too many requests. Please try again in a few minutes.")
    msg_id = str(uuid.uuid4())
    import os as _os
    from mailer import app_public_url as _apu, contact_message_email_html
    # ONE branded email to the shared contact inbox (no duplicate admin alert).
    contact_inbox = (_os.environ.get("CONTACT_INBOX_EMAIL") or "customersupport@sailmorenow.com").strip()
    html = contact_message_email_html(
        name=name, email=email, subject=subject, message=message,
        action_url=f"{_apu()}/admin/contact?msg={msg_id}",
        source_label="Support message")
    try:
        res = await send_email(
            recipient_email=contact_inbox,
            subject=f"[Sail More Now Support] {subject}: {name}",
            html_content=html,
            reply_to=email,
        )
        if (res or {}).get("status") not in ("ok", "skipped"):
            logger.warning("support contact delivery not ok: %r", res)
    except Exception:
        logger.exception("support contact send failed")
    await db.contact_messages.insert_one({
        "id": msg_id,
        "name": name, "email": email, "message": message, "ip": client_ip(request),
        "subject": subject, "source": "profile_support", "user_id": u.get("user_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@router.patch("/boat-pros/photos")
async def update_boat_pro_photos(body: Dict[str, Any],
                                 session_token: Optional[str] = Cookie(default=None),
                                 authorization: Optional[str] = Header(default=None)):
    """Replace the caller's Boat Pro photo gallery. Accepts photos:[str] and
    clamps to 6 entries (strip + dedup). Each URL/data-URL limited to 400KB
    so the boat_pros doc can't be bloated by unbounded uploads."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") != "boat_pro":
        raise HTTPException(status_code=403, detail="Only Boat Pro accounts can update photos")
    incoming = body.get("photos") or []
    if not isinstance(incoming, list):
        raise HTTPException(status_code=400, detail="photos must be a list")
    photos: List[str] = []
    for p in incoming:
        s = (p or "").strip()
        if not s or s in photos:
            continue
        if len(s) > MAX_PHOTO_URL_CHARS:
            raise HTTPException(status_code=400, detail=f"Each photo must be ≤{MAX_PHOTO_URL_CHARS // 1000} KB")
        photos.append(s)
        if len(photos) >= 6:
            break
    r = await db.boat_pros.update_one(
        {"user_id": u["user_id"]},
        {"$set": {"photos": photos, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Boat Pro profile not found — set up your directory listing first")
    return await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})


def _norm_photos(raw):
    """Normalize stored org photos to a list of {url, caption, original}. Accepts
    legacy plain-string entries and coerces them to objects. `original` preserves
    the uncropped source so cropping stays non-destructive."""
    out = []
    for p in (raw or []):
        if isinstance(p, str):
            if p.strip():
                out.append({"url": p.strip(), "caption": "", "original": p.strip()})
        elif isinstance(p, dict) and (p.get("url") or "").strip():
            url = str(p["url"]).strip()
            out.append({"url": url, "caption": str(p.get("caption") or "").strip(), "original": (str(p.get("original") or "").strip() or url)})
    return out


@router.get("/u/{handle}")
async def public_profile_by_handle(handle: str,
                                   session_token: Optional[str] = Cookie(default=None),
                                   authorization: Optional[str] = Header(default=None)):
    """Public profile view keyed by @-handle. Returns non-sensitive fields
    plus (for Boat Pros) their directory listing and rating."""
    h = (handle or "").lstrip("@").lower().strip()
    _proj = {
        "_id": 0, "user_id": 1, "handle": 1, "name": 1, "picture": 1, "avatar": 1,
        "bio": 1, "account_type": 1, "primary_market": 1, "markets": 1,
        "subscription_tier": 1, "founding_partner": 1, "identity_verified": 1,
        "boat_name": 1, "boat_make_model": 1,
        "org_name": 1, "org_category": 1, "org_categories": 1,
        "website": 1, "public_email": 1, "public_phone": 1, "logo_url": 1, "logo_original_url": 1, "photos": 1, "cover_url": 1, "cover_original_url": 1, "cover_migrated": 1,
        "created_at": 1, "last_active_at": 1, "email": 1,
    }
    u = await db.users.find_one({"handle": h}, _proj)
    resolved_identity = "personal"
    if not u:
        # Business-handle resolution: /u/<business_handle> maps to the owning
        # account's Boat Pro listing, keeping old public links working.
        _biz = await db.boat_pros.find_one({"business_handle": h}, {"_id": 0, "user_id": 1})
        if _biz and _biz.get("user_id"):
            u = await db.users.find_one({"user_id": _biz["user_id"]}, _proj)
            resolved_identity = "business"
    if not u:
        raise HTTPException(status_code=404, detail="Username not found")
    u["partner_badge"] = partner_badge(u)
    # Dedicated cover with legacy fallback ONLY for not-yet-migrated orgs (so an
    # explicitly cleared cover on a migrated org is respected).
    _gallery = _norm_photos(u.get("photos"))
    _cover = (u.get("cover_url") or "").strip()
    if not u.get("cover_migrated") and not _cover and _gallery:
        _cover = _gallery[0]["url"]
        _gallery = _gallery[1:]
    u["cover_url"] = _cover or None
    # Keep the uncropped originals (now short object-storage URLs) so the full-size
    # viewer can show the full original; the page still renders the crop. Fall back
    # to the cropped image when no original was stored (older/low-quality photos).
    u["cover_original_url"] = (u.get("cover_original_url") or "").strip() or u["cover_url"]
    u["logo_original_url"] = (u.get("logo_original_url") or "").strip() or (u.get("logo_url") or None)
    u["photos"] = [{"url": p["url"], "caption": p["caption"], "original": p.get("original") or p["url"]} for p in _gallery]
    # Gallery is a Community Partner feature. Free orgs keep their stored photos but
    # they stay hidden on the public profile (and return if they become a partner).
    if u.get("account_type") == "partner" and not u.get("partner_badge"):
        u["photos"] = []
    follower_count = await db.follows.count_documents({"org_id": u["user_id"]})
    following_count = await db.follows.count_documents({"user_id": u["user_id"]})
    is_following = False
    is_blocked = False
    viewer = await current_user_from_token(session_token, authorization)
    if viewer and viewer.get("user_id") != u["user_id"]:
        is_following = bool(await db.follows.find_one({"user_id": viewer["user_id"], "org_id": u["user_id"]}))
        is_blocked = bool(await db.follow_blocks.find_one({"blocker_id": viewer["user_id"], "blocked_id": u["user_id"]}))
    pro = None
    rating = None; review_count = 0
    is_org = u.get("account_type") == "partner"
    if u.get("account_type") == "boat_pro":
        pro = await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})
        _pro_public_images(pro)
        _tier = _derive_pro_tier(pro, u)
        if pro is not None:
            pro["tier"] = _tier
            pro.update(_business_identity(pro, u))
            _apply_tier_visibility(pro, _tier)
    u["resolved_identity"] = resolved_identity
    u.pop("email", None)  # login email is never exposed on the public profile
    # Public contact (public_email / public_phone) is a DIRECTORY feature for
    # businesses (Boat Pros) and organizations only. For individual sailors and
    # boat owners these must never leak to the public API: strip them unless the
    # caller is the profile owner or an admin.
    if u.get("account_type") not in ("boat_pro", "partner"):
        is_owner = bool(viewer and viewer.get("user_id") == u["user_id"])
        if not (is_owner or (viewer and is_admin(viewer))):
            u.pop("public_email", None)
            u.pop("public_phone", None)
    if u.get("account_type") in ("boat_pro", "partner"):
        from routers.reviews_router import compute_summary
        # A Boat Pro's public @-handle page is their PERSONAL profile (the
        # business handle redirects to /directory), so show personal reviews.
        _ident = "personal" if u.get("account_type") == "boat_pro" else "business"
        summ = await compute_summary(u["user_id"], identity=_ident)
        rating = summ.get("overall")
        review_count = summ.get("count", 0)
    recent_posts = await db.posts.find(
        {"author_id": u["user_id"], "author_identity": {"$ne": "business"}},
        {"_id": 0, "id": 1, "title": 1, "market": 1, "created_at": 1, "type": 1},
    ).sort("created_at", -1).limit(5).to_list(5)
    # For orgs, merge forum/blog discussions into the recent-activity feed and
    # surface upcoming events (with sign-up) so the public profile is complete.
    upcoming_events = []
    if is_org:
        discs = await db.discussions.find(
            {"author_id": u["user_id"]},
            {"_id": 0, "id": 1, "title": 1, "kind": 1, "market": 1, "created_at": 1},
        ).sort("created_at", -1).limit(5).to_list(5)
        for d in discs:
            d["type"] = d.get("kind") or "forum"
        activity = recent_posts + discs
        activity.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        recent_posts = activity[:6]
        now_iso = datetime.now(timezone.utc).isoformat()
        upcoming_events = await db.events.find(
            {"organizer_id": u["user_id"], "starts_at": {"$gte": now_iso}},
            {"_id": 0, "organizer_email": 0, "email_recipients": 0},
        ).sort("starts_at", 1).limit(10).to_list(10)
    return {"user": u, "pro": pro, "rating": rating, "review_count": review_count,
            "recent_posts": recent_posts, "upcoming_events": upcoming_events,
            "follower_count": follower_count,
            "following_count": following_count, "is_following": is_following, "is_blocked": is_blocked}


PUBLIC_LISTING_FIELDS = ["org_name", "website", "handle", "bio", "logo_url",
                         "org_categories", "primary_market", "markets",
                         "public_email", "public_phone"]


@router.get("/org-listing/mine")
async def get_my_org_listing(session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") != "partner":
        raise HTTPException(status_code=403, detail="Only Club/Org accounts have a directory listing")
    doc = await db.users.find_one({"user_id": u["user_id"]}, {
        "_id": 0, "user_id": 1, "handle": 1, "name": 1, "org_name": 1, "website": 1,
        "bio": 1, "logo_url": 1, "logo_original_url": 1, "picture": 1, "avatar": 1,
        "org_categories": 1, "org_category": 1, "cover_url": 1, "cover_original_url": 1, "cover_migrated": 1,
        "primary_market": 1, "markets": 1, "public_email": 1, "public_phone": 1, "photos": 1,
    })
    doc["org_categories"] = doc.get("org_categories") or ([doc["org_category"]] if doc.get("org_category") else [])
    doc["logo_url"] = doc.get("logo_url") or doc.get("picture") or doc.get("avatar")
    gallery = _norm_photos(doc.get("photos"))
    # One-time migration (idempotent): legacy orgs stored the cover as photos[0].
    # Promote it to the dedicated cover field ONCE, then set a flag so clearing the
    # cover later isn't undone by re-promotion on subsequent loads.
    if not doc.get("cover_migrated"):
        if not (doc.get("cover_url") or "").strip() and gallery:
            cover = gallery[0]
            gallery = gallery[1:]
            doc["cover_url"] = cover["url"]
            doc["cover_original_url"] = cover.get("original") or cover["url"]
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {
            "cover_url": doc.get("cover_url") or None,
            "cover_original_url": doc.get("cover_original_url") or None,
            "photos": gallery, "cover_migrated": True,
        }})
    doc["photos"] = gallery
    doc["cover_url"] = doc.get("cover_url") or None
    doc["cover_original_url"] = doc.get("cover_original_url") or None
    doc["logo_original_url"] = doc.get("logo_original_url") or None
    is_cp = bool(partner_badge(u))
    return {"listing": doc, "org_categories_all": ORG_CATEGORIES, "markets_all": PNW_MARKETS,
            "max_photos": 5 if is_cp else 0, "is_community_partner": is_cp,
            "status": org_status(u), "partner_badge": partner_badge(u)}


_UPLOAD_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


@router.post("/org-listing/upload")
async def upload_org_image(file: UploadFile = File(...),
                           session_token: Optional[str] = Cookie(default=None),
                           authorization: Optional[str] = Header(default=None)):
    """Upload one org/club image (logo, cover or gallery) to object storage and
    return its /api/files URL. The editor saves only this short URL, so the
    listing PATCH stays tiny and never trips the per-field size cap."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") not in ("partner", "boat_pro"):
        raise HTTPException(status_code=403, detail="Only Club/Org or Boat Pro accounts have a directory listing")
    ct = (file.content_type or "").split(";")[0].strip().lower()
    ext = _UPLOAD_EXT.get(ct)
    if not ext:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG or WebP image")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be 15MB or smaller")
    path = f"{APP_NAME}/org/{u['user_id']}/{uuid.uuid4().hex}.{ext}"
    try:
        result = await asyncio.to_thread(put_object, path, data, ct)
    except Exception:
        logger.exception("org image upload failed")
        raise HTTPException(status_code=502, detail="Couldn't save your photo. Try again.")
    return {"url": f"/api/files/{result.get('path', path)}"}


@router.api_route("/org-listing", methods=["PUT", "PATCH"])
async def update_org_listing(body: OrgListingUpdate,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    """Dedicated public directory-listing editor for Club/Org accounts. Updates only
    the PUBLIC listing fields (org name, website, handle, logo, categories, bio,
    markets, public email/phone). Private first/last name + login email are untouched
    here. org_name/website/handle stay linked to the account record."""
    import re as _re
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") != "partner":
        raise HTTPException(status_code=403, detail="Only Club/Org accounts have a directory listing")
    update: Dict[str, Any] = {}
    if body.org_name is not None:
        on = body.org_name.strip()[:120]
        if not on:
            raise HTTPException(status_code=400, detail="Organization name is required")
        update["org_name"] = on
        update["name"] = on  # partners' display name mirrors the org name
    if body.handle is not None:
        raw = body.handle.strip().lstrip("@")
        if not _re.fullmatch(r"[A-Za-z0-9_]{3,20}", raw):
            raise HTTPException(status_code=400, detail="Username must be 3-20 letters, numbers or _")
        hl = raw.lower()
        if await handle_taken(hl, exclude_user_id=u["user_id"]):
            raise HTTPException(status_code=409, detail="That username is already taken")
        update["handle"] = hl
    if body.website is not None:
        update["website"] = body.website.strip()[:200] or None
    if body.bio is not None:
        update["bio"] = body.bio.strip()[:2000] or None
    if body.logo_url is not None:
        lu = body.logo_url.strip()
        if lu and len(lu) > MAX_PHOTO_URL_CHARS:
            raise HTTPException(status_code=400, detail="That image is too large — please choose a smaller one")
        update["logo_url"] = lu or None
        # The org/club profile image IS the directory logo. Keep the profile
        # `picture` (read by the profile header, feed, messages and followers) in
        # sync, and retire any old emoji avatar so nothing falls back to it. This
        # is what makes editing the logo change the profile picture too.
        update["picture"] = lu or None
        update["avatar"] = None
    for _fld in ("logo_original_url", "cover_url", "cover_original_url"):
        _val = getattr(body, _fld)
        if _val is not None:
            _v = _val.strip()
            if _v and len(_v) > MAX_PHOTO_URL_CHARS:
                raise HTTPException(status_code=400, detail="That image is too large — please choose a smaller one")
            update[_fld] = _v or None
    if body.public_email is not None:
        pe = body.public_email.strip().lower()
        if pe and not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", pe):
            raise HTTPException(status_code=400, detail="Enter a valid public email")
        update["public_email"] = pe or None
    if body.public_phone is not None:
        update["public_phone"] = body.public_phone.strip()[:40] or None
    if body.org_categories is not None:
        cats = [c for c in body.org_categories if c in ORG_CATEGORIES]
        update["org_categories"] = cats
        update["org_category"] = cats[0] if cats else None
    if body.primary_market is not None:
        if body.primary_market and body.primary_market not in PNW_MARKETS:
            raise HTTPException(status_code=400, detail="Invalid market")
        update["primary_market"] = body.primary_market or None
    if body.markets is not None:
        mk = [m for m in body.markets if m in PNW_MARKETS]
        update["markets"] = mk
    if body.photos is not None and bool(partner_badge(u)):
        # Gallery is a Community Partner feature: enforce max 5. Free orgs never
        # reach here (the editor hides the gallery), so their stored photos are
        # preserved untouched and simply hidden until they upgrade.
        max_photos = 5
        photos: List[Dict[str, str]] = []
        seen = set()
        for p in body.photos:
            if isinstance(p, str):
                url, caption, original = p.strip(), "", p.strip()
            elif isinstance(p, dict):
                url = str(p.get("url") or "").strip()
                caption = str(p.get("caption") or "").strip()[:140]
                original = str(p.get("original") or "").strip() or url
            else:
                continue
            if not url or url in seen:
                continue
            for _v in (url, original):
                if len(_v) > MAX_PHOTO_URL_CHARS:
                    raise HTTPException(status_code=400, detail=f"Each photo must be ≤{MAX_PHOTO_URL_CHARS // 1000} KB")
            seen.add(url)
            photos.append({"url": url, "caption": caption, "original": original})
            if len(photos) >= max_photos:
                break
        update["photos"] = photos
    if not update:
        raise HTTPException(status_code=400, detail="No changes provided")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})
    return await get_my_org_listing(session_token=session_token, authorization=authorization)


@router.post("/orgs/{org_id}/reviews")
async def create_org_review(org_id: str, body: OrgReviewCreate,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """A signed-in, paid member leaves a one-off review on a Club/Org (no two-way
    review flow). One review per member per org; editable via PATCH /reviews/{id}."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u["user_id"] == org_id:
        raise HTTPException(status_code=400, detail="You can't review your own organization")
    org = await db.users.find_one({"user_id": org_id}, {"_id": 0, "account_type": 1})
    if not org or org.get("account_type") != "partner":
        raise HTTPException(status_code=404, detail="Organization not found")
    if u.get("account_type") not in ("sailor", "boat_owner"):
        raise HTTPException(status_code=400, detail="Only sailors and boat owners can review an organization.")
    if body.category_ratings:
        raise HTTPException(status_code=400, detail="Category ratings aren't accepted on organization reviews — send a single 1..5 rating.")
    if not can_review(u):  # paid tier required
        raise HTTPException(status_code=403, detail={"code": "upgrade_required",
            "message": "Reviewing is a paid feature. Upgrade your account to leave a review."})
    if not 1 <= body.rating <= 5:
        raise HTTPException(status_code=400, detail="rating must be 1..5")
    existing = await db.reviews.find_one({"target_id": org_id, "author_id": u["user_id"]}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        await db.reviews.update_one({"id": existing["id"]}, {"$set": {
            "rating": body.rating, "comment": (body.comment or "").strip(), "updated_at": now}})
        return await db.reviews.find_one({"id": existing["id"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()), "target_id": org_id, "author_id": u["user_id"],
        "author_name": u.get("name"), "author_avatar": display_image(u),
        "author_handle": u.get("handle"),
        "author_identity": "personal", "author_business_id": None,
        "rating": body.rating, "comment": (body.comment or "").strip(), "created_at": now,
    }
    await db.reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/boat-pros")
async def upsert_boat_pro(body: BoatProUpsert,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") != "boat_pro":
        raise HTTPException(status_code=403, detail="Only Boat Pro accounts can create a directory listing")
    # Free boat pros are browse-only: a public listing requires a paid tier.
    require_interaction(u)
    for m in body.markets:
        if m not in PNW_MARKETS:
            raise HTTPException(status_code=400, detail=f"Invalid market {m}")
    # Tier is derived server-side from the user's subscription — client cannot override.
    sub_tier = (u.get("subscription_tier") or "free").lower()
    server_tier = sub_tier if sub_tier in {"basic", "featured", "premium"} else "basic"
    # Enforce tier matrix limits on the backend.
    max_markets = TIER_MAX_MARKETS.get(server_tier, 1)
    if len(body.markets) > max_markets:
        raise HTTPException(status_code=400, detail={
            "code": "tier_limit",
            "message": f"Your plan includes {max_markets} market{'s' if max_markets != 1 else ''}. Upgrade to add more.",
        })
    doc = body.model_dump()
    # Image fields are owned by the dedicated listing editor (PATCH /boat-pros/listing).
    # Only touch them here when the client explicitly sends them, so a lightweight text
    # save (name/bio/categories/markets) never wipes a logo, cover or gallery.
    if body.logo_url is None:
        doc.pop("logo_url", None)
    if body.photo_url is None:
        doc.pop("photo_url", None)
    if body.photos is None:
        doc.pop("photos", None)
    else:
        photos = []
        for p in body.photos:
            s = (p or "").strip()
            if s and s not in photos:
                photos.append(s)
            if len(photos) >= 6:
                break
        doc["photos"] = photos
    # Credentials are Premium-only. Non-empty credential lists require Premium; an
    # empty/default list never overwrites credentials already on file.
    existing = await db.boat_pros.find_one(
        {"user_id": u["user_id"]}, {"_id": 0, "certifications": 1, "licenses": 1, "insurance": 1})
    for fld in CREDENTIAL_FIELDS:
        normalized = _norm_cred(getattr(body, fld, None))
        if not normalized:
            doc.pop(fld, None)  # don't wipe stored credentials with an empty save
            continue
        if normalized == _norm_cred((existing or {}).get(fld)):
            doc[fld] = normalized  # unchanged — allow
            continue
        if server_tier != "premium":
            raise HTTPException(status_code=400, detail=CREDENTIALS_PREMIUM_MSG)
        doc[fld] = normalized
    doc["tier"] = server_tier
    doc["user_id"] = u["user_id"]
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.boat_pros.update_one(
        {"user_id": u["user_id"]},
        {"$set": doc, "$setOnInsert": {"created_at": doc["updated_at"]}},
        upsert=True,
    )
    return await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0})


@router.get("/reviews")
async def list_reviews(target_id: str):
    return await db.reviews.find({"target_id": target_id, "removed": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(200)


def _validate_category_ratings(cr: Optional[Dict[str, int]]) -> Dict[str, int]:
    if not cr or not all(k in cr for k in REVIEW_CATEGORIES):
        raise HTTPException(status_code=400, detail=f"All categories required: {', '.join(REVIEW_CATEGORIES)}")
    out = {}
    for k in REVIEW_CATEGORIES:
        v = cr.get(k)
        if not isinstance(v, int) or not 1 <= v <= 5:
            raise HTTPException(status_code=400, detail=f"{k} must be 1..5")
        out[k] = v
    return out


@router.post("/reviews")
async def create_review(body: ReviewCreate,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # ONE-WAY reviews are ONLY sailors/owners reviewing an ORGANIZATION. Boat Pro
    # targets use the two-way (accept/reject) system, and Boat Pros / orgs cannot
    # author a one-way review.
    if u.get("account_type") not in ("sailor", "boat_owner"):
        raise HTTPException(status_code=400, detail="Only sailors and boat owners can leave a one-way organization review.")
    target = await db.users.find_one({"user_id": body.target_id}, {"_id": 0, "account_type": 1})
    if not target or target.get("account_type") != "partner":
        raise HTTPException(status_code=400, detail="One-way reviews are only for organizations. Boat Pro reviews use the two-way review flow.")
    # One-way org reviews are a single overall star rating only — no per-dimension
    # category ratings (those belong to the two-way Boat Pro / crew review flow).
    if body.category_ratings:
        raise HTTPException(status_code=400, detail="Category ratings aren't accepted on organization reviews — send a single 1..5 rating.")
    if not can_review(u):  # paid tier required — no Hired bypass for one-way reviews
        raise HTTPException(status_code=403, detail={"code": "upgrade_required",
            "message": "Reviewing is a paid feature. Upgrade your account to leave a review."})
    if not 1 <= body.rating <= 5:
        raise HTTPException(status_code=400, detail="rating must be 1..5")
    existing = await db.reviews.find_one({"target_id": body.target_id, "author_id": u["user_id"]}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        await db.reviews.update_one({"id": existing["id"]}, {"$set": {
            "rating": body.rating, "comment": (body.comment or "").strip(), "updated_at": now}})
        return await db.reviews.find_one({"id": existing["id"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "target_id": body.target_id,
        "author_id": u["user_id"],
        "author_name": u.get("name"),
        "author_avatar": display_image(u),
        "author_handle": u.get("handle"),
        "author_identity": "personal",
        "author_business_id": None,
        "rating": body.rating,
        "comment": (body.comment or "").strip(),
        "created_at": now,
    }
    await db.reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/reviews/{review_id}")
async def update_review(review_id: str, body: ReviewUpdate,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    r = await db.reviews.find_one({"id": review_id}, {"_id": 0, "author_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    if r.get("author_id") != u["user_id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own review")
    if not 1 <= body.rating <= 5:
        raise HTTPException(status_code=400, detail="rating must be 1..5")
    if body.category_ratings:
        raise HTTPException(status_code=400, detail="Category ratings aren't accepted on organization reviews — send a single 1..5 rating.")
    await db.reviews.update_one({"id": review_id}, {"$set": {
        "rating": body.rating, "comment": (body.comment or "").strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return await db.reviews.find_one({"id": review_id}, {"_id": 0})


@router.delete("/reviews/{review_id}")
async def delete_review(review_id: str,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    r = await db.reviews.find_one({"id": review_id}, {"_id": 0, "author_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    if r.get("author_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="You can only delete your own review")
    await db.reviews.delete_one({"id": review_id})
    # Shared cleanup: close any open report on this review (target_deleted) and
    # drop related notifications. The org rating average/count is computed live
    # from db.reviews on every read, so it updates automatically after delete.
    await purge_content("review", review_id, u["user_id"])
    return {"ok": True}


@router.post("/boat-pros/{pro_id}/hire")
async def toggle_hire(pro_id: str,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """Any signed-in member can mark a pro as Hired (toggle) — this also lets
    free-tier members leave a review for that pro."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if pro_id == u["user_id"]:
        raise HTTPException(status_code=400, detail="You can't hire your own listing")
    if not await db.boat_pros.find_one({"user_id": pro_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Pro not found")
    existing = await db.hires.find_one({"pro_id": pro_id, "user_id": u["user_id"]})
    if existing:
        await db.hires.delete_one({"pro_id": pro_id, "user_id": u["user_id"]})
        hired = False
    else:
        await db.hires.insert_one({"pro_id": pro_id, "user_id": u["user_id"],
                                   "created_at": datetime.now(timezone.utc).isoformat()})
        hired = True
    count = await db.hires.count_documents({"pro_id": pro_id})
    return {"hired": hired, "count": count}
