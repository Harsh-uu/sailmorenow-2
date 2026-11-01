"""Iteration 28 retest — the 3 findings from iteration 27.

Covers:
  - POST /api/searches duplicate check uses re.escape (regex metachars are literal)
  - scheduler._monday_admin_report_digest_job ADMIN_EMAILS dedupe via
    db.admin_email_digests claim documents
"""
import os
import sys
import time
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
for _k, _v in backend_env.items():
    if _v is not None:
        os.environ.setdefault(_k, _v)

STAMP = str(int(time.time()))


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def user(mdb):
    uid = f"TEST_iter28_{uuid.uuid4().hex[:8]}"
    tok = f"test_session_iter28_{uuid.uuid4().hex}"
    mdb.users.insert_one({
        "user_id": uid, "email": f"TEST_iter28_{STAMP}@sailmorenow.dev",
        "name": f"TEST_Iter28_{STAMP}", "picture": "https://via.placeholder.com/64",
        "account_type": "sailor", "primary_market": "Greater Seattle",
        "markets": ["Greater Seattle"], "onboarding_complete": True,
        "subscription_tier": "free", "newsletter_opt_in": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield uid, tok
    mdb.users.delete_one({"user_id": uid})
    mdb.user_sessions.delete_many({"user_id": uid})


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# -------------------------------------------------- POST /searches re.escape
class TestSavedSearchRegexEscape:
    def test_regex_metachar_duplicate_detected(self, user, mdb):
        uid, tok = user
        mdb.users.update_one({"user_id": uid}, {"$set": {"saved_searches": []}})

        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "sail.*"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body.get("duplicate") is not True
        assert body["search"]["q"] == "sail.*"

        # persisted
        got = requests.get(f"{API}/searches", headers=_h(tok), timeout=30).json()["searches"]
        assert [s["q"] for s in got] == ["sail.*"]

        # second identical POST -> duplicate
        r2 = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "sail.*"}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("duplicate") is True, r2.text

        got = requests.get(f"{API}/searches", headers=_h(tok), timeout=30).json()["searches"]
        assert len(got) == 1, got

    def test_metachar_saved_does_not_swallow_other_queries(self, user, mdb):
        """With re.escape, 'sail.*' must NOT match 'sailing' as a duplicate."""
        uid, tok = user
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "sailing"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("duplicate") is not True, r.text
        got = requests.get(f"{API}/searches", headers=_h(tok), timeout=30).json()["searches"]
        assert sorted(s["q"] for s in got) == ["sail.*", "sailing"], got
        mdb.users.update_one({"user_id": uid}, {"$set": {"saved_searches": []}})

    def test_other_metachars_case_insensitive_duplicate(self, user, mdb):
        uid, tok = user
        mdb.users.update_one({"user_id": uid}, {"$set": {"saved_searches": []}})
        q = "J/105 (racing)"
        assert requests.post(f"{API}/searches", headers=_h(tok), json={"q": q},
                             timeout=30).status_code == 200
        r = requests.post(f"{API}/searches", headers=_h(tok),
                          json={"q": "j/105 (RACING)"}, timeout=30)
        assert r.json().get("duplicate") is True, r.text
        mdb.users.update_one({"user_id": uid}, {"$set": {"saved_searches": []}})


# -------------------------------------------------- ADMIN_EMAILS dedupe
class TestAdminEmailDigestDedupe:
    def test_extra_admin_email_not_resent_on_rerun(self, mdb):
        import mailer
        import scheduler
        from deps import admin_emails
        from motor.motor_asyncio import AsyncIOMotorClient

        extras = [e for e in admin_emails() if e]
        assert extras, "ADMIN_EMAILS is empty; cannot test extras dedupe"
        extra = extras[0]

        # Snapshot + reset state we are about to mutate
        admin_users = list(mdb.users.find(
            {"$or": [{"platform_role": "admin"}, {"email": {"$in": extras}}]},
            {"_id": 0, "user_id": 1, "admin_report_digest_sent_at": 1}))
        claim_keys = [f"admin_email::{e.lower()}" for e in extras]
        prior_claims = list(mdb.admin_email_digests.find({"key": {"$in": claim_keys}}))
        mdb.admin_email_digests.delete_many({"key": {"$in": claim_keys}})

        sent = []

        async def fake_send_email(*, recipient_email, subject, html_content, reply_to=None):
            sent.append(recipient_email)
            return {"status": "ok"}

        orig = mailer.send_email
        mailer.send_email = fake_send_email
        try:
            async def run():
                client = AsyncIOMotorClient(MONGO_URL)
                adb = client[DB_NAME]
                await scheduler._monday_admin_report_digest_job(adb)
                first = list(sent)
                await scheduler._monday_admin_report_digest_job(adb)
                second = sent[len(first):]
                client.close()
                return first, second

            first, second = asyncio.run(run())

            # First run must email the ADMIN_EMAILS extra + persist a claim doc
            assert extra in first, f"{extra} not emailed on first run: {first}"

            # Second immediate run must NOT re-send and must not duplicate the claim
            assert extra not in second, f"ADMIN_EMAILS dedupe failed, resent to {extra}: {second}"
            claim_docs2 = list(mdb.admin_email_digests.find({"key": f"admin_email::{extra.lower()}"}))
            assert len(claim_docs2) == 1, \
                f"claim doc duplicated on rerun ({len(claim_docs2)} docs) — upsert created a new doc"
            assert claim_docs2[0].get("sent_at")
        finally:
            mailer.send_email = orig
            # cleanup claim docs created by this test, restore any pre-existing
            mdb.admin_email_digests.delete_many({"key": {"$in": claim_keys}})
            for doc in prior_claims:
                mdb.admin_email_digests.insert_one(doc)
            for u in admin_users:
                if u.get("admin_report_digest_sent_at"):
                    mdb.users.update_one({"user_id": u["user_id"]},
                                         {"$set": {"admin_report_digest_sent_at":
                                                   u["admin_report_digest_sent_at"]}})
                else:
                    mdb.users.update_one({"user_id": u["user_id"]},
                                         {"$unset": {"admin_report_digest_sent_at": ""}})
