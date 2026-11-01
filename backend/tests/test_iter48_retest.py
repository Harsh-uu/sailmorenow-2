"""Iter48 — retest of the 3 defects flagged in iter47 (backend part).

Modules covered:
- scheduler._contact_reply_retry_job  (lease-based CAS atomic claim, matrix, on-fail)
- scheduler.next_run                  (job id coverage)
- payments_router GET /api/payments/mode
- directory_router PATCH /api/boat-pros/photos (400_000-char cap)
- admin_router POST /api/admin/contact/{id}/reply contract
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
    tok = f"test_iter48_{uuid.uuid4().hex[:10]}"
    mdb.user_sessions.insert_one({
        "user_id": user_id, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return tok


def _doc(tag, replies):
    return {
        "id": str(uuid.uuid4()), "name": f"TEST_iter48_{tag}",
        "email": f"test.iter48.{tag}@example.com",
        "message": "TEST_ iter48 retry", "ip": "127.0.0.1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "replies": replies,
    }


def _reply(delivered, retry_count):
    r = {"id": str(uuid.uuid4()), "body": "TEST_ retry body",
         "delivered": delivered,
         "at": datetime.now(timezone.utc).isoformat()}
    if retry_count is not None:
        r["retry_count"] = retry_count
    return r


def _mail(tag):
    return f"test.iter48.{tag}@example.com"


# ============================================ 1. atomic CAS + matrix + on-fail
class TestContactReplyRetryJob:
    """One asyncio.run — motor binds to the first loop it sees.

    Docs are inserted lazily right before the pass that needs them so earlier
    passes cannot consume them.
    """

    def test_all_scenarios(self, mongo):
        _bootstrap_env()
        import mailer
        import scheduler
        from motor.motor_asyncio import AsyncIOMotorClient

        d_cas = _doc("cas", [_reply(False, 0)])
        d_cas3 = _doc("cas3", [_reply(False, 0)])
        d_cap = _doc("cap", [_reply(False, 5)])
        d_done = _doc("done", [_reply(True, 0)])
        d_nofield = _doc("nofield", [_reply(False, None)])
        d_fail = _doc("fail", [_reply(False, 0)])
        d_fail2 = _doc("fail2", [_reply(False, 0)])

        calls = []
        results = {}

        async def slow_ok(**kw):
            calls.append(kw.get("recipient_email"))
            await asyncio.sleep(0.25)
            return {"status": "ok", "id": "msg_test"}

        async def slow_err(**kw):
            calls.append(kw.get("recipient_email"))
            await asyncio.sleep(0.25)
            return {"status": "error", "http": 500}

        def only(tag):
            return [c for c in calls if c == _mail(tag)]

        async def scenario():
            mc = AsyncIOMotorClient(MONGO_URL)
            mdb = mc[DB_NAME]
            original = mailer.send_email
            try:
                mailer.send_email = slow_ok

                # --- A: 2 concurrent runs on the SAME undelivered reply ----
                await mdb.contact_messages.insert_one(dict(d_cas))
                calls.clear()
                await asyncio.gather(scheduler._contact_reply_retry_job(mdb),
                                     scheduler._contact_reply_retry_job(mdb))
                results["cas2"] = only("cas")

                # --- B: 3 concurrent runs ----------------------------------
                await mdb.contact_messages.insert_one(dict(d_cas3))
                calls.clear()
                await asyncio.gather(scheduler._contact_reply_retry_job(mdb),
                                     scheduler._contact_reply_retry_job(mdb),
                                     scheduler._contact_reply_retry_job(mdb))
                results["cas3"] = only("cas3")

                # --- C: matrix (cap-5 / delivered / missing retry_count) ---
                await mdb.contact_messages.insert_many(
                    [dict(d_cap), dict(d_done), dict(d_nofield)])
                calls.clear()
                await scheduler._contact_reply_retry_job(mdb)
                results["cap"] = only("cap")
                results["done"] = only("done")
                results["nofield"] = only("nofield")

                # --- D: on-fail single run ---------------------------------
                mailer.send_email = slow_err
                await mdb.contact_messages.insert_one(dict(d_fail))
                calls.clear()
                await scheduler._contact_reply_retry_job(mdb)
                results["fail1"] = only("fail")

                # --- E: on-fail, two overlapping runs ----------------------
                await mdb.contact_messages.insert_one(dict(d_fail2))
                calls.clear()
                await asyncio.gather(scheduler._contact_reply_retry_job(mdb),
                                     scheduler._contact_reply_retry_job(mdb))
                results["fail2"] = only("fail2")
            finally:
                mailer.send_email = original
                mc.close()

        asyncio.run(scenario())

        def rr(d):
            doc = mongo.contact_messages.find_one({"id": d["id"]}, {"_id": 0})
            return doc["replies"][0]

        f = []
        # A — exactly one send, retry_count 1, delivered flipped
        if len(results["cas2"]) != 1:
            f.append(f"CAS 2-run: {len(results['cas2'])} send_email calls (expected 1)")
        a = rr(d_cas)
        if a.get("retry_count") != 1:
            f.append(f"CAS 2-run: retry_count={a.get('retry_count')} (expected 1)")
        if a.get("delivered") is not True or not a.get("delivered_at"):
            f.append(f"CAS 2-run: delivered/delivered_at wrong: {a}")
        if not a.get("last_retry_at"):
            f.append("CAS 2-run: last_retry_at missing")

        # B
        if len(results["cas3"]) != 1:
            f.append(f"CAS 3-run: {len(results['cas3'])} send_email calls (expected 1)")
        b = rr(d_cas3)
        if b.get("retry_count") != 1 or b.get("delivered") is not True:
            f.append(f"CAS 3-run: row wrong: {b}")

        # C
        cap = rr(d_cap)
        if results["cap"] or cap.get("retry_count") != 5 or cap.get("delivered") is not False:
            f.append(f"cap-5 not skipped: sends={results['cap']} row={cap}")
        done = rr(d_done)
        if results["done"] or done.get("retry_count") != 0:
            f.append(f"delivered reply retried: sends={results['done']} row={done}")
        nf = rr(d_nofield)
        if len(results["nofield"]) != 1 or nf.get("retry_count") != 1 or nf.get("delivered") is not True:
            f.append(f"missing-retry_count reply mishandled: sends={results['nofield']} row={nf}")

        # D
        if len(results["fail1"]) != 1:
            f.append(f"on-fail: {len(results['fail1'])} sends (expected 1)")
        fl = rr(d_fail)
        if fl.get("delivered") is not False:
            f.append(f"on-fail: delivered flipped despite error: {fl}")
        if fl.get("retry_count") != 1:
            f.append(f"on-fail: retry_count={fl.get('retry_count')} (expected 1)")
        if not fl.get("last_retry_at"):
            f.append("on-fail: last_retry_at missing")

        # E
        if len(results["fail2"]) != 1:
            f.append(f"on-fail concurrent: {len(results['fail2'])} sends (expected 1)")
        fl2 = rr(d_fail2)
        if fl2.get("retry_count") != 1 or fl2.get("delivered") is not False:
            f.append(f"on-fail concurrent row wrong: {fl2}")

        mongo.contact_messages.delete_many({"name": {"$regex": "^TEST_iter48_"}})
        assert not f, "; ".join(f)

    def test_next_run_reports_all_jobs(self):
        _bootstrap_env()
        import scheduler
        src = open("/app/backend/scheduler.py").read()
        for jid in ("monday_admin_report_digest", "contact_reply_retry"):
            assert jid in src, jid
        assert callable(scheduler.next_run)


# ==================================================== 2. API regressions
class TestRegressions:
    def test_payments_mode(self, client):
        r = client.get(f"{API}/payments/mode")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert set(d.keys()) == {"mode", "webhook_secret_configured"}, d
        assert d["mode"] == "test", d
        assert d["webhook_secret_configured"] is False, d

    def test_photos_char_cap_and_persistence(self, mongo, client):
        u = mongo.users.find_one({"email": "pro.marina@sailmorenow.dev"})
        assert u, "seeded pro.marina missing"
        tok = _mint(mongo, u["user_id"])
        before = (mongo.boat_pros.find_one({"user_id": u["user_id"]}) or {}).get("photos")
        try:
            prefix = "data:image/jpeg;base64,"
            big = prefix + ("A" * (400_001 - len(prefix)))
            r = client.patch(f"{API}/boat-pros/photos", json={"photos": [big]},
                             headers=_auth(tok))
            assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
            after = (mongo.boat_pros.find_one({"user_id": u["user_id"]}) or {}).get("photos")
            assert after == before, "photos mutated on rejected request"

            small = prefix + ("A" * 100)
            ok = client.patch(f"{API}/boat-pros/photos", json={"photos": [small]},
                              headers=_auth(tok))
            assert ok.status_code == 200, ok.text[:300]
            assert "_id" not in ok.json()
            assert ok.json().get("photos") == [small]
            g = client.get(f"{API}/boat-pros/mine", headers=_auth(tok))
            assert g.status_code == 200
            assert g.json().get("photos") == [small]
        finally:
            mongo.boat_pros.update_one({"user_id": u["user_id"]},
                                       {"$set": {"photos": before or []}})
            mongo.user_sessions.delete_many({"session_token": tok})

    def test_mine_unauth_401(self, client):
        r = client.get(f"{API}/boat-pros/mine")
        assert r.status_code == 401, r.status_code

    def test_admin_contact_reply_contract(self, mongo, client):
        uid = "TEST_iter48_admin"
        mongo.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": "test.iter48.admin@sailmorenow.dev",
            "name": "TEST Admin48", "platform_role": "admin",
            "account_type": "sailor", "onboarding_complete": True}}, upsert=True)
        tok = _mint(mongo, uid)
        d = _doc("reply", [])
        mongo.contact_messages.insert_one(dict(d))
        try:
            r = client.post(f"{API}/admin/contact/{d['id']}/reply",
                            json={"body": "TEST_ iter48 reply body"},
                            headers=_auth(tok))
            assert r.status_code == 200, r.text[:300]
            p = r.json()
            for k in ("ok", "persisted", "delivered", "reply"):
                assert k in p, f"missing {k}: {p}"
            assert p["persisted"] is True
            for k in ("id", "body", "delivered", "at"):
                assert k in p["reply"], f"missing reply.{k}: {p['reply']}"
            doc = mongo.contact_messages.find_one({"id": d["id"]})
            assert len(doc.get("replies", [])) == 1
        finally:
            mongo.contact_messages.delete_one({"id": d["id"]})
            mongo.user_sessions.delete_many({"user_id": uid})
            mongo.users.delete_one({"user_id": uid})
