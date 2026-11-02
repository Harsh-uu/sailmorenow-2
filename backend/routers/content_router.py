"""Editable site content: searchable FAQ + member Testimonials.

FAQs are seeded once (idempotent by `seed_key`) and are fully admin-editable
thereafter. Testimonials are member-submitted, hidden until an admin approves
them. Admin mutations are recorded in the audit log.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from deps import db, require_admin, require_user
from audit import log_admin_action

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# FAQ seed data — categories are ordered; questions are ordered within each.
# [Subscription path] and [My Markets path] resolved to the real in-app spots:
# both live on the Profile screen (web /profile; mobile Profile tab).
# ---------------------------------------------------------------------------
FAQ_SEED: List[Dict[str, Any]] = [
    # GETTING STARTED
    {"category": "Getting Started", "question": "What is Sail More Now?",
     "answer": "A Pacific Northwest sailing community and directory. Find and review boat pros, connect with crew and boat owners, and discover clubs and events in your market."},
    {"category": "Getting Started", "question": "Who can join?",
     "answer": "Sailors and boat owners, boat pros, and clubs or organizations. Free to join with premium features and boat pro listings available for purchase. You must be 18 or older."},
    {"category": "Getting Started", "question": "How do I create an account?",
     "answer": "Choose your role, fill in your details, and create a password with at least 8 characters, one uppercase letter, one number and one special character. You will also agree to the Code of Conduct."},
    {"category": "Getting Started", "question": "How do I change the markets I follow?",
     "answer": "Open your Profile and go to \u201cMarkets you follow\u201d to add or remove markets. Events, your feed and your home screen update right away."},
    # PLANS AND PRICING
    {"category": "Plans and Pricing", "question": "What does a free account include?",
     "answer": "Free accounts can browse, like posts, blogs and forum posts, and change their profile picture. Messaging and following need a paid plan."},
    {"category": "Plans and Pricing", "question": "What do boat pro plans cost and include?",
     "answer": "Basic is $12.99 a month: one market, no logo. Featured is $19.99 a month: two markets, your logo and an enhanced listing. Premium is $29.99 a month: unlimited markets, a 5-photo gallery, trust and credentials, top directory placement. Every paid Boat Pro plan can receive reviews and send direct messages."},
    {"category": "Plans and Pricing", "question": "Is there a discount for longer plans?",
     "answer": "Yes. Choosing 6 months saves 10% and 12 months saves 20%, and you can see the per-month price and total before you pay."},
    {"category": "Plans and Pricing", "question": "How do I cancel or change my plan?",
     "answer": "Open your Profile and go to the Subscription section to change or cancel your plan."},
    # VERIFICATION AND SAFETY
    {"category": "Verification and Safety", "question": "How does ID verification work?",
     "answer": "You upload a government ID and our team reviews it by hand. Certifications are self-reported and are not verified by us."},
    {"category": "Verification and Safety", "question": "How do I report a problem or block someone?",
     "answer": "Open their profile or the post and choose Report or Block."},
    # BOAT PROS AND REVIEWS
    {"category": "Boat Pros and Reviews", "question": "How do I show that I hired a boat pro?",
     "answer": "Tap Hired on their listing. You can then leave an optional review, and you can edit your own review later."},
    {"category": "Boat Pros and Reviews", "question": "How do I get a boat pro listing?",
     "answer": "Sign up as a boat pro, complete your listing (your signup details are filled in for you), and choose a plan."},
    # COMMUNITY
    {"category": "Community", "question": "How does the Crew Bank work?",
     "answer": "Sailors post when they are available and boat owners post open crew spots. Paid members can message each other from there."},
    {"category": "Community", "question": "How do events work?",
     "answer": "Browse events in your markets or all markets, RSVP, and message the hosting club. Clubs can post volunteer opportunities with contact details."},
    {"category": "Community", "question": "How do I contact support?",
     "answer": "Use the Help form in the app and we will reply by email within 48 hours."},
    {"category": "Getting Started", "question": "How do I delete my account?",
     "answer": "Open Settings on the web, or Profile in the app, and scroll to the very bottom. Choose Delete account. We email you a 6-digit code, and you confirm by entering it and typing DELETE. Deleting removes your profile, posts, comments, listings, reviews, messages and photos. We keep a small set of records we are required to retain, with your name and contact details removed. If you subscribe through the App Store or Google Play, cancel in the store too. This cannot be undone."},
]

CATEGORY_ORDER = [
    "Getting Started", "Plans and Pricing", "Verification and Safety",
    "Boat Pros and Reviews", "Community",
]


async def seed_faqs(database) -> int:
    """Insert any seed FAQ not already present (keyed by `seed_key`). Preserves
    admin edits — existing rows are never overwritten. Returns inserted count."""
    inserted = 0
    cat_index = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    per_cat_order: Dict[str, int] = {}
    for item in FAQ_SEED:
        cat = item["category"]
        order = per_cat_order.get(cat, 0)
        per_cat_order[cat] = order + 1
        seed_key = f"{cat}::{item['question']}"
        if await database.faqs.find_one({"seed_key": seed_key}, {"_id": 1}):
            continue
        await database.faqs.insert_one({
            "id": str(uuid.uuid4()),
            "seed_key": seed_key,
            "category": cat,
            "category_order": cat_index.get(cat, 99),
            "question": item["question"],
            "answer": item["answer"],
            "order": order,
            "active": True,
            "created_at": _now(),
            "updated_at": _now(),
        })
        inserted += 1
    return inserted


def _faq_sort(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(docs, key=lambda d: (d.get("category_order", 99), d.get("order", 0), d.get("created_at", "")))


# ---------- Public FAQ ----------
@router.get("/faqs")
async def list_faqs():
    docs = await db.faqs.find({"active": {"$ne": False}}, {"_id": 0, "seed_key": 0}).to_list(500)
    return _faq_sort(docs)


# ---------- Admin FAQ ----------
@router.get("/admin/faqs")
async def admin_list_faqs(admin=Depends(require_admin)):
    docs = await db.faqs.find({}, {"_id": 0, "seed_key": 0}).to_list(1000)
    return _faq_sort(docs)


@router.post("/admin/faqs")
async def admin_create_faq(body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    question = (body.get("question") or "").strip()
    answer = (body.get("answer") or "").strip()
    category = (body.get("category") or "").strip()
    if not question or not answer or not category:
        raise HTTPException(status_code=400, detail="Category, question and answer are required")
    cat_index = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    last = await db.faqs.find({"category": category}).sort("order", -1).to_list(1)
    order = (last[0].get("order", 0) + 1) if last else 0
    doc = {
        "id": str(uuid.uuid4()),
        "category": category,
        "category_order": cat_index.get(category, 99),
        "question": question,
        "answer": answer,
        "order": order,
        "active": bool(body.get("active", True)),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.faqs.insert_one(doc)
    await log_admin_action(admin, "create", "faq", doc["id"], summary=question[:120])
    doc.pop("_id", None)
    return doc


@router.patch("/admin/faqs/{faq_id}")
async def admin_edit_faq(faq_id: str, body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    doc = await db.faqs.find_one({"id": faq_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="FAQ not found")
    allowed = {"question", "answer", "category", "order", "active"}
    changes = {k: v for k, v in body.items() if k in allowed and v is not None}
    if "category" in changes:
        cat_index = {c: i for i, c in enumerate(CATEGORY_ORDER)}
        changes["category_order"] = cat_index.get(changes["category"], 99)
    if not changes:
        return doc
    changes["updated_at"] = _now()
    await db.faqs.update_one({"id": faq_id}, {"$set": changes})
    await log_admin_action(admin, "edit", "faq", faq_id,
                           summary=f"{doc.get('question', '')[:90]} — {', '.join(sorted(changes.keys()))}")
    return await db.faqs.find_one({"id": faq_id}, {"_id": 0, "seed_key": 0})


@router.post("/admin/faqs/reorder")
async def admin_reorder_faqs(body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    ordered_ids = body.get("ordered_ids") or []
    if not isinstance(ordered_ids, list) or not ordered_ids:
        raise HTTPException(status_code=400, detail="ordered_ids is required")
    for index, fid in enumerate(ordered_ids):
        await db.faqs.update_one({"id": fid}, {"$set": {"order": index, "updated_at": _now()}})
    await log_admin_action(admin, "reorder", "faq", ordered_ids[0], summary=f"Reordered {len(ordered_ids)} FAQs")
    return {"ok": True, "count": len(ordered_ids)}


@router.delete("/admin/faqs/{faq_id}")
async def admin_delete_faq(faq_id: str, admin=Depends(require_admin)):
    doc = await db.faqs.find_one({"id": faq_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="FAQ not found")
    await db.faqs.delete_one({"id": faq_id})
    await log_admin_action(admin, "delete", "faq", faq_id, summary=doc.get("question", "")[:120])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Testimonials
# ---------------------------------------------------------------------------
def _first_last_initial(name: str) -> str:
    parts = [p for p in (name or "").strip().split() if p]
    if not parts:
        return "A member"
    first = parts[0]
    if len(parts) > 1 and parts[-1]:
        return f"{first} {parts[-1][0].upper()}."
    return first


def _public_testimonial(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "quote": doc.get("quote", ""),
        "role": doc.get("role", ""),
        "market": doc.get("market", ""),
        "attribution": doc.get("display_name") if doc.get("show_name") else "",
        "created_at": doc.get("created_at"),
    }


@router.get("/testimonials")
async def list_testimonials():
    docs = await db.testimonials.find({"status": "approved"}, {"_id": 0}).sort("approved_at", -1).to_list(50)
    return [_public_testimonial(d) for d in docs]


@router.get("/review-highlights")
async def review_highlights():
    """Positive member reviews (4+ stars, with a written comment) surfaced as
    testimonials on the marketing + pricing pages. Includes the reviewer's home
    market. Falls back to approved member testimonials to top up when sparse."""
    docs = await db.reviews.find(
        {"rating": {"$gte": 4}, "comment": {"$nin": [None, ""]}, "removed": {"$ne": True}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(40)
    ids = list({d.get("author_id") for d in docs if d.get("author_id")})
    umap: Dict[str, Any] = {}
    if ids:
        async for u in db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "primary_market": 1, "name": 1}):
            umap[u["user_id"]] = u
    out: List[Dict[str, Any]] = []
    for d in docs:
        comment = (d.get("comment") or "").strip()
        if len(comment) < 10:
            continue
        u = umap.get(d.get("author_id"), {})
        out.append({
            "id": d["id"],
            "quote": comment,
            "attribution": _first_last_initial(d.get("author_name") or u.get("name") or ""),
            "market": u.get("primary_market", ""),
            "role": "",
            "rating": d.get("rating"),
        })
    # Top up with approved member testimonials if we have fewer than 3 reviews.
    if len(out) < 3:
        extra = await db.testimonials.find({"status": "approved"}, {"_id": 0}).sort("approved_at", -1).to_list(12)
        for d in extra:
            out.append(_public_testimonial(d))
    return out[:12]


@router.post("/testimonials")
async def submit_testimonial(body: Dict[str, Any] = Body(default={}), user=Depends(require_user)):
    quote = (body.get("quote") or "").strip()
    if len(quote) < 10:
        raise HTTPException(status_code=400, detail="Please share a little more (at least 10 characters)")
    if len(quote) > 280:
        raise HTTPException(status_code=400, detail="Please keep your quote to 280 characters or less")
    show_name = bool(body.get("show_name"))
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("user_id"),
        "author_email": user.get("email"),
        "quote": quote,
        "role": (body.get("role") or user.get("account_type") or "").replace("_", " ").strip()[:60],
        "market": (body.get("market") or user.get("primary_market") or "").strip()[:80],
        "show_name": show_name,
        "display_name": _first_last_initial(user.get("name") or ""),
        "status": "pending",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.testimonials.insert_one(doc)
    return {"ok": True, "status": "pending"}


# ---------- Admin testimonials ----------
@router.get("/admin/testimonials")
async def admin_list_testimonials(status: Optional[str] = None, admin=Depends(require_admin)):
    q: Dict[str, Any] = {}
    if status in {"pending", "approved", "hidden"}:
        q["status"] = status
    docs = await db.testimonials.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.patch("/admin/testimonials/{tid}")
async def admin_update_testimonial(tid: str, body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    doc = await db.testimonials.find_one({"id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Testimonial not found")
    status = body.get("status")
    if status not in {"approved", "hidden", "pending"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    changes: Dict[str, Any] = {"status": status, "updated_at": _now()}
    if status == "approved":
        changes["approved_at"] = _now()
    await db.testimonials.update_one({"id": tid}, {"$set": changes})
    await log_admin_action(admin, status, "testimonial", tid, summary=(doc.get("quote") or "")[:120])
    return await db.testimonials.find_one({"id": tid}, {"_id": 0})


@router.delete("/admin/testimonials/{tid}")
async def admin_delete_testimonial(tid: str, admin=Depends(require_admin)):
    doc = await db.testimonials.find_one({"id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Testimonial not found")
    await db.testimonials.delete_one({"id": tid})
    await log_admin_action(admin, "delete", "testimonial", tid, summary=(doc.get("quote") or "")[:120])
    return {"ok": True}
