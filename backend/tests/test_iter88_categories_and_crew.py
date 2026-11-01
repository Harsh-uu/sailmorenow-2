"""Iter 88 regression:
  1) GET /api/markets categories include new names and exclude legacy ones.
  2) Boat Pros categories migrated to new names for seeded accounts.
  3) Per-event crew endpoints work: POST/PATCH/DELETE /events/{id}/crew.
  4) Event create with optional ends_at (null) and with ends_at.
  5) Free-user gated actions (DM/post/follow) return 402/403 upgrade_required.
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def free_user():
    email = f"qa.free+{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "Hunter2!pass",
        "first_name": "QA", "last_name": "Free",
        "account_type": "sailor", "primary_market": "Greater Seattle",
        "agreed_to_guidelines": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["session_token"], "user_id": data["user"]["user_id"]}


@pytest.fixture(scope="module")
def paid_user(admin_token):
    """Register, then admin-upgrade to premium."""
    email = f"qa.paid+{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "Hunter2!pass",
        "first_name": "QA", "last_name": "Paid",
        "account_type": "sailor", "primary_market": "Greater Seattle",
        "agreed_to_guidelines": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    uid = data["user"]["user_id"]
    # Upgrade tier directly in mongo (simpler + stable)
    import subprocess
    subprocess.run([
        "mongosh", "--quiet", "--eval",
        f'db=db.getSiblingDB("test_database"); db.users.updateOne({{user_id:"{uid}"}},{{$set:{{subscription_tier:"premium"}}}})'
    ], capture_output=True)
    return {"email": email, "token": data["session_token"], "user_id": uid}


# ---------- 1) /api/markets categories ----------
class TestMarketsCategories:
    def test_markets_has_new_cats_and_no_legacy(self):
        r = requests.get(f"{API}/markets", timeout=15)
        assert r.status_code == 200
        cats = r.json()["categories"]
        must_include = ["Detailing - Exterior", "Detailing - Interior", "Sails", "Canvas", "Diesel Engine Specialist"]
        for c in must_include:
            assert c in cats, f"missing new cat: {c}"
        must_exclude = ["Engine & Mechanical", "Sails & Canvas", "Cleaning & Detailing",
                        "Exterior boat detailing", "Interior detailing", "Waxing & Polishing",
                        "Navigation & Instruments Calibration"]
        for c in must_exclude:
            assert c not in cats, f"legacy cat still exposed: {c}"


# ---------- 2) Boat Pros categories migrated ----------
class TestBoatProMigration:
    @classmethod
    def _by_handle(cls):
        r = requests.get(f"{API}/boat-pros", timeout=15)
        assert r.status_code == 200
        pros = r.json()
        pros = pros if isinstance(pros, list) else pros.get("pros", pros.get("items", []))
        return {p.get("handle"): p.get("categories") for p in pros}

    def test_river_city_canvas_is_canvas_only(self):
        got = self._by_handle().get("rivercitycanvas")
        assert got == ["Canvas"], f"rivercitycanvas categories={got}, expected ['Canvas']"

    def test_north_sound_rig_and_sail_includes_sails_and_canvas(self):
        got = self._by_handle().get("demo-north-sound-rig") or self._by_handle().get("northsoundriggingco")
        assert got is not None
        assert "Sails" in got and "Canvas" in got, f"got={got}; expected both Sails and Canvas"
        assert "Sails & Canvas" not in got

    def test_salish_marina_has_diesel(self):
        got = self._by_handle().get("salishmarinaservices")
        assert got is not None
        assert "Diesel Engine Specialist" in got, f"got={got}"
        assert "Engine & Mechanical" not in got

    def test_wash_n_go_and_harbor_shine_exterior_detailing(self):
        d = self._by_handle()
        for h in ["demo-wash-n-go", "demo-harbor-shine"]:
            cats = d.get(h)
            assert cats is not None, f"handle {h} missing"
            assert "Detailing - Exterior" in cats, f"{h} cats={cats}"
            assert "Cleaning & Detailing" not in cats


# ---------- 3) Per-event crew endpoints ----------
class TestPerEventCrew:
    @pytest.fixture(scope="class")
    def event_id(self, admin_token):
        # Create a future event (Dec 2026) as admin
        payload = {
            "title": "TEST88 Crew Event",
            "market": "Greater Seattle",
            "category": "race",
            "starts_at": "2026-12-15T14:30:00+00:00",
            "ends_at": "2026-12-15T17:00:00+00:00",
            "description": "iter88 crew test",
            "location_text": "Seattle",
        }
        r = requests.post(f"{API}/events", json=payload, headers=_h(admin_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        eid = r.json().get("id") or r.json().get("event", {}).get("id")
        yield eid
        requests.delete(f"{API}/events/{eid}", headers=_h(admin_token), timeout=15)

    def test_crew_join_then_patch_then_delete(self, paid_user, event_id):
        tok = paid_user["token"]
        # cleanup
        requests.delete(f"{API}/events/{event_id}/crew", headers=_h(tok), timeout=15)
        # POST
        payload = {
            "positions": ["Foredeck", "Railmeat"],
            "experience": "5 yrs racing",
            "notes": "available weekends",
            "contact_via": "in-app",
            "post_to_feed": False,
        }
        r = requests.post(f"{API}/events/{event_id}/crew", json=payload, headers=_h(tok), timeout=15)
        assert r.status_code in (200, 201), r.text
        # GET
        g = requests.get(f"{API}/events/{event_id}/crew", headers=_h(tok), timeout=15)
        assert g.status_code == 200
        entries = g.json()
        entries = entries if isinstance(entries, list) else entries.get("entries", entries.get("items", []))
        mine = [e for e in entries if e.get("user_id") == paid_user["user_id"]]
        assert mine, f"no entry for paid user; entries={entries}"
        m = mine[0]
        assert "Foredeck" in m.get("positions", [])
        assert m.get("experience") == "5 yrs racing"
        assert m.get("notes") == "available weekends"
        # PATCH status -> found
        r2 = requests.patch(f"{API}/events/{event_id}/crew/status",
                            json={"status": "found"}, headers=_h(tok), timeout=15)
        assert r2.status_code == 200, r2.text
        # PATCH back to seeking
        r3 = requests.patch(f"{API}/events/{event_id}/crew/status",
                            json={"status": "seeking"}, headers=_h(tok), timeout=15)
        assert r3.status_code == 200, r3.text
        # DELETE
        rd = requests.delete(f"{API}/events/{event_id}/crew", headers=_h(tok), timeout=15)
        assert rd.status_code in (200, 204)


# ---------- 4) Event create with optional ends_at ----------
class TestEventCreateOptionalEnd:
    def test_event_without_ends_at(self, admin_token):
        payload = {
            "title": "TEST88 NoEnd",
            "market": "Greater Seattle",
            "category": "social",
            "starts_at": "2026-12-20T15:30:00+00:00",
            "ends_at": None,
            "description": "optional end",
            "location_text": "Lk Union",
        }
        r = requests.post(f"{API}/events", json=payload, headers=_h(admin_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        eid = doc.get("id") or doc.get("event", {}).get("id")
        assert eid
        # Verify ends_at persists as None
        g = requests.get(f"{API}/events/{eid}", timeout=15)
        if g.status_code == 200:
            ev = g.json()
            assert ev.get("ends_at") in (None, "", "null")
        requests.delete(f"{API}/events/{eid}", headers=_h(admin_token), timeout=15)

    def test_event_with_both_times_30min(self, admin_token):
        payload = {
            "title": "TEST88 Both",
            "market": "Greater Seattle",
            "category": "race",
            "starts_at": "2026-12-21T14:30:00+00:00",
            "ends_at": "2026-12-21T17:00:00+00:00",
            "description": "both times",
            "location_text": "Elliott Bay",
        }
        r = requests.post(f"{API}/events", json=payload, headers=_h(admin_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        eid = doc.get("id") or doc.get("event", {}).get("id")
        g = requests.get(f"{API}/events/{eid}", timeout=15)
        if g.status_code == 200:
            ev = g.json()
            assert ev.get("ends_at") and "17:00" in ev["ends_at"]
        requests.delete(f"{API}/events/{eid}", headers=_h(admin_token), timeout=15)


# ---------- 5) Free gating 402/403 upgrade_required ----------
class TestFreeGating:
    def test_free_dm_gated(self, free_user, admin_token):
        me = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=15)
        assert me.status_code == 200
        admin_uid = me.json().get("user_id") or me.json().get("id")
        r = requests.post(f"{API}/messages/{admin_uid}",
                          json={"body": "hi"}, headers=_h(free_user["token"]), timeout=15)
        assert r.status_code in (402, 403), r.text
        body = r.json().get("detail", r.json())
        if isinstance(body, dict):
            assert body.get("code") == "upgrade_required"

    def test_free_post_gated(self, free_user):
        r = requests.post(f"{API}/posts",
                          json={"type": "discussion", "title": "hi", "body": "hi from free",
                                "market": "Greater Seattle"},
                          headers=_h(free_user["token"]), timeout=15)
        assert r.status_code in (402, 403), r.text

    def test_free_follow_gated(self, free_user, admin_token):
        me = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=15)
        admin_uid = me.json().get("user_id") or me.json().get("id")
        r = requests.post(f"{API}/follows/{admin_uid}", headers=_h(free_user["token"]), timeout=15)
        assert r.status_code in (402, 403), f"free follow should be gated, got {r.status_code} {r.text}"
