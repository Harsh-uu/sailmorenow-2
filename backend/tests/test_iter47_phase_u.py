"""Iter47 — post-Phase-T follow-up tests.

Modules covered:
- payments_router.payments_mode / deps.stripe_mode  (GET /api/payments/mode)
- scheduler._contact_reply_retry_job               (auto-retry cron job)
- directory_router.update_photos                   (shared MAX_PHOTO_URL_CHARS)
- admin_router.admin_contact_reply                 (iter46 regression)
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


def _bootstrap_env():
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")
    for k, v in backend_env.items():
        if v is not None:
            os.environ.setdefault(k, v)


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
    tok = f"test_iter47_{uuid.uuid4().hex[:10]}"
    mdb.user_sessions.insert_one({
        "user_id": user_id, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return tok


# ============================================================ 1. payments/mode
class TestPaymentsMode:
    def test_mode_public_200(self, client):
        r = client.get(f"{API}/payments/mode")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert set(d.keys()) == {"mode", "webhook_secret_configured"}, d
        assert d["mode"] == "test", d
        assert isinstance(d["webhook_secret_configured"], bool)
        assert d["webhook_secret_configured"] is False, d

    def test_mode_ignores_bogus_auth(self, client):
        """Public endpoint: a garbage bearer token must not 401."""
        r = client.get(f"{API}/payments/mode", headers=_auth("not-a-real-token"))
        assert r.status_code == 200, r.text[:300]
        assert r.json()["mode"] == "test"

    def test_stripe_mode_helper_prefixes(self):
        _bootstrap_env()
        import deps
        original = deps.STRIPE_API_KEY
        try:
            for key, expected in [("sk_live_abc", "live"), ("sk_test_abc", "test"),
                                  ("pk_live_abc", "unknown"), ("", "unknown")]:
                deps.STRIPE_API_KEY = key
                assert deps.stripe_mode()["mode"] == expected, key
        finally:
            deps.STRIPE_API_KEY = original


# ================================================== 2. contact reply retry job
class TestContactReplyRetryJob:
    """All scenarios share ONE asyncio.run because motor binds to the first
    loop it sees."""

    @staticmethod
    def _seed(mdb, tag, replies):
        mid = str(uuid.uuid4())
        mdb.contact_messages.insert_one({
            "id": mid, "name": f"TEST_iter47_{tag}",
            "email": f"test.iter47.{tag}@example.com",
            "message": "TEST_ iter47 retry", "ip": "127.0.0.1",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "replies": replies,
        })
        return mid

    @staticmethod
    def _reply(delivered, retry_count):
        return {"id": str(uuid.uuid4()), "body": "TEST_ retry body",
                "delivered": delivered, "retry_count": retry_count,
                "created_at": datetime.now(timezone.utc).isoformat()}

    def test_retry_matrix_and_atomic_claim(self, mongo):
        _bootstrap_env()
        import mailer
        import scheduler
        from motor.motor_asyncio import AsyncIOMotorClient

        r_a = self._reply(False, 0)
        r_b = self._reply(False, 5)
        r_c = self._reply(True, 0)
        r_d = self._reply(False, 0)
        mid_a = self._seed(mongo, "a", [r_a])
        mid_b = self._seed(mongo, "b", [r_b])
        mid_c = self._seed(mongo, "c", [r_c])
        mid_d = self._seed(mongo, "d", [r_d])
        # (e) real shape produced by admin_router: NO retry_count field at all
        r_e = {"id": str(uuid.uuid4()), "body": "TEST_ retry body",
               "at": datetime.now(timezone.utc).isoformat(),
               "by": "admin", "by_name": "Admin", "delivered": False}
        mid_e = self._seed(mongo, "e", [r_e])

        calls = []

        async def fake_ok(**kwargs):
            calls.append(kwargs.get("recipient_email"))
            return {"status": "ok", "id": "msg_test"}

        async def fake_ok_slow(**kwargs):
            calls.append(kwargs.get("recipient_email"))
            await asyncio.sleep(0.25)
            return {"status": "ok", "id": "msg_test"}

        results = {}

        async def scenario():
            mc = AsyncIOMotorClient(MONGO_URL)
            mdb = mc[DB_NAME]
            original = mailer.send_email
            try:
                # --- pass 1: only mid_a/mid_d eligible ------------------
                mailer.send_email = fake_ok
                await scheduler._contact_reply_retry_job(mdb)
                results["pass1_calls"] = list(calls)

                # --- pass 2: concurrency / atomic-claim guard -----------
                # reset mid_d back to undelivered retry_count 0 and fire two
                # concurrent invocations on the SAME reply.
                await mdb.contact_messages.update_one(
                    {"id": mid_d, "replies.id": r_d["id"]},
                    {"$set": {"replies.$.delivered": False,
                              "replies.$.retry_count": 0},
                     "$unset": {"replies.$.delivered_at": ""}})
                calls.clear()
                mailer.send_email = fake_ok_slow
                await asyncio.gather(scheduler._contact_reply_retry_job(mdb),
                                     scheduler._contact_reply_retry_job(mdb))
                results["concurrent_calls"] = list(calls)
            finally:
                mailer.send_email = original
                mc.close()

        asyncio.run(scenario())

        doc_a = mongo.contact_messages.find_one({"id": mid_a}, {"_id": 0})
        doc_b = mongo.contact_messages.find_one({"id": mid_b}, {"_id": 0})
        doc_c = mongo.contact_messages.find_one({"id": mid_c}, {"_id": 0})
        doc_d = mongo.contact_messages.find_one({"id": mid_d}, {"_id": 0})
        doc_e = mongo.contact_messages.find_one({"id": mid_e}, {"_id": 0})

        failures = []
        # (a) undelivered + retry_count 0 -> retried & flipped delivered
        ra = doc_a["replies"][0]
        if ra.get("delivered") is not True:
            failures.append(f"(a) delivered not flipped: {ra}")
        if not ra.get("delivered_at"):
            failures.append(f"(a) delivered_at missing: {ra}")
        if ra.get("retry_count") != 1:
            failures.append(f"(a) retry_count != 1: {ra.get('retry_count')}")
        if not ra.get("last_retry_at"):
            failures.append("(a) last_retry_at missing")

        # (b) retry cap 5 -> skipped
        rb = doc_b["replies"][0]
        if rb.get("delivered") is not False:
            failures.append(f"(b) capped reply was delivered: {rb}")
        if rb.get("retry_count") != 5:
            failures.append(f"(b) retry_count changed: {rb.get('retry_count')}")

        # (c) already delivered -> skipped
        rc = doc_c["replies"][0]
        if rc.get("retry_count") != 0:
            failures.append(f"(c) delivered reply was retried: {rc}")

        # send_email recipients on pass 1: only a + d + e
        p1 = results["pass1_calls"]
        expected_p1 = {"test.iter47.a@example.com", "test.iter47.d@example.com",
                       "test.iter47.e@example.com"}
        if set(p1) != expected_p1 or len(p1) != 3:
            failures.append(f"pass1 send_email calls wrong: {p1}")

        # (e) reply with no retry_count field must still retry + flip
        re_ = doc_e["replies"][0]
        if re_.get("delivered") is not True or re_.get("retry_count") != 1:
            failures.append(f"(e) no-retry_count reply mishandled: {re_}")

        # concurrency: exactly ONE send + ONE increment
        cc = results["concurrent_calls"]
        rd = doc_d["replies"][0]
        if len(cc) != 1:
            failures.append(
                f"ATOMIC CLAIM BROKEN: {len(cc)} send_email calls for the same "
                f"reply under asyncio.gather (expected 1): {cc}")
        if rd.get("retry_count") != 1:
            failures.append(
                f"ATOMIC CLAIM BROKEN: retry_count={rd.get('retry_count')} "
                "after 2 concurrent runs (expected 1)")

        mongo.contact_messages.delete_many(
            {"id": {"$in": [mid_a, mid_b, mid_c, mid_d, mid_e]}})
        assert not failures, "; ".join(failures)


# ========================================================= 3. photos char cap
@pytest.fixture(scope="module")
def pro_session(mongo):
    u = mongo.users.find_one({"email": "pro.marina@sailmorenow.dev"})
    assert u, "seeded pro.marina user missing"
    pro = mongo.boat_pros.find_one({"user_id": u["user_id"]})
    assert pro, "seeded boat_pro doc missing"
    saved = pro.get("photos", [])
    tok = _mint(mongo, u["user_id"])
    yield tok, u["user_id"]
    mongo.boat_pros.update_one({"user_id": u["user_id"]},
                               {"$set": {"photos": saved}})
    mongo.user_sessions.delete_many({"session_token": tok})


def _photo(n):
    prefix = "data:image/jpeg;base64,"
    return prefix + ("A" * (n - len(prefix)))


class TestPhotoCharCap:
    def test_over_cap_rejected_400(self, client, pro_session):
        tok, _ = pro_session
        r = client.patch(f"{API}/boat-pros/photos", headers=_auth(tok),
                         json={"photos": [_photo(400_001)]})
        assert r.status_code == 400, f"{r.status_code}: {r.text[:200]}"
        detail = r.json().get("detail", "")
        assert "400 KB" in detail, detail

    def test_at_cap_accepted(self, client, pro_session, mongo):
        tok, uid = pro_session
        p = _photo(400_000)
        r = client.patch(f"{API}/boat-pros/photos", headers=_auth(tok),
                         json={"photos": [p]})
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "_id" not in body
        assert len(body["photos"]) == 1
        assert len(body["photos"][0]) == 400_000
        # persistence check
        doc = mongo.boat_pros.find_one({"user_id": uid})
        assert len(doc["photos"][0]) == 400_000

    def test_mine_unauth_401(self, client):
        r = client.get(f"{API}/boat-pros/mine")
        assert r.status_code == 401, r.status_code

    def test_mine_returns_pro_doc(self, client, pro_session):
        tok, uid = pro_session
        r = client.get(f"{API}/boat-pros/mine", headers=_auth(tok))
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["user_id"] == uid
        assert "_id" not in d


# ============================================ 4. admin contact reply regression
class TestAdminReplyRegression:
    def test_reply_contract(self, client, mongo):
        uid = "TEST_iter47_admin"
        mongo.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": "test.iter47.admin@sailmorenow.dev",
            "name": "TEST Admin47", "platform_role": "admin",
            "account_type": "sailor", "onboarding_complete": True}}, upsert=True)
        tok = _mint(mongo, uid)
        mid = str(uuid.uuid4())
        mongo.contact_messages.insert_one({
            "id": mid, "name": "TEST_Iter47", "email": "test.iter47@example.com",
            "message": "TEST_ iter47 reply contract", "ip": "127.0.0.1",
            "created_at": datetime.now(timezone.utc).isoformat()})
        try:
            r = client.post(f"{API}/admin/contact/{mid}/reply", headers=_auth(tok),
                            json={"body": "TEST_ iter47 reply body"})
            assert r.status_code == 200, r.text[:300]
            p = r.json()
            for k in ("ok", "persisted", "delivered", "reply"):
                assert k in p, f"missing {k}: {p}"
            assert p["persisted"] is True
            rep = p["reply"]
            for k in ("id", "body", "delivered", "at"):
                assert k in rep, f"missing reply.{k}: {rep}"
            doc = mongo.contact_messages.find_one({"id": mid})
            assert len(doc.get("replies", [])) == 1
        finally:
            mongo.contact_messages.delete_one({"id": mid})
            mongo.user_sessions.delete_many({"user_id": uid})
            mongo.users.delete_one({"user_id": uid})
