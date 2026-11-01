"""Iter46 retest of the iter45 defects.

Modules covered:
- admin_router.admin_contact_reply: delivered/ok must be derived from the
  send_email RETURN value ({'status': ok|error|skipped}) not just try/except.
  Scenarios: ok / error / skipped / raises. Plus HTTP guards 401/403/404/400.
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
    tok = f"test_iter46_{uuid.uuid4().hex[:10]}"
    mdb.user_sessions.insert_one({
        "user_id": user_id, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return tok


@pytest.fixture(scope="module")
def admin_session(mongo):
    uid = "TEST_iter46_admin"
    mongo.users.update_one({"user_id": uid}, {"$set": {
        "user_id": uid, "email": "test.iter46.admin@sailmorenow.dev",
        "name": "TEST Admin46", "platform_role": "admin",
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
        "id": mid, "name": "TEST_Iter46", "email": "test.iter46@example.com",
        "message": "TEST_ iter46 reply contract message",
        "ip": "127.0.0.1", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield mid
    mongo.contact_messages.delete_one({"id": mid})


# --------------------------------------------------- reply contract over HTTP
class TestReplyGuards:
    def test_happy_path_contract_and_persistence(self, client, mongo, admin_session, contact_msg):
        tok, uid = admin_session
        text = "TEST_ iter46 thanks for reaching out to Sail More Now!"
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


# ------------------- delivery status derivation (in-process patched mailer) --
class TestReplyDeliveryStatus:
    """The public URL can't inject a mailer outage, so call the route handler
    directly with mailer.send_email patched. All scenarios share ONE event
    loop because motor binds to the first loop it sees."""

    @staticmethod
    def _setup(mongo, n):
        uid = f"TEST_iter46_ip_{n}"
        mongo.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": f"test.iter46.ip{n}@sailmorenow.dev",
            "name": "TEST Admin46 IP", "platform_role": "admin",
            "account_type": "sailor", "onboarding_complete": True}}, upsert=True)
        tok = _mint(mongo, uid)
        mid = str(uuid.uuid4())
        mongo.contact_messages.insert_one({
            "id": mid, "name": "TEST_Iter46ip", "email": f"test.iter46.ip{n}@example.com",
            "message": "TEST_ inproc", "ip": "127.0.0.1",
            "created_at": datetime.now(timezone.utc).isoformat()})
        return uid, tok, mid

    @staticmethod
    def _teardown(mongo, uid, mid):
        mongo.contact_messages.delete_one({"id": mid})
        mongo.user_sessions.delete_many({"user_id": uid})
        mongo.users.delete_one({"user_id": uid})

    def test_delivery_status_matrix(self, mongo):
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

        async def skipped_status(**kwargs):
            return {"status": "skipped", "reason": "no_key"}

        async def ok_status(**kwargs):
            return {"status": "ok", "id": "msg_test"}

        async def scenario(fake, n):
            uid, tok, mid = self._setup(mongo, n)
            original = mailer.send_email
            mailer.send_email = fake
            try:
                result = await admin_router.admin_contact_reply(
                    mid, {"body": "TEST_ iter46 delivery status body"},
                    session_token=None, authorization=f"Bearer {tok}")
                doc = mongo.contact_messages.find_one({"id": mid})
                return result, doc
            finally:
                mailer.send_email = original
                self._teardown(mongo, uid, mid)

        async def all_scenarios():
            return {
                "raise": await scenario(raiser, 1),
                "error": await scenario(err_status, 2),
                "skipped": await scenario(skipped_status, 3),
                "ok": await scenario(ok_status, 4),
            }

        out = asyncio.run(all_scenarios())

        for name in ("raise", "error", "skipped"):
            res, doc = out[name]
            assert res["persisted"] is True, (name, res)
            assert res["delivered"] is False, (
                f"{name}: delivered should be False when send_email -> {name}", res)
            assert res["ok"] is False, (name, res)
            assert res["reply"]["delivered"] is False, (name, res)
            reps = doc.get("replies") or []
            assert len(reps) == 1 and reps[-1]["delivered"] is False, (name, reps)
            assert doc.get("status") == "replied", (name, doc.get("status"))

        res, doc = out["ok"]
        assert res["persisted"] is True and res["delivered"] is True and res["ok"] is True, res
        reps = doc.get("replies") or []
        assert len(reps) == 1 and reps[-1]["delivered"] is True, reps
