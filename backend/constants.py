"""Shared constants for Sail More Now."""
from typing import Dict, Any

PNW_MARKETS = [
    "Portland/Vancouver", "Hood River", "Eugene", "Olympia", "Tacoma",
    "Greater Seattle", "Kirkland", "Everett", "Anacortes/San Juan Islands", "Bellingham",
]

BOAT_PRO_CATEGORIES = [
    "Rigging", "Sails", "Canvas", "Electronics",
    "Bottom Paint & Haul-out", "Fiberglass & Repair",
    "Surveying", "Delivery Captain", "Sailing Instruction", "Storage & Moorage",
    "Insurance", "Brokerage", "Diving & Underwater Services", "Refrigeration & HVAC",
    "Plumbing & Watermakers", "Woodwork & Interior Joinery", "Metal Fabrication & Welding",
    "Upholstery", "Painting & Gelcoat", "Batteries & Charging",
    "Solar & Wind Power", "Life Raft & Safety Gear",
    "Charter & Yacht Management", "Detailing - Exterior", "Detailing - Interior",
    "Diesel Engine Specialist", "Outboard Motor Specialist", "Autopilot & Steering",
    "Legal & Documentation", "Financing", "Photography & Videography", "Winter Storage",
    "Transport & Trucking",
]

SAILOR_REASONS = [
    "Find crew for my boat",
    "Find boats to cruise on",
    "Find boats to race on",
    "Learn to sail",
    "Meet the local sailing community",
    "Volunteer with a sailing organization",
    "Charter opportunities",
]

CREW_POSITIONS = ["Driver", "Foredeck", "Mast", "Pit", "Trimmer",
                  "Mainsheet", "Tactician", "Railmeat"]

# Multi-select "Type of sailing experience" (crew bank sign-up, shown as chips).
EXPERIENCE_TYPES = [
    "Buoy Racing", "Coastal/Offshore racing", "Offshore passage",
    "Cruising daytime", "Cruising overnight", "Dinghies",
    "Asym Kite", "Sym Kite", "Small boats (20'-29')",
    "Medium boats (30'-44')", "Big boats (45'+)",
]

# Sailing Style questionnaire — five 1..5 sliders (opposing qualifiers at the ends).
SAILING_STYLE_AXES = [
    {"key": "pace", "low": "Competitive, fast-paced", "high": "Casual, relaxed"},
    {"key": "social", "low": "Quiet, peaceful, solo tasks", "high": "Social, party vibes, group focus"},
    {"key": "experience", "low": "Experienced, knows the ropes", "high": "Beginner, eager to learn"},
    {"key": "drinks", "low": "Drinks and casual socializing allowed", "high": "Dry boat, focused"},
    {"key": "goal", "low": "Performance / results driven", "high": "Just out to get experience"},
]
SAILING_STYLE_KEYS = [a["key"] for a in SAILING_STYLE_AXES]

TIER_RANK = {"premium": 0, "featured": 1, "basic": 2}

# Clubs & Organizations directory categories (parallel to BOAT_PRO_CATEGORIES).
ORG_CATEGORIES = [
    "Yacht club",
    "Racing Club",
    "One Design Fleet",
    "Cruising Association",
    "Membership Club",
    "Nonprofits & Youth sailing",
]

# Legacy org-category names → current taxonomy (used at startup normalization).
ORG_CATEGORY_LEGACY_MAP = {
    "Yacht clubs": "Yacht club",
    "Racing fleets and associations": "Racing Club",
    "Nonprofits and youth sailing": "Nonprofits & Youth sailing",
    "Sailing schools and instruction": "Membership Club",
}

# Maximum characters allowed for a single photo string stored on a Boat Pro
# document. Photos are transported as base64 data URLs, so the CHAR length
# includes the ~33 % base64 overhead. The client compressor in
# `/app/frontend/src/lib/constants.js` mirrors this value — keep them in
# sync when adjusting.
MAX_PHOTO_URL_CHARS = 400_000

EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

SUBSCRIPTION_PACKAGES: Dict[str, Dict[str, Any]] = {
    "pro_basic_1":     {"tier": "basic",    "audience": "boat_pro", "months": 1,  "monthly": 12.99, "discount": 0.0},
    "pro_basic_6":     {"tier": "basic",    "audience": "boat_pro", "months": 6,  "monthly": 12.99, "discount": 0.10},
    "pro_basic_12":    {"tier": "basic",    "audience": "boat_pro", "months": 12, "monthly": 12.99, "discount": 0.20},
    "pro_featured_1":  {"tier": "featured", "audience": "boat_pro", "months": 1,  "monthly": 19.99, "discount": 0.0},
    "pro_featured_6":  {"tier": "featured", "audience": "boat_pro", "months": 6,  "monthly": 19.99, "discount": 0.10},
    "pro_featured_12": {"tier": "featured", "audience": "boat_pro", "months": 12, "monthly": 19.99, "discount": 0.20},
    "pro_premium_1":   {"tier": "premium",  "audience": "boat_pro", "months": 1,  "monthly": 29.99, "discount": 0.0},
    "pro_premium_6":   {"tier": "premium",  "audience": "boat_pro", "months": 6,  "monthly": 29.99, "discount": 0.10},
    "pro_premium_12":  {"tier": "premium",  "audience": "boat_pro", "months": 12, "monthly": 29.99, "discount": 0.20},
    "sailor_premium_1":  {"tier": "premium", "audience": "sailor", "months": 1,  "monthly": 6.99, "discount": 0.0},
    "sailor_premium_3":  {"tier": "premium", "audience": "sailor", "months": 3,  "monthly": 6.99, "discount": 0.10},
    "sailor_premium_6":  {"tier": "premium", "audience": "sailor", "months": 6,  "monthly": 6.99, "discount": 0.15},
    "sailor_premium_12": {"tier": "premium", "audience": "sailor", "months": 12, "monthly": 6.99, "discount": 0.20},
    "owner_premium_1":   {"tier": "premium", "audience": "boat_owner", "months": 1,  "monthly": 6.99, "discount": 0.0},
    "owner_premium_3":   {"tier": "premium", "audience": "boat_owner", "months": 3,  "monthly": 6.99, "discount": 0.10},
    "owner_premium_6":   {"tier": "premium", "audience": "boat_owner", "months": 6,  "monthly": 6.99, "discount": 0.15},
    "owner_premium_12":  {"tier": "premium", "audience": "boat_owner", "months": 12, "monthly": 6.99, "discount": 0.20},
}


def package_total(pkg: Dict[str, Any]) -> float:
    return round(pkg["monthly"] * pkg["months"] * (1.0 - pkg["discount"]), 2)


# --- Plan-queue copy (PLAN-QUEUE-1 / RULE 1 stacking). Keep in sync with the
# web (frontend) and mobile checkout + pricing strings. No em dashes. ---
TIER_LABELS = {"basic": "Basic", "featured": "Featured", "premium": "Premium"}

# One-line pricing-page note shown on both clients.
PLAN_STACK_PRICING_LINE = "Plans stack: a new plan starts when your current one ends."


def tier_label(tier: str) -> str:
    return TIER_LABELS.get((tier or "").lower(), (tier or "").replace("_", " ").title() or "plan")


# Boat Pro tier ordering + base monthly price (RULE 2 prorated upgrade). Higher
# rank = higher tier. Sailors/owners have a single paid tier so this is Boat Pro
# only. Partner/admin grants are out of scope.
BOAT_PRO_TIER_RANK = {"basic": 1, "featured": 2, "premium": 3}
BOAT_PRO_MONTHLY = {"basic": 12.99, "featured": 19.99, "premium": 29.99}


def upgrade_checkout_msg(to_tier: str, amount: float, days: int, end: str) -> str:
    """Checkout copy for a prorated Boat Pro tier upgrade. end is YYYY-MM-DD."""
    return (f"Upgrade to {tier_label(to_tier)} now and pay only ${amount:.2f} for "
            f"the {days} days left. Your end date stays {end}.")


def stacked_checkout_msg(active_until: str, months, start: str, end: str) -> str:
    """Shown when a purchase will QUEUE behind an active plan. Dates are
    YYYY-MM-DD display strings."""
    return (f"You are set until {active_until}. Your new {months}-month plan "
            f"starts on {start} and runs to {end}.")


def queue_full_msg(tier: str, starts_on: str) -> str:
    """Shown (HTTP 409) when the user already has one queued plan (limit = 1)."""
    return (f"You already have a plan waiting. Your {tier_label(tier)} plan "
            f"starts on {starts_on}. You can add another after it starts.")


def event_has_crew_bank(ev: Dict[str, Any]) -> bool:
    """Crew Bank shows on an event ONLY when the host ticked "This is a race"
    (is_race) OR the category is Racing. Mirrors the web (lib/events.js) and
    mobile (lib/eventRules.ts) eventHasCrewBank helpers."""
    return bool(ev.get("is_race") or ev.get("category") == "racing")
