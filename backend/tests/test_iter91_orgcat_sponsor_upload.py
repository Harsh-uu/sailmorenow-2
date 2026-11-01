"""Iter 91 — org_categories, /api/partners?category=..., sponsor image upload."""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
EXPECTED_ORG_CATS = [
    "Yacht club",
    "Racing Club",
    "One Design Fleet",
    "Cruising Association",
    "Membership Club",
    "Nonprofits & Youth sailing",
]


@pytest.fixture(scope="session")
def admin_token():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("session_token") or data.get("token")
    assert token
    return token


@pytest.fixture
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}"})
    return s


# --- markets endpoint returns org_categories ---
def test_markets_includes_org_categories():
    r = requests.get(f"{BASE_URL}/api/markets")
    assert r.status_code == 200
    j = r.json()
    assert "org_categories" in j
    assert j["org_categories"] == EXPECTED_ORG_CATS


# --- partners endpoint supports org_category filter ---
def test_partners_no_category_returns_all_with_org_category_field():
    r = requests.get(f"{BASE_URL}/api/partners")
    assert r.status_code == 200
    j = r.json()
    assert "partners" in j and isinstance(j["partners"], list)
    assert j["count"] == len(j["partners"])
    # Each partner should at least carry the org_category key (may be None/absent for some legacy)
    # At least one org should have org_category set
    with_cat = [p for p in j["partners"] if p.get("org_category")]
    assert len(with_cat) > 0, "Expected at least some partners to have org_category backfilled"


def test_partners_filter_yacht_clubs():
    r = requests.get(f"{BASE_URL}/api/partners", params={"category": "Yacht club"})
    assert r.status_code == 200
    partners = r.json()["partners"]
    assert len(partners) > 0, "Expected at least one Yacht club partner"
    for p in partners:
        cats = p.get("org_categories") or ([p.get("org_category")] if p.get("org_category") else [])
        assert "Yacht club" in cats, f"Partner {p.get('name')} has {cats}"


def test_partners_filter_unknown_category_empty():
    r = requests.get(f"{BASE_URL}/api/partners", params={"category": "Zzz Not A Category"})
    assert r.status_code == 200
    assert r.json()["partners"] == []


def test_partners_market_filter_still_works():
    r = requests.get(f"{BASE_URL}/api/partners", params={"market": "Greater Seattle"})
    assert r.status_code == 200
    partners = r.json()["partners"]
    # All returned should match market (primary_market or markets list)
    for p in partners:
        in_primary = p.get("primary_market") == "Greater Seattle"
        in_markets = "Greater Seattle" in (p.get("markets") or [])
        assert in_primary or in_markets, f"{p.get('name')} not in Greater Seattle"


# --- sponsor image upload ---
def _tiny_png_bytes():
    # 1x1 PNG
    return bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
        "890000000D49444154789C6360000000000500010D0A2DB40000000049454E44AE426082"
    )


def test_sponsor_upload_requires_auth():
    r = requests.post(f"{BASE_URL}/api/admin/sponsors/upload-image",
                       files={"file": ("x.png", _tiny_png_bytes(), "image/png")})
    assert r.status_code == 403


def test_sponsor_upload_non_admin_rejected():
    # Try with a brand new user
    s = requests.Session()
    email = f"TEST_iter91_user+{os.urandom(3).hex()}@example.com"
    reg = s.post(f"{BASE_URL}/api/auth/register", json={
        "first_name": "Iter", "last_name": "NinetyOne", "email": email,
        "password": "Hunter2!pass", "account_type": "sailor",
        "primary_market": "Greater Seattle", "agreed_to_guidelines": True,
    })
    if reg.status_code not in (200, 201):
        pytest.skip(f"register failed: {reg.status_code} {reg.text}")
    tok = reg.json().get("session_token") or reg.json().get("token")
    r = requests.post(f"{BASE_URL}/api/admin/sponsors/upload-image",
                      headers={"Authorization": f"Bearer {tok}"},
                      files={"file": ("x.png", _tiny_png_bytes(), "image/png")})
    assert r.status_code == 403


def test_sponsor_upload_admin_success_and_file_served(admin_client):
    files = {"file": ("iter91.png", _tiny_png_bytes(), "image/png")}
    r = admin_client.post(f"{BASE_URL}/api/admin/sponsors/upload-image", files=files)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert "image_url" in data
    url = data["image_url"]
    assert url.startswith("/api/files/"), f"unexpected url: {url}"
    # Verify served via /api/files/{path}
    full = f"{BASE_URL}{url}"
    served = requests.get(full)
    assert served.status_code == 200
    assert served.headers.get("content-type", "").startswith("image/")
    assert len(served.content) > 0


def test_sponsor_create_with_uploaded_image_appears_in_public(admin_client):
    # Upload
    up = admin_client.post(
        f"{BASE_URL}/api/admin/sponsors/upload-image",
        files={"file": ("iter91b.png", _tiny_png_bytes(), "image/png")},
    )
    assert up.status_code == 200
    img_url = up.json()["image_url"]

    # Create sponsor
    payload = {
        "name": "TEST_Iter91_Sponsor",
        "image_url": img_url,
        "link_url": "https://example.com/iter91",
        "active": True,
    }
    cr = admin_client.post(f"{BASE_URL}/api/admin/sponsors", json=payload)
    assert cr.status_code in (200, 201), f"{cr.status_code} {cr.text}"
    sponsor = cr.json()
    sid = sponsor.get("id")
    assert sid

    try:
        # Public GET /api/sponsors should include it
        pub = requests.get(f"{BASE_URL}/api/sponsors")
        assert pub.status_code == 200
        items = pub.json() if isinstance(pub.json(), list) else pub.json().get("sponsors", [])
        ids = [s.get("id") for s in items]
        assert sid in ids
        found = next(s for s in items if s.get("id") == sid)
        assert found["image_url"] == img_url
        assert found["link_url"] == payload["link_url"]
    finally:
        # cleanup
        admin_client.delete(f"{BASE_URL}/api/admin/sponsors/{sid}")
