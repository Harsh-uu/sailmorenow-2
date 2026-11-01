"""Iteration 39 — in-process unit test for directory_router._CONTACT_RATE pruning.

The HTTP server runs in a separate process, so the expired-key pruning branch
must be exercised by calling the coroutine directly.
Module under test: directory_router.contact_form
"""
import asyncio
import os
import sys
import uuid

import pytest
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeClient:
    host = "127.0.0.1"


class _FakeRequest:
    def __init__(self, ip):
        self.headers = {"x-forwarded-for": ip}
        self.client = _FakeClient()


@pytest.fixture(scope="module")
def mod():
    import routers.directory_router as m
    return m


def _payload(marker):
    return {"name": marker, "email": "iter39+prune@example.com",
            "message": "A perfectly valid contact message for pruning test."}


def test_expired_keys_are_pruned(mod):
    ip = f"203.0.113.{uuid.uuid4().int % 250 + 1}"
    mod._CONTACT_RATE["9.9.9.9"] = [0.0]  # epoch -> long expired
    res = _run(mod.contact_form(_payload("TEST_iter39_prune"), _FakeRequest(ip)))
    assert res == {"ok": True}
    assert "9.9.9.9" not in mod._CONTACT_RATE, "expired IP key should be pruned"
    assert mod._CONTACT_RATE.get(ip) and len(mod._CONTACT_RATE[ip]) == 1
    from deps import db
    _run(db.contact_messages.delete_many({"ip": ip}))
    mod._CONTACT_RATE.pop(ip, None)


def test_invalid_payload_records_no_hit(mod):
    ip = f"198.51.100.{uuid.uuid4().int % 250 + 1}"
    from fastapi import HTTPException
    for _ in range(4):
        with pytest.raises(HTTPException) as e:
            _run(mod.contact_form({"name": "x", "email": "bad", "message": "hi"},
                                  _FakeRequest(ip)))
        assert e.value.status_code == 400
    assert ip not in mod._CONTACT_RATE
    res = _run(mod.contact_form(_payload("TEST_iter39_after_invalid"), _FakeRequest(ip)))
    assert res == {"ok": True}
    from deps import db
    _run(db.contact_messages.delete_many({"ip": ip}))
    mod._CONTACT_RATE.pop(ip, None)
