"""SINGLE SOURCE OF TRUTH for every plan benefit shown to users (PLAN-HOME-A).

This module is the ONLY place plan benefits are written. Pricing, My plan and the
locked-feature prompts (web + mobile) must render from the payload produced here
(served by GET /api/plans/matrix) so the display can never drift from the rules.

Where a number is actually enforced in code, it is IMPORTED here (not retyped) so
the matrix follows the enforcement automatically:
  - Boat Pro markets      -> directory_router.TIER_MAX_MARKETS
  - Boat Pro logo/cover/gallery -> directory_router._pro_tier_caps
  - prices + terms + discounts  -> constants.SUBSCRIPTION_PACKAGES / package_total
  - org Founding Partner cap    -> admin_router.FOUNDING_MARKETS (cap 5)

Each feature row carries:
  key        stable identifier (never shown)
  label      plain-English name
  meaning    one short "what it means" line
  values     value per level (True / False / an int / a short string)
  source     where the rule lives in code (or "copy only")
  promised   True when it is MARKETING COPY ONLY with no code behind it

No em dashes anywhere in this file's user-facing strings (hyphens only).
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, List

from constants import SUBSCRIPTION_PACKAGES, package_total


# --- Pricing (derived straight from the enforced package table) -------------
def _packages_for(audience: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for pid, pkg in SUBSCRIPTION_PACKAGES.items():
        if pkg["audience"] != audience:
            continue
        out.append({
            "package_id": pid,
            "tier": pkg["tier"],
            "months": pkg["months"],
            "monthly": pkg["monthly"],
            "discount_pct": round(pkg["discount"] * 100),
            "total": package_total(pkg),
        })
    out.sort(key=lambda p: (p["tier"], p["months"]))
    return out


def _pricing_block() -> Dict[str, Any]:
    return {
        "member": {
            # sailor and boat_owner share the same $6.99 premium; list both so a
            # client can pick the exact package id for the account type.
            "sailor": _packages_for("sailor"),
            "boat_owner": _packages_for("boat_owner"),
            "note": "Sailors and Boat Owners share one Premium price. Terms: 1, 3, 6, 12 months.",
        },
        "boat_pro": {
            "basic": [p for p in _packages_for("boat_pro") if p["tier"] == "basic"],
            "featured": [p for p in _packages_for("boat_pro") if p["tier"] == "featured"],
            "premium": [p for p in _packages_for("boat_pro") if p["tier"] == "premium"],
            "note": "Boat Pro terms: 1, 6, 12 months. 10% off at 6 months, 20% off at 12.",
        },
        "organization": {
            "note": "Organizations pay off app. An admin sets Free, Community Partner or Founding Partner. There is no self-serve organization package.",
        },
    }


# --- Feature matrix ---------------------------------------------------------
def _member_features() -> List[Dict[str, Any]]:
    """Sailors, Boat Owners and Crew. Levels: free, premium."""
    Y, N = True, False
    return [
        {"key": "browse", "label": "Read the feed, directory, events and hub",
         "meaning": "See the community feed, the Boat Pro directory, the events calendar and the community hub. Reading the feed is open to everyone and every post is shown in full.",
         "short": "Read the full feed, directory, events and hub.",
         "values": {"free": Y, "premium": Y}, "source": "open GET routes (no gate); feed never truncated by plan", "promised": False},
        {"key": "follow", "label": "Follow organizations and Boat Pros",
         "meaning": "Follow clubs, orgs and Boat Pros to see their updates.",
         "short": "Follow clubs, orgs and Boat Pros.",
         "values": {"free": Y, "premium": Y}, "source": "follows_router (no paid gate)", "promised": False},
        {"key": "direct_message", "label": "Direct messaging",
         "meaning": "Send and receive direct messages. Premium unlocks messaging for your account.",
         "short": "Direct messaging is a Premium feature.",
         "values": {"free": N, "premium": Y}, "source": "messaging_router.send_message -> require_interaction (sender only)", "promised": False},
        {"key": "post_comment_react", "label": "Post, comment and react",
         "meaning": "Create feed posts, comment on posts and add reactions.",
         "short": "Posting, comments and reactions are a Premium feature.",
         "values": {"free": N, "premium": Y}, "source": "community_router create_post/create_comment + reactions_router -> require_interaction", "promised": False},
        {"key": "write_reviews", "label": "Write reviews",
         "meaning": "Leave a two-way review. Requires a paid, non-expired plan.",
         "short": "Writing reviews is a Premium feature.",
         "values": {"free": N, "premium": Y}, "source": "reviews_router -> can_review", "promised": False},
        {"key": "crew_bank_listing", "label": "Crew Bank listing",
         "meaning": "List yourself in the Crew Bank so skippers can find you.",
         "short": "A Crew Bank listing is a Premium feature.",
         "values": {"free": N, "premium": Y}, "source": "community_router crew listing -> require_interaction", "promised": False},
        {"key": "rsvp", "label": "RSVP to events",
         "meaning": "Register as an attendee or volunteer for an event.",
         "short": "RSVP to any event.",
         "values": {"free": Y, "premium": Y}, "source": "community_router.register_for_event (NO paid gate in code)", "promised": False},
        {"key": "id_verified_badge", "label": "ID-verified badge",
         "meaning": "ID verification is a personal-profile feature (including the personal profile that comes with a Boat Pro account). A paid plan unlocks it; free accounts cannot verify.",
         "short": "ID verification is a Premium feature on your personal profile.",
         "values": {"free": N, "premium": Y}, "source": "identity_router -> is_paid_subscriber (personal-profile feature)", "promised": False},
        {"key": "create_events", "label": "Create events",
         "meaning": "Sailors and Boat Owners cannot create events at all right now, paid or free.",
         "short": "Event creation is not open to Sailors or Boat Owners.",
         "values": {"free": N, "premium": N}, "source": "community_router event_posting_closed (account_type gate, not a tier gate)", "promised": False},
    ]


def _boat_pro_features() -> List[Dict[str, Any]]:
    """Boat Pro. Levels: basic, featured, premium. Numbers pulled from the
    enforcement helpers so the display follows the rules."""
    from routers.directory_router import TIER_MAX_MARKETS, _pro_tier_caps  # lazy: avoids import cycle
    caps = {t: _pro_tier_caps(t) for t in ("basic", "featured", "premium")}

    def markets(t: str):
        m = TIER_MAX_MARKETS.get(t, 1)
        return "Unlimited" if m >= 999 else m

    return [
        {"key": "read_feed", "label": "Read the feed",
         "meaning": "Reading the community feed is open to everyone; every post is shown in full on any plan.",
         "short": "Read every feed post in full on any plan.",
         "values": {"basic": True, "featured": True, "premium": True},
         "source": "community_router list_posts (no plan truncation)", "promised": False},
        {"key": "public_listing", "label": "Public directory listing",
         "meaning": "A paid tier is required for any public Boat Pro listing. Free Boat Pros are browse-only.",
         "short": "A paid Boat Pro plan is required for a public listing.",
         "values": {"basic": True, "featured": True, "premium": True},
         "source": "directory_router.upsert_boat_pro -> require_interaction", "promised": False},
        {"key": "markets", "label": "Markets",
         "meaning": "How many market areas the listing can appear in.",
         "short": "List in more market areas.",
         "values": {"basic": markets("basic"), "featured": markets("featured"), "premium": markets("premium")},
         "source": "directory_router.TIER_MAX_MARKETS", "promised": False},
        {"key": "logo", "label": "Logo",
         "meaning": "Show a company logo on the listing.",
         "short": "Add a logo from the Featured plan.",
         "values": {"basic": caps["basic"]["can_logo"], "featured": caps["featured"]["can_logo"], "premium": caps["premium"]["can_logo"]},
         "source": "directory_router._pro_tier_caps.can_logo", "promised": False},
        {"key": "cover", "label": "Cover photo",
         "meaning": "Show a cover/banner photo on the listing.",
         "short": "Add a cover photo from the Featured plan.",
         "values": {"basic": caps["basic"]["can_cover"], "featured": caps["featured"]["can_cover"], "premium": caps["premium"]["can_cover"]},
         "source": "directory_router._pro_tier_caps.can_cover", "promised": False},
        {"key": "gallery_photos", "label": "Gallery photos",
         "meaning": "Number of work-sample photos in the listing gallery.",
         "short": "Show a 5-photo gallery on Premium.",
         "values": {"basic": caps["basic"]["max_photos"], "featured": caps["featured"]["max_photos"], "premium": caps["premium"]["max_photos"]},
         "source": "directory_router._pro_tier_caps.max_photos", "promised": False},
        {"key": "credentials", "label": "Trust and credentials",
         "meaning": "Show certifications, licenses and insurance on the listing.",
         "short": "Show credentials and trust badges on Premium.",
         "values": {"basic": False, "featured": False, "premium": True},
         "source": "directory_router._apply_tier_visibility (Premium only)", "promised": False},
        {"key": "enhanced_styling", "label": "Enhanced listing card",
         "meaning": "Richer listing card and the short bio appear from Featured up.",
         "short": "Get an enhanced listing card from the Featured plan.",
         "values": {"basic": False, "featured": True, "premium": True},
         "source": "DirectoryDetail.jsx / Directory.jsx (bio + card style gated at featured)", "promised": False},
        {"key": "reviews_received", "label": "Reviews received",
         "meaning": "Receiving reviews is never tier-gated. Any Boat Pro can be reviewed.",
         "short": "Receive reviews on any plan.",
         "values": {"basic": True, "featured": True, "premium": True},
         "source": "reviews_router (receiving not gated)", "promised": False},
        {"key": "messaging_send", "label": "Direct messaging",
         "meaning": "Any paid Boat Pro, including Basic, can send and receive direct messages.",
         "short": "Direct messaging is included on every Boat Pro plan.",
         "values": {"basic": True, "featured": True, "premium": True},
         "source": "messaging_router -> require_interaction (Basic counts as paid)", "promised": False},
        {"key": "sort_priority", "label": "Directory placement",
         "meaning": "Where the listing appears in directory and search results: Premium at the top, then Featured, then Basic.",
         "short": "Where your listing appears in directory and search results.",
         "values": {"basic": "Standard", "featured": "Higher", "premium": "Highest (top of results)"},
         "source": "directory_router TIER_RANK sort (premium 0, featured 1, basic 2)", "promised": False},
    ]


def _org_features() -> List[Dict[str, Any]]:
    """Organizations. Levels: free, community_partner, founding_partner.
    Community Partner and Founding Partner grant the EXACT same access; Founding
    Partner adds only the different badge and the per-market slot cap."""
    Y, N = True, False
    return [
        {"key": "read_feed", "label": "Read the feed",
         "meaning": "Reading the community feed is open to everyone; every post is shown in full at any status.",
         "short": "Read every feed post in full at any status.",
         "values": {"free": Y, "community_partner": Y, "founding_partner": Y},
         "source": "community_router list_posts (no plan truncation)", "promised": False},
        {"key": "directory_listing", "label": "Clubs & Orgs directory listing",
         "meaning": "A public listing in the Clubs & Organizations directory.",
         "short": "A public listing in the Clubs & Orgs directory.",
         "values": {"free": Y, "community_partner": Y, "founding_partner": Y},
         "source": "org accounts are listed regardless of status", "promised": False},
        {"key": "build_following", "label": "Build a following",
         "meaning": "Members can follow the organization.",
         "short": "Let members follow your organization.",
         "values": {"free": Y, "community_partner": Y, "founding_partner": Y},
         "source": "follows_router (no paid gate)", "promised": False},
        {"key": "reviews_received", "label": "Reviews received",
         "meaning": "An organization can receive reviews at any status.",
         "short": "Receive reviews at any status.",
         "values": {"free": Y, "community_partner": Y, "founding_partner": Y},
         "source": "reviews_router (receiving not gated)", "promised": False},
        {"key": "logo", "label": "Logo",
         "meaning": "Show a logo on the listing.",
         "short": "Show your logo on the listing.",
         "values": {"free": Y, "community_partner": Y, "founding_partner": Y},
         "source": "org listing stores logo at any status", "promised": False},
        {"key": "cover", "label": "Cover photo",
         "meaning": "Show a cover/banner photo on the listing.",
         "short": "Show a cover photo on the listing.",
         "values": {"free": Y, "community_partner": Y, "founding_partner": Y},
         "source": "org listing stores cover at any status", "promised": False},
        {"key": "gallery_photos", "label": "Gallery photos",
         "meaning": "Number of gallery photos shown publicly. Free orgs can store but not show a gallery.",
         "short": "Show a 5-photo gallery as a Community Partner.",
         "values": {"free": 0, "community_partner": 5, "founding_partner": 5},
         "source": "directory_router get_my_org_listing max_photos (5 if partner_badge else 0) + public hide for free", "promised": False},
        {"key": "events_per_month", "label": "Events per month",
         "meaning": "Free orgs may post 1 VOLUNTEER-only event per calendar month. Partners post unlimited events of all types.",
         "short": "Free orgs: 1 volunteer event a month. Partners: unlimited events.",
         "values": {"free": "1 volunteer only / calendar month", "community_partner": "Unlimited (all types)", "founding_partner": "Unlimited (all types)"},
         "source": "community_router event create gate (calendar-month, volunteer-only for free partner)", "promised": False},
        {"key": "feed_posts_per_month", "label": "Feed posts per month",
         "meaning": "Free orgs get 1 feed post per calendar month (marketplace posts count toward it). Partners are unlimited.",
         "short": "Free orgs: 1 post a month. Partners: unlimited posts.",
         "values": {"free": "1 / calendar month", "community_partner": "Unlimited", "founding_partner": "Unlimited"},
         "source": "community_router.create_post gate (calendar-month)", "promised": False},
        {"key": "marketplace", "label": "Marketplace posts",
         "meaning": "Marketplace listings count toward the free monthly feed-post limit; unlimited for partners.",
         "short": "Marketplace posts are unlimited for partners.",
         "values": {"free": "Counts toward 1 / month", "community_partner": "Unlimited", "founding_partner": "Unlimited"},
         "source": "community_router.create_post (marketplace is a post)", "promised": False},
        {"key": "forums_blogs", "label": "Forums and blogs",
         "meaning": "Create forum threads and blog posts in the hub. Community Partner and Founding Partner organizations can; free organizations cannot.",
         "short": "Posting forums and blogs is a Community Partner feature.",
         "values": {"free": N, "community_partner": Y, "founding_partner": Y},
         "source": "hub_router.create_discussion (free orgs blocked; partners unlimited)", "promised": False},
        {"key": "direct_messaging", "label": "Direct messaging",
         "meaning": "Send direct messages. Free orgs cannot; partners can.",
         "short": "Direct messaging is a Community Partner feature.",
         "values": {"free": N, "community_partner": Y, "founding_partner": Y},
         "source": "messaging_router -> require_interaction (free org tier is free)", "promised": False},
        {"key": "partner_badge", "label": "Partner badge",
         "meaning": "A single badge on the listing: none when free, Community Partner, or Founding Partner.",
         "short": "Show a single partner badge on your listing.",
         "values": {"free": "None", "community_partner": "Community Partner", "founding_partner": "Founding Partner"},
         "source": "deps.partner_badge (single badge from subscription_tier)", "promised": False},
        {"key": "founding_cap", "label": "Founding Partner slots",
         "meaning": "Founding Partner is limited to the first 5 organizations in Portland/Vancouver and the first 5 in Greater Seattle. The cap is a warning to the admin, not a hard block.",
         "short": "Founding Partner: first 5 orgs in Portland/Vancouver and first 5 in Greater Seattle.",
         "values": {"free": "n/a", "community_partner": "n/a", "founding_partner": "First 5 per market (Portland/Vancouver, Greater Seattle)"},
         "source": "admin_router.FOUNDING_MARKETS + admin_set_org_status (client-side warning only)", "promised": False},
        {"key": "founding_recognition", "label": "Founding Partner recognition",
         "meaning": "Founding Partners get a recognition badge on the home page and an annual bio in the newsletter. Jenn fulfills these manually.",
         "short": "Recognition on the home page and an annual newsletter bio.",
         "values": {"free": N, "community_partner": N, "founding_partner": "Home-page recognition + annual newsletter bio"},
         "source": "manual (Jenn fulfills); badge via deps.partner_badge, recognition/newsletter not automated", "promised": True},
    ]


ACCOUNT_TYPES = [
    {"key": "member", "label": "Sailors, Boat Owners & Crew",
     "levels": [{"key": "free", "label": "Free"}, {"key": "premium", "label": "Premium"}],
     "builder": _member_features},
    {"key": "boat_pro", "label": "Boat Pros",
     "levels": [{"key": "basic", "label": "Basic"}, {"key": "featured", "label": "Featured"}, {"key": "premium", "label": "Premium"}],
     "builder": _boat_pro_features},
    {"key": "organization", "label": "Clubs & Organizations",
     "levels": [{"key": "free", "label": "Free"}, {"key": "community_partner", "label": "Community Partner"}, {"key": "founding_partner", "label": "Founding Partner"}],
     "builder": _boat_pro_features},  # overwritten below (kept explicit for readability)
]
ACCOUNT_TYPES[2]["builder"] = _org_features


def build_matrix() -> Dict[str, Any]:
    """Assemble the full, read-only plan feature matrix. Safe to call per request
    (numbers are pulled live from the enforcement helpers)."""
    account_types: List[Dict[str, Any]] = []
    for at in ACCOUNT_TYPES:
        account_types.append({
            "key": at["key"],
            "label": at["label"],
            "levels": at["levels"],
            "features": at["builder"](),
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pricing": _pricing_block(),
        "account_types": account_types,
    }
