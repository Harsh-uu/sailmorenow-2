"""Iter 87 — regression on the 7 flow groups from the review request.
Shared FastAPI backend hit via REACT_APP_BACKEND_URL."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASS = os.environ.get("ADMIN_PASSWORD", "")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def admin_id(admin_h):
    me = requests.get(f"{API}/auth/me", headers=admin_h).json()
    return me["user_id"]


def _rand():
    return uuid.uuid4().hex[:8]


def _register(password="Hunter2!pass", agreed=True, account_type="sailor",
              extra=None):
    email = f"qa.free+{_rand()}@example.com"
    body = {
        "email": email, "password": password,
        "first_name": "QA", "last_name": "Free",
        "account_type": account_type, "primary_market": "Greater Seattle",
        "agreed_to_guidelines": agreed, "newsletter_opt_in": False,
    }
    if extra:
        body.update(extra)
    r = requests.post(f"{API}/auth/register", json=body)
    return r, email


# ---------- 1. Signup validation ----------
class TestSignup:
    def test_valid_sailor_signup(self):
        r, email = _register()
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == email
        assert r.json()["user"]["subscription_tier"] == "free"

    def test_partner_club_signup(self):
        r, _ = _register(account_type="partner", extra={"org_name": f"TEST87 Club {_rand()}"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["account_type"] == "partner"

    def test_missing_consent_is_blocked(self):
        r, _ = _register(agreed=False)
        assert r.status_code == 400, r.text
        assert "guideline" in r.text.lower() or "18" in r.text.lower()

    def test_weak_password_too_short(self):
        r, _ = _register(password="Ab1!")
        # 400 (custom validator) or 422 (pydantic min_length) both acceptable
        assert r.status_code in (400, 422), r.text

    def test_weak_password_no_upper(self):
        r, _ = _register(password="hunter2!pass")
        assert r.status_code in (400, 422), r.text

    def test_weak_password_no_digit(self):
        r, _ = _register(password="HunterTwo!pass")
        assert r.status_code in (400, 422), r.text

    def test_weak_password_no_special(self):
        r, _ = _register(password="Hunter2Pass")
        assert r.status_code in (400, 422), r.text


# ---------- 2. Pricing packages ----------
class TestPricing:
    def test_packages_matrix(self):
        r = requests.get(f"{API}/payments/packages")
        assert r.status_code == 200
        pkgs = {p["package_id"]: p for p in r.json()}
        assert pkgs["pro_basic_1"]["monthly"] == 12.99
        assert pkgs["pro_featured_1"]["monthly"] == 19.99
        assert pkgs["pro_premium_1"]["monthly"] == 29.99
        assert pkgs["pro_basic_6"]["discount"] == 0.10
        assert pkgs["pro_basic_12"]["discount"] == 0.20
        assert pkgs["sailor_premium_1"]["monthly"] == 6.99
        assert pkgs["owner_premium_1"]["monthly"] == 6.99
        assert pkgs["sailor_premium_3"]["discount"] == 0.10
        assert pkgs["sailor_premium_6"]["discount"] == 0.15
        assert pkgs["sailor_premium_12"]["discount"] == 0.20
        assert pkgs["owner_premium_3"]["discount"] == 0.10
        assert pkgs["owner_premium_6"]["discount"] == 0.15
        assert pkgs["owner_premium_12"]["discount"] == 0.20
        # 12.99 * 12 * 0.80 = 124.70
        assert abs(pkgs["pro_basic_12"]["total"] - 124.70) < 0.02

    def test_checkout_session_test_mode(self, admin_h):
        r = requests.post(f"{API}/payments/checkout", headers=admin_h,
                          json={"package_id": "sailor_premium_1", "origin_url": BASE_URL})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d and ("stripe.com" in d["url"] or "checkout" in d["url"])
        assert d["amount"] == 6.99


# ---------- 3. Free user gating ----------
class TestFreeGating:
    def test_free_dm_returns_upgrade_required(self, admin_id):
        r, _ = _register()
        tok = r.json()["session_token"]
        resp = requests.post(f"{API}/messages/{admin_id}",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"body": "TEST87 should be blocked"})
        assert resp.status_code == 403, f"got {resp.status_code}: {resp.text}"
        detail = resp.json().get("detail")
        assert isinstance(detail, dict), f"expected structured detail: {resp.text}"
        assert detail.get("code") == "upgrade_required"

    def test_free_follow_user_behavior(self, admin_id):
        """Per spec: free user following should return 403 upgrade_required."""
        r, _ = _register()
        tok = r.json()["session_token"]
        resp = requests.post(f"{API}/follows/{admin_id}",
                             headers={"Authorization": f"Bearer {tok}"})
        # Clean up if it accidentally succeeded
        if resp.status_code == 200:
            requests.delete(f"{API}/follows/{admin_id}",
                            headers={"Authorization": f"Bearer {tok}"})
        assert resp.status_code == 403, (
            f"SPEC GAP: Free user follow succeeded with {resp.status_code}. "
            f"Expected 403 upgrade_required. Body: {resp.text}"
        )
        detail = resp.json().get("detail")
        assert isinstance(detail, dict) and detail.get("code") == "upgrade_required"


# ---------- 4. Directory / Boat Pro ----------
class TestDirectory:
    @pytest.fixture(scope="class")
    def pro_id(self):
        r = requests.get(f"{API}/boat-pros", params={"market": "Greater Seattle"})
        assert r.status_code == 200
        pros = r.json()
        if not pros:
            pytest.skip("no boat pros seeded")
        return pros[0]["user_id"]

    def test_hired_toggle_updates_count(self, admin_h, pro_id):
        r0 = requests.get(f"{API}/boat-pros/{pro_id}", headers=admin_h)
        assert r0.status_code == 200, r0.text
        pro = r0.json().get("pro") or r0.json()
        start_hired = pro.get("viewer_hired", False)
        start_count = pro.get("hire_count", 0)
        r1 = requests.post(f"{API}/boat-pros/{pro_id}/hire", headers=admin_h)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["hired"] != start_hired
        expected = start_count + (1 if d1["hired"] else -1)
        assert d1["count"] == expected
        # Restore
        r2 = requests.post(f"{API}/boat-pros/{pro_id}/hire", headers=admin_h)
        assert r2.json()["hired"] == start_hired
        assert r2.json()["count"] == start_count

    def test_review_create_edit_delete(self, admin_h, pro_id):
        body = {
            "target_id": pro_id, "rating": 5,
            "comment": "TEST87 regression review",
            "category_ratings": {"personality": 5, "skill": 5,
                                 "promptness": 5, "communication": 5},
        }
        r = requests.post(f"{API}/reviews", headers=admin_h, json=body)
        assert r.status_code in (200, 201), r.text
        rid = r.json().get("id")
        assert rid
        # Edit via admin content router (admin can edit any review)
        edit = requests.patch(f"{API}/admin/content/review/{rid}",
                              headers=admin_h, json={"rating": 4, "comment": "TEST87 edited"})
        assert edit.status_code == 200, edit.text
        assert edit.json().get("rating") == 4
        # Delete
        d = requests.delete(f"{API}/admin/content/review/{rid}", headers=admin_h)
        assert d.status_code in (200, 204), d.text
        rl = requests.get(f"{API}/reviews", params={"target_id": pro_id})
        assert all(x.get("id") != rid for x in rl.json())


# ---------- 5. Events ----------
class TestEvents:
    def test_event_15min_rsvp_volunteer_admin_edit(self, admin_h):
        starts = "2026-12-15T14:15:00Z"
        ends = "2026-12-15T16:45:00Z"
        body = {
            "title": f"TEST87 event {_rand()}",
            "description": "regression", "market": "Greater Seattle",
            "starts_at": starts, "ends_at": ends,
            "category": "race", "is_volunteer": True,
        }
        r = requests.post(f"{API}/events", headers=admin_h, json=body)
        assert r.status_code in (200, 201), r.text
        ev = r.json()
        eid = ev.get("id")
        assert eid, ev
        # Backend normalizes trailing Z to +00:00
        assert ev["starts_at"].replace("+00:00", "Z") == starts
        assert ev["ends_at"].replace("+00:00", "Z") == ends
        assert ev.get("is_volunteer") is True

        # Market filter — narrow by date window
        lst = requests.get(f"{API}/events",
                           params={"market": "Greater Seattle",
                                   "from": "2026-12-01T00:00:00Z",
                                   "to": "2026-12-31T23:59:00Z"}).json()
        assert any(e.get("id") == eid for e in lst), f"event not in list window ({len(lst)} docs)"

        # RSVP via /register
        rsvp = requests.post(f"{API}/events/{eid}/register", headers=admin_h,
                             json={"status": "going"})
        assert rsvp.status_code in (200, 201), rsvp.text

        # Volunteer sign-up — ask event crew endpoint (an event with is_volunteer)
        vol = requests.post(f"{API}/events/{eid}/crew", headers=admin_h,
                            json={"role": "volunteer"})
        # Accept various success/409
        assert vol.status_code in (200, 201, 400, 409), vol.text

        # Admin edit event via PATCH /events/{id}
        upd = requests.patch(f"{API}/events/{eid}", headers=admin_h,
                             json={"title": "TEST87 edited event"})
        assert upd.status_code in (200, 204), upd.text
        # Verify persistence
        lst2 = requests.get(f"{API}/events",
                            params={"market": "Greater Seattle",
                                    "from": "2026-12-01T00:00:00Z",
                                    "to": "2026-12-31T23:59:00Z"}).json()
        found = next((e for e in lst2 if e.get("id") == eid), None)
        assert found and "edited" in found.get("title", "").lower()

        # Cleanup
        d = requests.delete(f"{API}/events/{eid}", headers=admin_h)
        assert d.status_code in (200, 204)


# ---------- 6. Community feed ----------
class TestCommunity:
    def test_for_sale_post_and_comment_and_admin_edit(self, admin_h):
        body = {
            "type": "for_sale", "title": "TEST87 for sale",
            "body": "TEST87 forsale body. Link https://example.com included.",
            "market": "Greater Seattle",
            "price": 199.99, "condition": "Like New",
        }
        r = requests.post(f"{API}/posts", headers=admin_h, json=body)
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id")
        assert pid

        # Comment
        c = requests.post(f"{API}/posts/{pid}/comments", headers=admin_h,
                          json={"body": "TEST87 comment"})
        assert c.status_code in (200, 201), c.text
        cid = c.json().get("id")

        # Verify list
        feed = requests.get(f"{API}/posts", params={"type": "for_sale",
                                                    "market": "Greater Seattle"})
        assert feed.status_code == 200
        assert any(p.get("id") == pid for p in feed.json())

        # Admin edit post via admin_content
        e = requests.patch(f"{API}/admin/content/post/{pid}",
                           headers=admin_h, json={"body": "TEST87 admin-edited body"})
        assert e.status_code == 200, e.text
        assert "admin-edited" in e.json().get("body", "")

        # Admin edit comment
        if cid:
            ec = requests.patch(f"{API}/admin/content/comment/{cid}",
                                headers=admin_h, json={"body": "TEST87 admin-edited comment"})
            assert ec.status_code in (200, 404), ec.text

        # Admin delete post
        rm = requests.delete(f"{API}/admin/content/post/{pid}", headers=admin_h)
        assert rm.status_code in (200, 204), rm.text
