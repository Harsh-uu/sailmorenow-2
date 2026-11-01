"""Iter 94 — Org Club/Org listing: logo + photos (url+caption + legacy coercion),
partner_badge gating, admin partner-search, and clubs directory filtering.

Covers:
- GET /api/org-listing/mine (shape: photos as [{url,caption}], max_photos, is_community_partner)
- PATCH /api/org-listing with photos as list of {url,caption} AND legacy strings
  -> normalized to [{url,caption}], clamped to max (6 if CP, 1 otherwise)
- GET /api/u/{handle}: photos as [{url,caption}]; partner_badge only for CP
- GET /api/admin/partners/search returns 401 without admin, 200 with admin
"""
import os
import pytest
import requests

def _read_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    return url.rstrip("/")

BASE_URL = _read_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

# Pre-minted via mongosh (see testing credentials)
CP_TOKEN = "test_iter94_psss_1791564140750"      # pugetsoundsailingsoc (community_partner)
REG_TOKEN = "test_iter94_wtyc_1791564140753"     # whitetrashyachtclub (free partner)

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- GET /api/org-listing/mine ----------------
class TestOrgListingMine:
    def test_cp_mine_shape(self):
        r = requests.get(f"{BASE_URL}/api/org-listing/mine", headers=_auth(CP_TOKEN))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "listing" in data
        assert data["is_community_partner"] is True
        assert data["max_photos"] == 6
        # photos must be list of {url, caption}
        photos = data["listing"]["photos"]
        assert isinstance(photos, list) and len(photos) >= 1
        for p in photos:
            assert set(p.keys()) >= {"url", "caption"}
            assert isinstance(p["url"], str) and p["url"]
            assert isinstance(p["caption"], str)

    def test_regular_org_mine_shape(self):
        r = requests.get(f"{BASE_URL}/api/org-listing/mine", headers=_auth(REG_TOKEN))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_community_partner"] is False
        assert data["max_photos"] == 1
        photos = data["listing"]["photos"]
        assert isinstance(photos, list)

    def test_mine_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/org-listing/mine")
        assert r.status_code == 401


# ---------------- PATCH /api/org-listing ----------------
class TestPatchOrgListingPhotos:
    def test_cp_photos_objects_accepted_and_clamped_to_6(self):
        payload_photos = [
            {"url": f"https://example.com/p{i}.jpg", "caption": f"TEST iter94 photo {i}"}
            for i in range(8)
        ]
        r = requests.patch(f"{BASE_URL}/api/org-listing",
                           headers=_auth(CP_TOKEN),
                           json={"photos": payload_photos})
        assert r.status_code == 200, r.text
        photos = r.json()["listing"]["photos"]
        assert len(photos) == 6
        for p in photos:
            assert "url" in p and "caption" in p
        assert photos[0]["caption"] == "TEST iter94 photo 0"

    def test_cp_legacy_strings_coerced(self):
        legacy = ["https://example.com/a.jpg", "https://example.com/b.jpg"]
        r = requests.patch(f"{BASE_URL}/api/org-listing",
                           headers=_auth(CP_TOKEN),
                           json={"photos": legacy})
        assert r.status_code == 200, r.text
        photos = r.json()["listing"]["photos"]
        assert len(photos) == 2
        for p, src in zip(photos, legacy):
            assert p["url"] == src
            assert p["caption"] == ""  # legacy strings get empty caption

    def test_regular_org_photos_clamped_to_1(self):
        payload = [
            {"url": "https://example.com/one.jpg", "caption": "TEST iter94 one"},
            {"url": "https://example.com/two.jpg", "caption": "TEST iter94 two"},
            {"url": "https://example.com/three.jpg", "caption": "TEST iter94 three"},
        ]
        r = requests.patch(f"{BASE_URL}/api/org-listing",
                           headers=_auth(REG_TOKEN),
                           json={"photos": payload})
        assert r.status_code == 200, r.text
        photos = r.json()["listing"]["photos"]
        assert len(photos) == 1
        assert photos[0]["url"] == "https://example.com/one.jpg"
        assert photos[0]["caption"] == "TEST iter94 one"

    def test_cp_restore_seed_photos(self):
        """Restore the 3 seeded gallery photos so the UI parity tests see the
        same starting state as the main agent's screenshots."""
        seeded = [
            {"url": "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800",
             "caption": "Spring regatta"},
            {"url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800",
             "caption": "Clubhouse"},
            {"url": "https://images.unsplash.com/photo-1540946485063-a40da27545f8?w=800",
             "caption": ""},
        ]
        r = requests.patch(f"{BASE_URL}/api/org-listing",
                           headers=_auth(CP_TOKEN),
                           json={"photos": seeded})
        assert r.status_code == 200
        assert len(r.json()["listing"]["photos"]) == 3

    def test_regular_org_restore_empty(self):
        r = requests.patch(f"{BASE_URL}/api/org-listing",
                           headers=_auth(REG_TOKEN),
                           json={"photos": []})
        assert r.status_code == 200
        assert r.json()["listing"]["photos"] == []


# ---------------- GET /api/u/{handle} ----------------
class TestPublicProfilePhotos:
    def test_cp_has_partner_badge_and_photos_as_objects(self):
        r = requests.get(f"{BASE_URL}/api/u/pugetsoundsailingsoc")
        assert r.status_code == 200, r.text
        data = r.json()
        u = data["user"]
        assert u["partner_badge"] in ("founding", "founding_partner", "community_partner"), u.get("partner_badge")
        photos = u["photos"]
        assert isinstance(photos, list) and len(photos) >= 1
        for p in photos:
            assert isinstance(p, dict) and "url" in p and "caption" in p

    def test_regular_org_no_partner_badge(self):
        r = requests.get(f"{BASE_URL}/api/u/whitetrashyachtclub")
        assert r.status_code == 200, r.text
        data = r.json()
        u = data["user"]
        # Regular (non-CP) orgs must NOT get the partner badge
        assert not u.get("partner_badge"), f"regular org got partner_badge={u.get('partner_badge')}"
        assert u.get("account_type") == "partner"


# ---------------- GET /api/admin/partners/search ----------------
class TestAdminPartnersSearch:
    def test_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/partners/search")
        # Not authenticated at all -> 401 (per require_admin)
        assert r.status_code in (401, 403), r.text

    def test_non_admin_rejected(self):
        r = requests.get(f"{BASE_URL}/api/admin/partners/search",
                         headers=_auth(CP_TOKEN))
        assert r.status_code == 403, r.text

    def test_admin_search_returns_orgs(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/partners/search?q=puget")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "orgs" in data
        found = [o for o in data["orgs"] if o.get("handle") == "pugetsoundsailingsoc"]
        assert found, "Expected pugetsoundsailingsoc in admin partner search"
        o = found[0]
        assert o["is_community_partner"] is True
        assert "partner_badge" in o

    def test_admin_search_regular_org(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/partners/search?q=whitetrash")
        assert r.status_code == 200, r.text
        found = [o for o in r.json()["orgs"] if o.get("handle") == "whitetrashyachtclub"]
        assert found
        assert found[0]["is_community_partner"] is False


# ---------------- Admin partner designate/revoke roundtrip ----------------
class TestAdminDesignateRevoke:
    """The admin UI uses POST /api/admin/community-partner/activate to flip
    is_community_partner on an org. Verify it works both ways end-to-end."""

    def test_designate_and_revoke_regular_org(self, admin_session):
        # Look up the regular org's email
        r = admin_session.get(f"{BASE_URL}/api/admin/partners/search?q=whitetrash")
        orgs = r.json()["orgs"]
        reg = next(o for o in orgs if o["handle"] == "whitetrashyachtclub")
        email = reg["email"]

        # Activate (make CP, 1 month to keep it bounded)
        act = admin_session.post(f"{BASE_URL}/api/admin/community-partner/activate",
                                 json={"email": email, "months": 1, "activate": True})
        assert act.status_code == 200, act.text
        assert act.json()["tier"] == "community_partner"

        # Verify via search
        r2 = admin_session.get(f"{BASE_URL}/api/admin/partners/search?q=whitetrash")
        found = next(o for o in r2.json()["orgs"] if o["handle"] == "whitetrashyachtclub")
        assert found["is_community_partner"] is True

        # Verify public profile now shows partner_badge
        pr = requests.get(f"{BASE_URL}/api/u/whitetrashyachtclub")
        assert pr.json()["user"]["partner_badge"] in ("founding", "founding_partner", "community_partner")

        # Revoke
        rev = admin_session.post(f"{BASE_URL}/api/admin/community-partner/activate",
                                 json={"email": email, "months": 0, "activate": False})
        assert rev.status_code == 200, rev.text
        assert rev.json()["tier"] == "free"

        # Verify revoked state
        r3 = admin_session.get(f"{BASE_URL}/api/admin/partners/search?q=whitetrash")
        found3 = next(o for o in r3.json()["orgs"] if o["handle"] == "whitetrashyachtclub")
        assert found3["is_community_partner"] is False
        pr2 = requests.get(f"{BASE_URL}/api/u/whitetrashyachtclub")
        assert not pr2.json()["user"].get("partner_badge")
