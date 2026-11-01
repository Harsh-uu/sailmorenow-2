"""Iteration 20 — focused retest of the CRITICAL VAPID key-format fix + iter19 action items.

Covers:
  push.py       -> persisted private_key is a b64url raw 32-byte scalar loadable by py_vapid
                -> Vapid.sign() actually produces an Authorization header (real delivery path)
                -> legacy PKCS8-PEM doc is auto-migrated on load
                -> send_push_to_user returns N>0 with a mocked successful webpush
                -> 410 WebPushException prunes the subscription doc
  notifications -> notify() push fanout is fire-and-forget (create_task, request path < 200ms)
  hub_router    -> GET /api/discussions?status=pending sorted by created_at desc (admin)
"""
import os
import sys
import json
import time
import uuid
import asyncio
import subprocess

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

DB = "test_database"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw")
RUN_PREFIX = "TEST_user20_" + WORKER + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(is_admin=False):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST_User20',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'],
      onboarding_complete:true, subscription_tier:'premium', newsletter_opt_in:false,
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "User-Agent": UA})
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mongo(f"""
    var ids = db.users.find({{user_id:{{$regex:'^{RUN_PREFIX}'}}}},{{user_id:1}}).toArray().map(u=>u.user_id);
    db.push_subscriptions.deleteMany({{user_id:{{$in:ids}}}});
    db.push_subscriptions.deleteMany({{endpoint:{{$regex:'{RUN_PREFIX}'}}}});
    db.discussions.deleteMany({{author_id:{{$in:ids}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


# ---------- in-process helpers ----------
def _load_backend():
    for k, v in dotenv_values("/app/backend/.env").items():
        if v is not None:
            os.environ.setdefault(k, v)
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")


_LOOP = None


def _run(coro):
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        _LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)


@pytest.fixture
def inproc_db(monkeypatch):
    """Motor db bound to this module's persistent loop, patched into modules under test."""
    _load_backend()
    from motor.motor_asyncio import AsyncIOMotorClient
    import push as push_mod
    import notifications as notif_mod

    async def _mk():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        return c[os.environ["DB_NAME"]]

    mdb = _run(_mk())
    monkeypatch.setattr(push_mod, "db", mdb)
    monkeypatch.setattr(notif_mod, "db", mdb)
    return mdb


def _vapid_doc():
    return json.loads(mongo(
        "print(JSON.stringify(db.settings.findOne({key:'vapid'},{_id:0})))"))


# ---------- 1. VAPID key format (the CRITICAL fix) ----------
class TestVapidKeyFormat:
    def test_persisted_private_key_loadable_by_py_vapid(self):
        _load_backend()
        from py_vapid import Vapid
        doc = _vapid_doc()
        assert doc, "no persisted VAPID settings doc"
        assert doc.get("private_key"), "private_key missing"
        assert "private_pem" not in doc, "legacy private_pem field still present"
        priv = doc["private_key"]
        assert "BEGIN" not in priv
        assert len(priv) == 43, f"expected 43-char b64url raw 32-byte scalar, got {len(priv)}"
        v = Vapid.from_string(private_key=priv)
        assert v.private_key is not None

    def test_public_key_matches_private_key(self):
        _load_backend()
        import base64
        from py_vapid import Vapid
        doc = _vapid_doc()
        v = Vapid.from_string(private_key=doc["private_key"])
        nums = v.public_key.public_numbers()
        raw = b"\x04" + nums.x.to_bytes(32, "big") + nums.y.to_bytes(32, "big")
        derived = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
        assert derived == doc["public_key"], "public_key does not match private_key"

    def test_vapid_sign_produces_auth_header(self):
        """The exact crypto step pywebpush performs on every real delivery."""
        _load_backend()
        from py_vapid import Vapid
        doc = _vapid_doc()
        v = Vapid.from_string(private_key=doc["private_key"])
        headers = v.sign({"aud": "https://fcm.googleapis.com", "sub": doc["subject"]})
        assert "Authorization" in headers, headers
        assert headers["Authorization"].startswith("vapid ") or \
            headers["Authorization"].startswith("WebPush "), headers["Authorization"]

    def test_api_public_key_matches_db(self, client):
        r = client.get(f"{BASE}/push/vapid-public-key")
        assert r.status_code == 200, r.text
        assert r.json()["public_key"] == _vapid_doc()["public_key"], \
            "server cached a different key than what is persisted"

    def test_legacy_pem_doc_is_migrated_on_load(self, inproc_db):
        """A legacy PKCS8-PEM entry must be replaced by a loadable b64url key."""
        _load_backend()
        import push as push_mod
        from py_vapid import Vapid
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        original = _vapid_doc()
        pem = ec.generate_private_key(ec.SECP256R1(), default_backend()).private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()).decode()
        try:
            mongo("db.settings.deleteOne({key:'vapid'});"
                  "db.settings.insertOne({key:'vapid', private_pem:" + json.dumps(pem) +
                  ", public_key:'legacy', subject:'mailto:legacy@test.dev'});")
            push_mod._VAPID_CACHE.clear()
            keys = _run(push_mod._ensure_vapid_keys())
            assert "BEGIN" not in keys["private_key"]
            Vapid.from_string(private_key=keys["private_key"])
            migrated = _vapid_doc()
            assert "private_pem" not in migrated, "legacy private_pem not unset"
            assert migrated["private_key"] == keys["private_key"]
            assert migrated["public_key"] != "legacy"
            assert mongo("print(db.settings.countDocuments({key:'vapid'}))").strip() == "1"
        finally:
            mongo("db.settings.replaceOne({key:'vapid'}," + json.dumps(original) + ",{upsert:true});")
            push_mod._VAPID_CACHE.clear()
        assert _vapid_doc() == original


# ---------- 2. Push delivery smoke (mocked webpush) ----------
class TestPushDelivery:
    def test_send_push_returns_nonzero_with_successful_webpush(self, monkeypatch, inproc_db):
        _load_backend()
        import push as push_mod
        uid, _ = mint_user()
        eps = [f"https://fcm.test/{RUN_PREFIX}ok{i}" for i in range(2)]
        for ep in eps:
            mongo(f"""db.push_subscriptions.insertOne({{user_id:'{uid}', endpoint:'{ep}',
              subscription:{{endpoint:'{ep}', keys:{{p256dh:'BQ', auth:'AA'}}}},
              created_at:new Date().toISOString()}});""")
        calls = []
        monkeypatch.setattr(push_mod, "webpush", lambda **kw: calls.append(kw) or True)
        sent = _run(push_mod.send_push_to_user(uid, {"title": "t", "body": "b", "url": "/"}))
        assert sent == 2, f"expected sent=2, got {sent}"
        assert len(calls) == 2
        # the key handed to pywebpush must be the loadable b64url one
        for kw in calls:
            assert "BEGIN" not in kw["vapid_private_key"]
            assert len(kw["vapid_private_key"]) == 43
            assert kw["vapid_claims"]["sub"].startswith("mailto:")
            assert json.loads(kw["data"])["title"] == "t"

    def test_push_test_endpoint_reports_sent_count(self, client, monkeypatch, inproc_db):
        """POST /api/push/test hits the real (network) webpush, so assert the
        server-side count path via the same code with a mocked webpush and the
        HTTP endpoint's contract shape."""
        uid, tok = mint_user()
        ep = f"https://fcm.test/{RUN_PREFIX}httptest"
        r = client.post(f"{BASE}/push/subscribe", headers=auth(tok),
                        json={"subscription": {"endpoint": ep,
                                               "keys": {"p256dh": "BQ" + "A" * 85,
                                                        "auth": "A" * 22}}})
        assert r.status_code == 200, r.text
        r2 = client.post(f"{BASE}/push/test", headers=auth(tok))
        assert r2.status_code == 200, r2.text
        assert "sent" in r2.json() and isinstance(r2.json()["sent"], int)
        # in-process with mocked transport the same user must yield sent=1
        _load_backend()
        import push as push_mod
        monkeypatch.setattr(push_mod, "webpush", lambda **kw: True)
        assert _run(push_mod.send_push_to_user(uid, {"title": "x"})) >= 1

    def test_410_deletes_subscription(self, monkeypatch, inproc_db):
        _load_backend()
        import push as push_mod
        uid, _ = mint_user()
        ep = f"https://fcm.test/{RUN_PREFIX}gone410"
        mongo(f"""db.push_subscriptions.insertOne({{user_id:'{uid}', endpoint:'{ep}',
          subscription:{{endpoint:'{ep}', keys:{{p256dh:'BQ', auth:'AA'}}}},
          created_at:new Date().toISOString()}});""")

        class Resp:
            status_code = 410

        def boom(**kwargs):
            e = push_mod.WebPushException("gone")
            e.response = Resp()
            raise e

        monkeypatch.setattr(push_mod, "webpush", boom)
        assert _run(push_mod.send_push_to_user(uid, {"title": "x"})) == 0
        assert mongo(f"print(db.push_subscriptions.countDocuments({{endpoint:'{ep}'}}))").strip() == "0"


# ---------- 3. notify() fanout is fire-and-forget ----------
class TestNotifyFireAndForget:
    def test_notify_returns_before_slow_push_completes(self, monkeypatch, inproc_db):
        _load_backend()
        import push as push_mod
        import notifications as notif_mod
        uid, _ = mint_user()
        started = {"v": False}

        async def slow_send(user_id, payload):
            started["v"] = True
            await asyncio.sleep(1.0)
            return 1

        monkeypatch.setattr(push_mod, "send_push_to_user", slow_send)

        async def run():
            t0 = time.monotonic()
            doc = await notif_mod.notify(uid, "dm", "TEST_user20 fnf", body="b", link="/messages")
            elapsed = time.monotonic() - t0
            # let the background task start so we prove it was actually scheduled
            await asyncio.sleep(0.05)
            return doc, elapsed

        doc, elapsed = _run(run())
        assert doc["kind"] == "dm" and "_id" not in doc
        assert elapsed < 0.2, f"notify() awaited the push fanout ({elapsed:.3f}s)"
        assert started["v"] is True, "push fanout task was never scheduled"
        assert mongo(
            f"print(db.notifications.countDocuments({{user_id:'{uid}', kind:'dm'}}))").strip() == "1"


# ---------- 4. Discussions sort by created_at for non-published statuses ----------
class TestDiscussionsSort:
    def test_pending_list_sorted_by_created_at_desc(self, client):
        uid, tok = mint_user()
        _, admin_tok = mint_user(is_admin=True)
        ids = []
        for i in range(3):
            r = client.post(f"{BASE}/discussions", headers=auth(tok),
                            json={"kind": "blog", "title": f"TEST_user20 sort {i}",
                                  "body": "b", "market": MARKET})
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["status"] == "pending" and d["published_at"] is None
            ids.append(d["id"])
        # scramble created_at: ids[1] newest, ids[0] middle, ids[2] oldest
        stamps = {ids[1]: "2026-06-03T00:00:00+00:00",
                  ids[0]: "2026-06-02T00:00:00+00:00",
                  ids[2]: "2026-06-01T00:00:00+00:00"}
        for did, ts in stamps.items():
            mongo(f"db.discussions.updateOne({{id:'{did}'}},{{$set:{{created_at:'{ts}'}}}});")
        r = client.get(f"{BASE}/discussions", params={"kind": "blog", "status": "pending"},
                       headers=auth(admin_tok))
        assert r.status_code == 200, r.text
        mine = [d for d in r.json() if d["id"] in ids]
        assert len(mine) == 3, f"expected 3 pending docs, got {len(mine)}"
        assert [d["id"] for d in mine] == [ids[1], ids[0], ids[2]], \
            f"not sorted by created_at desc: {[d['created_at'] for d in mine]}"
        got = [d["created_at"] for d in mine]
        assert got == sorted(got, reverse=True)

    def test_published_list_still_sorted_by_published_at_desc(self, client):
        _, tok = mint_user()
        ids = []
        for i in range(2):
            d = client.post(f"{BASE}/discussions", headers=auth(tok),
                            json={"kind": "forum", "title": f"TEST_user20 pub {i}",
                                  "body": "b", "market": MARKET}).json()
            ids.append(d["id"])
        mongo(f"db.discussions.updateOne({{id:'{ids[0]}'}},"
              f"{{$set:{{published_at:'2026-06-09T00:00:00+00:00'}}}});")
        mongo(f"db.discussions.updateOne({{id:'{ids[1]}'}},"
              f"{{$set:{{published_at:'2026-06-08T00:00:00+00:00'}}}});")
        docs = client.get(f"{BASE}/discussions", params={"kind": "forum"}).json()
        mine = [d["id"] for d in docs if d["id"] in ids]
        assert mine == [ids[0], ids[1]], f"published sort wrong: {mine}"

    def test_pending_list_still_admin_only(self, client):
        _, tok = mint_user()
        assert client.get(f"{BASE}/discussions",
                          params={"status": "pending"}).status_code == 403
        assert client.get(f"{BASE}/discussions", params={"status": "pending"},
                          headers=auth(tok)).status_code == 403


# ---------- 5. Regression guard: seeded identity_verified preserved ----------
def test_seed_alex_identity_verified_preserved():
    out = mongo("print(JSON.stringify(db.users.findOne("
                "{email:'crew.alex@sailmorenow.dev'},{_id:0,identity_verified:1})))")
    doc = json.loads(out)
    assert doc and doc.get("identity_verified") is True, doc


# ---------- 6. REAL (unmocked) webpush delivery against a local push service ----------
class TestRealDelivery:
    """No mocks: pywebpush signs with the persisted VAPID key, encrypts with a real
    P-256 client key and POSTs to a local HTTP server standing in for FCM.
    This is the path that silently failed before the iteration-19 fix."""

    def test_end_to_end_delivery_no_mocks(self, inproc_db):
        _load_backend()
        import base64
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives.asymmetric import ec
        import push as push_mod

        received = []

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n)
                received.append({"headers": dict(self.headers), "len": len(body)})
                self.send_response(201)
                self.end_headers()

            def log_message(self, *a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            client_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
            nums = client_key.public_key().public_numbers()
            raw = b"\x04" + nums.x.to_bytes(32, "big") + nums.y.to_bytes(32, "big")
            p256dh = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
            auth_secret = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()
            uid, _ = mint_user()
            ep = f"http://127.0.0.1:{port}/push/{RUN_PREFIX}real"
            mongo("db.push_subscriptions.insertOne(" + json.dumps({
                "user_id": uid, "endpoint": ep,
                "subscription": {"endpoint": ep,
                                 "keys": {"p256dh": p256dh, "auth": auth_secret}},
                "created_at": "2026-06-01T00:00:00+00:00"}) + ");")
            sent = _run(push_mod.send_push_to_user(uid, {"title": "TEST_user20 real", "url": "/"}))
            assert sent == 1, ("real webpush delivery failed (sent=%s) — check backend "
                               "logs for a VAPID key error" % sent)
            assert len(received) == 1
            hdrs = {k.lower(): v for k, v in received[0]["headers"].items()}
            assert "authorization" in hdrs, hdrs
            assert "vapid" in hdrs["authorization"].lower(), hdrs["authorization"]
            assert "t=" in hdrs["authorization"] and "k=" in hdrs["authorization"]
            assert hdrs.get("content-encoding") == "aes128gcm", hdrs
            assert received[0]["len"] > 0
        finally:
            srv.shutdown()
            srv.server_close()

    def test_push_test_endpoint_returns_sent_gt_zero(self, client):
        """Full HTTP path: POST /api/push/test with a real subscription whose
        endpoint is a local push service in this container -> {sent: 1}."""
        import base64
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives.asymmetric import ec

        hits = []

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                hits.append(self.headers.get("Authorization"))
                self.send_response(201)
                self.end_headers()

            def log_message(self, *a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            k = ec.generate_private_key(ec.SECP256R1(), default_backend())
            n = k.public_key().public_numbers()
            raw = b"\x04" + n.x.to_bytes(32, "big") + n.y.to_bytes(32, "big")
            _, tok = mint_user()
            ep = f"http://127.0.0.1:{port}/push/{RUN_PREFIX}api"
            body = {"subscription": {"endpoint": ep, "keys": {
                "p256dh": base64.urlsafe_b64encode(raw).rstrip(b"=").decode(),
                "auth": base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()}}}
            assert client.post(f"{BASE}/push/subscribe", headers=auth(tok),
                               json=body).status_code == 200
            r = client.post(f"{BASE}/push/test", headers=auth(tok), timeout=30)
            assert r.status_code == 200, r.text
            assert r.json()["sent"] == 1, f"{r.json()} — expected sent=1, real push failed"
            assert hits and "vapid" in (hits[0] or "").lower(), hits
        finally:
            srv.shutdown()
            srv.server_close()
