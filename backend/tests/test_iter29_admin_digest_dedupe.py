"""iter29/30 — retest ADMIN_EMAILS dedupe in scheduler._monday_admin_report_digest_job.

Verifies:
  (a) db.admin_email_digests has a unique index on 'key' created at backend startup
  run 1  -> emails jenn@sailmorenow.com once, exactly one admin_email_digests doc
  run 2  -> no email, still exactly one doc (no duplicate insert)
  run 3  -> after backdating sent_at 9 days, re-emails once and refreshes the
            SAME doc (no new doc)
  run 4  -> per-recipient fault isolation: a Mongo failure while claiming one
            ADMIN_EMAILS address must not block the other address.
Mocks: mailer.send_email (monkeypatched).
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, "/app/backend")

from dotenv import dotenv_values

BACKEND_ENV = dotenv_values("/app/backend/.env")
for k in ("MONGO_URL", "DB_NAME", "ADMIN_EMAILS"):
    if BACKEND_ENV.get(k) and not os.environ.get(k):
        os.environ[k] = BACKEND_ENV[k]

ADMIN_EMAIL = "jenn@sailmorenow.com"
CLAIM_KEY = f"admin_email::{ADMIN_EMAIL}"
# second address used only for the fault-isolation run
OTHER_EMAIL = "test_iter30_admin@example.com"
OTHER_KEY = f"admin_email::{OTHER_EMAIL}"


def _db():
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


class _FailingDigests:
    """Wraps admin_email_digests and raises for one specific claim key."""

    def __init__(self, real, fail_key):
        self._real = real
        self._fail_key = fail_key

    def _boom(self, filt_or_doc):
        key = (filt_or_doc or {}).get("key")
        return key == self._fail_key

    async def update_one(self, filt, update, **kw):
        if self._boom(filt):
            raise RuntimeError("injected mongo failure (update_one)")
        return await self._real.update_one(filt, update, **kw)

    async def insert_one(self, doc, **kw):
        if self._boom(doc):
            raise RuntimeError("injected mongo failure (insert_one)")
        return await self._real.insert_one(doc, **kw)

    def __getattr__(self, name):
        return getattr(self._real, name)


class _DBProxy:
    def __init__(self, db, digests):
        self._db = db
        self._digests = digests

    @property
    def admin_email_digests(self):
        return self._digests

    def __getattr__(self, name):
        return getattr(self._db, name)


@pytest.fixture(scope="module")
def state():
    """Snapshot & restore state mutated by the job; report the raw run results."""
    import mailer
    import scheduler

    sent = []

    async def fake_send_email(recipient_email=None, subject=None, html_content=None, **kw):
        sent.append(recipient_email)
        return {"id": "mock"}

    orig = mailer.send_email
    mailer.send_email = fake_send_email
    orig_admin_emails = os.environ.get("ADMIN_EMAILS")

    results = {}

    async def main():
        client, db = _db()
        # --- snapshot ---
        pre_docs = await db.admin_email_digests.find({}, {"_id": 0}).to_list(200)
        admin_users = await db.users.find(
            {"$or": [{"platform_role": "admin"}, {"email": ADMIN_EMAIL}]},
            {"_id": 0, "user_id": 1, "email": 1, "admin_report_digest_sent_at": 1},
        ).to_list(500)
        results["pre_docs"] = pre_docs
        results["admin_users"] = admin_users
        # index state as produced by backend startup (no manual creation here)
        results["indexes"] = await db.admin_email_digests.index_information()
        # clear only our claim docs so we start from a clean slate
        await db.admin_email_digests.delete_many({"key": {"$in": [CLAIM_KEY, OTHER_KEY]}})

        try:
            # ---- run 1 ----
            sent.clear()
            await scheduler._monday_admin_report_digest_job(db)
            results["run1_sent"] = list(sent)
            results["run1_docs"] = await db.admin_email_digests.find(
                {"key": CLAIM_KEY}, {"_id": 0}).to_list(50)

            # ---- run 2 ----
            sent.clear()
            await scheduler._monday_admin_report_digest_job(db)
            results["run2_sent"] = list(sent)
            results["run2_docs"] = await db.admin_email_digests.find(
                {"key": CLAIM_KEY}, {"_id": 0}).to_list(50)

            # ---- run 3: backdate sent_at beyond the 5-day cutoff ----
            old = (datetime.now(timezone.utc) - timedelta(days=9)).isoformat()
            await db.admin_email_digests.update_many(
                {"key": CLAIM_KEY}, {"$set": {"sent_at": old}})
            # NOTE: admin *user* stamps are deliberately left fresh so the
            # ADMIN_EMAILS (admin_email_digests) branch is the one exercised.
            fresh = datetime.now(timezone.utc).isoformat()
            for u in admin_users:
                await db.users.update_one({"user_id": u["user_id"]},
                                          {"$set": {"admin_report_digest_sent_at": fresh}})
            sent.clear()
            await scheduler._monday_admin_report_digest_job(db)
            results["run3_sent"] = list(sent)
            results["run3_docs"] = await db.admin_email_digests.find(
                {"key": CLAIM_KEY}, {"_id": 0}).to_list(50)

            # ---- run 4: per-recipient fault isolation ----
            # Two ADMIN_EMAILS; injected Mongo failure only for OTHER_EMAIL.
            os.environ["ADMIN_EMAILS"] = f"{ADMIN_EMAIL},{OTHER_EMAIL}"
            await db.admin_email_digests.delete_many(
                {"key": {"$in": [CLAIM_KEY, OTHER_KEY]}})
            for u in admin_users:
                await db.users.update_one({"user_id": u["user_id"]},
                                          {"$set": {"admin_report_digest_sent_at": fresh}})
            proxy = _DBProxy(db, _FailingDigests(db.admin_email_digests, OTHER_KEY))
            sent.clear()
            await scheduler._monday_admin_report_digest_job(proxy)
            results["run4_sent"] = list(sent)
            results["run4_docs"] = await db.admin_email_digests.find(
                {"key": {"$in": [CLAIM_KEY, OTHER_KEY]}}, {"_id": 0}).to_list(50)
        finally:
            # --- cleanup / restore ---
            os.environ["ADMIN_EMAILS"] = orig_admin_emails or ""
            await db.admin_email_digests.delete_many(
                {"key": {"$in": [CLAIM_KEY, OTHER_KEY]}})
            for d in pre_docs:
                await db.admin_email_digests.update_one(
                    {"key": d.get("key")}, {"$set": d}, upsert=True)
            for u in admin_users:
                await db.users.update_one(
                    {"user_id": u["user_id"]},
                    {"$set": {"admin_report_digest_sent_at":
                              u.get("admin_report_digest_sent_at")}})
            results["post_docs"] = await db.admin_email_digests.find(
                {}, {"_id": 0}).to_list(200)
            client.close()

    try:
        asyncio.run(main())
    finally:
        mailer.send_email = orig
    print("RESULTS:", {k: v for k, v in results.items() if k != "admin_users"})
    return results


class TestAdminEmailDigestDedupe:
    def test_admin_email_configured(self, state):
        from deps import admin_emails
        assert ADMIN_EMAIL in admin_emails()

    def test_unique_index_on_key_created_at_startup(self, state):
        idx = state["indexes"]
        uniq = [name for name, spec in idx.items()
                if spec.get("unique") and [k for k, _ in spec.get("key", [])] == ["key"]]
        assert uniq, f"no unique index on admin_email_digests.key; indexes={idx}"

    def test_run1_sends_once_and_creates_one_doc(self, state):
        assert state["run1_sent"].count(ADMIN_EMAIL) == 1, state["run1_sent"]
        docs = state["run1_docs"]
        assert len(docs) == 1, docs
        assert docs[0]["key"] == CLAIM_KEY
        assert docs[0].get("sent_at")

    def test_run2_does_not_resend(self, state):
        assert ADMIN_EMAIL not in state["run2_sent"], state["run2_sent"]

    def test_run2_does_not_duplicate_doc(self, state):
        docs = state["run2_docs"]
        assert len(docs) == 1, f"duplicate claim docs after 2nd run: {docs}"

    def test_run3_resends_after_cutoff_and_refreshes_same_doc(self, state):
        assert state["run3_sent"].count(ADMIN_EMAIL) == 1, state["run3_sent"]
        docs = state["run3_docs"]
        assert len(docs) == 1, f"expected 1 refreshed doc, got {docs}"
        assert docs[0]["sent_at"] > (
            datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    def test_run4_failure_on_one_recipient_does_not_block_other(self, state):
        assert state["run4_sent"].count(ADMIN_EMAIL) == 1, (
            f"healthy recipient not emailed despite isolated failure: {state['run4_sent']}")
        assert OTHER_EMAIL not in state["run4_sent"], state["run4_sent"]
        keys = [d["key"] for d in state["run4_docs"]]
        assert keys == [CLAIM_KEY], keys

    def test_cleanup(self, state):
        async def check():
            client, db = _db()
            n = await db.admin_email_digests.count_documents(
                {"key": {"$in": [CLAIM_KEY, OTHER_KEY]}})
            client.close()
            return n
        expected = len([d for d in state["pre_docs"]
                        if d.get("key") in (CLAIM_KEY, OTHER_KEY)])
        assert asyncio.run(check()) == expected
