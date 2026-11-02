"""Two-way review sessions with an ACCEPT / REJECT flow (single system for Boat
Pro, sailor and owner reviews).

Model:
  review_sessions  — the pairing (reviewer + reviewee, relationship, status,
                     reveal_at = created_at + 48h).
                     status: "pending"       reviewer submitted, review HIDDEN
                             "accepted"      reviewee accepted -> review LIVE
                             "rejected"      reviewee rejected -> HIDDEN forever
                             "auto_revealed" 48h passed, no response -> LIVE
  mutual_reviews   — one doc per submission (session_id + author_id): ratings
                     {overall (required), personality, skill, promptness,
                     communication} + optional comment.

Flow:
  • The reviewer creates a session AND submits in one step. Review is hidden.
  • The reviewee is notified to accept or reject (and may optionally review back).
  • Accept  -> the original review goes live immediately.
  • Reject  -> stays hidden permanently; reviewer notified with the disputes line.
  • No response in 48h -> auto-reveal (scheduler / lazy on read). Reject never reveals.
Rejected sessions never appear in any public endpoint or average.
"""
from __future__ import annotations
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Cookie, Header, HTTPException

from deps import (db, current_user_from_token, can_review, display_image, is_admin,
                  can_act_as_business, resolve_active_identity, admin_emails)
from schemas import (ReviewSessionCreate, ReviewAccept, ReviewRatings, TwoWayReviewEdit,
                     ReviewReply, AdminHoldBody, AdminRemoveReviewBody)
from notifications import notify

router = APIRouter()
logger = logging.getLogger("smn.reviews")

REVIEW_WINDOW_DAYS = 7
REVIEW_COMMENT_MAX = 1000
CONTEXT_NOTE_MAX = 200
REPLY_MAX = 500
DISPUTE_MAX = 1000
OPTIONAL_KEYS = ("personality", "skill", "promptness", "communication")
ALL_KEYS = ("overall",) + OPTIONAL_KEYS
VALID_RELATIONSHIPS = {"customer_pro", "owner_crew", "sailor_sailor", "owner_owner", "pro_pro"}
# Sessions whose reviews are public and counted. Legacy "accepted"/"auto_revealed"
# are kept so old demo rows don't vanish or crash; "revealed" is the new status.
LIVE_STATUSES = ("revealed", "accepted", "auto_revealed")


def _validate_ratings(r: ReviewRatings) -> Dict[str, int]:
    """Overall is required (1..5). The four dimensions are optional (1..5 when
    present). Returns a dict of ONLY the provided values. Safety is rejected at
    the schema layer (extra='forbid')."""
    if not (1 <= int(r.overall) <= 5):
        raise HTTPException(status_code=400, detail="overall must be 1..5")
    out: Dict[str, int] = {"overall": int(r.overall)}
    for k in OPTIONAL_KEYS:
        v = getattr(r, k)
        if v is None:
            continue
        if not (1 <= int(v) <= 5):
            raise HTTPException(status_code=400, detail=f"{k} must be 1..5")
        out[k] = int(v)
    return out


def _roles_for(relationship: str, a_type: str, b_type: str) -> tuple:
    """(reviewer_role, reviewee_role) or 400. Org<->Org is blocked. Boat Pro<->
    Boat Pro is handled by relationship 'pro_pro' (extra checks live in
    create_session: personal identity + no shared category)."""
    if a_type == "partner" and b_type == "partner":
        raise HTTPException(status_code=400, detail="Organizations cannot review other organizations.")
    if relationship == "customer_pro":
        if a_type == "boat_pro" and b_type != "boat_pro":
            return ("pro", "customer")
        if b_type == "boat_pro" and a_type != "boat_pro":
            return ("customer", "pro")
        raise HTTPException(status_code=400, detail="customer_pro requires exactly one boat_pro participant")
    if relationship == "owner_crew":
        if a_type == "boat_owner" and b_type == "sailor":
            return ("owner", "crew")
        if a_type == "sailor" and b_type == "boat_owner":
            return ("crew", "owner")
        raise HTTPException(status_code=400, detail="owner_crew requires one boat_owner and one sailor")
    if relationship == "sailor_sailor":
        if a_type == "sailor" and b_type == "sailor":
            return ("sailor", "sailor")
        raise HTTPException(status_code=400, detail="sailor_sailor requires two sailors")
    if relationship == "owner_owner":
        if a_type == "boat_owner" and b_type == "boat_owner":
            return ("owner", "owner")
        raise HTTPException(status_code=400, detail="owner_owner requires two boat owners")
    if relationship == "pro_pro":
        if a_type == "boat_pro" and b_type == "boat_pro":
            return ("pro", "pro")
        raise HTTPException(status_code=400, detail="pro_pro requires two Boat Pros")
    raise HTTPException(status_code=400, detail="Invalid relationship")


def _is_participant(session: Dict[str, Any], user_id: str) -> Optional[Dict[str, Any]]:
    for p in session.get("participants", []):
        if p.get("user_id") == user_id:
            return p
    return None


def _reviewer(session: Dict[str, Any]) -> Dict[str, Any]:
    return next(p for p in session["participants"] if p.get("is_reviewer"))


def _reviewee(session: Dict[str, Any]) -> Dict[str, Any]:
    return next(p for p in session["participants"] if not p.get("is_reviewer"))


async def _get_review(session_id: str, author_id: str) -> Optional[Dict[str, Any]]:
    return await db.mutual_reviews.find_one({"session_id": session_id, "author_id": author_id}, {"_id": 0})


async def _maybe_auto_reveal(session: Dict[str, Any]) -> Dict[str, Any]:
    """A still-pending session whose 7-day window elapsed reveals automatically.
    Held, withdrawn, rejected (legacy) and already-live sessions are untouched."""
    if session.get("status") != "pending":
        return session
    if session.get("held"):
        return session
    now = datetime.now(timezone.utc)
    if (session.get("reveal_at") or "") > now.isoformat():
        return session
    res = await db.review_sessions.update_one(
        {"id": session["id"], "status": "pending", "held": {"$ne": True}},
        {"$set": {"status": "revealed", "revealed": True, "revealed_at": now.isoformat()}},
    )
    fresh = await db.review_sessions.find_one({"id": session["id"]}, {"_id": 0})
    if res.modified_count == 1:
        try:
            for p in fresh["participants"]:
                await notify(user_id=p["user_id"], kind="review_completed",
                             title="A review went live",
                             body="The 7-day window ended, so the review is now public.",
                             link=f"/reviews?session={fresh['id']}", meta={"session_id": fresh["id"]})
        except Exception:
            logger.exception("auto-reveal notify failed")
    return fresh


async def _hydrate(session: Dict[str, Any]) -> Dict[str, Any]:
    ids = [p["user_id"] for p in session.get("participants", [])]
    users = await db.users.find({"user_id": {"$in": ids}},
                                {"_id": 0, "user_id": 1, "name": 1, "avatar": 1, "picture": 1, "handle": 1, "account_type": 1}).to_list(None)
    umap = {u["user_id"]: u for u in users}
    pro_ids = [uid for uid in ids if (umap.get(uid) or {}).get("account_type") == "boat_pro"]
    pros = {}
    if pro_ids:
        async for pr in db.boat_pros.find({"user_id": {"$in": pro_ids}},
                                          {"_id": 0, "user_id": 1, "company_name": 1, "logo_url": 1, "photo_url": 1}):
            pros[pr["user_id"]] = pr
    # pro_pro reviews are made from the PERSONAL profile: show personal name only,
    # never the business name/logo, even though it counts toward the business rating.
    pro_pro = session.get("relationship") == "pro_pro"
    for p in session["participants"]:
        u = umap.get(p["user_id"], {})
        p["user_name"] = u.get("name")
        p["user_avatar"] = display_image(u) if u else None
        p["user_handle"] = u.get("handle")
        p["account_type"] = u.get("account_type")
        # Boat Pro participants also carry their business identity so the UI can
        # show the reviewer by business name + logo (via the shared LogoCircle).
        pr = pros.get(p["user_id"])
        if pr and not pro_pro:
            p["business_name"] = pr.get("company_name")
            p["business_logo"] = pr.get("logo_url") or pr.get("photo_url")
            p["business_listing_id"] = pr["user_id"]
        else:
            p["business_name"] = None
            p["business_logo"] = None
            p["business_listing_id"] = None
    return session


def _project(session: Dict[str, Any], viewer_id: str, mine, other, show_other: Optional[bool] = None) -> Dict[str, Any]:
    live = session.get("status") in LIVE_STATUSES
    if show_other is None:
        show_other = live
    return {**session, "my_review": mine, "other_review": other if show_other else None,
            "live": live, "status": session.get("status")}


# --------------------------- Endpoints ---------------------------------------
@router.post("/review-sessions")
async def create_session(body: ReviewSessionCreate,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not can_review(u):
        raise HTTPException(status_code=403, detail={"code": "upgrade_required",
            "message": "Reviewing is a paid feature. Upgrade your account to leave a review."})
    if body.relationship not in VALID_RELATIONSHIPS:
        raise HTTPException(status_code=400, detail="Invalid relationship")
    if body.counterparty_id == u["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot review yourself")
    other = await db.users.find_one({"user_id": body.counterparty_id}, {"_id": 0})
    if not other:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    reviewer_role, reviewee_role = _roles_for(body.relationship, u.get("account_type") or "", other.get("account_type") or "")

    author_identity = "personal"
    is_mutual_pair = False
    # Boat Pro -> Boat Pro: reviewer must be acting PERSONAL, share NO category,
    # and each pair may review each other at most once (mutual pair).
    if body.relationship == "pro_pro":
        my_pro = await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0, "categories": 1})
        other_pro = await db.boat_pros.find_one({"user_id": other["user_id"]}, {"_id": 0, "categories": 1})
        # "Acting as" from the explicit request param when given, else stored state.
        acting = body.as_identity or await resolve_active_identity(u, my_pro)
        if acting != "personal":
            raise HTTPException(status_code=400, detail={"code": "must_act_personal",
                "message": "Review another Boat Pro from your personal profile, not your business profile."})
        mine_cats = {c.lower() for c in (my_pro or {}).get("categories", [])}
        their_cats = {c.lower() for c in (other_pro or {}).get("categories", [])}
        if mine_cats & their_cats:
            raise HTTPException(status_code=400, detail={"code": "shared_category",
                "message": "You share a service category with this Boat Pro, so you cannot review them."})
        existing = await db.review_sessions.find_one({
            "relationship": "pro_pro",
            "participants.user_id": {"$all": [u["user_id"], other["user_id"]]},
        }, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail={"code": "already_reviewed",
                "message": "You and this Boat Pro have already reviewed each other."})
        is_mutual_pair = True

    ratings = _validate_ratings(body.ratings)
    now = datetime.now(timezone.utc)
    sid = str(uuid.uuid4())
    # Which Boat Pro identity is being reviewed (business default). Only meaningful
    # when the reviewed party is a Boat Pro; None otherwise.
    counter_is_pro = (other.get("account_type") == "boat_pro")
    target_identity = None
    if counter_is_pro:
        target_identity = body.target_identity if body.target_identity in ("business", "personal") else "business"
        # Validate the chosen identity exists for this Boat Pro: "personal" is
        # always valid (every account has a personal side); "business" requires
        # an actual directory listing.
        if target_identity == "business":
            other_listing = await db.boat_pros.find_one({"user_id": other["user_id"]}, {"_id": 0, "user_id": 1})
            if not other_listing:
                raise HTTPException(status_code=400, detail={"code": "no_business_profile",
                    "message": "This Boat Pro does not have a business profile to review."})
    reveal_at = now + timedelta(days=REVIEW_WINDOW_DAYS)
    session = {
        "id": sid, "relationship": body.relationship, "context_note": body.context_note,
        "event_id": body.event_id, "boat_pro_id": body.boat_pro_id,
        "status": "pending", "revealed": False, "held": False, "mutual_pair": is_mutual_pair,
        "target_identity": target_identity,
        "participants": [
            {"user_id": u["user_id"], "role": reviewer_role, "is_reviewer": True, "submitted": True, "submitted_at": now.isoformat()},
            {"user_id": other["user_id"], "role": reviewee_role, "is_reviewer": False, "submitted": False},
        ],
        "created_at": now.isoformat(),
        "reveal_at": reveal_at.isoformat(),
    }
    await db.review_sessions.insert_one(session)
    session.pop("_id", None)
    mine = {"session_id": sid, "author_id": u["user_id"], "author_role": reviewer_role,
            "author_identity": author_identity, "author_business_id": None, "target_id": other["user_id"],
            "target_identity": target_identity,
            "ratings": ratings, "comment": (body.comment or None), "created_at": now.isoformat()}
    await db.mutual_reviews.insert_one(dict(mine))
    verb = "sailed with" if body.relationship in ("owner_crew", "sailor_sailor", "owner_owner") else "worked with"
    reveal_date = reveal_at.strftime("%b %d, %Y")
    if can_review(other):
        title = f"{u.get('name')} left you a review"
        notif_body = f"{u.get('name')} said they {verb} you and left you a review. Do you want to review them? It stays private until you review them back or 7 days pass."
        cta = "review_back"
    else:
        title = f"{u.get('name')} left you a review"
        notif_body = f"{u.get('name')} said they {verb} you and left you a review. It goes live on {reveal_date}. Upgrade to review them back."
        cta = "upgrade"
    try:
        await notify(user_id=other["user_id"], kind="review_request", title=title, body=notif_body,
                     link=f"/reviews?session={sid}",
                     meta={"session_id": sid, "relationship": body.relationship, "cta": cta})
    except Exception:
        logger.exception("review_request notify failed")
    session = await _hydrate(session)
    return _project(session, u["user_id"], mine, None)


@router.post("/review-sessions/{session_id}/accept")
async def accept_session(session_id: str, body: ReviewAccept,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Review-back / confirm (temporary name; UI buttons change in REVIEWS-2/3).
    WITH a review-back (paid only): writes the review-back and reveals BOTH now.
    WITHOUT one: returns a clear error - the review stays private until the window
    ends. Free accounts cannot review back; their sessions reveal at window end."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    reviewee = _reviewee(s)
    if reviewee["user_id"] != u["user_id"]:
        raise HTTPException(status_code=403, detail="Only the reviewed person can review back")
    if s.get("held"):
        raise HTTPException(status_code=409, detail="This review is being looked at by our team.")
    if s.get("status") != "pending":
        raise HTTPException(status_code=409, detail="This review is no longer pending")
    if body.ratings is None:
        raise HTTPException(status_code=400, detail={"code": "stays_private",
            "message": "The review stays private until you review them back or the 7-day window ends."})
    if not can_review(u):
        raise HTTPException(status_code=403, detail={"code": "upgrade_required",
            "message": "Reviewing back is a paid feature. Otherwise the review reveals when the 7-day window ends."})
    now = datetime.now(timezone.utc)
    ratings = _validate_ratings(body.ratings)
    reviewer = _reviewer(s)
    # The review-back targets the original reviewer. For a Boat Pro target, mirror
    # the session's identity (a pro_pro pair is symmetric); None otherwise.
    reviewer_u = await db.users.find_one({"user_id": reviewer["user_id"]}, {"_id": 0, "account_type": 1})
    # The review-back targets the identity the ORIGINAL reviewer acted as. In a
    # pro_pro pair that is always the personal profile (the reviewer acts
    # personal); otherwise mirror the session's reviewed identity when the
    # original reviewer is a Boat Pro, and None for everyone else.
    if s.get("relationship") == "pro_pro":
        back_target_identity = "personal"
    elif (reviewer_u or {}).get("account_type") == "boat_pro":
        back_target_identity = s.get("target_identity")
    else:
        back_target_identity = None
    await db.mutual_reviews.update_one(
        {"session_id": session_id, "author_id": u["user_id"]},
        {"$set": {"session_id": session_id, "author_id": u["user_id"], "author_role": reviewee["role"],
                  "author_identity": "personal", "author_business_id": None, "target_id": reviewer["user_id"],
                  "target_identity": back_target_identity,
                  "ratings": ratings, "comment": (body.comment or None), "created_at": now.isoformat()}},
        upsert=True)
    await db.review_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "revealed", "revealed": True, "revealed_at": now.isoformat(),
                  "participants.$[r].submitted": True, "participants.$[r].submitted_at": now.isoformat()}},
        array_filters=[{"r.user_id": u["user_id"]}])
    try:
        await notify(user_id=reviewer["user_id"], kind="review_completed",
                     title="A review went live",
                     body=f"{u.get('name')} reviewed you back, so both reviews are now public.",
                     link=f"/reviews?session={session_id}", meta={"session_id": session_id})
    except Exception:
        logger.exception("review reveal notify failed")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    s = await _hydrate(s)
    mine = await _get_review(session_id, u["user_id"])
    other = await _get_review(session_id, reviewer["user_id"])
    return _project(s, u["user_id"], mine, other)


@router.post("/review-sessions/{session_id}/reject")
async def reject_session(session_id: str):
    """REMOVED. Rejecting a review is gone; a reviewee can no longer suppress a
    review. Use the 'did not work together' flag instead (does not hide)."""
    raise HTTPException(status_code=410, detail={"code": "gone",
        "message": "Rejecting reviews has been removed. Reviews reveal when you review back or after 7 days."})


@router.get("/review-sessions/mine")
async def list_my_sessions(session_token: Optional[str] = Cookie(default=None),
                           authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    out: List[Dict[str, Any]] = []
    async for s in db.review_sessions.find({"participants.user_id": u["user_id"]}, {"_id": 0}).sort("created_at", -1):
        s = await _maybe_auto_reveal(s)
        me = _is_participant(s, u["user_id"])
        viewer_is_reviewee = bool(me and not me.get("is_reviewer"))
        # Rejected sessions are never shown to the reviewee.
        if s.get("status") == "rejected" and viewer_is_reviewee:
            continue
        s = await _hydrate(s)
        other_p = next(p for p in s["participants"] if p["user_id"] != u["user_id"])
        show_other = (s.get("status") in LIVE_STATUSES)
        out.append(_project(s, u["user_id"], await _get_review(s["id"], u["user_id"]),
                            await _get_review(s["id"], other_p["user_id"]), show_other))
    return out


@router.get("/review-sessions/{session_id}")
async def get_session(session_id: str,
                      session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or not _is_participant(s, u["user_id"]):
        raise HTTPException(status_code=404, detail="Session not found")
    s = await _maybe_auto_reveal(s)
    me = _is_participant(s, u["user_id"])
    viewer_is_reviewee = bool(me and not me.get("is_reviewer"))
    if s.get("status") == "rejected" and viewer_is_reviewee:
        raise HTTPException(status_code=404, detail="Session not found")
    s = await _hydrate(s)
    other_p = next(p for p in s["participants"] if p["user_id"] != u["user_id"])
    show_other = (s.get("status") in LIVE_STATUSES)
    return _project(s, u["user_id"], await _get_review(s["id"], u["user_id"]),
                    await _get_review(s["id"], other_p["user_id"]), show_other)


@router.delete("/review-sessions/{session_id}/review/{author_id}")
async def delete_mutual_review(session_id: str, author_id: str,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    """Delete ONE side of a two-way review (the `mutual_reviews` doc authored by
    `author_id` in `session_id`). Allowed for that review's author OR an admin.
    Covers pending (the reviewer's single hidden review) and live two-way reviews.

    Each mutual_reviews doc is independent, so removing one side never breaks the
    other. When no reviews remain on the session, the session itself is torn down
    and every notification about it (incl. the reviewee's pending request) is
    removed, plus any open report on it is closed. Averages recompute live."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    review = await db.mutual_reviews.find_one(
        {"session_id": session_id, "author_id": author_id}, {"_id": 0, "author_id": 1})
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if author_id != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="You can only delete your own review")
    # Authors may remove their own review ONLY while the session is pending (use
    # withdraw instead). Once revealed, only an admin can remove it.
    if author_id == u["user_id"] and not is_admin(u) and s.get("status") != "pending":
        raise HTTPException(status_code=409, detail={"code": "cannot_delete_live",
            "message": "You cannot delete a review once it is public. Contact support if there is a problem."})
    await db.mutual_reviews.delete_one({"session_id": session_id, "author_id": author_id})
    remaining = await db.mutual_reviews.count_documents({"session_id": session_id})
    notifications_removed = 0
    session_deleted = False
    if remaining == 0:
        await db.review_sessions.delete_one({"id": session_id})
        res = await db.notifications.delete_many({"meta.session_id": session_id})
        notifications_removed = res.deleted_count
        now_iso = datetime.now(timezone.utc).isoformat()
        # Reviews are not reportable today, so this is defensive: close any open
        # report that happens to point at this session so nothing dangles.
        await db.reports.update_many(
            {"target_type": {"$in": ["review", "review_session"]},
             "target_id": session_id, "status": "open"},
            {"$set": {"status": "resolved", "target_deleted": True,
                      "resolved_by": u["user_id"], "resolved_at": now_iso,
                      "resolution_notes": "review deleted"}})
        session_deleted = True
    return {"ok": True, "session_deleted": session_deleted,
            "notifications_removed": notifications_removed}


async def _live_session_ids() -> set:
    rows = await db.review_sessions.find({"status": {"$in": list(LIVE_STATUSES)}},
                                         {"_id": 0, "id": 1, "relationship": 1}).to_list(None)
    return rows


def _avg_of(review: Dict[str, Any]) -> Optional[float]:
    vals = [v for k, v in (review.get("ratings") or {}).items() if isinstance(v, int)]
    return (sum(vals) / len(vals)) if vals else None


def _identity_filter(identity: str) -> Dict[str, Any]:
    """Mongo match for a review's target_identity. 'business' (default) also
    matches legacy/missing docs; 'personal' matches only explicit personal."""
    if identity == "personal":
        return {"target_identity": "personal"}
    return {"target_identity": {"$in": ["business", None]}}


async def compute_summary(target_id: str, live_rows: Optional[list] = None,
                          identity: str = "business") -> Dict[str, Any]:
    """SINGLE source of truth for a target's rating summary (LIVE reviews only).
    Used by /api/reviews/summary AND by every directory card / list / public
    profile so the number is identical everywhere.

      • Organization -> ONE `overall` average out of 5 + count, combining one-way
        star reviews with Boat Pro two-way reviews (each two-way contributes the
        average of the ratings it contains). No five-parameter breakdown.
      • Boat Pro / sailor / owner -> five averages {overall,personality,skill,
        promptness,communication} (blanks skipped) + count.

    Pass `live_rows` (the result of _live_session_ids()) to avoid re-querying it
    once per card when summarising a whole list."""
    if live_rows is None:
        live_rows = await _live_session_ids()
    live_ids = [r["id"] for r in live_rows]
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0, "account_type": 1})
    is_org = bool(target and target.get("account_type") == "partner")
    idf = _identity_filter(identity)
    if is_org:
        vals: List[float] = []
        async for r in db.reviews.find({"target_id": target_id, "removed": {"$ne": True}}, {"_id": 0, "rating": 1}):
            if isinstance(r.get("rating"), int):
                vals.append(float(r["rating"]))
        if live_ids:
            async for r in db.mutual_reviews.find({"target_id": target_id, "session_id": {"$in": live_ids}, "removed": {"$ne": True}, **idf}, {"_id": 0, "ratings": 1}):
                a = _avg_of(r)
                if a is not None:
                    vals.append(a)
        return {"target_type": "organization", "count": len(vals),
                "overall": round(sum(vals) / len(vals), 1) if vals else None}
    sums: Dict[str, float] = {k: 0 for k in ALL_KEYS}
    cnts: Dict[str, int] = {k: 0 for k in ALL_KEYS}
    n = 0
    if live_ids:
        async for r in db.mutual_reviews.find({"target_id": target_id, "session_id": {"$in": live_ids}, "removed": {"$ne": True}, **idf}, {"_id": 0, "ratings": 1}):
            n += 1
            for k in ALL_KEYS:
                v = (r.get("ratings") or {}).get(k)
                if isinstance(v, int):
                    sums[k] += v
                    cnts[k] += 1
    agg = {k: (round(sums[k] / cnts[k], 1) if cnts[k] else None) for k in ALL_KEYS}
    return {"target_type": "member", "count": n, "overall": agg["overall"],
            "personality": agg["personality"], "skill": agg["skill"],
            "promptness": agg["promptness"], "communication": agg["communication"]}


@router.get("/mutual-reviews/for/{user_id}")
async def mutual_reviews_for(user_id: str, identity: str = "business"):
    """Public list of LIVE two-way reviews about a Boat Pro / sailor / owner for ONE
    identity ("business" default, or "personal"), plus the per-dimension averages."""
    rows = await _live_session_ids()
    live_ids = {r["id"]: r for r in rows}
    if not live_ids:
        return {"count": 0, "aggregate": None, "reviews": []}
    reviews = await db.mutual_reviews.find(
        {"target_id": user_id, "session_id": {"$in": list(live_ids.keys())}, "removed": {"$ne": True}, **_identity_filter(identity)}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    if not reviews:
        return {"count": 0, "aggregate": None, "reviews": []}
    sums: Dict[str, float] = {k: 0 for k in ALL_KEYS}
    cnts: Dict[str, int] = {k: 0 for k in ALL_KEYS}
    for r in reviews:
        for k in ALL_KEYS:
            v = (r.get("ratings") or {}).get(k)
            if isinstance(v, int):
                sums[k] += v
                cnts[k] += 1
    aggregate = {k: (round(sums[k] / cnts[k], 1) if cnts[k] else None) for k in ALL_KEYS}
    author_ids = list({r["author_id"] for r in reviews})
    users = await db.users.find({"user_id": {"$in": author_ids}},
                                {"_id": 0, "user_id": 1, "name": 1, "avatar": 1, "picture": 1, "account_type": 1}).to_list(None)
    umap = {x["user_id"]: x for x in users}
    for r in reviews:
        au = umap.get(r["author_id"], {})
        r["author_name"] = au.get("name")
        r["author_avatar"] = display_image(au) if au else None
        r["relationship"] = live_ids.get(r["session_id"], {}).get("relationship")
    return {"count": len(reviews), "aggregate": aggregate, "reviews": reviews}


@router.get("/reviews/summary/{target_id}")
async def review_summary(target_id: str, identity: str = "business"):
    """Single summary for any target (live reviews only, 1 decimal, with count),
    for one Boat Pro identity. Delegates to compute_summary() - the ONE function
    every directory card, list and public profile also uses."""
    return await compute_summary(target_id, identity=identity)


def _relationship_for(viewer_type: str, target_type: str) -> Dict[str, Any]:
    """Non-raising sibling of _roles_for: decide whether `viewer_type` may review
    `target_type` and how. Returns {ok, relationship, reason, prompt} where
    `prompt` is the UI wording ("worked together" / "sailed together")."""
    if target_type == "partner":
        if viewer_type in ("sailor", "boat_owner"):
            return {"ok": True, "relationship": "organization", "reason": None, "prompt": None}
        if viewer_type == "boat_pro":
            # org <-> Boat Pro is a two-way review (matches _roles_for).
            return {"ok": True, "relationship": "customer_pro", "reason": None,
                    "prompt": "worked together"}
        return {"ok": False, "relationship": None, "prompt": None,
                "reason": "Organizations can't review other organizations."}
    if target_type == "boat_pro":
        if viewer_type == "boat_pro":
            # Boat Pro <-> Boat Pro is a personal two-way "pro_pro" review. The
            # extra gates (acting personal, no shared category, not already
            # exchanged) are applied in can_review_target.
            return {"ok": True, "relationship": "pro_pro", "reason": None,
                    "prompt": "worked together"}
        # sailor, boat_owner, and org (partner) all review a Boat Pro two-way.
        return {"ok": True, "relationship": "customer_pro", "reason": None,
                "prompt": "worked together"}
    if target_type in ("sailor", "boat_owner"):
        pair = {viewer_type, target_type}
        if pair == {"sailor", "boat_owner"}:
            return {"ok": True, "relationship": "owner_crew", "reason": None,
                    "prompt": "sailed together"}
        if viewer_type == "sailor" and target_type == "sailor":
            return {"ok": True, "relationship": "sailor_sailor", "reason": None,
                    "prompt": "sailed together"}
        if viewer_type == "boat_owner" and target_type == "boat_owner":
            return {"ok": True, "relationship": "owner_owner", "reason": None,
                    "prompt": "sailed together"}
        return {"ok": False, "relationship": None, "prompt": None,
                "reason": "This account type can't be reviewed."}
    return {"ok": False, "relationship": None, "prompt": None,
            "reason": "This account type can't be reviewed."}


@router.get("/reviews/can-review/{target_id}")
async def can_review_target(target_id: str,
                            session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """Read-only eligibility probe for the review UI: may the signed-in viewer
    review `target_id`, and how? Reviewing is always a paid feature
    (`must_be_paid` = true); an eligible-but-free viewer gets can_review=false
    with an upgrade reason so the UI can show an upgrade prompt rather than hide
    the action. `relationship` is customer_pro | owner_crew | organization, and
    `prompt` carries the context wording ("worked together" / "sailed together").
    `review_type` is "two_way" (accept/reject) or "one_way" (instant org review)."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0, "account_type": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    base = {"must_be_paid": True, "relationship": None, "prompt": None,
            "review_type": None, "can_review": False, "reason": None, "reason_code": None}
    if target_id == u["user_id"]:
        return {**base, "reason": "You can't review yourself.", "reason_code": "self"}
    rel = _relationship_for(u.get("account_type") or "", target.get("account_type") or "")
    review_type = "one_way" if rel.get("relationship") == "organization" else ("two_way" if rel.get("ok") else None)
    base.update({"relationship": rel.get("relationship"), "prompt": rel.get("prompt"),
                 "review_type": review_type})
    if not rel["ok"]:
        return {**base, "reason": rel["reason"], "reason_code": "not_allowed"}
    # Boat Pro <-> Boat Pro extra gates. These apply regardless of plan so the
    # UI can show an accurate disabled state before any upgrade prompt.
    if rel.get("relationship") == "pro_pro":
        my_pro = await db.boat_pros.find_one({"user_id": u["user_id"]}, {"_id": 0, "categories": 1})
        acting = await resolve_active_identity(u, my_pro)
        if acting != "personal":
            return {**base, "reason": "To review another Boat Pro, switch to your personal profile.",
                    "reason_code": "switch_to_personal"}
        other_pro = await db.boat_pros.find_one({"user_id": target_id}, {"_id": 0, "categories": 1})
        mine_cats = {c.lower() for c in (my_pro or {}).get("categories", [])}
        their_cats = {c.lower() for c in (other_pro or {}).get("categories", [])}
        if mine_cats & their_cats:
            return {**base, "reason": "You can't review a Boat Pro in the same category.",
                    "reason_code": "shared_category"}
        existing = await db.review_sessions.find_one({
            "relationship": "pro_pro",
            "participants.user_id": {"$all": [u["user_id"], target_id]},
        }, {"_id": 0, "id": 1})
        if existing:
            return {**base, "reason": "You've already reviewed each other.",
                    "reason_code": "already_reviewed"}
    if not can_review(u):
        return {**base, "reason": "Reviewing is a paid feature. Upgrade your account to leave a review.",
                "reason_code": "upgrade_required"}
    return {**base, "can_review": True, "reason_code": "ok"}



@router.get("/reviews/list/{target_id}")
async def reviews_list(target_id: str, limit: int = 20, offset: int = 0, identity: str = "business",
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """Unified LIVE reviews about a target for one Boat Pro identity ("business"
    default, or "personal"): one-way (org) and two-way merged, newest first,
    paginated. Pending/withdrawn/removed reviews never appear. The matching
    compute_summary() rollup rides along in `summary`."""
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    rows = await _live_session_ids()
    live_rel = {r["id"]: r.get("relationship") for r in rows}
    items: List[Dict[str, Any]] = []
    if live_rel:
        async for r in db.mutual_reviews.find(
            {"target_id": target_id, "session_id": {"$in": list(live_rel.keys())}, "removed": {"$ne": True}, **_identity_filter(identity)}, {"_id": 0}):
            ratings = r.get("ratings") or {}
            items.append({
                "id": f"tw_{r['session_id']}_{r['author_id']}", "type": "two_way",
                "relationship": live_rel.get(r["session_id"]),
                "_author_id": r.get("author_id"),
                "_session_id": r.get("session_id"),
                "_author_identity": r.get("author_identity"),
                "overall": ratings.get("overall"),
                "ratings": {k: v for k, v in ratings.items() if k != "overall" and isinstance(v, int)},
                "comment": r.get("comment"), "created_at": r.get("created_at"),
                "reply": r.get("reply")})
    async for r in db.reviews.find({"target_id": target_id, "removed": {"$ne": True}}, {"_id": 0}):
        items.append({
            "id": r.get("id"), "type": "one_way", "relationship": "organization",
            "_author_id": r.get("author_id"), "overall": r.get("rating"), "ratings": {},
            "comment": r.get("comment"), "created_at": r.get("created_at"),
            "reply": r.get("reply")})
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    total = len(items)
    page = items[offset:offset + limit]
    aids = list({it["_author_id"] for it in page if it.get("_author_id")})
    users = {u["user_id"]: u async for u in db.users.find(
        {"user_id": {"$in": aids}},
        {"_id": 0, "user_id": 1, "name": 1, "avatar": 1, "picture": 1, "handle": 1, "account_type": 1})}
    pro_ids = [uid for uid in aids if (users.get(uid) or {}).get("account_type") == "boat_pro"]
    pros = {}
    if pro_ids:
        async for pr in db.boat_pros.find({"user_id": {"$in": pro_ids}},
                                          {"_id": 0, "user_id": 1, "company_name": 1, "logo_url": 1, "photo_url": 1}):
            pros[pr["user_id"]] = pr
    viewer = await current_user_from_token(session_token, authorization)
    viewer_id = viewer["user_id"] if viewer else None
    viewer_admin = bool(viewer and is_admin(viewer))
    for it in page:
        author_id = it.pop("_author_id", None)
        session_id = it.pop("_session_id", None)
        author_identity = it.pop("_author_identity", None)
        au = users.get(author_id) or {}
        pr = pros.get(au.get("user_id"))
        # A pro acting as an individual (author_identity == "personal", e.g. a
        # pro_pro review) shows their personal name only, never a business.
        if author_identity == "personal":
            pr = None
        # One-way org reviews are deleted via DELETE /reviews/{id}; two-way live
        # reviews via DELETE /review-sessions/{sid}/review/{author_id}. Either way
        # the review's author or an admin may delete; the client picks the call
        # from `type` (+ review_session_id / review_author_id for two-way).
        mine_or_admin = bool(viewer_id and (author_id == viewer_id or viewer_admin))
        it["can_delete"] = bool(mine_or_admin and it.get("type") in ("one_way", "two_way"))
        if it.get("type") == "two_way":
            it["review_session_id"] = session_id
            it["review_author_id"] = author_id
        it["author"] = {
            "name": au.get("name"), "avatar": display_image(au) if au else None,
            "account_type": au.get("account_type"), "handle": au.get("handle"),
            "business_name": (pr or {}).get("company_name") if pr else None,
            "business_logo": ((pr or {}).get("logo_url") or (pr or {}).get("photo_url")) if pr else None,
            "business_listing_id": pr["user_id"] if pr else None}
    # The reply is authored by the reviewed party (target). Show their live name
    # on the "Reply from ..." line, falling back to the stored name if gone.
    if any(it.get("reply") for it in page):
        tgt = await db.users.find_one({"user_id": target_id}, {"_id": 0, "name": 1})
        tgt_name = (tgt or {}).get("name")
        for it in page:
            rep = it.get("reply")
            if rep and tgt_name:
                rep["author_name"] = tgt_name
    summary = await compute_summary(target_id, rows, identity=identity)
    return {"summary": summary, "count": total, "limit": limit, "offset": offset, "reviews": page}


# --------------------------- New review lifecycle ----------------------------
# (The "did not work together" flag endpoint was removed in REVIEWS-1B. Legacy
#  flag data on old sessions is harmless and simply ignored.)


@router.post("/review-sessions/{session_id}/withdraw")
async def withdraw_session(session_id: str,
                           session_token: Optional[str] = Cookie(default=None),
                           authorization: Optional[str] = Header(default=None)):
    """Reviewer withdraws their own review while still PENDING (not held). Deletes
    the review, marks the session 'withdrawn', removes the pending request and
    notifies the reviewee. A fresh review starts a new 7-day window; nothing
    carries over."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    reviewer = _reviewer(s)
    if reviewer["user_id"] != u["user_id"]:
        raise HTTPException(status_code=403, detail="Only the reviewer can withdraw")
    if s.get("held"):
        raise HTTPException(status_code=409, detail="This review is being looked at by our team.")
    if s.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Only a pending review can be withdrawn")
    now = datetime.now(timezone.utc).isoformat()
    await db.mutual_reviews.delete_many({"session_id": session_id})
    await db.review_sessions.update_one({"id": session_id},
        {"$set": {"status": "withdrawn", "revealed": False, "withdrawn_at": now}})
    await db.notifications.delete_many({"meta.session_id": session_id, "kind": "review_request"})
    reviewee = _reviewee(s)
    try:
        await notify(user_id=reviewee["user_id"], kind="review_withdrawn",
                     title="A review was withdrawn",
                     body=f"{u.get('name')} withdrew their review.",
                     link="/reviews", meta={"session_id": session_id})
    except Exception:
        logger.exception("withdraw notify failed")
    return {"ok": True, "status": "withdrawn"}


@router.put("/review-sessions/{session_id}/review")
async def edit_pending_review(session_id: str, body: TwoWayReviewEdit,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    """Reviewer edits their own review while PENDING and not held. Does not restart
    the 7-day window and does not notify the reviewee. No edits once revealed."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    reviewer = _reviewer(s)
    if reviewer["user_id"] != u["user_id"]:
        raise HTTPException(status_code=403, detail="Only the reviewer can edit")
    if s.get("held"):
        raise HTTPException(status_code=409, detail="This review is being looked at by our team.")
    if s.get("status") != "pending":
        raise HTTPException(status_code=409, detail="You can only edit a review while it is pending")
    ratings = _validate_ratings(body.ratings)
    await db.mutual_reviews.update_one({"session_id": session_id, "author_id": u["user_id"]},
        {"$set": {"ratings": ratings, "comment": (body.comment or None)}})
    if body.context_note is not None:
        await db.review_sessions.update_one({"id": session_id}, {"$set": {"context_note": body.context_note}})
    mine = await _get_review(session_id, u["user_id"])
    return {"ok": True, "review": mine}


# ------------------------------- Replies -------------------------------------
async def _add_reply(doc_collection: str, match: Dict[str, Any], existing_reply,
                     reviewed_party_id: str, reviewer_id: str, u: Dict[str, Any], text: str):
    if u["user_id"] != reviewed_party_id:
        raise HTTPException(status_code=403, detail="Only the reviewed party can reply")
    if existing_reply:
        raise HTTPException(status_code=409, detail="A reply already exists")
    now = datetime.now(timezone.utc).isoformat()
    reply = {"author_id": u["user_id"], "author_name": u.get("name"), "text": text[:REPLY_MAX], "created_at": now}
    await getattr(db, doc_collection).update_one(match, {"$set": {"reply": reply}})
    try:
        await notify(user_id=reviewer_id, kind="review_reply",
                     title="Someone replied to your review",
                     body=f"{u.get('name')} replied to your review.",
                     link="/reviews", meta=dict(match))
    except Exception:
        logger.exception("reply notify failed")
    return reply


@router.post("/review-sessions/{session_id}/review/{author_id}/reply")
async def reply_two_way(session_id: str, author_id: str, body: ReviewReply,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    """The reviewed party replies to a two-way review about them (after reveal).
    One reply per review, max 500 chars, free accounts allowed, no edits."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s.get("status") not in LIVE_STATUSES:
        raise HTTPException(status_code=404, detail="Review not public")
    review = await db.mutual_reviews.find_one({"session_id": session_id, "author_id": author_id}, {"_id": 0})
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    reply = await _add_reply("mutual_reviews", {"session_id": session_id, "author_id": author_id},
                             review.get("reply"), review["target_id"], author_id, u, body.text)
    return {"ok": True, "reply": reply}


@router.delete("/review-sessions/{session_id}/review/{author_id}/reply")
async def delete_reply_two_way(session_id: str, author_id: str,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    review = await db.mutual_reviews.find_one({"session_id": session_id, "author_id": author_id}, {"_id": 0})
    if not review or not review.get("reply"):
        raise HTTPException(status_code=404, detail="Reply not found")
    if review["reply"]["author_id"] != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.mutual_reviews.update_one({"session_id": session_id, "author_id": author_id}, {"$unset": {"reply": ""}})
    return {"ok": True}


@router.post("/reviews/{review_id}/reply")
async def reply_one_way(review_id: str, body: ReviewReply,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    """The organization (reviewed party) replies to a one-way org review."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    r = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    reply = await _add_reply("reviews", {"id": review_id}, r.get("reply"),
                             r["target_id"], r.get("author_id"), u, body.text)
    return {"ok": True, "reply": reply}


@router.delete("/reviews/{review_id}/reply")
async def delete_reply_one_way(review_id: str,
                               session_token: Optional[str] = Cookie(default=None),
                               authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    r = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not r or not r.get("reply"):
        raise HTTPException(status_code=404, detail="Reply not found")
    if r["reply"]["author_id"] != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.reviews.update_one({"id": review_id}, {"$unset": {"reply": ""}})
    return {"ok": True}


# ------------------------------- Admin ---------------------------------------
async def _require_admin(session_token, authorization) -> Dict[str, Any]:
    u = await current_user_from_token(session_token, authorization)
    if not u or not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    return u


async def _log_admin_action(admin_id: str, action: str, session_id: str, reason: Optional[str]):
    await db.admin_actions.insert_one({
        "id": str(uuid.uuid4()), "admin_id": admin_id, "action": action,
        "target_type": "review_session", "target_id": session_id,
        "reason": reason, "created_at": datetime.now(timezone.utc).isoformat()})


@router.get("/admin/review-sessions")
async def admin_list_sessions(status: Optional[str] = None, limit: int = 50, offset: int = 0,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    await _require_admin(session_token, authorization)
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    limit = max(1, min(int(limit), 200))
    rows = await db.review_sessions.find(q, {"_id": 0}).sort("created_at", -1).skip(max(0, offset)).limit(limit).to_list(limit)
    out = []
    for s in rows:
        s = await _hydrate(s)
        reviews = await db.mutual_reviews.find({"session_id": s["id"]}, {"_id": 0}).to_list(10)
        out.append({**s, "reviews": reviews,
                    "mutual_pair": bool(s.get("mutual_pair")), "held": bool(s.get("held")),
                    "target_identity": s.get("target_identity")})
    total = await db.review_sessions.count_documents(q)
    return {"count": total, "limit": limit, "offset": offset, "sessions": out}


async def _notify_both_neutral(s: Dict[str, Any], kind: str, title: str, body: str, extra_for=None, extra_body=None):
    ids = [p["user_id"] for p in s.get("participants", [])]
    umap = {x["user_id"]: x for x in await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1}).to_list(None)}
    for p in s.get("participants", []):
        other = next((x for x in s["participants"] if x["user_id"] != p["user_id"]), {})
        other_name = (umap.get(other.get("user_id"), {}) or {}).get("name") or "another member"
        this_body = body.replace("<name>", other_name)
        if extra_for and p["user_id"] == extra_for and extra_body:
            this_body = this_body + " " + extra_body
        try:
            await notify(user_id=p["user_id"], kind=kind, title=title, body=this_body,
                         link=f"/reviews?session={s['id']}", meta={"session_id": s["id"]})
        except Exception:
            logger.exception("neutral notify failed")


@router.post("/admin/review-sessions/{session_id}/hold")
async def admin_hold(session_id: str, body: AdminHoldBody,
                     session_token: Optional[str] = Cookie(default=None),
                     authorization: Optional[str] = Header(default=None)):
    admin = await _require_admin(session_token, authorization)
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.review_sessions.update_one({"id": session_id},
        {"$set": {"held": True, "hold_reason": body.reason, "held_at": datetime.now(timezone.utc).isoformat()}})
    await _log_admin_action(admin["user_id"], "hold", session_id, body.reason)
    await _notify_both_neutral(s, "review_held", "A review is being looked at",
        "A review between you and <name> is being looked at by our team. It will stay private until we finish. We will let you know the outcome.")
    return {"ok": True, "held": True}


@router.post("/admin/review-sessions/{session_id}/release")
async def admin_release(session_id: str, body: AdminHoldBody,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    admin = await _require_admin(session_token, authorization)
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.review_sessions.update_one({"id": session_id},
        {"$set": {"held": False, "released_at": datetime.now(timezone.utc).isoformat()}})
    await _log_admin_action(admin["user_id"], "release", session_id, body.reason)
    fresh = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    await _maybe_auto_reveal(fresh)
    await _notify_both_neutral(s, "review_released", "Review check complete",
        "Our team finished looking at a review between you and <name>. It will continue as normal.")
    return {"ok": True, "held": False}


@router.post("/admin/review-sessions/{session_id}/remove-review")
async def admin_remove_review(session_id: str, body: AdminRemoveReviewBody,
                              session_token: Optional[str] = Cookie(default=None),
                              authorization: Optional[str] = Header(default=None)):
    admin = await _require_admin(session_token, authorization)
    s = await db.review_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    review = await db.mutual_reviews.find_one({"session_id": session_id, "author_id": body.author_id}, {"_id": 0})
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    await db.mutual_reviews.update_one({"session_id": session_id, "author_id": body.author_id},
        {"$set": {"removed": True, "removed_at": datetime.now(timezone.utc).isoformat(),
                  "removed_by": admin["user_id"], "restored": False}})
    await _log_admin_action(admin["user_id"], "remove_review", session_id, body.reason)
    remaining = await db.mutual_reviews.count_documents({"session_id": session_id, "removed": {"$ne": True}})
    if remaining == 0:
        await db.review_sessions.update_one({"id": session_id}, {"$set": {"status": "removed", "revealed": False}})
    await _notify_both_neutral(s, "review_removed", "A review was removed",
        "A review between you and <name> was removed by our team.")
    return {"ok": True, "removed": True}

