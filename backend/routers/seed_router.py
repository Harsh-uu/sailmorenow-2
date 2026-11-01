"""Idempotent demo seed + root."""
from __future__ import annotations
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter

from deps import db

router = APIRouter()


@router.get("/")
async def root():
    return {"app": "Sail More Now API", "status": "ok"}


@router.post("/seed")
async def seed():
    # Idempotent demo seed: only runs while the users collection is empty so a
    # public caller can never reset live data.
    if await db.users.count_documents({}, limit=1):
        return {"seeded": False, "reason": "already_populated"}
    now = datetime.now(timezone.utc)
    seeds = [
        {"user_id": "seed_jane", "email": "captain.jane@sailmorenow.dev", "name": "Captain Jane",
         "account_type": "boat_owner", "primary_market": "Greater Seattle", "markets": ["Greater Seattle"],
         "reasons": ["Find crew for my boat"], "picture": None, "subscription_tier": "free",
         "onboarding_complete": True, "policies_agreed": True, "newsletter_opt_in": True,
         "avatar": "⛵", "bio": "Weekend cruiser on Puget Sound.", "created_at": now.isoformat()},
        {"user_id": "seed_alex", "email": "crew.alex@sailmorenow.dev", "name": "Alex Rivera",
         "account_type": "sailor", "primary_market": "Anacortes/San Juan Islands",
         "markets": ["Anacortes/San Juan Islands", "Bellingham"],
         "reasons": ["Find boats to race on", "Learn to sail"],
         "subscription_tier": "premium", "onboarding_complete": True, "policies_agreed": True,
         "newsletter_opt_in": True, "avatar": "🧭",
         "bio": "USCG-endorsed sailor. Foredeck & pit crew, 30–45ft racers.", "created_at": now.isoformat()},
        {"user_id": "seed_marina", "email": "pro.marina@sailmorenow.dev", "name": "Salish Marina Services",
         "account_type": "boat_pro", "primary_market": "Greater Seattle",
         "markets": ["Greater Seattle", "Kirkland", "Everett"], "reasons": [],
         "subscription_tier": "premium", "onboarding_complete": True, "policies_agreed": True,
         "newsletter_opt_in": True, "created_at": now.isoformat()},
        {"user_id": "seed_rigging", "email": "pro.rigging@sailmorenow.dev", "name": "North Sound Rigging Co.",
         "account_type": "boat_pro", "primary_market": "Bellingham",
         "markets": ["Bellingham", "Anacortes/San Juan Islands"],
         "subscription_tier": "featured", "onboarding_complete": True, "policies_agreed": True,
         "newsletter_opt_in": True, "created_at": now.isoformat()},
        {"user_id": "seed_canvas", "email": "pro.canvas@sailmorenow.dev", "name": "River City Canvas",
         "account_type": "boat_pro", "primary_market": "Portland/Vancouver",
         "markets": ["Portland/Vancouver", "Hood River"],
         "subscription_tier": "basic", "onboarding_complete": True, "policies_agreed": True,
         "newsletter_opt_in": True, "created_at": now.isoformat()},
        {"user_id": "seed_partner", "email": "partner.psss@sailmorenow.dev", "name": "Puget Sound Sailing Society",
         "account_type": "partner", "primary_market": "Greater Seattle",
         "markets": ["Greater Seattle", "Tacoma", "Everett"],
         "subscription_tier": "free", "onboarding_complete": True, "policies_agreed": True,
         "newsletter_opt_in": True, "created_at": now.isoformat()},
    ]
    for u in seeds:
        await db.users.update_one({"user_id": u["user_id"]}, {"$setOnInsert": u}, upsert=True)

    pros = [
        {"user_id": "seed_marina", "company_name": "Salish Marina Services",
         "logo_url": None, "photo_url": "https://images.unsplash.com/photo-1646520835127-8946b42cadc4?w=800",
         "short_bio": "Full-service marine electronics, engines, and haul-out. Family-owned since 1998.",
         "website": "https://example.com/salish", "contact_email": "hello@salish.example",
         "contact_phone": "(206) 555-0182",
         "categories": ["Diesel Engine Specialist", "Electronics", "Bottom Paint & Haul-out"],
         "markets": ["Greater Seattle", "Kirkland", "Everett"], "tier": "premium",
         "created_at": now.isoformat(), "updated_at": now.isoformat()},
        {"user_id": "seed_rigging", "company_name": "North Sound Rigging Co.",
         "photo_url": "https://images.unsplash.com/photo-1615486511484-92e172cc4fe0?w=800",
         "short_bio": "Standing & running rigging inspections, replacements, and re-rigs for offshore-ready boats.",
         "website": "https://example.com/nsrigging", "contact_email": "info@nsrigging.example",
         "contact_phone": "(360) 555-0110",
         "categories": ["Rigging", "Surveying"],
         "markets": ["Bellingham", "Anacortes/San Juan Islands"], "tier": "featured",
         "created_at": now.isoformat(), "updated_at": now.isoformat()},
        {"user_id": "seed_canvas", "company_name": "River City Canvas",
         "short_bio": "Custom sail covers, dodgers, and biminis. PNW weather-tested.",
         "contact_email": "quotes@rivercity.example", "contact_phone": "(503) 555-0144",
         "categories": ["Canvas"], "markets": ["Portland/Vancouver", "Hood River"], "tier": "basic",
         "created_at": now.isoformat(), "updated_at": now.isoformat()},
    ]
    for p in pros:
        await db.boat_pros.update_one({"user_id": p["user_id"]}, {"$set": p}, upsert=True)

    posts = [
        {"id": "seed_post_1", "type": "sailing_opportunity", "title": "Wed night race — need foredeck",
         "body": "J/109 out of Shilshole looking for a foredeck for weekly Wednesday night races. Season starts April, all skill levels welcome to try out. Beer & pizza after.",
         "market": "Greater Seattle", "author_id": "seed_jane", "author_name": "Captain Jane",
         "author_avatar": "⛵", "created_at": now.isoformat()},
        {"id": "seed_post_2", "type": "volunteer_opportunity",
         "title": "Youth sailing camp — dock hands needed", "market": "Greater Seattle",
         "body": "PSSS summer camp needs 4 dock volunteers each morning July 8–19. Great for retired sailors or off-season students. Free lunch + swag.",
         "author_id": "seed_partner", "author_name": "Puget Sound Sailing Society",
         "created_at": now.isoformat()},
        {"id": "seed_post_3", "type": "sailing_opportunity",
         "title": "Delivery crew — Bellingham → San Juans", "market": "Bellingham",
         "body": "Delivering a Beneteau 42 from Bellingham to Roche Harbor next weekend. 2 crew spots. Overnight stop in Sucia. Experienced sailors preferred but happy to teach.",
         "author_id": "seed_alex", "author_name": "Alex Rivera",
         "created_at": now.isoformat()},
    ]
    for p in posts:
        await db.posts.update_one({"id": p["id"]}, {"$set": p}, upsert=True)

    events = [
        {"id": "seed_ev_1", "title": "Puget Sound Spring Regatta",
         "description": "Three-day PHRF regatta hosted by Corinthian YC. Registration open through April 5.",
         "market": "Greater Seattle",
         "starts_at": (now + timedelta(days=21)).isoformat(),
         "ends_at": (now + timedelta(days=23)).isoformat(),
         "location": "Shilshole Bay", "is_volunteer": False, "is_paid": True, "is_race": True, "price": 145.0,
         "registration_url": "https://example.com/regatta",
         "image_url": "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=1200",
         "organizer_id": "seed_partner", "organizer_name": "Puget Sound Sailing Society",
         "created_at": now.isoformat(), "approved": True},
        {"id": "seed_ev_2", "title": "Youth sailing camp — volunteer orientation",
         "description": "Volunteer orientation for the summer youth camp. Snacks provided.",
         "market": "Greater Seattle",
         "starts_at": (now + timedelta(days=10)).isoformat(),
         "location": "Leschi", "is_volunteer": True, "is_paid": False, "is_race": False,
         "image_url": "https://images.unsplash.com/photo-1613578699399-82ae71be53a3?w=1200",
         "organizer_id": "seed_partner", "organizer_name": "Puget Sound Sailing Society",
         "created_at": now.isoformat(), "approved": True},
        {"id": "seed_ev_3", "title": "Anacortes Cruisers' Rendezvous",
         "description": "Weekend rendezvous at Cap Sante. Potluck, dock party, and guest speaker on PNW cruising.",
         "market": "Anacortes/San Juan Islands",
         "starts_at": (now + timedelta(days=35)).isoformat(),
         "ends_at": (now + timedelta(days=37)).isoformat(),
         "location": "Cap Sante Marina", "is_volunteer": False, "is_paid": True, "is_race": False, "price": 45.0,
         "image_url": "https://images.unsplash.com/photo-1715885883010-9a04e71e236b?w=1200",
         "organizer_id": "seed_partner", "organizer_name": "Puget Sound Sailing Society",
         "created_at": now.isoformat(), "approved": True},
        {"id": "seed_ev_4", "title": "Columbia Gorge Kiteboarding & Sailing Meetup",
         "description": "Casual after-work meetup at the waterfront park. All welcome.",
         "market": "Hood River",
         "starts_at": (now + timedelta(days=5)).isoformat(),
         "location": "Waterfront Park", "is_volunteer": False, "is_paid": False, "is_race": False,
         "image_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=1200",
         "organizer_id": "seed_partner", "organizer_name": "Puget Sound Sailing Society",
         "created_at": now.isoformat(), "approved": True},
    ]
    for e in events:
        await db.events.update_one({"id": e["id"]}, {"$set": e}, upsert=True)

    # NOTE: demo review seeding is intentionally DISABLED. Under the single
    # two-way review system, Boat Pro / sailor / owner reviews must flow through
    # review_sessions + mutual_reviews (accept/reject), and only sailors/owners
    # may one-way review an organization. The old seed created one-way reviews
    # targeting Boat Pros (seed_marina / seed_rigging), which violates the rules,
    # so it is no longer created on seed.

    return {"seeded": True, "users": len(seeds), "pros": len(pros), "posts": len(posts),
            "events": len(events), "reviews": 0}
