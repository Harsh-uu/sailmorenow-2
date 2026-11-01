"""Demo data seeding + reset for pre-launch demos.

Every record created here is tagged ``is_demo: True`` so the reset routine can
remove ONLY demo rows and never touch real users, settings, FAQs, testimonials,
audit logs or other configuration. IDs use a ``demo_`` prefix for readability.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

# Collections that hold demo records (used by reset + status).
DEMO_COLLECTIONS = ["users", "boat_pros", "posts", "events", "event_registrations", "reviews"]

# A "small" demo loads a lighter subset for quick walkthroughs.
SMALL_USERS = {"demo_sailor", "demo_owner", "demo_org", "demo_pro_haulout"}
SMALL_PROS = {"demo_pro_haulout"}
SMALL_POSTS = {"demo_post_1", "demo_post_2"}
SMALL_EVENTS = {"demo_ev_1"}
SMALL_RSVPS = {"demo_reg_1"}
SMALL_REVIEWS = {"demo_rev_1", "demo_rev_2"}

_IMG = {
    "haulout": "https://images.unsplash.com/photo-1640539941763-ae899c481cca?w=1000",
    "detail": "https://images.unsplash.com/photo-1785013045447-92e088e00fa1?w=1000",
    "diesel": "https://images.unsplash.com/photo-1552656967-7a0991a13906?w=1000",
    "rig": "https://images.unsplash.com/photo-1524722228493-c418381c4cac?w=1000",
    "sails": "https://images.unsplash.com/photo-1603275218135-07c03485bba9?w=1000",
    "instruction": "https://images.unsplash.com/photo-1474917518260-23f84bd71c75?w=1000",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def seed_demo(db, size: str = "full") -> Dict[str, int]:
    """Idempotently insert demo records (tagged is_demo). Safe to re-run.
    size="small" loads a lighter subset; "full" loads everything."""
    small = size == "small"
    now = _now()
    ts = now.isoformat()

    users: List[Dict[str, Any]] = [
        {"user_id": "demo_sailor", "email": "demo.sailor@sailmorenow.demo", "name": "Alex Rivera",
         "first_name": "Alex", "last_name": "Rivera", "handle": "demo-alex-rivera",
         "account_type": "sailor", "primary_market": "Greater Seattle", "markets": ["Greater Seattle", "Everett"],
         "subscription_tier": "premium", "bio": "Foredeck & pit crew on 30–45ft racers. Always up for a Wednesday night race.",
         "avatar": "🧭"},
        {"user_id": "demo_owner", "email": "demo.owner@sailmorenow.demo", "name": "Captain Jamie Cole",
         "first_name": "Jamie", "last_name": "Cole", "handle": "demo-jamie-cole",
         "account_type": "boat_owner", "primary_market": "Greater Seattle", "markets": ["Greater Seattle"],
         "subscription_tier": "free", "bio": "Weekend cruiser on Puget Sound aboard a Catalina 36.",
         "boat_name": "Second Wind", "avatar": "⛵"},
        {"user_id": "demo_org", "email": "demo.org@sailmorenow.demo", "name": "Salish Bay Sailing Club",
         "first_name": "Morgan", "last_name": "Lee", "handle": "demo-salish-bay-sailing-club",
         "account_type": "partner", "org_name": "Salish Bay Sailing Club",
         "primary_market": "Greater Seattle", "markets": ["Greater Seattle", "Tacoma", "Everett"],
         "subscription_tier": "community_partner", "bio": "Non-profit club running races, youth camps, and cruising rendezvous across Puget Sound."},
        {"user_id": "demo_pro_haulout", "email": "demo.haulout@sailmorenow.demo", "name": "Cascade Haul-Out & Diesel",
         "first_name": "Dana", "last_name": "Boyd", "handle": "demo-cascade-haulout",
         "account_type": "boat_pro", "company_name": "Cascade Haul-Out & Diesel",
         "primary_market": "Greater Seattle", "markets": ["Greater Seattle", "Everett"],
         "subscription_tier": "premium"},
        {"user_id": "demo_pro_rig", "email": "demo.rig@sailmorenow.demo", "name": "North Sound Rig & Sail",
         "first_name": "Sam", "last_name": "Nguyen", "handle": "demo-north-sound-rig",
         "account_type": "boat_pro", "company_name": "North Sound Rig & Sail",
         "primary_market": "Bellingham", "markets": ["Bellingham", "Anacortes/San Juan Islands"],
         "subscription_tier": "featured"},
        {"user_id": "demo_pro_detail", "email": "demo.detail@sailmorenow.demo", "name": "Harbor Shine Detailing & School",
         "first_name": "Riley", "last_name": "Park", "handle": "demo-harbor-shine",
         "account_type": "boat_pro", "company_name": "Harbor Shine Detailing & School",
         "primary_market": "Portland/Vancouver", "markets": ["Portland/Vancouver", "Hood River"],
         "subscription_tier": "basic"},
    ]
    if small:
        users = [u for u in users if u["user_id"] in SMALL_USERS]
    for u in users:
        u.update({"is_demo": True, "onboarding_complete": True, "policies_agreed": True,
                  "newsletter_opt_in": True, "picture": None, "created_at": ts})
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": u}, upsert=True)

    pros: List[Dict[str, Any]] = [
        {"user_id": "demo_pro_haulout", "company_name": "Cascade Haul-Out & Diesel",
         "photo_url": _IMG["haulout"], "photos": [_IMG["haulout"], _IMG["diesel"], _IMG["detail"]],
         "short_bio": "Travel-lift haul-outs, bottom paint, and full diesel engine service. 25-ton capacity, family-owned.",
         "website": "https://example.com/cascade", "contact_email": "service@cascade.demo", "contact_phone": "(206) 555-0101",
         "categories": ["Bottom Paint & Haul-out", "Diesel Engine Specialist"],
         "markets": ["Greater Seattle", "Everett"], "tier": "premium"},
        {"user_id": "demo_pro_rig", "company_name": "North Sound Rig & Sail",
         "photo_url": _IMG["rig"], "photos": [_IMG["rig"], _IMG["sails"], _IMG["instruction"]],
         "short_bio": "Standing & running rigging, re-rigs, and custom sails/canvas for offshore-ready boats.",
         "website": "https://example.com/northsound", "contact_email": "info@northsound.demo", "contact_phone": "(360) 555-0110",
         "categories": ["Rigging", "Sails", "Canvas"],
         "markets": ["Bellingham", "Anacortes/San Juan Islands"], "tier": "featured"},
        {"user_id": "demo_pro_detail", "company_name": "Harbor Shine Detailing & School",
         "photo_url": _IMG["detail"], "photos": [_IMG["detail"], _IMG["instruction"], _IMG["sails"]],
         "short_bio": "Freshwater detailing, waxing, and ASA-style sailing instruction for new owners.",
         "contact_email": "hello@harborshine.demo", "contact_phone": "(503) 555-0144",
         "categories": ["Detailing - Exterior", "Sailing Instruction"],
         "markets": ["Portland/Vancouver", "Hood River"], "tier": "basic"},
    ]
    if small:
        pros = [p for p in pros if p["user_id"] in SMALL_PROS]
    for p in pros:
        p.update({"is_demo": True, "created_at": ts, "updated_at": ts})
        await db.boat_pros.update_one({"user_id": p["user_id"]}, {"$set": p}, upsert=True)

    posts: List[Dict[str, Any]] = [
        {"id": "demo_post_1", "type": "general", "title": "First sail of the season!",
         "body": "Shook the cobwebs off Second Wind this weekend — glassy water and a perfect 10kt breeze off West Point. Who else is back out there?",
         "market": "Greater Seattle", "author_id": "demo_owner", "author_name": "Captain Jamie Cole", "author_avatar": "⛵"},
        {"id": "demo_post_2", "type": "update", "title": "Wednesday night racing starts April 9",
         "body": "Salish Bay's weeknight series kicks off next week. All experience levels welcome — reach out if you need a boat or a crew spot.",
         "market": "Greater Seattle", "author_id": "demo_org", "author_name": "Salish Bay Sailing Club"},
        {"id": "demo_post_3", "type": "note", "title": "Rigging check before the San Juans run",
         "body": "North Sound Rig & Sail just finished our pre-season inspection — swaged a new backstay and tuned the rig. Highly recommend before any offshore leg.",
         "market": "Bellingham", "author_id": "demo_sailor", "author_name": "Alex Rivera", "author_avatar": "🧭"},
        {"id": "demo_post_4", "type": "volunteer_opportunity", "title": "Youth camp dock volunteers needed",
         "body": "Salish Bay's summer youth camp needs 4 dock hands each morning, July 8–19. Great for retired sailors or students. Lunch + swag provided.",
         "market": "Greater Seattle", "author_id": "demo_org", "author_name": "Salish Bay Sailing Club"},
    ]
    if small:
        posts = [p for p in posts if p["id"] in SMALL_POSTS]
    for p in posts:
        p.update({"is_demo": True, "created_at": ts, "allow_comments": True})
        await db.posts.update_one({"id": p["id"]}, {"$set": p}, upsert=True)

    events: List[Dict[str, Any]] = [
        {"id": "demo_ev_1", "title": "Puget Sound Spring Regatta",
         "description": "Three-day PHRF regatta hosted by Salish Bay Sailing Club. Skippers' meeting Friday evening, racing Sat–Sun.",
         "market": "Greater Seattle", "starts_at": (now + timedelta(days=18)).isoformat(),
         "ends_at": (now + timedelta(days=20)).isoformat(), "location": "Shilshole Bay",
         "is_volunteer": False, "is_paid": True, "is_race": True, "price": 95.0,
         "image_url": "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=1200",
         "organizer_id": "demo_org", "organizer_name": "Salish Bay Sailing Club", "approved": True},
        {"id": "demo_ev_2", "title": "Youth Sailing Camp — Volunteer Orientation",
         "description": "Orientation for summer youth-camp volunteers. Meet the team, tour the docks, snacks provided.",
         "market": "Greater Seattle", "starts_at": (now + timedelta(days=9)).isoformat(),
         "location": "Leschi", "is_volunteer": True, "is_paid": False, "is_race": False,
         "image_url": "https://images.unsplash.com/photo-1613578699399-82ae71be53a3?w=1200",
         "organizer_id": "demo_org", "organizer_name": "Salish Bay Sailing Club", "approved": True},
    ]
    if small:
        events = [e for e in events if e["id"] in SMALL_EVENTS]
    for e in events:
        e.update({"is_demo": True, "created_at": ts})
        await db.events.update_one({"id": e["id"]}, {"$set": e}, upsert=True)

    rsvps: List[Dict[str, Any]] = [
        {"id": "demo_reg_1", "event_id": "demo_ev_1", "user_id": "demo_sailor",
         "user_name": "Alex Rivera", "user_email": "demo.sailor@sailmorenow.demo", "kind": "attendee"},
        {"id": "demo_reg_2", "event_id": "demo_ev_1", "user_id": "demo_owner",
         "user_name": "Captain Jamie Cole", "user_email": "demo.owner@sailmorenow.demo", "kind": "attendee"},
        {"id": "demo_reg_3", "event_id": "demo_ev_2", "user_id": "demo_owner",
         "user_name": "Captain Jamie Cole", "user_email": "demo.owner@sailmorenow.demo", "kind": "volunteer"},
    ]
    if small:
        rsvps = [r for r in rsvps if r["id"] in SMALL_RSVPS]
    for r in rsvps:
        r.update({"is_demo": True, "created_at": ts, "first_registered_at": ts})
        await db.event_registrations.update_one(
            {"event_id": r["event_id"], "user_id": r["user_id"]}, {"$set": r}, upsert=True)

    # NOTE: demo review seeding is intentionally DISABLED. Boat Pro reviews now
    # flow through the two-way review_sessions / mutual_reviews system (accept /
    # reject), and only sailors/owners may one-way review an organization. The
    # old demo reviews were one-way reviews targeting Boat Pros, which violates
    # the rules, so they are no longer created.

    await db.app_meta.update_one({"key": "demo"},
                                 {"$set": {"key": "demo", "seeded_at": ts, "size": size}}, upsert=True)

    return {"users": len(users), "boat_pros": len(pros), "posts": len(posts),
            "events": len(events), "event_registrations": len(rsvps), "reviews": 0}


async def reset_demo(db) -> Dict[str, int]:
    """Delete ONLY demo-tagged records across demo collections. Real users,
    settings, FAQs, testimonials, audit logs and config are preserved."""
    deleted: Dict[str, int] = {}
    for coll in DEMO_COLLECTIONS:
        res = await db[coll].delete_many({"is_demo": True})
        deleted[coll] = res.deleted_count
    await db.app_meta.delete_one({"key": "demo"})
    return deleted


async def demo_status(db) -> Dict[str, Any]:
    """Counts of demo records per collection, plus last-seeded snapshot."""
    counts: Dict[str, int] = {}
    total = 0
    for coll in DEMO_COLLECTIONS:
        n = await db[coll].count_documents({"is_demo": True})
        counts[coll] = n
        total += n
    meta = await db.app_meta.find_one({"key": "demo"}, {"_id": 0}) or {}
    return {"active": total > 0, "total": total, "counts": counts,
            "seeded_at": meta.get("seeded_at"), "size": meta.get("size")}
