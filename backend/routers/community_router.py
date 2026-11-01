"""Community endpoints: posts, events, registrations, crew bank, aggregator admin."""
from __future__ import annotations
import asyncio
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, Header, HTTPException, Depends, Query, Request

from deps import db, current_user_from_token, is_admin, is_paid_subscriber, partner_badge, require_interaction, require_admin, rate_limit, resolve_handle_user, display_image, business_listing_for, resolve_author_identity, author_fields, purge_content
from schemas import (PostCreate, PostExtend, EventCreate, RegistrationCreate,
                     CrewBankJoin, CrewStatusUpdate, StandaloneCrewUpsert,
                     CommentCreate, EventRecipientsUpdate, EventUpdate)
from pydantic import BaseModel, Field
from constants import PNW_MARKETS, CREW_POSITIONS, MAX_PHOTO_URL_CHARS, EXPERIENCE_TYPES, SAILING_STYLE_KEYS, event_has_crew_bank


def _clean_sailing_style(raw):
    if not raw:
        return None
    out = {}
    for k in SAILING_STYLE_KEYS:
        v = raw.get(k)
        if isinstance(v, (int, float)) and 1 <= int(v) <= 5:
            out[k] = int(v)
    return out or None


def _clean_experience_types(raw):
    return [t for t in (raw or []) if t in EXPERIENCE_TYPES]
from aggregator import run_aggregator, past_event_predicate
from categorize import apply_category, CATEGORIES
from mailer import send_email, crew_join_email_html
from notifications import notify

logger = logging.getLogger("smn.community")
router = APIRouter()

# Fire-and-forget task registry so create_task() targets aren't garbage-collected
# mid-flight — see testing agent iteration_4 review comment.
_bg_tasks: set = set()


def _fire_and_forget(coro):
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return t


# ---------- Posts ----------
@router.get("/posts")
async def list_posts(market: Optional[str] = None, type: Optional[str] = None,
                     markets: Optional[str] = None,
                     q: Optional[str] = None, condition: Optional[str] = None,
                     min_price: Optional[float] = None, max_price: Optional[float] = None,
                     session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    query: Dict[str, Any] = {}
    _mk = [m.strip() for m in (markets or "").split(",") if m.strip()]
    if _mk:
        query["market"] = {"$in": _mk + [None]}
    elif market and market != "all":
        query["market"] = {"$in": [market, None]}
    if type:
        query["type"] = type
    query["hidden_pending_review"] = {"$ne": True}
    now_iso = datetime.now(timezone.utc).isoformat()
    and_clauses: List[Dict[str, Any]] = [
        {"$or": [{"expired": {"$ne": True}}]},
        {"$or": [{"expires_at": None}, {"expires_at": {"$gt": now_iso}}]},
    ]
    # Marketplace (For Sale): hide sold listings from everyone except their owner
    # (sellers keep seeing & managing their own sold items for repost).
    if type == "for_sale":
        if u:
            and_clauses.append({"$or": [{"sold": {"$ne": True}}, {"author_id": u["user_id"]}]})
        else:
            and_clauses.append({"sold": {"$ne": True}})
        if condition:
            query["condition"] = condition
        price_f: Dict[str, Any] = {}
        if min_price is not None:
            price_f["$gte"] = min_price
        if max_price is not None:
            price_f["$lte"] = max_price
        if price_f:
            query["price"] = price_f
    if q and q.strip():
        import re as _re
        rx = _re.escape(q.strip())
        and_clauses.append({"$or": [{"title": {"$regex": rx, "$options": "i"}},
                                     {"body": {"$regex": rx, "$options": "i"}}]})
    query["$and"] = and_clauses
    docs = await db.posts.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Marketplace: a price drop bumps a listing to the top (sort by bumped_at,
    # falling back to created_at).
    if type == "for_sale":
        docs.sort(key=lambda d: d.get("bumped_at") or d.get("created_at") or "", reverse=True)
    # Comment counts — single aggregation over all visible posts
    post_ids = [d.get("id") for d in docs if d.get("id")]
    if post_ids:
        cursor = db.comments.aggregate([
            {"$match": {"post_id": {"$in": post_ids}}},
            {"$group": {"_id": "$post_id", "n": {"$sum": 1}}},
        ])
        counts = {row["_id"]: row["n"] async for row in cursor}
        for d in docs:
            d["comment_count"] = counts.get(d.get("id"), 0)
    for d in docs:
        d["found_crew"] = bool(d.get("found_crew"))
    # Authorship flags for the requesting user so the apps don't recompute them.
    # Same rule as PATCH/DELETE: you own it if author_id matches your user_id.
    uid = u["user_id"] if u else None
    for d in docs:
        mine = bool(uid and d.get("author_id") == uid)
        d["can_edit"] = mine
        d["can_delete"] = mine
    # Enrich author cards: account_type + verified flag + last_active_at
    author_ids = list({d.get("author_id") for d in docs if d.get("author_id")})
    if author_ids:
        users = await db.users.find({"user_id": {"$in": author_ids}},
                                    {"_id": 0, "user_id": 1, "account_type": 1, "handle": 1,
                                     "identity_verified": 1, "subscription_tier": 1,
                                     "founding_partner": 1, "last_active_at": 1}).to_list(None)
        umap = {u["user_id"]: u for u in users}
        for d in docs:
            au = umap.get(d.get("author_id")) or {}
            # Business-identity posts keep their stored business author block
            # (name/handle/avatar); only personal posts refresh from the live
            # user doc so edits to a person's handle/name reflect everywhere.
            if d.get("author_identity") == "business":
                d["author_verified"] = False
                d["author_last_active_at"] = None
                d["author_partner_badge"] = None
                continue
            d["author_account_type"] = au.get("account_type") or d.get("author_account_type")
            d["author_handle"] = au.get("handle") or d.get("author_handle")
            d["author_verified"] = bool(au.get("identity_verified"))
            d["author_last_active_at"] = au.get("last_active_at")
            d["author_partner_badge"] = partner_badge(au)
    # Reading the feed is open to everyone (free, paid, Boat Pro, partners,
    # orgs): posts are always returned in full, never truncated by plan.
    return docs


@router.post("/posts")
async def create_post(body: PostCreate,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Free organizations get 1 feed post per calendar month; other free accounts
    # can't post at all. Paid accounts are unlimited.
    if not is_paid_subscriber(u):
        if u.get("account_type") == "partner":
            month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
            used = await db.posts.count_documents({"author_id": u["user_id"], "created_at": {"$gte": month_start}})
            if used >= 1:
                raise HTTPException(status_code=402, detail={
                    "code": "upgrade_required",
                    "message": "Free organizations get 1 feed post a month. Become a Community Partner for unlimited posts.",
                })
        else:
            require_interaction(u)
    if body.market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market")
    now = datetime.now(timezone.utc)
    days = max(1, min(body.expires_days, 365))
    expires_at = (body.ends_at + "T23:59:59+00:00" if body.ends_at and len(body.ends_at) == 10
                  else body.ends_at) if body.ends_at else (now + timedelta(days=days)).isoformat()
    doc = body.model_dump()
    # For Sale gallery: cap at 6, size-check each, and keep image_url as the first
    # image for back-compat with single-image renderers.
    urls = doc.get("image_urls") or []
    if urls:
        urls = urls[:6]
        for u_ in urls:
            if len(u_ or "") > MAX_PHOTO_URL_CHARS:
                raise HTTPException(status_code=400, detail="Photo too large")
        doc["image_urls"] = urls
        if not doc.get("image_url"):
            doc["image_url"] = urls[0]
    if len(doc.get("image_url") or "") > MAX_PHOTO_URL_CHARS:
        raise HTTPException(status_code=400, detail="Photo too large")
    doc.pop("expires_days", None)
    _pro = await business_listing_for(u)
    _identity = await resolve_author_identity(u, body.identity, _pro)
    doc.pop("identity", None)
    doc.update({
        "id": str(uuid.uuid4()),
        "author_id": u["user_id"],
        **(await author_fields(u, _identity, _pro)),
        "expires_at": expires_at,
        "expired": False,
        "created_at": now.isoformat(),
    })
    await db.posts.insert_one(doc)
    doc.pop("_id", None)
    # Notify members whose saved Marketplace search matches this new listing.
    if doc.get("type") == "for_sale":
        _fire_and_forget(_notify_saved_search_matches(doc))
    return doc


async def _notify_saved_search_matches(post: Dict[str, Any]):
    """Ping members whose saved Marketplace search matches a brand-new listing."""
    try:
        searches = await db.saved_searches.find({}, {"_id": 0}).to_list(2000)
        seen: set = set()
        for s in searches:
            uid = s.get("user_id")
            if not uid or uid == post.get("author_id") or uid in seen:
                continue
            if _post_matches_search(post, s):
                seen.add(uid)
                try:
                    await notify(user_id=uid, kind="saved_search",
                                 title="New listing matches your saved search",
                                 body=f"{post.get('title')}" + (f" · ${post['price']:,.0f}" if isinstance(post.get('price'), (int, float)) else ""),
                                 link="/community?tab=marketplace",
                                 meta={"post_id": post.get("id")})
                except Exception:
                    logger.exception("saved_search notify failed for %s", uid)
    except Exception:
        logger.exception("saved search matching failed")


# ---------- Saved items (bookmarks) ----------
class SavedCreate(BaseModel):
    target_type: str  # post | discussion
    target_id: str


@router.post("/posts/{post_id}/sold")
async def toggle_post_sold(post_id: str, session_token: Optional[str] = Cookie(default=None),
                           authorization: Optional[str] = Header(default=None)):
    """Marketplace seller toggles a For Sale listing as Sold (owner only)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "sold": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("author_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Not your listing")
    new_val = not bool(post.get("sold"))
    now = datetime.now(timezone.utc)
    upd: Dict[str, Any] = {"sold": new_val}
    if new_val:
        # Mark sold — hidden from the Marketplace; kept for the seller 30 days.
        upd["sold_at"] = now.isoformat()
    else:
        # Repost / mark available again — clear sold and renew the 30-day window.
        upd["sold_at"] = None
        upd["expires_at"] = (now + timedelta(days=30)).isoformat()
        upd["expired"] = False
    await db.posts.update_one({"id": post_id}, {"$set": upd})
    return {"sold": new_val}


# ---------- Marketplace: saved searches + price drop ----------
class MarketSearchCreate(BaseModel):
    q: Optional[str] = None
    condition: Optional[str] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    market: Optional[str] = None


def _post_matches_search(post: Dict[str, Any], s: Dict[str, Any]) -> bool:
    """True if a For-Sale post satisfies a saved search's filters."""
    if post.get("type") != "for_sale":
        return False
    if s.get("market") and s["market"] != "all" and post.get("market") != s["market"]:
        return False
    if s.get("condition") and post.get("condition") != s["condition"]:
        return False
    price = post.get("price")
    if s.get("min_price") is not None and (price is None or price < s["min_price"]):
        return False
    if s.get("max_price") is not None and (price is None or price > s["max_price"]):
        return False
    q = (s.get("q") or "").strip().lower()
    if q:
        hay = f"{post.get('title') or ''} {post.get('body') or ''}".lower()
        if q not in hay:
            return False
    return True


@router.post("/marketplace/searches")
async def save_market_search(body: MarketSearchCreate,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not any([body.q and body.q.strip(), body.condition, body.min_price is not None, body.max_price is not None]):
        raise HTTPException(status_code=400, detail="Add at least one filter to save a search")
    doc = {
        "id": str(uuid.uuid4()), "user_id": u["user_id"],
        "q": (body.q or "").strip() or None, "condition": body.condition,
        "min_price": body.min_price, "max_price": body.max_price,
        "market": body.market, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.saved_searches.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/marketplace/searches")
async def list_market_searches(session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return await db.saved_searches.find({"user_id": u["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.delete("/marketplace/searches/{search_id}")
async def delete_market_search(search_id: str,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.saved_searches.delete_one({"id": search_id, "user_id": u["user_id"]})
    return {"ok": True}


class PriceUpdate(BaseModel):
    price: float


@router.post("/posts/{post_id}/price")
async def update_post_price(post_id: str, body: PriceUpdate,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """Seller updates a For-Sale listing's price. A price DROP bumps it to the
    top of the Marketplace, flags a 'price drop' badge, and notifies members who
    bookmarked it."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("author_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Not your listing")
    if post.get("type") != "for_sale":
        raise HTTPException(status_code=400, detail="Only For Sale listings have a price")
    if body.price < 0:
        raise HTTPException(status_code=400, detail="Price can't be negative")
    now = datetime.now(timezone.utc).isoformat()
    old_price = post.get("price")
    is_drop = isinstance(old_price, (int, float)) and body.price < old_price
    upd: Dict[str, Any] = {"price": body.price}
    if is_drop:
        upd["prev_price"] = old_price
        upd["price_dropped_at"] = now
        upd["bumped_at"] = now
    await db.posts.update_one({"id": post_id}, {"$set": upd})
    if is_drop:
        savers = await db.saved_items.find(
            {"target_id": post_id, "target_type": "post"}, {"_id": 0, "user_id": 1}).to_list(500)
        for sv in savers:
            uid = sv.get("user_id")
            if not uid or uid == u["user_id"]:
                continue
            try:
                await notify(user_id=uid, kind="price_drop",
                             title=f"Price drop: {post.get('title')}",
                             body=f"Now ${body.price:,.0f} (was ${old_price:,.0f}). Tap to view in the Marketplace.",
                             link="/community?tab=marketplace",
                             meta={"post_id": post_id})
            except Exception:
                logger.exception("price drop notify failed for %s", uid)
    return {"price": body.price, "price_dropped": is_drop}


class PostEdit(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    price: Optional[float] = None
    condition: Optional[str] = None
    image_url: Optional[str] = None
    image_urls: Optional[List[str]] = None


@router.patch("/posts/{post_id}")
async def edit_post(post_id: str, body: PostEdit,
                    session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    """Author edits their post. For-Sale keeps its owner-or-admin title/price/
    condition/photo edit; feed, general and sailing posts are author-only and
    edit the body and images only."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    is_for_sale = post.get("type") == "for_sale"
    # For-Sale keeps its existing owner-or-admin edit (title/price/condition/photos).
    # Other post types (feed / general / sailing opportunity) are author-only and
    # edit the body and images only. Plan gating is NOT applied to editing content
    # a user already owns.
    if is_for_sale:
        if post.get("author_id") != u["user_id"] and not is_admin(u):
            raise HTTPException(status_code=403, detail="Not your listing")
    else:
        if post.get("author_id") != u["user_id"]:
            raise HTTPException(status_code=403, detail="You can only edit your own post")
    changes: Dict[str, Any] = {}
    if is_for_sale:
        if body.title is not None:
            t = body.title.strip()
            if not t:
                raise HTTPException(status_code=400, detail="Title can't be empty")
            changes["title"] = t
        if body.body is not None:
            b = body.body.strip()
            if not b:
                raise HTTPException(status_code=400, detail="Description can't be empty")
            changes["body"] = b
        if body.condition is not None:
            changes["condition"] = body.condition or None
        if body.price is not None:
            if body.price < 0:
                raise HTTPException(status_code=400, detail="Price can't be negative")
            changes["price"] = body.price
        if body.image_urls is not None:
            urls = (body.image_urls or [])[:6]
            for u_ in urls:
                if len(u_ or "") > MAX_PHOTO_URL_CHARS:
                    raise HTTPException(status_code=400, detail="Photo too large")
            changes["image_urls"] = urls
            changes["image_url"] = urls[0] if urls else None
        if not changes:
            return post
        changes["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.posts.update_one({"id": post_id}, {"$set": changes})
        return await db.posts.find_one({"id": post_id}, {"_id": 0})
    # Non-for-sale: body + images only. Title/type/market/author/identity/created_at
    # are not editable. Setting the body stamps edited_at so apps can show "edited".
    if body.body is not None:
        b = body.body.strip()
        if not b:
            raise HTTPException(status_code=400, detail="Body can't be empty")
        if len(b) > 20000:
            raise HTTPException(status_code=400, detail="Body is too long (max 20000 characters)")
        changes["body"] = b
        changes["edited_at"] = datetime.now(timezone.utc).isoformat()
    if body.image_url is not None:
        if len(body.image_url or "") > MAX_PHOTO_URL_CHARS:
            raise HTTPException(status_code=400, detail="Photo too large")
        changes["image_url"] = body.image_url or None
    if body.image_urls is not None:
        urls = (body.image_urls or [])[:6]
        for u_ in urls:
            if len(u_ or "") > MAX_PHOTO_URL_CHARS:
                raise HTTPException(status_code=400, detail="Photo too large")
        changes["image_urls"] = urls
    if not changes:
        return post
    await db.posts.update_one({"id": post_id}, {"$set": changes})
    return await db.posts.find_one({"id": post_id}, {"_id": 0})


@router.delete("/posts/{post_id}")
async def delete_post(post_id: str,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """Author deletes their post. For-Sale keeps its owner-or-admin delete; feed,
    general and sailing posts are author-only. Both reuse the shared cleanup so
    comments, reactions, bookmarks and notifications go, and any open report is
    closed (target_deleted) so the moderation queue stays consistent."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "type": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("type") == "for_sale":
        if post.get("author_id") != u["user_id"] and not is_admin(u):
            raise HTTPException(status_code=403, detail="Not your listing")
    else:
        if post.get("author_id") != u["user_id"]:
            raise HTTPException(status_code=403, detail="You can only delete your own post")
    await db.posts.delete_one({"id": post_id})
    await purge_content("post", post_id, u["user_id"])
    return {"ok": True, "id": post_id}


@router.get("/posts/mine/for-sale")
async def my_for_sale(session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """A seller's own Marketplace listings (active + recently sold) for the
    profile 'My Listings' view with one-tap relist."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    docs = await db.posts.find(
        {"type": "for_sale", "author_id": u["user_id"]}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda d: (bool(d.get("sold")), -(_iso_ms(d.get("bumped_at") or d.get("created_at")))))
    return docs


def _iso_ms(v) -> float:
    try:
        return datetime.fromisoformat(v).timestamp() if v else 0.0
    except Exception:
        return 0.0


@router.get("/sailflow/station")
async def sailflow_station(market: Optional[str] = None):
    """Nearest SailFlow station for a market (editable mapping lives in
    backend/sailflow_stations.py). Used by the home-screen weather card."""
    from sailflow_stations import station_for
    return station_for(market)


@router.post("/saved")
async def save_item(body: SavedCreate, session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.target_type not in {"post", "discussion"}:
        raise HTTPException(status_code=400, detail="Invalid target type")
    coll = db.posts if body.target_type == "post" else db.discussions
    if not await coll.find_one({"id": body.target_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Not found")
    await db.saved_items.update_one(
        {"user_id": u["user_id"], "target_id": body.target_id},
        {"$set": {"user_id": u["user_id"], "target_type": body.target_type,
                  "target_id": body.target_id, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"saved": True}


@router.delete("/saved/{target_id}")
async def unsave_item(target_id: str, session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.saved_items.delete_one({"user_id": u["user_id"], "target_id": target_id})
    return {"saved": False}


@router.get("/saved/ids")
async def saved_ids(session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        return {"ids": []}
    docs = await db.saved_items.find({"user_id": u["user_id"]}, {"_id": 0, "target_id": 1}).to_list(1000)
    return {"ids": [d["target_id"] for d in docs]}


@router.get("/saved")
async def list_saved(session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    saved = await db.saved_items.find({"user_id": u["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for s in saved:
        coll = db.posts if s.get("target_type") == "post" else db.discussions
        doc = await coll.find_one({"id": s.get("target_id")}, {"_id": 0})
        if doc:
            doc["saved_type"] = s.get("target_type")
            doc["saved_at"] = s.get("created_at")
            out.append(doc)
    return out


@router.post("/posts/{post_id}/extend")
async def extend_post(post_id: str, body: PostExtend,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    p = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not p or p.get("author_id") != u["user_id"]:
        raise HTTPException(status_code=403, detail="Not your post")
    new_expiry = (datetime.now(timezone.utc) + timedelta(days=max(1, min(body.days, 365)))).isoformat()
    await db.posts.update_one({"id": post_id}, {"$set": {"expires_at": new_expiry, "expired": False,
                                                          "extension_prompted_at": None}})
    return {"expires_at": new_expiry}


# ---------- Events ----------
@router.get("/stats/public")
async def public_stats():
    """Lightweight public counts for the marketing home's social-proof strip."""
    from aggregator import upcoming_event_predicate
    now_iso = datetime.now(timezone.utc).isoformat()
    members = await db.users.count_documents({})
    pros = await db.boat_pros.count_documents({})
    events = await db.events.count_documents(upcoming_event_predicate(now_iso))
    discussions = await db.discussions.count_documents({})
    seeking_crew = await db.crew_bank_standalone.count_documents({
        "status": "seeking",
        "$or": [{"expires_at": None}, {"expires_at": {"$gt": now_iso}}],
    })
    return {"members": members, "boat_pros": pros, "upcoming_events": events,
            "discussions": discussions, "markets": len(PNW_MARKETS),
            "sailors_seeking_crew": seeking_crew}


@router.get("/events")
async def list_events(market: Optional[str] = None, from_: Optional[str] = Query(default=None, alias="from"),
                      to: Optional[str] = None, category: Optional[str] = None, markets: Optional[str] = None,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    from aggregator import upcoming_event_predicate
    u = await current_user_from_token(session_token, authorization)
    now_iso = datetime.now(timezone.utc).isoformat()
    query: Dict[str, Any] = {}
    _mk = [m.strip() for m in (markets or "").split(",") if m.strip()]
    if _mk:
        query["market"] = {"$in": _mk}
    elif market and market != "all":
        query["market"] = market
    if category and category in CATEGORIES:
        query["category"] = category
    if from_ or to:
        rng: Dict[str, Any] = {}
        if from_:
            rng["$gte"] = from_
        if to:
            rng["$lte"] = to
        query["starts_at"] = rng
    # Shared with /api/admin/events — intra-day precision for timed events, and
    # date-only (all-day) events remain visible because create_event synthesizes
    # ends_at = next-day midnight for them.
    query.update(upcoming_event_predicate(now_iso))
    query["hidden_pending_review"] = {"$ne": True}
    # organizer_email is the public RSVP contact (shown as a mailto on the event
    # page) but only to signed-in users, to avoid harvesting from the open API.
    proj: Dict[str, Any] = {"_id": 0, "email_recipients": 0}
    if not u:
        proj["organizer_email"] = 0
    docs = await db.events.find(query, proj).sort("starts_at", 1).to_list(500)
    if not docs:
        return docs
    ev_ids = [d["id"] for d in docs]
    # Single aggregation for registrations + single aggregation for crew counts
    reg_cur = db.event_registrations.aggregate([
        {"$match": {"event_id": {"$in": ev_ids}}},
        {"$group": {"_id": {"event_id": "$event_id", "kind": "$kind"}, "n": {"$sum": 1}}},
    ])
    reg_map: Dict[str, Dict[str, int]] = {}
    async for row in reg_cur:
        eid = row["_id"]["event_id"]
        reg_map.setdefault(eid, {"attendee": 0, "volunteer": 0})[row["_id"]["kind"]] = row["n"]
    crew_cur = db.crew_bank.aggregate([
        {"$match": {"event_id": {"$in": ev_ids}, "status": {"$ne": "found"}}},
        {"$group": {"_id": "$event_id", "n": {"$sum": 1}}},
    ])
    crew_map = {row["_id"]: row["n"] async for row in crew_cur}
    # Community Partner badge for event organizers.
    org_ids = list({d.get("organizer_id") for d in docs if d.get("organizer_id")})
    obadge: Dict[str, Any] = {}
    if org_ids:
        async for ou in db.users.find({"user_id": {"$in": org_ids}},
                                      {"_id": 0, "user_id": 1, "subscription_tier": 1, "founding_partner": 1}):
            obadge[ou["user_id"]] = partner_badge(ou)
    for d in docs:
        d["registrations"] = reg_map.get(d["id"], {"attendee": 0, "volunteer": 0})
        d["crew_count"] = crew_map.get(d["id"], 0)
        d["organizer_partner_badge"] = obadge.get(d.get("organizer_id"))
        if not d.get("category"):
            apply_category(d)
        # Volunteer host contact details are for signed-in members only.
        if not u:
            d.pop("volunteer_contact_email", None)
            d.pop("volunteer_contact_phone", None)
    return docs


@router.post("/events")
async def create_event(body: EventCreate, request: Request,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    rate_limit("event_post", request, limit=10, window=3600, detail="You're posting events too quickly. This is a temporary hourly limit that applies to every account, not a plan or partner limit. Please try again in an hour.")
    # Alpha gate: event posting is closed to sailors and boat owners (paid or
    # free) because editing and event guidelines do not exist for them yet. This
    # is NOT an upgrade path (upgrading would not help), so it uses its own code
    # rather than upgrade_required. Clubs/orgs (incl. free partner orgs), Boat
    # Pros and admins are unaffected and fall through to the rules below.
    if u.get("account_type") in ("sailor", "boat_owner") and not is_admin(u):
        raise HTTPException(status_code=403, detail={
            "code": "event_posting_closed",
            "message": "Event posting is open to clubs, organizations and Boat Pros for now.",
        })
    # Free organizations may post volunteer opportunities only, capped at 1 per
    # calendar month; regular events require the Community Partner tier. Free
    # individuals cannot create events at all (same gate as feed posts).
    if not is_paid_subscriber(u):
        if u.get("account_type") == "partner":
            if not body.is_volunteer:
                raise HTTPException(status_code=402, detail={
                    "code": "upgrade_required",
                    "message": "Free organizations can post volunteer opportunities only. Become a Community Partner to post events.",
                })
            month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
            used = await db.events.count_documents({
                "organizer_id": u["user_id"], "is_volunteer": True, "created_at": {"$gte": month_start},
            })
            if used >= 1:
                raise HTTPException(status_code=402, detail={
                    "code": "upgrade_required",
                    "message": "Free organizations get 1 volunteer event a month. Become a Community Partner to post more.",
                })
        else:
            require_interaction(u)
    if body.market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market")
    from date_utils import normalize_iso, is_date_only, end_of_day_iso, end_before_start
    doc = body.model_dump()
    if len(doc.get("image_url") or "") > MAX_PHOTO_URL_CHARS:
        raise HTTPException(status_code=400, detail="Flyer image too large")
    raw_starts = doc.get("starts_at")
    raw_ends = doc.get("ends_at")
    # Canonicalize all incoming ISO timestamps so read-time filters compare cleanly.
    starts = normalize_iso(raw_starts)
    ends = normalize_iso(raw_ends) if raw_ends else None
    # If this is an all-day (date-only) event with no ends_at, synthesize
    # ends_at = next-day-midnight UTC so the whole event day stays visible.
    if is_date_only(raw_starts) and not ends:
        ends = end_of_day_iso(raw_starts)
    # normalize_iso fails open on unparseable input — reject those explicitly.
    def _is_valid(v):
        return isinstance(v, str) and "T" in v and v.endswith("+00:00")
    if not _is_valid(starts):
        raise HTTPException(status_code=400, detail="Invalid starts_at (must be ISO-8601 date or datetime)")
    if raw_ends and not _is_valid(ends):
        raise HTTPException(status_code=400, detail="Invalid ends_at (must be ISO-8601 date or datetime)")
    doc["starts_at"] = starts
    doc["ends_at"] = ends
    doc["time_not_listed"] = bool(is_date_only(raw_starts))
    if end_before_start(starts, ends, doc["time_not_listed"]):
        raise HTTPException(status_code=400, detail="End time must be after the start time")
    if doc.get("category") in CATEGORIES:
        doc["category_manual"] = True
    else:
        doc.pop("category", None)
    apply_category(doc)
    doc.update({
        "id": str(uuid.uuid4()),
        "organizer_id": u["user_id"],
        "organizer_name": u.get("name"),
        "organizer_email": u.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "approved": True,
    })
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    try:
        from geocode import geocode_event
        asyncio.create_task(geocode_event(db, doc["id"]))
    except Exception:
        logger.exception("failed to schedule geocode for %s", doc.get("id"))
    return doc


async def _owned_event(event_id: str, u: Dict[str, Any]) -> Dict[str, Any]:
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.get("source") == "aggregator":
        raise HTTPException(status_code=400, detail="Imported feed events can't be edited here")
    if ev.get("organizer_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


async def _event_for_organizer(event_id: str, u: Dict[str, Any]) -> Dict[str, Any]:
    """Like _owned_event but allows imported (aggregator) events that have been
    LINKED to this organizer's club/org. Used for roster messaging — organizers of
    linked feed events may message their RSVPs/volunteers even though the event
    itself stays feed-managed (no edit/cancel)."""
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.get("organizer_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


async def _notify_event_people(ev: Dict[str, Any], kind: str, title: str, body_txt: str, exclude: str):
    from notifications import notify
    regs = await db.event_registrations.find({"event_id": ev["id"]}, {"_id": 0, "user_id": 1}).to_list(500)
    crew = await db.crew_bank.find({"event_id": ev["id"]}, {"_id": 0, "user_id": 1}).to_list(500)
    for uid in {r["user_id"] for r in regs + crew if r.get("user_id")} - {exclude}:
        await notify(user_id=uid, kind=kind, title=title, body=body_txt,
                     link=f"/events?event={ev['id']}" if kind != "event_cancelled" else "/events",
                     meta={"event_id": ev["id"]})


@router.patch("/events/{event_id}")
async def update_event(event_id: str, body: EventUpdate,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ev = await _owned_event(event_id, u)
    from date_utils import normalize_iso, is_date_only, end_of_day_iso, end_before_start
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if "market" in changes and changes["market"] not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market")
    if len(changes.get("image_url") or "") > MAX_PHOTO_URL_CHARS:
        raise HTTPException(status_code=400, detail="Flyer image too large")
    raw_starts = changes.get("starts_at")
    for k in ("starts_at", "ends_at"):
        if k in changes:
            iso = normalize_iso(changes[k])
            if not (isinstance(iso, str) and "T" in iso and iso.endswith("+00:00")):
                raise HTTPException(status_code=400, detail=f"Invalid {k}")
            changes[k] = iso
    if "category" in changes and changes["category"] not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    if not changes:
        return ev
    eff_starts = changes.get("starts_at", ev.get("starts_at"))
    eff_ends = changes.get("ends_at", ev.get("ends_at"))
    eff_tnl = is_date_only(raw_starts) if raw_starts else ev.get("time_not_listed")
    if end_before_start(eff_starts, eff_ends, eff_tnl):
        raise HTTPException(status_code=400, detail="End time must be after the start time")
    # EVENTS-FIX-1: same shared lock rule as the admin editor (derives/locks time_not_listed).
    from event_locks import finalize_editor_changes
    changes, locked_fields = finalize_editor_changes(changes, raw_starts)
    update_doc = {"$set": changes}
    if locked_fields:
        update_doc["$addToSet"] = {"admin_locked_fields": {"$each": locked_fields}}
    await db.events.update_one({"id": event_id}, update_doc)
    updated = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not updated.get("category_manual"):
        apply_category(updated)
    when_changed = any(k in changes for k in ("starts_at", "ends_at", "location", "market"))
    if when_changed or "title" in changes:
        await _notify_event_people(updated, "event_updated", f"Updated: {updated['title']}",
                                   "Time or location changed — tap to see the latest details.", u["user_id"])
    return updated


@router.get("/events/{event_id}/attendees.csv")
async def export_attendees_csv(event_id: str,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    """Organizer/admin check-in sheet: RSVPs + Crew Bank signups as CSV."""
    import csv, io
    from fastapi.responses import StreamingResponse
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.get("organizer_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=404, detail="Event not found")
    regs = await db.event_registrations.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    crew = await db.crew_bank.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    users = {x["user_id"]: x for x in await db.users.find(
        {"user_id": {"$in": list({r["user_id"] for r in regs + crew})}},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "handle": 1, "primary_market": 1}).to_list(2000)}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["type", "name", "email", "handle", "market", "positions", "experience", "notes", "status", "signed_up_at", "checked_in"])
    for r in regs:
        p = users.get(r["user_id"], {})
        w.writerow([r.get("kind") or "attendee", p.get("name") or r.get("user_name") or "", p.get("email") or "", p.get("handle") or "",
                    p.get("primary_market") or "", "", "", "", "", (r.get("created_at") or "")[:19], ""])
    for c in crew:
        p = users.get(c["user_id"], {})
        w.writerow(["crew", p.get("name") or c.get("user_name") or "", p.get("email") or c.get("user_email") or "", p.get("handle") or "",
                    p.get("primary_market") or c.get("user_market") or "", "; ".join(c.get("positions") or []),
                    c.get("experience") or "", c.get("notes") or "", c.get("status") or "open", (c.get("created_at") or "")[:19], ""])
    slug = "".join(ch if ch.isalnum() else "-" for ch in (ev.get("title") or "event")).strip("-").lower()[:60]
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{slug}-attendees.csv"'})


class EventSeriesCreate(EventCreate):
    repeat: str = "weekly"  # weekly | biweekly
    occurrences: int = Field(default=8, ge=2, le=26)


@router.post("/events/series")
async def create_event_series(body: EventSeriesCreate, request: Request,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Post a recurring series (e.g. Wednesday night races) in one go."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market")
    if body.repeat not in ("weekly", "biweekly"):
        raise HTTPException(status_code=400, detail="repeat must be weekly or biweekly")
    if len(body.image_url or "") > MAX_PHOTO_URL_CHARS:
        raise HTTPException(status_code=400, detail="Flyer image too large")
    rate_limit("event_post", request, limit=10, window=3600, detail="You're posting events too quickly. This is a temporary hourly limit that applies to every account, not a plan or partner limit. Please try again in an hour.")
    from date_utils import normalize_iso, is_date_only, end_of_day_iso
    step = timedelta(days=7 if body.repeat == "weekly" else 14)
    starts0 = normalize_iso(body.starts_at)
    ends0 = normalize_iso(body.ends_at) if body.ends_at else None
    if not (isinstance(starts0, str) and "T" in starts0):
        raise HTTPException(status_code=400, detail="Invalid starts_at")
    all_day = is_date_only(body.starts_at)
    series_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    base = body.model_dump(exclude={"repeat", "occurrences"})
    if base.get("category") in CATEGORIES:
        base["category_manual"] = True
    else:
        base.pop("category", None)
    s_dt = datetime.fromisoformat(starts0)
    e_dt = datetime.fromisoformat(ends0) if ends0 else None
    docs = []
    for i in range(body.occurrences):
        s = s_dt + step * i
        doc = dict(base)
        doc["starts_at"] = s.isoformat()
        doc["ends_at"] = (e_dt + step * i).isoformat() if e_dt else (end_of_day_iso(s.date().isoformat()) if all_day else None)
        apply_category(doc)
        doc.update({"id": str(uuid.uuid4()), "series_id": series_id, "series_index": i + 1, "series_total": body.occurrences,
                    "organizer_id": u["user_id"], "organizer_name": u.get("name"), "organizer_email": u.get("email"),
                    "created_at": now_iso, "approved": True})
        docs.append(doc)
    await db.events.insert_many(docs)
    for d in docs:
        d.pop("_id", None)
    return {"series_id": series_id, "count": len(docs), "events": docs}


@router.delete("/events/series/{series_id}")
async def cancel_event_series(series_id: str,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    q: Dict[str, Any] = {"series_id": series_id}
    if not is_admin(u):
        q["organizer_id"] = u["user_id"]
    evs = await db.events.find(q, {"_id": 0}).to_list(100)
    if not evs:
        raise HTTPException(status_code=404, detail="Series not found")
    for ev in evs:
        await _notify_event_people(ev, "event_cancelled", f"Cancelled: {ev['title']}",
                                   "The organizer cancelled this series. Check the calendar for more.", u["user_id"])
    ids = [e["id"] for e in evs]
    await db.events.delete_many({"id": {"$in": ids}})
    await db.event_registrations.delete_many({"event_id": {"$in": ids}})
    await db.crew_bank.delete_many({"event_id": {"$in": ids}})
    return {"ok": True, "cancelled": len(ids)}


@router.patch("/events/series/{series_id}")
async def update_event_series(series_id: str, body: EventUpdate,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Apply edits to every REMAINING event in a series. Time edits are applied as a
    shift (same weekday cadence, new time-of-day / offset) so each occurrence keeps its date."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from date_utils import normalize_iso
    q: Dict[str, Any] = {"series_id": series_id, "starts_at": {"$gte": datetime.now(timezone.utc).isoformat()}}
    if not is_admin(u):
        q["organizer_id"] = u["user_id"]
    evs = await db.events.find(q, {"_id": 0}).sort("starts_at", 1).to_list(100)
    if not evs:
        raise HTTPException(status_code=404, detail="No upcoming events in this series")
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if "market" in changes and changes["market"] not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market")
    if len(changes.get("image_url") or "") > MAX_PHOTO_URL_CHARS:
        raise HTTPException(status_code=400, detail="Flyer image too large")
    if "category" in changes:
        if changes["category"] not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category")
        changes["category_manual"] = True
        changes["category_needs_review"] = False
    start_delta = end_delta = None
    first = evs[0]
    if "starts_at" in changes:
        new_start = normalize_iso(changes.pop("starts_at"))
        if not (isinstance(new_start, str) and "T" in new_start):
            raise HTTPException(status_code=400, detail="Invalid starts_at")
        start_delta = datetime.fromisoformat(new_start) - datetime.fromisoformat(first["starts_at"])
    if "ends_at" in changes:
        new_end = normalize_iso(changes.pop("ends_at"))
        if not (isinstance(new_end, str) and "T" in new_end):
            raise HTTPException(status_code=400, detail="Invalid ends_at")
        base_end = first.get("ends_at") or first["starts_at"]
        end_delta = datetime.fromisoformat(new_end) - datetime.fromisoformat(base_end)
    if not changes and start_delta is None and end_delta is None:
        return {"ok": True, "updated": 0}
    now_iso = datetime.now(timezone.utc).isoformat()
    when_changed = start_delta is not None or end_delta is not None or any(k in changes for k in ("location", "market"))
    for ev in evs:
        per = dict(changes, updated_at=now_iso)
        if start_delta is not None:
            per["starts_at"] = (datetime.fromisoformat(ev["starts_at"]) + start_delta).isoformat()
        if end_delta is not None:
            per["ends_at"] = (datetime.fromisoformat(ev.get("ends_at") or ev["starts_at"]) + end_delta).isoformat()
        await db.events.update_one({"id": ev["id"]}, {"$set": per})
        if when_changed or "title" in changes:
            merged = {**ev, **per}
            await _notify_event_people(merged, "event_updated", f"Updated: {merged['title']}",
                                       "This series changed time or location — tap for details.", u["user_id"])
    return {"ok": True, "updated": len(evs), "series_id": series_id}


@router.get("/events/mine")
async def my_events(session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    """Organizer dashboard: my posted events (upcoming + recent past) with RSVP/volunteer/crew counts."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    since = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    docs = await db.events.find({"organizer_id": u["user_id"], "starts_at": {"$gte": since}},
                                {"_id": 0, "organizer_email": 0, "email_recipients": 0}).sort("starts_at", 1).to_list(300)
    ids = [d["id"] for d in docs]
    regs: Dict[str, Dict[str, int]] = {}
    async for r in db.event_registrations.aggregate([{"$match": {"event_id": {"$in": ids}}},
                                                     {"$group": {"_id": {"e": "$event_id", "k": "$kind"}, "n": {"$sum": 1}}}]):
        regs.setdefault(r["_id"]["e"], {})[r["_id"]["k"] or "attendee"] = r["n"]
    crew: Dict[str, Dict[str, int]] = {}
    async for c in db.crew_bank.aggregate([{"$match": {"event_id": {"$in": ids}}},
                                           {"$group": {"_id": {"e": "$event_id", "s": "$status"}, "n": {"$sum": 1}}}]):
        crew.setdefault(c["_id"]["e"], {})[c["_id"]["s"] or "open"] = c["_id"] and c["n"]
    now_iso = datetime.now(timezone.utc).isoformat()
    for d in docs:
        r = regs.get(d["id"], {})
        c = crew.get(d["id"], {})
        d["registrations"] = {"attendee": r.get("attendee", 0), "volunteer": r.get("volunteer", 0)}
        d["crew_count"] = sum(c.values())
        d["crew_found"] = c.get("found", 0)
        d["is_past"] = d["starts_at"] < now_iso
        if not d.get("category"):
            apply_category(d)
    return docs


def _word_safe_preview(text: str, limit: int = 120) -> str:
    """First line of `text`, trimmed to `limit` chars without cutting a word."""
    first = (text or "").strip().splitlines()[0] if (text or "").strip() else ""
    if len(first) <= limit:
        return first
    cut = first[:limit]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 0 else cut).rstrip() + "..."


class EventBlast(BaseModel):
    subject: str = Field(min_length=2, max_length=120)
    message: str = Field(min_length=2, max_length=2000)
    send_email: bool = True
    audience: str = "all"  # all | volunteer | attendee


@router.post("/events/{event_id}/blast")
async def event_message_blast(event_id: str, body: EventBlast, request: Request,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Organizer → RSVPs / volunteers / crew: in-app notification (+push) and optional email.
    `audience` targets everyone (all), only volunteers, or only attendees."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ev = await _event_for_organizer(event_id, u)
    if body.audience not in {"all", "volunteer", "attendee"}:
        raise HTTPException(status_code=400, detail="Invalid audience")
    rate_limit("event_blast", request, limit=5, window=3600, detail="Blast limit reached — max 5 per hour.")
    from notifications import notify
    from mailer import send_email, event_blast_email_html
    if body.audience in {"volunteer", "attendee"}:
        regs = await db.event_registrations.find({"event_id": event_id, "kind": body.audience},
                                                 {"_id": 0, "user_id": 1}).to_list(1000)
        crew = []
    else:
        regs = await db.event_registrations.find({"event_id": event_id}, {"_id": 0, "user_id": 1}).to_list(1000)
        crew = await db.crew_bank.find({"event_id": event_id}, {"_id": 0, "user_id": 1}).to_list(1000)
    user_ids = list({r["user_id"] for r in regs + crew if r.get("user_id")} - {u["user_id"]})
    users = await db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "email": 1}).to_list(2000)
    origin = (request.headers.get("origin") or "https://app.sailmorenow.com").rstrip("/")
    html = event_blast_email_html(organizer_name=u.get("name") or "", event_title=ev["title"], event_starts_at=ev["starts_at"],
                                  subject=body.subject, message=body.message, event_url=f"{origin}/events?event={event_id}")

    # Volunteer reminders land in ONE group message thread per event (host + every
    # volunteer signed up at send time). Later reminders post into the same thread;
    # volunteers who signed up since are added. Members are never removed, so a
    # volunteer who cancels keeps read access to the history. The notification is a
    # DM that opens the thread with a short, word-safe preview.
    if body.audience == "volunteer":
        now_iso = datetime.now(timezone.utc).isoformat()
        thread_title = f"{ev['title']} Volunteers"[:80]
        msg_body = f"{body.subject}\n\n{body.message}"
        thread = await db.dm_threads.find_one({"is_group": True, "event_reminder_event_id": event_id}, {"_id": 0})
        if not thread:
            thread_id = "group_" + uuid.uuid4().hex
            participants = [u["user_id"], *user_ids]
            await db.dm_threads.insert_one({
                "thread_id": thread_id, "is_group": True, "title": thread_title, "participants": participants,
                "created_by": u["user_id"], "created_at": now_iso, "updated_at": now_iso,
                "author_identity": "personal", "last_message": msg_body[:200],
                "reads": {u["user_id"]: now_iso}, "event_reminder_event_id": event_id,
            })
        else:
            thread_id = thread["thread_id"]
            if user_ids:
                await db.dm_threads.update_one({"thread_id": thread_id}, {"$addToSet": {"participants": {"$each": user_ids}}})
            thread = await db.dm_threads.find_one({"thread_id": thread_id}, {"_id": 0})
            participants = thread.get("participants", [])
            await db.dm_threads.update_one(
                {"thread_id": thread_id},
                {"$set": {"updated_at": now_iso, "last_message": msg_body[:200], f"reads.{u['user_id']}": now_iso},
                 "$pull": {"deleted_for": {"$in": participants}}},
            )
        await db.dm_messages.insert_one({
            "id": str(uuid.uuid4()), "thread_id": thread_id, "from_id": u["user_id"], "from_name": u.get("name"),
            "to_id": None, "body": msg_body, "created_at": now_iso, "read_at": None,
            "author_identity": "personal", "author_business_id": None,
        })
        preview = _word_safe_preview(body.subject, 120)
        notified = emailed = 0
        recipients = [p for p in participants if p != u["user_id"]]
        for pid in recipients:
            await notify(user_id=pid, kind="dm", title=thread_title, body=preview,
                         link=f"/messages?thread={thread_id}",
                         meta={"thread_id": thread_id, "is_group": True, "event_id": event_id})
            notified += 1
        if body.send_email:
            email_by_id = {usr["user_id"]: usr.get("email") for usr in users}
            for pid in recipients:
                em = email_by_id.get(pid)
                if em:
                    res = await send_email(em, f"{body.subject}: {ev['title']}", html, reply_to=u.get("email"))
                    if res.get("status") == "ok":
                        emailed += 1
        await db.event_blasts.insert_one({"id": str(uuid.uuid4()), "event_id": event_id, "sender_id": u["user_id"], "subject": body.subject,
                                          "message": body.message, "recipients": notified, "emailed": emailed,
                                          "thread_id": thread_id, "created_at": now_iso})
        return {"ok": True, "recipients": notified, "emailed": emailed, "thread_id": thread_id}

    notified = emailed = 0
    for p in users:
        await notify(user_id=p["user_id"], kind="event_blast", title=f"{ev['title']}: {body.subject}", body=body.message[:240],
                     link=f"/events?event={event_id}", meta={"event_id": event_id})
        notified += 1
        if body.send_email and p.get("email"):
            res = await send_email(p["email"], f"{body.subject}: {ev['title']}", html, reply_to=u.get("email"))
            if res.get("status") == "ok":
                emailed += 1
    await db.event_blasts.insert_one({"id": str(uuid.uuid4()), "event_id": event_id, "sender_id": u["user_id"], "subject": body.subject,
                                      "message": body.message, "recipients": notified, "emailed": emailed,
                                      "created_at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True, "recipients": notified, "emailed": emailed}


@router.get("/events/{event_id}/blasts")
async def event_blast_history(event_id: str,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await _event_for_organizer(event_id, u)
    return await db.event_blasts.find({"event_id": event_id}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)


@router.get("/partners/{handle}/events")
async def partner_public_events(handle: str):
    """Public: a partner/pro's upcoming events — embeddable/linkable from their own site."""
    h = (handle or "").lstrip("@").lower().strip()
    org = await db.users.find_one({"handle": h}, {"_id": 0, "user_id": 1, "handle": 1, "name": 1, "picture": 1, "avatar": 1,
                                                  "bio": 1, "account_type": 1, "primary_market": 1})
    if not org:
        raise HTTPException(status_code=404, detail="Username not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    events = await db.events.find({"organizer_id": org["user_id"], "starts_at": {"$gte": now_iso}},
                                  {"_id": 0, "organizer_email": 0, "email_recipients": 0}).sort("starts_at", 1).to_list(100)
    for d in events:
        if not d.get("category"):
            apply_category(d)
    return {"organizer": org, "events": events}


@router.get("/partners")
async def list_partners(market: Optional[str] = None, category: Optional[str] = None):
    """Public Clubs & Organizations directory: all organization accounts, with
    Community Partners (founding first, then partner) sorted to the top."""
    q: Dict[str, Any] = {"account_type": "partner"}
    and_conds: list = []
    if market and market != "all":
        and_conds.append({"$or": [{"primary_market": market}, {"markets": market}]})
    if category:
        and_conds.append({"$or": [{"org_categories": category}, {"org_category": category}]})
    if and_conds:
        q["$and"] = and_conds
    users = await db.users.find(q, {
        "_id": 0, "user_id": 1, "handle": 1, "name": 1, "avatar": 1, "picture": 1,
        "bio": 1, "primary_market": 1, "markets": 1, "subscription_tier": 1, "founding_partner": 1,
        "org_category": 1, "org_categories": 1, "logo_url": 1, "identity_verified": 1,
    }).to_list(500)
    for u in users:
        u["partner_badge"] = partner_badge(u)
    ids = [u["user_id"] for u in users]
    counts: Dict[str, int] = {}
    if ids:
        async for row in db.follows.aggregate([
            {"$match": {"org_id": {"$in": ids}}},
            {"$group": {"_id": "$org_id", "n": {"$sum": 1}}},
        ]):
            counts[row["_id"]] = row["n"]
    from routers.reviews_router import compute_summary, _live_session_ids
    live_rows = await _live_session_ids()
    for u in users:
        u["follower_count"] = counts.get(u["user_id"], 0)
        summ = await compute_summary(u["user_id"], live_rows)
        u["rating"] = summ.get("overall")
        u["review_count"] = summ.get("count", 0)
    rank = {"founding": 0, "partner": 1}
    users.sort(key=lambda u: (rank.get(u.get("partner_badge"), 2), (u.get("name") or "").lower()))
    return {"count": len(users), "partners": users}


@router.get("/founding-partners")
async def founding_partners():
    """Public 'Founding Partners' honor roll — every org whose single status is
    founding_partner. Status is chosen by hand in Admin; dropping an org back to
    Community Partner or Free removes it from this list."""
    users = await db.users.find(
        {"account_type": "partner", "subscription_tier": "founding_partner"},
        {"_id": 0, "handle": 1, "name": 1, "avatar": 1, "picture": 1,
         "primary_market": 1, "created_at": 1},
    ).to_list(50)
    users.sort(key=lambda u: u.get("created_at") or "")
    return {"count": len(users), "founders": users}



@router.delete("/events/{event_id}")
async def cancel_event(event_id: str, reason: Optional[str] = None,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ev = await _owned_event(event_id, u)
    reason_txt = f" Reason: {reason.strip()}" if reason and reason.strip() else ""
    await _notify_event_people(ev, "event_cancelled", f"Cancelled: {ev['title']}",
                               f"The organizer cancelled this event.{reason_txt} Check the calendar for more.", u["user_id"])
    await db.events.delete_one({"id": event_id})
    await db.event_registrations.delete_many({"event_id": event_id})
    await db.crew_bank.delete_many({"event_id": event_id})
    return {"ok": True, "id": event_id}


# ---------- Event registrations (volunteer + attendee) ----------
@router.post("/events/{event_id}/register")
async def register_for_event(event_id: str, body: RegistrationCreate,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.kind not in {"attendee", "volunteer"}:
        raise HTTPException(status_code=400, detail="Invalid kind")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    reg = {
        "id": str(uuid.uuid4()), "event_id": event_id, "user_id": u["user_id"],
        "user_name": u.get("name"), "user_email": u.get("email"),
        "kind": body.kind, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.event_registrations.update_one(
        {"event_id": event_id, "user_id": u["user_id"]},
        {"$set": reg, "$setOnInsert": {"first_registered_at": reg["created_at"]}},
        upsert=True,
    )
    # Notify the organizer that someone responded to their event (in-app bell).
    try:
        org_id = ev.get("organizer_id")
        if org_id and org_id != u["user_id"]:
            label = "volunteering for" if body.kind == "volunteer" else "attending"
            await notify(user_id=org_id, kind="event_rsvp",
                         title=f"{u.get('name')} is {label} '{ev.get('title')}'",
                         body=f"New {body.kind} RSVP for your event.",
                         link=f"/my-events?event={event_id}&roster={body.kind}",
                         meta={"event_id": event_id, "kind": body.kind})
    except Exception:
        logger.exception("event rsvp notify failed")
    return reg


@router.delete("/events/{event_id}/register")
async def unregister_from_event(event_id: str,
                                session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.event_registrations.delete_one({"event_id": event_id, "user_id": u["user_id"]})
    return {"ok": True}


@router.get("/events/{event_id}/registrations")
async def list_registrations(event_id: str,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.get("organizer_id") == u["user_id"] or is_admin(u):
        regs = await db.event_registrations.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
        # Host/admin only: attach each registrant's profile handle (for a profile
        # link) and phone so the host can reach volunteers/attendees. Email is the
        # account email already on the reg. Non-hosts get summary counts only
        # (below), so individual contact is never exposed to others (EV-5).
        uids = list({r.get("user_id") for r in regs if r.get("user_id")})
        profiles: Dict[str, Any] = {}
        if uids:
            async for pu in db.users.find(
                {"user_id": {"$in": uids}},
                {"_id": 0, "user_id": 1, "handle": 1, "public_phone": 1, "phone": 1},
            ):
                profiles[pu["user_id"]] = pu
        for r in regs:
            pu = profiles.get(r.get("user_id")) or {}
            r["user_handle"] = pu.get("handle")
            r["user_phone"] = pu.get("public_phone") or pu.get("phone")
        return {"scope": "full", "registrations": regs}
    mine = await db.event_registrations.find_one({"event_id": event_id, "user_id": u["user_id"]}, {"_id": 0})
    counts = {"attendee": 0, "volunteer": 0}
    agg = await db.event_registrations.aggregate([
        {"$match": {"event_id": event_id}},
        {"$group": {"_id": "$kind", "count": {"$sum": 1}}},
    ]).to_list(10)
    for row in agg:
        counts[row["_id"]] = row["count"]
    return {"scope": "summary", "counts": counts, "mine": mine}


# ---------- Crew Bank ----------
async def _hydrate_crew_verified(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach `user_verified` (ID-verified badge) to each crew entry."""
    ids = list({e.get("user_id") for e in entries if e.get("user_id")})
    if ids:
        rows = {u["user_id"]: u async for u in db.users.find(
            {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "identity_verified": 1, "handle": 1})}
        for e in entries:
            row = rows.get(e.get("user_id")) or {}
            e["user_verified"] = bool(row.get("identity_verified"))
            e["user_handle"] = row.get("handle")
    else:
        for e in entries:
            e["user_verified"] = False
            e["user_handle"] = None
    return entries


@router.post("/posts/{post_id}/found-crew")
async def mark_found_crew(post_id: str,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Skipper marks a sailing-opportunity post as crewed: removes it from the
    crew bank's open spots but keeps it in the feed. Author-only, idempotent."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "type": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("author_id") != u["user_id"]:
        raise HTTPException(status_code=403, detail="Not your post")
    if post.get("type") != "sailing_opportunity":
        raise HTTPException(status_code=400, detail="Not a sailing opportunity post")
    await db.posts.update_one({"id": post_id}, {"$set": {"found_crew": True}})
    return {"ok": True, "found_crew": True}


@router.post("/posts/{post_id}/still-looking")
async def mark_still_looking(post_id: str,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    """Reverse of found-crew: the skipper is looking for crew again. The post
    reappears in the crew bank's open spots and stays in the feed. Author-only,
    idempotent."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "author_id": 1, "type": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("author_id") != u["user_id"]:
        raise HTTPException(status_code=403, detail="Not your post")
    if post.get("type") != "sailing_opportunity":
        raise HTTPException(status_code=400, detail="Not a sailing opportunity post")
    await db.posts.update_one({"id": post_id}, {"$set": {"found_crew": False}})
    return {"ok": True, "found_crew": False}


@router.get("/crew-bank/open-opportunities")
async def open_sailing_opportunities(limit: int = 50, market: Optional[str] = None,
                                     markets: Optional[str] = None):
    """Sailing-opportunity feed posts (skippers/boats seeking crew) that are still
    open — surfaced under the crew bank's 'Open crew spots'. They also stay in the feed."""
    now_iso = datetime.now(timezone.utc).isoformat()
    q: Dict[str, Any] = {
        "type": "sailing_opportunity",
        "found_crew": {"$ne": True},
        "$or": [{"expires_at": {"$exists": False}}, {"expires_at": {"$gte": now_iso}}],
    }
    _mk = [m.strip() for m in (markets or "").split(",") if m.strip()]
    if _mk:
        q["market"] = {"$in": _mk}
    elif market and market != "all":
        q["market"] = market
    posts = await db.posts.find(q, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 200))).to_list(200)
    return {"count": len(posts), "opportunities": posts}


@router.get("/crew-bank/open")
async def open_crew_slots(days: int = 14, limit: int = 12, market: Optional[str] = None,
                          markets: Optional[str] = None, verified_only: bool = False,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    from aggregator import upcoming_event_predicate
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    now = datetime.now(timezone.utc)
    horizon = (now + timedelta(days=days)).isoformat()
    now_iso = now.isoformat()
    query = {
        "status": "seeking",
        "event_starts_at": {"$lte": horizon},
        # Shared with /api/events — intra-day precision, all-day events
        # remain visible because event_ends_at is next-day midnight.
        **upcoming_event_predicate(now_iso, "event_starts_at", "event_ends_at"),
    }
    if market and market != "all":
        query["event_market"] = market
    _mk = [m.strip() for m in (markets or "").split(",") if m.strip()]
    if _mk:
        query["event_market"] = {"$in": _mk}
    entries = await db.crew_bank.find(
        query, {"_id": 0, "user_email": 0}
    ).sort("event_starts_at", 1).limit(200 if verified_only else limit).to_list(200 if verified_only else limit)
    entries = await _hydrate_crew_verified(entries)
    if verified_only:
        entries = [e for e in entries if e.get("user_verified")][:limit]
    return entries


@router.get("/events/{event_id}/crew")
async def list_event_crew(event_id: str,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    entries = await db.crew_bank.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    handle_ids = list({e.get("user_id") for e in entries if e.get("user_id")})
    if handle_ids:
        handles = {r["user_id"]: r.get("handle") async for r in db.users.find(
            {"user_id": {"$in": handle_ids}}, {"_id": 0, "user_id": 1, "handle": 1})}
        for e in entries:
            e["user_handle"] = handles.get(e.get("user_id"))
    mine = None
    for e in entries:
        if u and e["user_id"] == u["user_id"]:
            mine = e
        if not (u and (e["user_id"] == u["user_id"] or ev.get("organizer_id") == u["user_id"] or is_admin(u))):
            e.pop("user_email", None)
    return {"count": len(entries), "entries": entries, "mine": mine,
            "can_join": bool(u and is_paid_subscriber(u) and event_has_crew_bank(ev))}


async def _maybe_email_organizer(ev: Dict[str, Any], u: Dict[str, Any], entry: Dict[str, Any], body: CrewBankJoin):
    """Fire-and-forget: notify the event organizer AND any admin-assigned per-event
    email recipients (if any) that someone joined the crew pool. Aggregator events
    don't have organizer emails.
    """
    recipients = []
    if ev.get("organizer_email"):
        recipients.append(ev["organizer_email"])
    for r in (ev.get("email_recipients") or []):
        r = (r or "").strip().lower()
        if r and r not in {x.lower() for x in recipients}:
            recipients.append(r)
    if not recipients:
        return
    try:
        origin = "https://app.sailmorenow.com"
        html = crew_join_email_html(
            organizer_name=ev.get("organizer_name") or "",
            event_title=ev.get("title") or "your event",
            event_starts_at=ev.get("starts_at") or "",
            crew_name=u.get("name") or "A sailor",
            positions=entry.get("positions") or [],
            experience=body.experience,
            notes=body.notes,
            can_email=(body.contact_via == "email"),
            event_url=f"{origin}/events",
        )
        reply_to = u.get("email") if body.contact_via == "email" else None
        for recipient in recipients:
            try:
                await send_email(
                    recipient_email=recipient,
                    subject=f"New crew signup for {ev.get('title')}",
                    html_content=html,
                    reply_to=reply_to,
                )
            except Exception:
                logger.exception("crew_join email failed for recipient=%s", recipient)
    except Exception:
        logger.exception("failed to email organizer/recipients")


@router.patch("/admin/events/{event_id}/email-recipients")
async def admin_set_event_recipients(event_id: str, body: EventRecipientsUpdate,
                                     session_token: Optional[str] = Cookie(default=None),
                                     authorization: Optional[str] = Header(default=None)):
    """Admin-only: assign extra email recipients for crew-signup notifications
    on a specific (usually aggregator/partner) event."""
    u = await current_user_from_token(session_token, authorization)
    if not u or not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0, "id": 1})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    # basic email sanity — lowercase + dedupe within the array
    cleaned: List[str] = []
    seen: set = set()
    for r in body.email_recipients or []:
        r = (r or "").strip().lower()
        if not r or "@" not in r or " " in r or len(r) > 254:
            raise HTTPException(status_code=400, detail=f"Invalid email: {r}")
        if r in seen:
            continue
        seen.add(r)
        cleaned.append(r)
    await db.events.update_one({"id": event_id}, {"$set": {"email_recipients": cleaned}})
    return {"event_id": event_id, "email_recipients": cleaned}


class BulkRecipientsCSV(BaseModel):
    csv: str


@router.post("/admin/events/{event_id}/recipients-bulk")
async def admin_bulk_recipients(event_id: str, body: BulkRecipientsCSV,
                                 session_token: Optional[str] = Cookie(default=None),
                                 authorization: Optional[str] = Header(default=None)):
    """Admin-only: paste CSV / newline-separated / comma-separated emails and
    have them appended to the event's email_recipients (deduped, lowercased)."""
    u = await current_user_from_token(session_token, authorization)
    if not u or not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0, "id": 1, "email_recipients": 1})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    import re as _re
    tokens = [t.strip().lower() for t in _re.split(r"[,\s;\n\r\t]+", body.csv or "") if t.strip()]
    valid: List[str] = []
    invalid: List[str] = []
    for t in tokens:
        if "@" in t and " " not in t and len(t) <= 254 and "." in t.split("@")[-1]:
            valid.append(t)
        else:
            invalid.append(t)
    merged: List[str] = []
    seen: set = set()
    for r in (ev.get("email_recipients") or []) + valid:
        r = (r or "").strip().lower()
        if r and r not in seen:
            seen.add(r)
            merged.append(r)
    await db.events.update_one({"id": event_id}, {"$set": {"email_recipients": merged}})
    return {"event_id": event_id, "added": len(valid), "invalid": invalid,
            "email_recipients": merged}


@router.post("/events/{event_id}/crew")
async def join_event_crew(event_id: str, body: CrewBankJoin,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") == "partner":
        raise HTTPException(status_code=403, detail="Organizations can't join crew. Post events and crew spots instead.")
    if not is_paid_subscriber(u):
        raise HTTPException(status_code=402, detail="Crew Bank is a Premium feature. Upgrade to join.")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event_has_crew_bank(ev):
        raise HTTPException(status_code=400, detail="This event is not a race, so it has no crew pool.")
    for p in body.positions:
        if p not in CREW_POSITIONS:
            raise HTTPException(status_code=400, detail=f"Unknown position: {p}")
    if not body.positions:
        raise HTTPException(status_code=400, detail="Pick at least one position")
    if body.contact_via not in {"in-app", "email"}:
        raise HTTPException(status_code=400, detail="Invalid contact_via")
    for m in body.markets:
        if m not in PNW_MARKETS:
            raise HTTPException(status_code=400, detail=f"Invalid market: {m}")
    # Markets are optional per event (never block a sign-up): default to the
    # event's own market when the sailor leaves them empty.
    markets = body.markets or ([ev.get("market")] if ev.get("market") else [])
    entry = {
        "event_id": event_id, "user_id": u["user_id"],
        "user_name": (f"{u.get('first_name', '')} {u.get('last_name', '')}".strip() or u.get("name")),
        "user_avatar": display_image(u),
        "user_email": u.get("email"), "user_market": u.get("primary_market"),
        "user_bio": u.get("bio"),
        "positions": body.positions,
        "experience": body.experience, "notes": body.notes,
        "availability": body.availability,
        "markets": markets,
        "experience_types": _clean_experience_types(body.experience_types),
        "sailing_style": _clean_sailing_style(body.sailing_style),
        "contact_via": body.contact_via,
        "event_title": ev.get("title"), "event_starts_at": ev.get("starts_at"),
        "event_ends_at": ev.get("ends_at"), "event_market": ev.get("market"),
        "status": "seeking",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    is_new = (await db.crew_bank.count_documents({"event_id": event_id, "user_id": u["user_id"]})) == 0
    await db.crew_bank.update_one(
        {"event_id": event_id, "user_id": u["user_id"]},
        {"$set": entry, "$setOnInsert": {"created_at": entry["updated_at"]}},
        upsert=True,
    )
    # Crew bank entries live in the crew bank only — never auto-posted to the feed.
    await db.posts.delete_one({"id": f"crew_{event_id}_{u['user_id']}"})
    # Fire-and-forget email to organizer on new signups only (not on updates)
    if is_new:
        _fire_and_forget(_maybe_email_organizer(ev, u, entry, body))
        try:
            oid = ev.get("organizer_id")
            if oid and oid != u["user_id"]:
                await notify(
                    user_id=oid, kind="crew_join",
                    title=f"{u.get('name')} joined your crew pool",
                    body=f"For {ev.get('title')}",
                    link="/events",
                    meta={"event_id": event_id, "crew_user_id": u["user_id"]},
                )
        except Exception:
            logger.exception("crew_join notify failed")
    return await db.crew_bank.find_one({"event_id": event_id, "user_id": u["user_id"]}, {"_id": 0})


@router.patch("/events/{event_id}/crew/status")
async def update_crew_status(event_id: str, body: CrewStatusUpdate,
                             session_token: Optional[str] = Cookie(default=None),
                             authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.status not in {"seeking", "found"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.crew_bank.update_one(
        {"event_id": event_id, "user_id": u["user_id"]},
        {"$set": {"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="You're not in this crew pool")
    if body.status == "found":
        await db.posts.delete_one({"id": f"crew_{event_id}_{u['user_id']}"})
    return {"status": body.status}


@router.delete("/events/{event_id}/crew")
async def leave_event_crew(event_id: str,
                           session_token: Optional[str] = Cookie(default=None),
                           authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.crew_bank.delete_one({"event_id": event_id, "user_id": u["user_id"]})
    await db.posts.delete_one({"id": f"crew_{event_id}_{u['user_id']}"})
    return {"ok": True}


# ---------- Comments on posts ----------
@router.get("/posts/{post_id}/comments")
async def list_comments(post_id: str):
    docs = await db.comments.find({"post_id": post_id, "hidden_pending_review": {"$ne": True}}, {"_id": 0}).sort("created_at", 1).to_list(500)
    author_ids = list({c.get("author_id") for c in docs if c.get("author_id")})
    if author_ids:
        handles = {r["user_id"]: r.get("handle") async for r in db.users.find(
            {"user_id": {"$in": author_ids}}, {"_id": 0, "user_id": 1, "handle": 1})}
        for c in docs:
            if c.get("author_identity") == "business":
                continue  # keep stored business handle/name/avatar
            c["author_handle"] = handles.get(c.get("author_id"))
    return docs


@router.post("/posts/{post_id}/comments")
async def create_comment(post_id: str, body: CommentCreate,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    require_interaction(u)
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail="Comment too long (max 2000 chars)")
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        # Blog/forum discussions store comments in db.comments keyed by their id too.
        post = await db.discussions.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.get("allow_comments") is False:
        raise HTTPException(status_code=403, detail="Comments are turned off on this post")
    if body.parent_id:
        parent = await db.comments.find_one({"id": body.parent_id, "post_id": post_id}, {"_id": 0})
        if not parent:
            raise HTTPException(status_code=404, detail="Parent comment not found")
    now = datetime.now(timezone.utc)
    _pro = await business_listing_for(u)
    _identity = await resolve_author_identity(u, body.identity, _pro)
    doc = {
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "parent_id": body.parent_id,
        "author_id": u["user_id"],
        **(await author_fields(u, _identity, _pro)),
        "body": text,
        "created_at": now.isoformat(),
    }
    await db.comments.insert_one(doc)
    doc.pop("_id", None)
    # @-mentions — extract simple `@handle` tokens (3..20 [A-Za-z0-9_]) from the
    # raw body and resolve each to EXACTLY ONE user by unique-handle match. This
    # replaces the earlier name-startswith prefix logic that could ping many.
    try:
        import re as _re
        tokens = list({t.lower() for t in _re.findall(r"@([A-Za-z0-9_]{3,20})\b", text)})
        mentioned_ids: List[str] = []
        for token in tokens[:10]:
            hit = await resolve_handle_user(token)
            if not hit:
                continue
            uid = hit.get("user_id")
            if uid and uid != u["user_id"] and uid not in mentioned_ids:
                mentioned_ids.append(uid)
        if mentioned_ids:
            await db.comments.update_one({"id": doc["id"]},
                                         {"$set": {"mentioned_user_ids": mentioned_ids}})
            doc["mentioned_user_ids"] = mentioned_ids
            snippet = text[:200]
            for mid in mentioned_ids:
                try:
                    await notify(user_id=mid, kind="mention",
                                 title=f"{u.get('name')} mentioned you",
                                 body=text[:140] + ("…" if len(text) > 140 else ""),
                                 link="/feed",
                                 meta={"post_id": post_id, "comment_id": doc["id"]})
                except Exception:
                    logger.exception("mention notify failed for %s", mid)
                # Email fallback for members with no active browser push
                # subscription. We check push_subscriptions collection (not the
                # user.push_subscriptions list) since that's where valid subs live.
                try:
                    subs = await db.push_subscriptions.count_documents({"user_id": mid})
                    if subs == 0:
                        target = await db.users.find_one(
                            {"user_id": mid},
                            {"_id": 0, "email": 1, "push_preferences": 1,
                             "newsletter_opt_in": 1},
                        )
                        if target and target.get("email"):
                            prefs = target.get("push_preferences") or {}
                            # Respect the per-kind mention toggle even for email
                            # fallback so opt-outs are truly silent.
                            if prefs.get("mention", True):
                                from mailer import send_email, mention_email_html
                                await send_email(
                                    recipient_email=target["email"],
                                    subject=f"{u.get('name')} mentioned you on Sail More Now",
                                    html_content=mention_email_html(
                                        mentioner_name=u.get("name") or "Someone",
                                        snippet=snippet,
                                        app_url="https://app.sailmorenow.com",
                                    ),
                                )
                except Exception:
                    logger.exception("mention email fallback failed for %s", mid)
    except Exception:
        logger.exception("mention parse failed")
    # Broadcast an updated comment_count to all connected clients so open pages
    # can update their toggle badge in real time (fire-and-forget).
    try:
        from deps import ws_manager
        new_count = await db.comments.count_documents({"post_id": post_id})
        import asyncio as _asyncio
        _asyncio.create_task(ws_manager.broadcast({
            "type": "comment.count", "post_id": post_id, "count": new_count,
        }))
    except Exception:
        logger.exception("comment count broadcast failed")
    # Notify post author (if not commenting on own post)
    try:
        author_id = post.get("author_id")
        if author_id and author_id != u["user_id"]:
            await notify(user_id=author_id, kind="comment",
                         title=f"{u.get('name')} commented on '{post.get('title')}'",
                         body=text[:140] + ("…" if len(text) > 140 else ""),
                         link="/feed", meta={"post_id": post_id, "comment_id": doc["id"]})
        # Notify parent-comment author on reply (avoid double-notify post author)
        if body.parent_id:
            parent = await db.comments.find_one({"id": body.parent_id}, {"_id": 0, "author_id": 1})
            pa = parent.get("author_id") if parent else None
            if pa and pa != u["user_id"] and pa != author_id:
                await notify(user_id=pa, kind="comment",
                             title=f"{u.get('name')} replied to your comment",
                             body=text[:140] + ("…" if len(text) > 140 else ""),
                             link="/feed", meta={"post_id": post_id, "comment_id": doc["id"]})
    except Exception:
        logger.exception("comment notify failed")
    return doc


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    c = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.get("author_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Not your comment")
    await db.comments.delete_one({"id": comment_id})
    # Cascade: also delete direct replies (one level; deeper replies orphan up to root post)
    await db.comments.delete_many({"parent_id": comment_id})
    # Broadcast updated comment_count so open pages update their toggle badge live.
    try:
        from deps import ws_manager
        post_id = c.get("post_id")
        if post_id:
            new_count = await db.comments.count_documents({"post_id": post_id})
            import asyncio as _asyncio
            _asyncio.create_task(ws_manager.broadcast({
                "type": "comment.count", "post_id": post_id, "count": new_count,
            }))
    except Exception:
        logger.exception("comment count broadcast (delete) failed")
    return {"ok": True}


# ---------- Standalone Crew Bank (event-independent) ----------
STANDALONE_TTL_DAYS = 90


def _standalone_expires_at(now: datetime) -> str:
    return (now + timedelta(days=STANDALONE_TTL_DAYS)).isoformat()


@router.get("/crew-bank/standalone")
async def list_standalone_crew(market: Optional[str] = None,
                               markets: Optional[str] = None,
                               limit: int = 60,
                               verified_only: bool = False,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    """Public list of sailors available for crew work outside of a specific event.
    Filters to status=seeking and non-expired. `market` narrows to entries whose
    markets[] list contains the given PNW market. Emails are hidden from the public."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    now_iso = datetime.now(timezone.utc).isoformat()
    q: Dict[str, Any] = {
        "status": "seeking",
        "$or": [{"expires_at": None}, {"expires_at": {"$gt": now_iso}}],
    }
    if market and market != "all":
        q["markets"] = market
    _mk = [m.strip() for m in (markets or "").split(",") if m.strip()]
    if _mk:
        q["markets"] = {"$in": _mk}
    entries = await db.crew_bank_standalone.find(
        q, {"_id": 0, "user_email": 0}
    ).sort("updated_at", -1).limit(max(1, min(limit, 200))).to_list(limit)
    # Hide listings whose owner's paid subscription has lapsed.
    owner_ids = [e.get("user_id") for e in entries if e.get("user_id")]
    if owner_ids:
        lapsed = {ou["user_id"] async for ou in db.users.find(
            {"user_id": {"$in": owner_ids}, "subscription_expires": {"$ne": None, "$lt": now_iso}},
            {"_id": 0, "user_id": 1})}
        entries = [e for e in entries if e.get("user_id") not in lapsed]
    for e in entries:
        e["is_complete"] = bool((e.get("positions") or []) and (e.get("markets") or []) and (e.get("notes") or e.get("experience") or e.get("about") or e.get("bio")))
    entries = await _hydrate_crew_verified(entries)
    if verified_only:
        entries = [e for e in entries if e.get("user_verified")]
    return {
        "count": len(entries),
        "entries": entries,
        "can_list_yourself": bool(u and is_paid_subscriber(u)),
    }


@router.get("/crew-bank/standalone/mine")
async def get_my_standalone_crew(session_token: Optional[str] = Cookie(default=None),
                                 authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    entry = await db.crew_bank_standalone.find_one({"user_id": u["user_id"]}, {"_id": 0})
    return {"entry": entry}


@router.get("/crew-bank/mine")
async def get_my_crew_listings(session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    """One place for a signed-in user's own crew listings of BOTH kinds: the
    standalone Crew Bank listing and every event crew sign-up. Owner-only; no
    other users' data and no emails/phones. Newest first."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    uid = u["user_id"]
    now_iso = datetime.now(timezone.utc).isoformat()
    listings: List[Dict[str, Any]] = []
    sa = await db.crew_bank_standalone.find_one({"user_id": uid}, {"_id": 0, "user_email": 0})
    if sa:
        listings.append({
            "kind": "standalone",
            "positions": sa.get("positions") or [],
            "status": sa.get("status") or "seeking",
            "markets": sa.get("markets") or [],
            "updated_at": sa.get("updated_at"),
            "created_at": sa.get("created_at"),
            "expires_at": sa.get("expires_at"),
            "is_expired": bool(sa.get("expires_at") and sa["expires_at"] <= now_iso),
        })
    evs = await db.crew_bank.find({"user_id": uid}, {"_id": 0, "user_email": 0}).to_list(500)
    for e in evs:
        listings.append({
            "kind": "event",
            "event_id": e.get("event_id"),
            "event_name": e.get("event_title"),
            "event_starts_at": e.get("event_starts_at"),
            "positions": e.get("positions") or [],
            "status": e.get("status") or "seeking",
            "markets": e.get("markets") or [],
            "updated_at": e.get("updated_at"),
            "created_at": e.get("created_at"),
        })
    listings.sort(key=lambda x: (x.get("updated_at") or x.get("created_at") or ""), reverse=True)
    return {"count": len(listings), "listings": listings}


@router.post("/crew-bank/standalone")
async def upsert_standalone_crew(body: StandaloneCrewUpsert,
                                 session_token: Optional[str] = Cookie(default=None),
                                 authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("account_type") == "partner":
        raise HTTPException(status_code=403, detail="Organizations can't list in the Crew Bank. Post events and crew spots instead.")
    if not is_paid_subscriber(u):
        raise HTTPException(status_code=402, detail="Listing yourself in the Crew Bank is a Premium feature. Upgrade to continue.")
    for p in body.positions:
        if p not in CREW_POSITIONS:
            raise HTTPException(status_code=400, detail=f"Unknown position: {p}")
    if not body.positions:
        raise HTTPException(status_code=400, detail="Pick at least one position")
    for m in body.markets:
        if m not in PNW_MARKETS:
            raise HTTPException(status_code=400, detail=f"Invalid market: {m}")
    if body.contact_via not in {"in-app", "email"}:
        raise HTTPException(status_code=400, detail="Invalid contact_via")
    now = datetime.now(timezone.utc)
    markets = body.markets or ([u.get("primary_market")] if u.get("primary_market") else [])
    style = _clean_sailing_style(body.sailing_style)
    exp_types = _clean_experience_types(body.experience_types)
    entry = {
        "user_id": u["user_id"],
        "user_name": (f"{u.get('first_name', '')} {u.get('last_name', '')}".strip() or u.get("name")),
        "user_avatar": display_image(u),
        "user_email": u.get("email"),
        "user_bio": u.get("bio"),
        "user_primary_market": u.get("primary_market"),
        "positions": body.positions,
        "experience": body.experience,
        "experience_types": exp_types,
        "sailing_style": style,
        "notes": body.notes,
        "availability": body.availability,
        "markets": markets,
        "contact_via": body.contact_via,
        "status": "seeking",
        "expires_at": _standalone_expires_at(now),
        "updated_at": now.isoformat(),
    }
    await db.crew_bank_standalone.update_one(
        {"user_id": u["user_id"]},
        {"$set": entry, "$setOnInsert": {"created_at": now.isoformat()}},
        upsert=True,
    )
    # Sailing style is optional and persisted on the profile for reuse.
    if style is not None:
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"sailing_style": style}})
    return await db.crew_bank_standalone.find_one({"user_id": u["user_id"]}, {"_id": 0})


@router.patch("/crew-bank/standalone/status")
async def update_standalone_status(body: CrewStatusUpdate,
                                   session_token: Optional[str] = Cookie(default=None),
                                   authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.status not in {"seeking", "found"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.crew_bank_standalone.update_one(
        {"user_id": u["user_id"]},
        {"$set": {"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="You don't have a standalone crew listing")
    return {"status": body.status}


@router.post("/crew-bank/standalone/renew")
async def renew_standalone_crew(session_token: Optional[str] = Cookie(default=None),
                                authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    now = datetime.now(timezone.utc)
    res = await db.crew_bank_standalone.update_one(
        {"user_id": u["user_id"]},
        {"$set": {"expires_at": _standalone_expires_at(now),
                  "status": "seeking",
                  "updated_at": now.isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="You don't have a standalone crew listing")
    entry = await db.crew_bank_standalone.find_one({"user_id": u["user_id"]}, {"_id": 0})
    return {"expires_at": entry["expires_at"], "entry": entry}


@router.delete("/crew-bank/standalone")
async def delete_standalone_crew(session_token: Optional[str] = Cookie(default=None),
                                 authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.crew_bank_standalone.delete_one({"user_id": u["user_id"]})
    return {"ok": True}


# ---------- Admin: aggregator ----------
@router.get("/admin/events/sources")
async def admin_events_sources(admin=Depends(require_admin)):
    from aggregator import _load_sources
    srcs = await _load_sources(db)
    return [{"key": s.key, "label": getattr(s, "source_label", None) or s.label,
             "default_market": s.default_market} for s in srcs]


@router.get("/admin/events/sync-status")
async def admin_events_sync_status(admin=Depends(require_admin)):
    """Freshness card for the admin Events dashboard: when the aggregator last ran
    and when the daily auto-sync will next run."""
    meta = await db.app_meta.find_one({"key": "aggregator_last_run"}, {"_id": 0})
    next_run = None
    try:
        from scheduler import next_run as _next
        runs = _next() or {}
        next_run = runs.get("events_daily_sync")
    except Exception:
        logger.exception("sync-status next_run failed")
    last = meta or {}
    summary = last.get("summary") or {}
    return {
        "last_run_at": last.get("run_at"),
        "next_run_at": next_run,
        "last_inserted": summary.get("inserted"),
        "last_updated": summary.get("updated"),
        "last_errors": summary.get("errors"),
        "sources": summary.get("sources") or [],
    }


@router.post("/admin/events/aggregate")
async def admin_events_aggregate(admin=Depends(require_admin)):
    from scheduler import notify_admins_category_review
    result = await run_aggregator(db)
    result["review_alert"] = await notify_admins_category_review(db)
    return result


@router.post("/admin/events/review-alert")
async def admin_events_review_alert(admin=Depends(require_admin)):
    from scheduler import notify_admins_category_review
    return await notify_admins_category_review(db)


@router.post("/admin/events/send-reminders")
async def admin_events_send_reminders(admin=Depends(require_admin)):
    from scheduler import _event_reminder_job
    return await _event_reminder_job(db)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.events.delete_many(past_event_predicate(now_iso))
    return await run_aggregator(db)


@router.delete("/admin/events/aggregate")
async def admin_events_purge(admin=Depends(require_admin)):
    res = await db.events.delete_many({"source": "aggregator"})
    return {"deleted": res.deleted_count}
