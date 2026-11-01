"""Iter 83 — bulk event contact edit, moderation restore/remove, follow suggestions."""
import os, uuid, time
import pytest
import requests

def _load_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        # Fallback to frontend .env
        try:
            for line in open("/app/frontend/.env"):
                if line.strip().startswith("REACT_APP_BACKEND_URL="):
                    v = line.strip().split("=", 1)[1].strip().strip('"')
                    break
        except Exception:
            pass
    assert v, "REACT_APP_BACKEND_URL missing"
    return v.rstrip("/")

BASE = _load_base()
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "")


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    email = f"iter83_user_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{BASE}/api/auth/register", json={
        "email": email, "password": "pw12345678", "name": "Iter83 Reporter",
        "first_name": "Iter", "last_name": "Reporter",
        "account_type": "sailor", "primary_market": "Greater Seattle",
    }, timeout=45)
    assert r.status_code in (200, 201), r.text
    return s, email


# -------- Bulk event contact --------
class TestBulkEventContact:
    def test_bulk_update_two_events(self, admin_session):
        r = admin_session.get(f"{BASE}/api/admin/events", timeout=15)
        assert r.status_code == 200
        events = r.json()
        agg = [e for e in events if (e.get("source") == "aggregator")][:2]
        if len(agg) < 2:
            pytest.skip("Need 2 aggregator events")
        ids = [e["id"] for e in agg]
        new_name = f"TEST83 Bulk Organizer {uuid.uuid4().hex[:6]}"
        new_email = f"test83bulk_{uuid.uuid4().hex[:6]}@example.com"
        r = admin_session.patch(f"{BASE}/api/admin/events/bulk",
                                json={"event_ids": ids, "organizer_name": new_name, "organizer_email": new_email},
                                timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True and j["updated"] >= 2
        # Verify by GET
        r2 = admin_session.get(f"{BASE}/api/admin/events", timeout=15)
        after = {e["id"]: e for e in r2.json()}
        for eid in ids:
            assert after[eid]["organizer_name"] == new_name
            assert after[eid]["organizer_email"] == new_email

    def test_bulk_requires_field(self, admin_session):
        r = admin_session.patch(f"{BASE}/api/admin/events/bulk",
                                json={"event_ids": ["x"]}, timeout=15)
        assert r.status_code == 400

    def test_bulk_requires_ids(self, admin_session):
        r = admin_session.patch(f"{BASE}/api/admin/events/bulk",
                                json={"event_ids": [], "organizer_name": "x"}, timeout=15)
        assert r.status_code == 400

    def test_bulk_admin_only(self, user_session):
        s, _ = user_session
        r = s.patch(f"{BASE}/api/admin/events/bulk",
                    json={"event_ids": ["x"], "organizer_name": "y"}, timeout=15)
        assert r.status_code in (401, 403)


# -------- Moderation restore/remove --------
class TestModerationRestoreRemove:
    def _create_post(self, s):
        r = s.post(f"{BASE}/api/posts", json={
            "title": f"TEST83 post {uuid.uuid4().hex[:6]}",
            "body": "iter83 body content",
            "type": "discussion",
            "market": "Greater Seattle",
        }, timeout=15)
        assert r.status_code in (200, 201), r.text
        return r.json()["id"]

    def _flag_post(self, reporter, post_id):
        r = reporter.post(f"{BASE}/api/reports", json={
            "target_type": "post", "target_id": post_id,
            "reason": "test flag iter83", "category": "inappropriate",
        }, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_restore_unhides_and_dismisses(self, admin_session, user_session):
        # Admin creates post (admin can post; needs premium tier — admin has premium)
        pid = self._create_post(admin_session)
        reporter, _ = user_session
        rep = self._flag_post(reporter, pid)
        assert rep.get("hidden") is True
        # Restore
        r = admin_session.post(f"{BASE}/api/admin/moderation/restore",
                               json={"target_type": "post", "target_id": pid}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["restored"] is True
        # Post now visible in listing
        r2 = admin_session.get(f"{BASE}/api/posts", timeout=15)
        ids = [p["id"] for p in (r2.json() or [])]
        assert pid in ids
        # Reports dismissed
        r3 = admin_session.get(f"{BASE}/api/admin/reports?status=open", timeout=15)
        open_ids = [rep["target_id"] for rep in r3.json().get("reports", [])]
        assert pid not in open_ids

    def test_remove_deletes_and_resolves(self, admin_session, user_session):
        pid = self._create_post(admin_session)
        reporter, _ = user_session
        self._flag_post(reporter, pid)
        r = admin_session.post(f"{BASE}/api/admin/moderation/remove",
                               json={"target_type": "post", "target_id": pid}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["removed"] is True
        # Confirm gone
        r2 = admin_session.get(f"{BASE}/api/posts", timeout=15)
        ids = [p["id"] for p in (r2.json() or [])]
        assert pid not in ids

    def test_restore_admin_only(self, user_session):
        s, _ = user_session
        r = s.post(f"{BASE}/api/admin/moderation/restore",
                   json={"target_type": "post", "target_id": "fake"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_restore_invalid_target_type(self, admin_session):
        r = admin_session.post(f"{BASE}/api/admin/moderation/restore",
                               json={"target_type": "banana", "target_id": "x"}, timeout=15)
        assert r.status_code == 400


# -------- Follow suggestions --------
class TestFollowSuggestions:
    def test_suggestions_shape(self, admin_session):
        r = admin_session.get(f"{BASE}/api/follows/suggestions?limit=6", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "suggestions" in j
        s = j["suggestions"]
        assert isinstance(s, list)
        if s:
            for it in s:
                assert "user_id" in it
                assert "is_org" in it
                assert "follower_count" in it
                assert "partner_badge" in it

    def test_suggestions_exclude_self_and_followed(self, admin_session):
        # Get admin id
        me = admin_session.get(f"{BASE}/api/me", timeout=15).json()
        my_id = me.get("user_id")
        follows = admin_session.get(f"{BASE}/api/follows", timeout=15).json()
        followed = set(follows.get("ids") or [])
        r = admin_session.get(f"{BASE}/api/follows/suggestions?limit=6", timeout=15)
        for s in r.json()["suggestions"]:
            assert s["user_id"] != my_id
            assert s["user_id"] not in followed

    def test_suggestions_orgs_first(self, admin_session):
        r = admin_session.get(f"{BASE}/api/follows/suggestions?limit=12", timeout=15)
        sug = r.json()["suggestions"]
        if len(sug) < 2:
            pytest.skip("not enough suggestions to verify order")
        # After first non-org appears, no org may appear
        saw_non_org = False
        for s in sug:
            if not s["is_org"]:
                saw_non_org = True
            elif saw_non_org:
                pytest.fail("Orgs must come before non-orgs")

    def test_suggestions_auth_required(self):
        r = requests.get(f"{BASE}/api/follows/suggestions?limit=6", timeout=15)
        assert r.status_code == 401
