"""Iteration 37 — Phase Q backend tests.

Modules under test:
  * directory_router.contact_form        -> POST /api/contact per-IP throttle
  * auth_router.onboarding               -> PATCH /api/auth/onboarding handle claim
  * directory_router.list_pros           -> GET /api/boat-pros `handle` join
  * messaging_router.mark_thread_read    -> POST /api/messages/{thread_id}/read
"""
import asyncio
import os
import sys
import uuid
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

MARKET = "Greater Seattle"


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def db():
    from deps import db as _db
    return _db


def _mk_user(db, suffix, handle=None):
    """user_ids intentionally contain no '-' (thread_id parsing splits on '-')."""
    uid = f"TEST_iter37_{suffix}_{uuid.uuid4().hex[:8]}"
    token = f"TEST_iter37_sess_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": uid, "email": f"{uid}@sailmorenow.dev", "name": f"TEST Iter37 {suffix}",
        "account_type": "sailor", "primary_market": MARKET, "markets": [MARKET],
        "onboarding_complete": True, "created_at": now.isoformat(),
    }
    if handle:
        doc["handle"] = handle
    _run(db.users.insert_one(doc))
    _run(db.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": now.replace(year=now.year + 1), "created_at": now,
    }))
    return {"user_id": uid, "token": token, "handle": handle}


@pytest.fixture(scope="module")
def users(db):
    a = _mk_user(db, "alpha")
    b = _mk_user(db, "beta")
    c = _mk_user(db, "gamma")
    yield {"a": a, "b": b, "c": c}
    ids = [a["user_id"], b["user_id"], c["user_id"]]
    _run(db.users.delete_many({"user_id": {"$in": ids}}))
    _run(db.user_sessions.delete_many({"user_id": {"$in": ids}}))
    _run(db.dm_messages.delete_many({"from_id": {"$in": ids}}))
    _run(db.dm_threads.delete_many({"participants": {"$in": ids}}))


def _hdr(u):
    return {"Authorization": f"Bearer {u['token']}"}


# ------------------------------------------------- POST /api/contact rate limit
class TestContactRateLimit:
    def _payload(self, marker):
        return {"name": marker, "email": "iter37+qa@example.com",
                "message": f"Valid QA contact message for {marker}"}

    def test_three_ok_fourth_429(self, client, db):
        ip = f"203.0.113.{uuid.uuid4().int % 200 + 1}"
        marker = f"TEST_iter37_rl_{uuid.uuid4().hex[:8]}"
        codes = []
        for i in range(4):
            r = client.post(f"{API}/contact", json=self._payload(f"{marker}_{i}"),
                            headers={"X-Forwarded-For": ip})
            codes.append(r.status_code)
        assert codes[:3] == [200, 200, 200], codes
        assert codes[3] == 429, codes
        body = client.post(f"{API}/contact", json=self._payload(marker),
                           headers={"X-Forwarded-For": ip})
        assert body.status_code == 429
        assert "detail" in body.json()
        # only 3 rows persisted for this IP
        docs = _run(db.contact_messages.find({"ip": ip}, {"_id": 0}).to_list(20))
        assert len(docs) == 3, f"expected 3 persisted, got {len(docs)}"
        _run(db.contact_messages.delete_many({"ip": ip}))

    def test_different_ip_not_throttled(self, client, db):
        ip1 = f"198.51.100.{uuid.uuid4().int % 120 + 1}"
        ip2 = f"198.51.100.{uuid.uuid4().int % 120 + 130}"
        marker = f"TEST_iter37_rl2_{uuid.uuid4().hex[:8]}"
        for i in range(3):
            client.post(f"{API}/contact", json=self._payload(f"{marker}_{i}"),
                        headers={"X-Forwarded-For": ip1})
        assert client.post(f"{API}/contact", json=self._payload(marker),
                           headers={"X-Forwarded-For": ip1}).status_code == 429
        r = client.post(f"{API}/contact", json=self._payload(f"{marker}_other"),
                        headers={"X-Forwarded-For": ip2})
        assert r.status_code == 200, r.text
        _run(db.contact_messages.delete_many({"ip": {"$in": [ip1, ip2]}}))

    def test_invalid_submissions_do_not_consume_quota(self, client, db):
        """iter39 fix: throttle runs AFTER validation, so three 400s must not
        lock the user out — the following valid submission returns 200."""
        ip = f"192.0.2.{uuid.uuid4().int % 200 + 1}"
        for _ in range(3):
            r = client.post(f"{API}/contact", json={"name": "x", "email": "bad", "message": "hi"},
                            headers={"X-Forwarded-For": ip})
            assert r.status_code == 400
        r = client.post(f"{API}/contact", json={
            "name": "TEST_iter37_valid", "email": "ok@example.com",
            "message": "a perfectly valid message"}, headers={"X-Forwarded-For": ip})
        assert r.status_code == 200, (
            f"invalid submissions must not consume quota, got {r.status_code}: {r.text}")
        docs = _run(db.contact_messages.find({"ip": ip}, {"_id": 0}).to_list(20))
        assert len(docs) == 1, f"expected only the valid submission persisted, got {len(docs)}"
        _run(db.contact_messages.delete_many({"ip": ip}))


# ------------------------------------------- PATCH /api/auth/onboarding handle
class TestOnboardingHandle:
    def _body(self, **kw):
        b = {"account_type": "sailor", "primary_market": MARKET, "markets": [MARKET],
             "reasons": [], "avatar": "⛵", "username": None, "bio": "TEST bio",
             "newsletter_opt_in": False, "policies_agreed": True}
        b.update(kw)
        return b

    def test_valid_handle_persists_lowercase(self, client, users, db):
        h = f"Iter37{uuid.uuid4().hex[:6]}"
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle=h),
                         headers=_hdr(users["a"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["handle"] == h.lower()
        assert d["onboarding_complete"] is True
        assert "_id" not in d
        me = client.get(f"{API}/auth/me", headers=_hdr(users["a"]))
        assert me.status_code == 200
        assert me.json()["handle"] == h.lower()
        doc = _run(db.users.find_one({"user_id": users["a"]["user_id"]}, {"_id": 0}))
        assert doc["handle"] == h.lower()
        users["a"]["handle"] = h.lower()

    def test_at_prefix_stripped(self, client, users):
        h = f"iter37p{uuid.uuid4().hex[:5]}"
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle=f"@{h}"),
                         headers=_hdr(users["c"]))
        assert r.status_code == 200, r.text
        assert r.json()["handle"] == h
        users["c"]["handle"] = h

    def test_too_short_400(self, client, users):
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle="ab"),
                         headers=_hdr(users["b"]))
        assert r.status_code == 400, r.text
        assert "3-20" in r.json()["detail"]

    def test_space_400(self, client, users):
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle="has space"),
                         headers=_hdr(users["b"]))
        assert r.status_code == 400, r.text

    def test_too_long_400(self, client, users):
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle="a" * 21),
                         headers=_hdr(users["b"]))
        assert r.status_code == 400, r.text

    def test_duplicate_handle_409(self, client, users):
        taken = users["a"]["handle"]
        assert taken, "prerequisite test_valid_handle_persists_lowercase must run first"
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle=taken.upper()),
                         headers=_hdr(users["b"]))
        assert r.status_code == 409, r.text

    def test_null_handle_leaves_existing_untouched(self, client, users, db):
        existing = users["a"]["handle"]
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle=None),
                         headers=_hdr(users["a"]))
        assert r.status_code == 200, r.text
        assert r.json()["handle"] == existing
        doc = _run(db.users.find_one({"user_id": users["a"]["user_id"]}, {"_id": 0}))
        assert doc["handle"] == existing

    def test_unauthenticated_401(self, client):
        r = client.patch(f"{API}/auth/onboarding", json=self._body(handle="whatever1"))
        assert r.status_code == 401


# --------------------------------------------------- GET /api/boat-pros handle
class TestBoatProsHandle:
    def test_handle_key_present_and_populated(self, client, db):
        r = client.get(f"{API}/boat-pros")
        assert r.status_code == 200, r.text
        pros = r.json()
        assert isinstance(pros, list) and len(pros) > 0
        for p in pros:
            assert "handle" in p, f"pro {p.get('id')} missing handle key"
            assert "_id" not in p
        # cross-check against users collection
        checked = 0
        for p in pros:
            uid = p.get("user_id")
            if not uid:
                continue
            u = _run(db.users.find_one({"user_id": uid}, {"_id": 0, "handle": 1}))
            expected = (u or {}).get("handle")
            assert p["handle"] == (expected if expected else None), (
                f"handle mismatch for {uid}: api={p['handle']} db={expected}")
            checked += 1
        assert checked > 0, "no pros with user_id to verify"

    def test_handle_null_when_user_has_none(self, client, db):
        """Temporarily unset a pro's user handle and confirm the API returns null."""
        pros = client.get(f"{API}/boat-pros").json()
        target = next((p for p in pros if p.get("user_id") and p.get("handle")), None)
        if not target:
            pytest.skip("no pro with a handle to mutate")
        uid, old = target["user_id"], target["handle"]
        _run(db.users.update_one({"user_id": uid}, {"$unset": {"handle": ""}}))
        try:
            again = client.get(f"{API}/boat-pros").json()
            got = next(p for p in again if p.get("user_id") == uid)
            assert got["handle"] is None
        finally:
            _run(db.users.update_one({"user_id": uid}, {"$set": {"handle": old}}))


# ------------------------------------- POST /api/messages/{thread_id}/read
def _tid(a, b):
    return "-".join(sorted([a, b]))


class TestReadReceipts:
    def _seed_msgs(self, db, sender, receiver, n=2):
        tid = _tid(sender["user_id"], receiver["user_id"])
        now = datetime.now(timezone.utc).isoformat()
        ids = []
        for i in range(n):
            mid = str(uuid.uuid4())
            ids.append(mid)
            _run(db.dm_messages.insert_one({
                "id": mid, "thread_id": tid, "from_id": sender["user_id"],
                "from_name": "TEST", "to_id": receiver["user_id"],
                "body": f"TEST_iter37 msg {i}", "created_at": now, "read_at": None,
            }))
        _run(db.dm_threads.update_one({"thread_id": tid}, {"$set": {
            "thread_id": tid, "participants": [sender["user_id"], receiver["user_id"]],
            "updated_at": now, "last_message": "TEST_iter37"}}, upsert=True))
        return tid, ids

    def test_unauthenticated_401(self, client, users):
        tid = _tid(users["a"]["user_id"], users["b"]["user_id"])
        r = client.post(f"{API}/messages/{tid}/read")
        assert r.status_code == 401, r.text

    def test_non_participant_403(self, client, users):
        tid = _tid(users["a"]["user_id"], users["b"]["user_id"])
        r = client.post(f"{API}/messages/{tid}/read", headers=_hdr(users["c"]))
        assert r.status_code == 403, r.text

    def test_marks_inbound_only_and_idempotent(self, client, users, db):
        tid, ids = self._seed_msgs(db, users["a"], users["b"], n=2)
        # an outbound message from the reader must NOT be touched
        own_id = str(uuid.uuid4())
        _run(db.dm_messages.insert_one({
            "id": own_id, "thread_id": tid, "from_id": users["b"]["user_id"],
            "from_name": "TEST", "to_id": users["a"]["user_id"],
            "body": "TEST_iter37 outbound", "created_at": datetime.now(timezone.utc).isoformat(),
            "read_at": None}))

        r = client.post(f"{API}/messages/{tid}/read", headers=_hdr(users["b"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["marked"] == 2, d

        for mid in ids:
            doc = _run(db.dm_messages.find_one({"id": mid}, {"_id": 0}))
            assert doc["read_at"], f"{mid} not marked read"
        own = _run(db.dm_messages.find_one({"id": own_id}, {"_id": 0}))
        assert own["read_at"] is None, "reader's own outbound message must stay unread"

        # GET history reflects read_at
        hist = client.get(f"{API}/messages/{tid}", headers=_hdr(users["a"]))
        assert hist.status_code == 200
        got = {m["id"]: m for m in hist.json()}
        assert all(got[mid]["read_at"] for mid in ids)

        # second call is a no-op
        r2 = client.post(f"{API}/messages/{tid}/read", headers=_hdr(users["b"]))
        assert r2.status_code == 200
        assert r2.json()["marked"] == 0

        _run(db.dm_messages.delete_many({"thread_id": tid}))
        _run(db.dm_threads.delete_many({"thread_id": tid}))

    def test_legacy_message_without_read_at_field_is_marked(self, client, users, db):
        """Pre-iter37 docs have no read_at key at all."""
        tid = _tid(users["a"]["user_id"], users["b"]["user_id"])
        mid = str(uuid.uuid4())
        _run(db.dm_messages.insert_one({
            "id": mid, "thread_id": tid, "from_id": users["a"]["user_id"],
            "to_id": users["b"]["user_id"], "body": "TEST_iter37 legacy",
            "created_at": datetime.now(timezone.utc).isoformat()}))
        r = client.post(f"{API}/messages/{tid}/read", headers=_hdr(users["b"]))
        assert r.status_code == 200, r.text
        assert r.json()["marked"] == 1
        doc = _run(db.dm_messages.find_one({"id": mid}, {"_id": 0}))
        assert doc.get("read_at")
        _run(db.dm_messages.delete_many({"thread_id": tid}))
        _run(db.dm_threads.delete_many({"thread_id": tid}))

    def test_send_message_sets_read_at_null(self, client, users, db):
        r = client.post(f"{API}/messages/{users['b']['user_id']}",
                        json={"body": "TEST_iter37 live send"}, headers=_hdr(users["a"]))
        assert r.status_code == 200, r.text
        msg = r.json()
        assert "read_at" in msg and msg["read_at"] is None
        assert "_id" not in msg
        _run(db.dm_messages.delete_many({"id": msg["id"]}))

    def test_dashed_user_id_participant_allowed(self, client, db):
        """iter39 fix: participants come from db.dm_threads.participants, so a
        user_id containing dashes (e.g. 'test-user-t1') is no longer rejected."""
        uid = "TEST-iter39-dash-" + uuid.uuid4().hex[:6]
        token = f"TEST_iter39_dash_{uuid.uuid4().hex}"
        now = datetime.now(timezone.utc)
        other = "seed_marina"
        tid = _tid(uid, other)
        _run(db.users.insert_one({"user_id": uid, "email": f"{uid}@x.dev", "name": "TEST dash",
                                  "account_type": "sailor", "onboarding_complete": True}))
        _run(db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                          "expires_at": now.replace(year=now.year + 1),
                                          "created_at": now}))
        _run(db.dm_threads.update_one({"thread_id": tid}, {"$set": {
            "thread_id": tid, "participants": [uid, other],
            "updated_at": now.isoformat(), "last_message": "TEST_iter39"}}, upsert=True))
        mid = str(uuid.uuid4())
        _run(db.dm_messages.insert_one({
            "id": mid, "thread_id": tid, "from_id": other, "to_id": uid,
            "body": "TEST_iter39 inbound", "created_at": now.isoformat(), "read_at": None}))
        hdr = {"Authorization": f"Bearer {token}"}
        try:
            g = client.get(f"{API}/messages/{tid}", headers=hdr)
            assert g.status_code == 200, f"GET history got {g.status_code}: {g.text}"
            assert any(m["id"] == mid for m in g.json())
            r = client.post(f"{API}/messages/{tid}/read", headers=hdr)
            assert r.status_code == 200, (
                f"participant with dashed user_id got {r.status_code} on own thread: {r.text}")
            assert r.json()["marked"] == 1, r.text
            doc = _run(db.dm_messages.find_one({"id": mid}, {"_id": 0}))
            assert doc["read_at"], "inbound message should be marked read"
        finally:
            _run(db.users.delete_many({"user_id": uid}))
            _run(db.user_sessions.delete_many({"user_id": uid}))
            _run(db.dm_messages.delete_many({"thread_id": tid}))
            _run(db.dm_threads.delete_many({"thread_id": tid}))

    def test_non_participant_on_existing_thread_403(self, client, db, users):
        """A user NOT in dm_threads.participants must still get 403 even though
        their id happens to appear as a dash-token of the thread_id."""
        uid = "TEST-iter39-out-" + uuid.uuid4().hex[:6]
        token = f"TEST_iter39_out_{uuid.uuid4().hex}"
        now = datetime.now(timezone.utc)
        tid = _tid(users["a"]["user_id"], users["b"]["user_id"])
        _run(db.users.insert_one({"user_id": uid, "email": f"{uid}@x.dev", "name": "TEST out",
                                  "account_type": "sailor", "onboarding_complete": True}))
        _run(db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                          "expires_at": now.replace(year=now.year + 1),
                                          "created_at": now}))
        _run(db.dm_threads.update_one({"thread_id": tid}, {"$set": {
            "thread_id": tid, "participants": [users["a"]["user_id"], users["b"]["user_id"]],
            "updated_at": now.isoformat()}}, upsert=True))
        try:
            hdr = {"Authorization": f"Bearer {token}"}
            assert client.get(f"{API}/messages/{tid}", headers=hdr).status_code == 403
            assert client.post(f"{API}/messages/{tid}/read", headers=hdr).status_code == 403
        finally:
            _run(db.users.delete_many({"user_id": uid}))
            _run(db.user_sessions.delete_many({"user_id": uid}))
            _run(db.dm_threads.delete_many({"thread_id": tid}))
