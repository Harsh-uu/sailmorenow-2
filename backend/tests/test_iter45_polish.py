"""Iter45 polish backend tests.

Modules covered:
- admin_router.admin_contact_reply: {ok, persisted, delivered, reply} contract,
  persistence-vs-delivery split (including mailer failure paths, tested
  in-process with a patched mailer.send_email), guards 401/403/404/400.
- admin_router.handle_available: 30/60s per-IP throttle + per-IP isolation.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = base_url.rstrip("/") + "/api"

MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _mint(mdb, user_id):
    tok = f"test_iter45_{uuid.uuid4().hex[:10]}"
    mdb.user_sessions.insert_one({
        "user_id": user_id, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return tok


@pytest.fixture(scope="module")
def admin_session(mongo):
    uid = "TEST_iter45_admin"
    mongo.users.update_one({"user_id": uid}, {"$set": {
        "user_id": uid, "email": "test.iter45.admin@sailmorenow.dev",
        "name": "TEST Admin45", "platform_role": "admin",
        "account_type": "sailor", "onboarding_complete": True}}, upsert=True)
    tok = _mint(mongo, uid)
    yield tok, uid
    mongo.user_sessions.delete_many({"user_id": uid})
    mongo.users.delete_one({"user_id": uid})


@pytest.fixture(scope="module")
def sailor_session(mongo):
    u = mongo.users.find_one({"email": "crew.alex@sailmorenow.dev"})
    assert u, "seeded crew.alex user missing"
    tok = _mint(mongo, u["user_id"])
    yield tok
    mongo.user_sessions.delete_many({"session_token": tok})


@pytest.fixture
def contact_msg(mongo):
    mid = str(uuid.uuid4())
    mongo.contact_messages.insert_one({
        "id": mid, "name": "TEST_Iter45", "email": "test.iter45@example.com",
        "message": "TEST_ iter45 reply contract message",
        "ip": "127.0.0.1", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield mid
    mongo.contact_messages.delete_one({"id": mid})


# --------------------------------------------------- reply contract over HTTP
class TestReplyContract:
    def test_happy_path_contract_and_persistence(self, client, mongo, admin_session, contact_msg):
        tok, uid = admin_session
        text = "TEST_ Thanks for reaching out to Sail More Now! We'll reply shortly."
        r = client.post(f"{API}/admin/contact/{contact_msg}/reply",
                        json={"body": text}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["persisted"] is True
        assert isinstance(p["delivered"], bool)
        assert p["ok"] == p["delivered"]
        rep = p["reply"]
        for k in ("id", "body", "at", "by", "by_name", "delivered"):
            assert k in rep, f"missing {k} in reply: {rep}"
        assert rep["body"] == text
        assert rep["by"] == uid
        assert rep["delivered"] == p["delivered"]
        doc = mongo.contact_messages.find_one({"id": contact_msg})
        replies = doc.get("replies") or []
        assert len(replies) == 1
        assert replies[-1]["body"] == text
        assert replies[-1]["delivered"] == p["delivered"]
        assert doc.get("status") == "replied"
        assert doc.get("last_reply_at")

    def test_unauthenticated_401(self, client, contact_msg):
        r = client.post(f"{API}/admin/contact/{contact_msg}/reply", json={"body": "hello there"})
        assert r.status_code == 401, r.text

    def test_non_admin_403(self, client, sailor_session, contact_msg):
        r = client.post(f"{API}/admin/contact/{contact_msg}/reply",
                        json={"body": "hello there"}, headers=_auth(sailor_session))
        assert r.status_code == 403, r.text

    def test_unknown_msg_404(self, client, admin_session):
        tok, _ = admin_session
        r = client.post(f"{API}/admin/contact/{uuid.uuid4()}/reply",
                        json={"body": "hello there"}, headers=_auth(tok))
        assert r.status_code == 404, r.text

    def test_short_body_400(self, client, admin_session, contact_msg):
        tok, _ = admin_session
        r = client.post(f"{API}/admin/contact/{contact_msg}/reply",
                        json={"body": "hi"}, headers=_auth(tok))
        assert r.status_code == 400, r.text

    def test_long_body_400(self, client, admin_session, contact_msg):
        tok, _ = admin_session
        r = client.post(f"{API}/admin/contact/{contact_msg}/reply",
                        json={"body": "x" * 6001}, headers=_auth(tok))
        assert r.status_code == 400, r.text


# ------------------------- delivery-failure paths (in-process patched mailer)
class TestReplyDeliveryFailure:
    """The public URL can't inject a mailer outage, so call the route handler
    directly with mailer.send_email patched."""

    @staticmethod
    def _setup(mongo):
        uid = "TEST_iter45_admin_ip"
        mongo.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": "test.iter45.ip@sailmorenow.dev",
            "name": "TEST Admin IP", "platform_role": "admin",
            "account_type": "sailor", "onboarding_complete": True}}, upsert=True)
        tok = _mint(mongo, uid)
        mid = str(uuid.uuid4())
        mongo.contact_messages.insert_one({
            "id": mid, "name": "TEST_Iter45ip", "email": "test.iter45.ip@example.com",
            "message": "TEST_ inproc", "ip": "127.0.0.1",
            "created_at": datetime.now(timezone.utc).isoformat()})
        return uid, tok, mid

    @staticmethod
    def _teardown(mongo, uid, mid):
        mongo.contact_messages.delete_one({"id": mid})
        mongo.user_sessions.delete_many({"user_id": uid})
        mongo.users.delete_one({"user_id": uid})

    def test_delivery_failure_paths(self, mongo):
        """Both scenarios run inside ONE event loop (motor's client binds to the
        first loop it sees, so a second asyncio.run() would blow up)."""
        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        for k, v in backend_env.items():
            if v is not None:
                os.environ.setdefault(k, v)
        import mailer
        from routers import admin_router

        async def raiser(**kwargs):
            raise RuntimeError("resend down")

        async def err_status(**kwargs):
            return {"status": "error", "http": 500}

        async def scenario(fake):
            uid, tok, mid = self._setup(mongo)
            original = mailer.send_email
            mailer.send_email = fake
            try:
                result = await admin_router.admin_contact_reply(
                    mid, {"body": "TEST_ delivery failure path body"},
                    session_token=None, authorization=f"Bearer {tok}")
                doc = mongo.contact_messages.find_one({"id": mid})
                return result, doc
            finally:
                mailer.send_email = original
                self._teardown(mongo, uid, mid)

        async def both():
            return await scenario(raiser), await scenario(err_status)

        (r1, d1), (r2, d2) = asyncio.run(both())

        # 1) mailer raises -> persisted, delivered False
        assert r1["persisted"] is True and r1["delivered"] is False and r1["ok"] is False, r1
        reps = d1.get("replies") or []
        assert len(reps) == 1 and reps[-1]["delivered"] is False
        assert d1.get("status") == "replied"

        # 2) mailer returns {'status': 'error'} (send_email NEVER raises) ->
        #    delivered must mirror actual Resend success
        assert r2["persisted"] is True
        assert r2["delivered"] is False, (
            "delivered=True even though send_email returned status=error — the "
            "router only catches exceptions and ignores the returned status")
        reps2 = d2.get("replies") or []
        assert len(reps2) == 1 and reps2[-1]["delivered"] is False


# ------------------------------------------------------- handle rate limiting
class TestHandleThrottle:
    def test_burst_returns_429_with_detail(self, client):
        got = None
        for _ in range(45):
            r = client.get(f"{API}/handle/available", params={"q": f"rl{uuid.uuid4().hex[:8]}"},
                           headers={"X-Forwarded-For": "203.0.113.45"})
            if r.status_code == 429:
                got = r
                break
        assert got is not None, "rate limit never triggered within 45 requests"
        assert got.json().get("detail") == "Too many availability checks. Try again in a minute."

    def test_other_ip_not_throttled(self, client):
        # burn IP A
        for _ in range(35):
            client.get(f"{API}/handle/available", params={"q": f"a{uuid.uuid4().hex[:8]}"},
                       headers={"X-Forwarded-For": "198.51.100.7"})
        r = client.get(f"{API}/handle/available", params={"q": f"b{uuid.uuid4().hex[:8]}"},
                       headers={"X-Forwarded-For": "198.51.100.200"})
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
