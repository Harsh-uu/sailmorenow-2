"""Iter 92 — Backend regression for:
   1) /api/markets returns the new ORG_CATEGORIES list exactly
   2) POST /api/auth/register (partner) stores org_categories[] + org_category(first)
   3) PATCH /api/auth/profile:
        - primary_market validation (400 on invalid)
        - primary_market auto-adds to user.markets (followed)
        - org_categories (partner only) sets org_category=first; non-partner ignored
   4) GET /api/partners?category=... filters by org_categories[] membership
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

EXPECTED_ORG_CATEGORIES = [
    "Yacht club",
    "Racing Club",
    "One Design Fleet",
    "Cruising Association",
    "Membership Club",
    "Nonprofits & Youth sailing",
]

STRONG_PW = "Hunter2!pass"


def _unique_email(prefix: str) -> str:
    return f"TEST_iter92_{prefix}_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- /api/markets ----------

def test_markets_has_org_categories(session: requests.Session):
    r = session.get(f"{API}/markets")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "org_categories" in data, "markets endpoint must expose org_categories"
    assert data["org_categories"] == EXPECTED_ORG_CATEGORIES, (
        f"Expected {EXPECTED_ORG_CATEGORIES}, got {data['org_categories']}"
    )
    # existing fields still present
    for key in ("markets", "categories", "reasons"):
        assert key in data


# ---------- POST /api/auth/register (partner with org_categories) ----------

def test_register_partner_stores_org_categories(session: requests.Session):
    email = _unique_email("partner")
    cats_in = ["Yacht club", "Racing Club", "Not A Real Category"]  # last one must be filtered
    r = session.post(f"{API}/auth/register", json={
        "first_name": "Test", "last_name": "Partner",
        "email": email, "password": STRONG_PW,
        "primary_market": "Greater Seattle",
        "account_type": "partner",
        "org_name": "TEST Iter92 Org",
        "org_categories": cats_in,
        "agreed_to_guidelines": True,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("session_token"), "register must return a session token"
    user = body.get("user") or {}
    # org_categories must be filtered to taxonomy, keep order
    assert user.get("org_categories") == ["Yacht club", "Racing Club"], user.get("org_categories")
    assert user.get("org_category") == "Yacht club", user.get("org_category")
    # primary market auto-added to followed markets
    assert "Greater Seattle" in (user.get("markets") or [])


# ---------- PATCH /api/auth/profile ----------

def _register_user(session: requests.Session, account_type: str, extra: dict | None = None):
    email = _unique_email(account_type)
    payload = {
        "first_name": "Test", "last_name": "User",
        "email": email, "password": STRONG_PW,
        "primary_market": "Greater Seattle",
        "account_type": account_type,
        "agreed_to_guidelines": True,
    }
    if extra:
        payload.update(extra)
    r = session.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    return email, tok, r.json().get("user") or {}


def test_profile_patch_rejects_invalid_primary_market(session: requests.Session):
    _, tok, _ = _register_user(session, "sailor")
    r = session.patch(
        f"{API}/auth/profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"primary_market": "Atlantis"},
    )
    assert r.status_code == 400, r.text


def test_profile_patch_primary_market_autofollows(session: requests.Session):
    _, tok, user = _register_user(session, "sailor")
    # starts with Greater Seattle (both primary and followed)
    assert "Greater Seattle" in (user.get("markets") or [])
    r = session.patch(
        f"{API}/auth/profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"primary_market": "Tacoma"},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated.get("primary_market") == "Tacoma"
    # new home market auto-added to followed markets
    assert "Tacoma" in (updated.get("markets") or []), updated.get("markets")
    # previously followed market retained (addToSet does not drop old)
    assert "Greater Seattle" in (updated.get("markets") or [])


def test_profile_patch_org_categories_partner_only(session: requests.Session):
    # Partner: should set org_categories + org_category=first
    _, tok, _ = _register_user(session, "partner", extra={
        "org_name": "TEST Iter92 Patch Org",
        "org_categories": ["Yacht club"],
    })
    r = session.patch(
        f"{API}/auth/profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"org_categories": ["Membership Club", "Nonprofits & Youth sailing", "BOGUS"]},
    )
    assert r.status_code == 200, r.text
    u = r.json()
    assert u.get("org_categories") == ["Membership Club", "Nonprofits & Youth sailing"], u.get("org_categories")
    assert u.get("org_category") == "Membership Club"

    # Sailor: should NOT update org_categories (silently ignored since not partner)
    _, tok2, _ = _register_user(session, "sailor")
    r2 = session.patch(
        f"{API}/auth/profile",
        headers={"Authorization": f"Bearer {tok2}"},
        json={"org_categories": ["Yacht club"]},
    )
    assert r2.status_code == 200, r2.text
    u2 = r2.json()
    assert not u2.get("org_categories"), f"sailor should not get org_categories, got {u2.get('org_categories')}"


# ---------- GET /api/partners?category=... ----------

def test_partners_filter_by_org_categories(session: requests.Session):
    # Create a partner tagged with a specific category
    tag = "One Design Fleet"
    _, _, user = _register_user(session, "partner", extra={
        "org_name": "TEST Iter92 Filter Org",
        "org_categories": [tag, "Yacht club"],
    })
    created_uid = user.get("user_id")
    assert created_uid

    r = session.get(f"{API}/partners", params={"category": tag})
    assert r.status_code == 200, r.text
    body = r.json()
    partners = body.get("partners") or []
    # Our created partner must appear
    assert any(p.get("user_id") == created_uid for p in partners), (
        f"Created partner {created_uid} not in filtered list"
    )
    # Every partner returned must have `tag` in org_categories OR equal org_category
    for p in partners:
        cats = p.get("org_categories") or []
        assert tag in cats or p.get("org_category") == tag, (
            f"Partner {p.get('user_id')} does not match filter: cats={cats} org_category={p.get('org_category')}"
        )

    # also verify the other matching category still returns the same partner
    r2 = session.get(f"{API}/partners", params={"category": "Yacht club"})
    assert r2.status_code == 200
    uids2 = [p.get("user_id") for p in (r2.json().get("partners") or [])]
    assert created_uid in uids2
