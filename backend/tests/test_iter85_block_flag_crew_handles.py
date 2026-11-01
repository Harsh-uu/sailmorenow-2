"""Iter 85 backend tests:
  - Block/Unblock flow via POST/DELETE /api/follows/block/{id}
  - /api/reports (flag) accepts new `category` field
  - Crew endpoints return user_handle:
      /api/crew-bank/standalone, /api/crew-bank/open, /api/events/{id}/crew
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def _register(session: requests.Session, email: str, password: str = "hunter2pass", name: str = "Test User") -> dict:
    parts = name.split(" ", 1)
    fn = parts[0] or "Test"
    ln = parts[1] if len(parts) > 1 else "User"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name,
              "first_name": fn, "last_name": ln,
              "account_type": "sailor", "primary_market": "Greater Seattle"},
    )
    if r.status_code == 400 and "already" in r.text.lower():
        # fall back to login
        r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code in (200, 201), f"register/login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"user": data["user"], "token": data["session_token"]}


def _login(email: str, password: str) -> dict:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    d = r.json()
    return {"session": s, "user": d["user"], "token": d["session_token"]}


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def user_a():
    s = requests.Session()
    email = f"iter85_a_{uuid.uuid4().hex[:8]}@example.com"
    info = _register(s, email, name="Iter85 A")
    return {"session": s, **info, "email": email}


@pytest.fixture(scope="module")
def user_b():
    s = requests.Session()
    email = f"iter85_b_{uuid.uuid4().hex[:8]}@example.com"
    info = _register(s, email, name="Iter85 B")
    return {"session": s, **info, "email": email}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ------------------ BLOCK / UNBLOCK ------------------
class TestBlockFlow:
    def test_block_then_unblock(self, user_a, user_b):
        a_tok = user_a["token"]; b_id = user_b["user"]["user_id"]
        # Block
        r = requests.post(f"{API}/follows/block/{b_id}", headers=_auth(a_tok))
        assert r.status_code == 200, r.text
        # Verify blocked list
        r = requests.get(f"{API}/follows/blocked", headers=_auth(a_tok))
        assert r.status_code == 200
        blocked = r.json()
        arr = blocked if isinstance(blocked, list) else (blocked.get("blocked") or blocked.get("entries") or [])
        assert any((x.get("user_id") == b_id) for x in arr), f"B not in blocked: {blocked}"
        # Idempotent re-block
        r2 = requests.post(f"{API}/follows/block/{b_id}", headers=_auth(a_tok))
        assert r2.status_code == 200
        # Unblock
        r = requests.delete(f"{API}/follows/block/{b_id}", headers=_auth(a_tok))
        assert r.status_code == 200, r.text
        # Confirm gone
        r = requests.get(f"{API}/follows/blocked", headers=_auth(a_tok))
        blocked2 = r.json()
        arr = blocked2 if isinstance(blocked2, list) else (blocked2.get("blocked") or blocked2.get("entries") or [])
        assert not any((x.get("user_id") == b_id) for x in arr)

    def test_block_requires_auth(self, user_b):
        r = requests.post(f"{API}/follows/block/{user_b['user']['user_id']}")
        assert r.status_code in (401, 403)


# ------------------ REPORTS (FLAG) ------------------
class TestReportsCategory:
    def test_report_accepts_category(self, admin):
        # Admin creates a post to report (admin is paid_subscriber for post creation)
        headers = _auth(admin["token"])
        pr = requests.post(f"{API}/posts", json={
            "title": "TEST85 flag target",
            "body": "delete me",
            "market": "Greater Seattle",
            "type": "discussion",
        }, headers=headers)
        # Some setups gate posts by subscription; skip if 402
        if pr.status_code == 402:
            pytest.skip("posts require paid subscription for this admin session")
        assert pr.status_code in (200, 201), pr.text
        post_id = pr.json().get("id") or pr.json().get("post", {}).get("id")
        assert post_id, pr.text

        # Register a fresh reporter to file the report
        s = requests.Session()
        email = f"iter85_flagger_{uuid.uuid4().hex[:8]}@example.com"
        rep = _register(s, email, name="Flagger")
        rr = requests.post(f"{API}/reports", json={
            "target_type": "post",
            "target_id": post_id,
            "reason": "Against community guidelines — TEST85",
            "category": "inappropriate",
        }, headers=_auth(rep["token"]))
        assert rr.status_code in (200, 201), rr.text
        data = rr.json()
        # Response may include duplicate/hidden flags
        assert isinstance(data, dict)

        # Cleanup — admin removes the post
        try:
            requests.post(f"{API}/admin/moderation/remove", json={
                "target_type": "post", "target_id": post_id
            }, headers=headers)
        except Exception:
            pass


# ------------------ CREW ENDPOINTS return user_handle ------------------
class TestCrewHandles:
    def test_standalone_includes_user_handle_key(self):
        r = requests.get(f"{API}/crew-bank/standalone?limit=50")
        assert r.status_code == 200
        d = r.json()
        entries = d.get("entries") if isinstance(d, dict) else d
        assert isinstance(entries, list)
        # If there are entries, each must expose user_handle key (may be None)
        for e in entries:
            assert "user_handle" in e, f"missing user_handle in {list(e.keys())}"
        # Seeded captain_jenn entry should be present per test_credentials
        assert any(e.get("user_handle") == "captain_jenn" for e in entries), \
            "expected captain_jenn seeded entry"

    def test_open_slots_shape_includes_user_handle(self):
        r = requests.get(f"{API}/crew-bank/open?days=90&limit=50")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # If entries exist, each should include user_handle key
        for e in rows:
            assert "user_handle" in e, f"missing user_handle in {list(e.keys())}"

    def test_event_crew_shape_includes_user_handle(self, admin):
        # Find any event and hit /events/{id}/crew
        r = requests.get(f"{API}/events?limit=5")
        assert r.status_code == 200
        evs = r.json()
        evs = evs if isinstance(evs, list) else evs.get("events", [])
        if not evs:
            pytest.skip("no events available")
        eid = evs[0].get("id")
        r2 = requests.get(f"{API}/events/{eid}/crew", headers=_auth(admin["token"]))
        assert r2.status_code == 200, r2.text
        d = r2.json()
        entries = d.get("entries", [])
        for e in entries:
            assert "user_handle" in e, f"missing user_handle in crew entry: {list(e.keys())}"
