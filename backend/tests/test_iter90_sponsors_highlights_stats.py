"""Iter 90 — sponsors CRUD, review highlights, stats seeking-crew field."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    data = r.json()
    tok = data.get("session_token") or data.get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def admin_hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def unauth():
    return {}


# ----- stats/public -----
class TestPublicStats:
    def test_includes_sailors_seeking_crew(self):
        r = requests.get(f"{BASE}/api/stats/public")
        assert r.status_code == 200
        j = r.json()
        assert "sailors_seeking_crew" in j, f"missing sailors_seeking_crew; keys={list(j)}"
        assert isinstance(j["sailors_seeking_crew"], int)
        assert j["sailors_seeking_crew"] >= 0


# ----- review-highlights -----
class TestReviewHighlights:
    def test_review_highlights_returns_list(self):
        r = requests.get(f"{BASE}/api/review-highlights")
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j, list)

    def test_review_highlights_only_4plus_with_comment(self):
        r = requests.get(f"{BASE}/api/review-highlights")
        j = r.json()
        for item in j:
            # Items from reviews collection have `rating`; testimonial fallbacks may not
            if "rating" in item and item.get("rating") is not None:
                assert item["rating"] >= 4
            assert "quote" in item and item["quote"]
            assert "attribution" in item
            assert "market" in item


# ----- sponsors -----
class TestSponsorsAccess:
    def test_public_list_ok(self):
        r = requests.get(f"{BASE}/api/sponsors")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_list_requires_auth(self):
        r = requests.get(f"{BASE}/api/admin/sponsors")
        assert r.status_code in (401, 403)

    def test_admin_create_requires_auth(self):
        r = requests.post(f"{BASE}/api/admin/sponsors", json={"image_url": "https://x", "link_url": "https://y"})
        assert r.status_code in (401, 403)


class TestSponsorsAdminCRUD:
    created_id = None

    def test_create_requires_image_and_link(self, admin_hdr):
        r = requests.post(f"{BASE}/api/admin/sponsors", json={"name": "TEST_x"}, headers=admin_hdr)
        assert r.status_code == 400

    def test_create_ok(self, admin_hdr):
        payload = {
            "image_url": "https://picsum.photos/400/120?test90a",
            "link_url": "https://example.com/sponsor-a",
            "name": "TEST_Iter90_SponsorA",
            "active": True,
        }
        r = requests.post(f"{BASE}/api/admin/sponsors", json=payload, headers=admin_hdr)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["id"]
        assert j["image_url"] == payload["image_url"]
        assert j["link_url"] == payload["link_url"]
        assert j["active"] is True
        TestSponsorsAdminCRUD.created_id = j["id"]

    def test_appears_in_public(self, admin_hdr):
        assert TestSponsorsAdminCRUD.created_id
        r = requests.get(f"{BASE}/api/sponsors")
        ids = [s["id"] for s in r.json()]
        assert TestSponsorsAdminCRUD.created_id in ids

    def test_patch_deactivate(self, admin_hdr):
        sid = TestSponsorsAdminCRUD.created_id
        r = requests.patch(f"{BASE}/api/admin/sponsors/{sid}", json={"active": False}, headers=admin_hdr)
        assert r.status_code == 200, r.text
        assert r.json()["active"] is False
        # verify hidden from public
        pub = requests.get(f"{BASE}/api/sponsors").json()
        assert sid not in [s["id"] for s in pub]

    def test_delete(self, admin_hdr):
        sid = TestSponsorsAdminCRUD.created_id
        r = requests.delete(f"{BASE}/api/admin/sponsors/{sid}", headers=admin_hdr)
        assert r.status_code == 200
        # 404 on patch after delete
        r2 = requests.patch(f"{BASE}/api/admin/sponsors/{sid}", json={"active": True}, headers=admin_hdr)
        assert r2.status_code == 404
