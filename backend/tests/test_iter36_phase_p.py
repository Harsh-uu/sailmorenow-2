"""Iteration 36 — Phase P backend tests.

Modules under test:
  * directory_router.public_profile_by_handle  -> GET /api/u/{handle}
  * directory_router.contact_form              -> POST /api/contact
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from dotenv import dotenv_values, load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"


def _rl_headers():
    """POST /api/contact is now throttled 3/10min per IP -> unique IP per call."""
    return {"X-Forwarded-For": f"10.37.%d.%d" % (uuid.uuid4().int % 250 + 1, uuid.uuid4().int % 250 + 1)}


class _FakeRequest:
    """Minimal stand-in for starlette Request for direct-call unit tests."""
    def __init__(self, ip="10.36.0.1"):
        self.headers = {"x-forwarded-for": ip}
        self.client = None


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def db():
    from deps import db as _db
    return _db


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def seeded_handle(db):
    """Create a TEST_ user with a known lowercase handle + one post."""
    uid = f"TEST_iter36_{uuid.uuid4().hex[:8]}"
    handle = f"test36{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc).isoformat()
    _run(db.users.insert_one({
        "user_id": uid, "email": f"{uid}@sailmorenow.dev", "name": "TEST Iter36 Sailor",
        "handle": handle, "account_type": "sailor", "primary_market": "Greater Seattle",
        "bio": "TEST bio", "onboarding_complete": True, "created_at": now,
    }))
    pid = str(uuid.uuid4())
    _run(db.posts.insert_one({
        "id": pid, "author_id": uid, "title": "TEST_iter36 post",
        "market": "Greater Seattle", "type": "discussion", "created_at": now,
    }))
    yield {"user_id": uid, "handle": handle, "post_id": pid}
    _run(db.users.delete_many({"user_id": uid}))
    _run(db.posts.delete_many({"id": pid}))


# ---------------------------------------------------------------- GET /api/u/{handle}
class TestHandleDirectory:
    def test_existing_handle_returns_full_shape(self, client, seeded_handle):
        r = client.get(f"{API}/u/{seeded_handle['handle']}")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("user", "pro", "rating", "review_count", "recent_posts"):
            assert k in d, f"missing key {k}"
        assert d["user"]["handle"] == seeded_handle["handle"]
        assert d["user"]["user_id"] == seeded_handle["user_id"]
        assert d["user"]["name"] == "TEST Iter36 Sailor"
        assert d["pro"] is None
        assert d["review_count"] == 0
        assert isinstance(d["recent_posts"], list)
        assert any(p["id"] == seeded_handle["post_id"] for p in d["recent_posts"])

    def test_no_sensitive_fields_leaked(self, client, seeded_handle):
        d = client.get(f"{API}/u/{seeded_handle['handle']}").json()
        assert "_id" not in d["user"]
        assert "email" not in d["user"], "email must not be exposed on public profile"

    def test_unknown_handle_404(self, client):
        r = client.get(f"{API}/u/definitely_not_a_handle_{uuid.uuid4().hex[:8]}")
        assert r.status_code == 404
        assert "detail" in r.json()

    def test_case_insensitive_lookup(self, client, seeded_handle):
        r = client.get(f"{API}/u/{seeded_handle['handle'].upper()}")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["handle"] == seeded_handle["handle"]

    def test_at_prefix_stripped(self, client, seeded_handle):
        r = client.get(f"{API}/u/@{seeded_handle['handle']}")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["handle"] == seeded_handle["handle"]

    def test_boat_pro_handle_includes_pro_and_rating(self, client, db):
        """Existing seeded boat pro should surface its directory listing."""
        u = _run(db.users.find_one({"account_type": "boat_pro", "handle": {"$exists": True}}, {"_id": 0}))
        if not u:
            pytest.skip("no seeded boat_pro with handle")
        r = client.get(f"{API}/u/{u['handle']}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["account_type"] == "boat_pro"
        assert "review_count" in d


# ---------------------------------------------------------------- POST /api/contact
class TestContactForm:
    def test_empty_body_400(self, client):
        r = client.post(f"{API}/contact", json={}, headers=_rl_headers())
        assert r.status_code == 400, r.text

    def test_short_message_400(self, client):
        r = client.post(f"{API}/contact", json={
            "name": "TEST_short", "email": "test36@example.com", "message": "hi"}, headers=_rl_headers())
        assert r.status_code == 400

    def test_malformed_email_400(self, client):
        r = client.post(f"{API}/contact", json={
            "name": "TEST_bademail", "email": "not-an-email", "message": "a valid long message"}, headers=_rl_headers())
        assert r.status_code == 400

    def test_missing_name_400(self, client):
        r = client.post(f"{API}/contact", json={
            "email": "test36@example.com", "message": "a valid long message here"}, headers=_rl_headers())
        assert r.status_code == 400

    def test_too_long_message_400(self, client):
        r = client.post(f"{API}/contact", json={
            "name": "TEST_long", "email": "test36@example.com", "message": "x" * 4001}, headers=_rl_headers())
        assert r.status_code == 400

    def test_valid_submission_persists(self, client, db):
        marker = f"TEST_iter36_contact_{uuid.uuid4().hex[:8]}"
        payload = {"name": marker, "email": "test36+qa@example.com",
                   "message": f"This is a valid QA message {marker}"}
        r = client.post(f"{API}/contact", json=payload, headers=_rl_headers())
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        doc = _run(db.contact_messages.find_one({"name": marker}, {"_id": 0}))
        assert doc is not None, "contact_messages doc was not persisted"
        assert doc["email"] == payload["email"]
        assert doc["message"] == payload["message"]
        assert "id" in doc and "created_at" in doc
        _run(db.contact_messages.delete_many({"name": marker}))

    def test_html_injection_escaped_in_email(self, monkeypatch):
        """Unit-level: send_email must be called with info@sailmorenow.com,
        reply_to = submitter, and the message must be escaped."""
        import routers.directory_router as dr
        import mailer

        captured = {}

        async def fake_send_email(recipient_email, subject, html_content, reply_to=None):
            captured.update(recipient_email=recipient_email, subject=subject,
                            html_content=html_content, reply_to=reply_to)
            return {"status": "ok"}

        monkeypatch.setattr(mailer, "send_email", fake_send_email)
        payload = {"name": "TEST_inject", "email": "inject36@example.com",
                   "message": "<script>alert(1)</script> long enough message"}
        _run(dr.contact_form(payload, _FakeRequest("10.36.1.1")))
        assert captured["recipient_email"] == "info@sailmorenow.com"
        assert captured["reply_to"] == payload["email"]
        assert "<script>" not in captured["html_content"]
        from deps import db as _db
        _run(_db.contact_messages.delete_many({"name": "TEST_inject"}))

    def test_mailer_failure_does_not_500(self, monkeypatch):
        """Regression: the except branch references an undefined `logger`."""
        import routers.directory_router as dr
        import mailer

        async def boom(**kwargs):
            raise RuntimeError("resend down")

        monkeypatch.setattr(mailer, "send_email", boom)
        payload = {"name": "TEST_boom", "email": "boom36@example.com",
                   "message": "long enough message for boom test"}
        try:
            res = _run(dr.contact_form(payload, _FakeRequest("10.36.1.1")))
        except NameError as e:
            pytest.fail(f"contact_form crashed on mailer failure: {e!r}")
        assert res.get("ok") is True
        from deps import db as _db
        _run(_db.contact_messages.delete_many({"name": "TEST_boom"}))


# ---------------------------------------------------------------- reports insights (for AdminReports UI)
class TestReportsInsights:
    def test_admin_reports_requires_auth(self, client):
        r = client.get(f"{API}/admin/reports")
        assert r.status_code in (401, 403, 404), r.status_code
