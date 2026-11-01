"""iter30 — verify server.py _startup collapses legacy duplicate
admin_email_digests docs and (re)creates the unique index on `key`.

Simulates legacy data: drops the unique index, inserts 2 docs with the same
key, restarts the backend via supervisor, then asserts only the newest doc
survived and the unique index is back.
"""
import asyncio
import os
import subprocess
import sys
import time

import pytest
from dotenv import dotenv_values

sys.path.insert(0, "/app/backend")
ENV = dotenv_values("/app/backend/.env")
KEY = "admin_email::test_iter30_legacy@example.com"


def _db():
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(ENV["MONGO_URL"])
    return client, client[ENV["DB_NAME"]]


@pytest.fixture(scope="module")
def collapse_state():
    out = {}

    async def setup():
        client, db = _db()
        try:
            await db.admin_email_digests.drop_index("key_1")
        except Exception as exc:
            out["drop_err"] = str(exc)
        await db.admin_email_digests.delete_many({"key": KEY})
        await db.admin_email_digests.insert_many([
            {"key": KEY, "sent_at": "2026-01-01T00:00:00+00:00"},
            {"key": KEY, "sent_at": "2026-06-01T00:00:00+00:00"},
        ])
        out["pre_count"] = await db.admin_email_digests.count_documents({"key": KEY})
        client.close()

    async def verify():
        client, db = _db()
        out["post_docs"] = await db.admin_email_digests.find({"key": KEY},
                                                            {"_id": 0}).to_list(10)
        out["indexes"] = await db.admin_email_digests.index_information()
        await db.admin_email_digests.delete_many({"key": KEY})
        client.close()

    asyncio.run(setup())
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False,
                   capture_output=True)
    time.sleep(12)
    asyncio.run(verify())
    print("COLLAPSE RESULTS:", out)
    return out


class TestStartupCollapse:
    def test_duplicates_seeded(self, collapse_state):
        assert collapse_state["pre_count"] == 2

    def test_duplicates_collapsed_keeping_latest(self, collapse_state):
        docs = collapse_state["post_docs"]
        assert len(docs) == 1, f"duplicates not collapsed at startup: {docs}"
        assert docs[0]["sent_at"] == "2026-06-01T00:00:00+00:00", docs

    def test_unique_index_recreated(self, collapse_state):
        idx = collapse_state["indexes"]
        uniq = [n for n, s in idx.items()
                if s.get("unique") and [k for k, _ in s.get("key", [])] == ["key"]]
        assert uniq, f"unique index on key missing after startup: {idx}"
