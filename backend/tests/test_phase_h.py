"""Phase H tests.

Covers:
  GET  /api/push/vapid-public-key          -> public, 87-char b64 key, stable
  POST /api/push/subscribe                 -> 401 anon, 400 bad body, upsert
  POST /api/push/unsubscribe               -> only own doc deleted
  POST /api/push/test                      -> 401 anon, {sent:N}
  notify() push fanout                     -> in-process w/ mocked push.webpush
  push pruning on 410                      -> subscription removed
  POST /api/discussions                    -> forum published / blog pending, validation
  GET  /api/discussions                    -> published default, admin-only pending
  POST /api/discussions/{id}/approve       -> admin only + blog_approved notify
  DELETE /api/discussions/{id}             -> author/admin, cascades comments
  GET  /api/digest/preview                 -> send_history field
  _sunday_digest_job                       -> appends digest_send_history

xdist-safe via RUN_PREFIX; full teardown of TEST_userH_* artifacts.
"""
import os
import sys
import json
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
RUN_PREFIX = "TEST_userH_" + WORKER + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_UserH",
              is_admin=False, market=MARKET, newsletter=True):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mkt = "null" if market is None else f"'{market}'"
    mkts = "[]" if market is None else f"['{market}']"
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'{account_type}',
      primary_market:{mkt}, markets:{mkts},
      onboarding_complete:true, subscription_tier:'{tier}',
      newsletter_opt_in:{'true' if newsletter else 'false'},
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def sub_body(endpoint):
    return {"subscription": {"endpoint": endpoint,
                             "keys": {"p256dh": "BQ" + "A" * 85, "auth": "A" * 22}}}


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
    db.comments.deleteMany({{author_id:{{$in:ids}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


# ---------- H.1 Push endpoints ----------
class TestPushEndpoints:
    def test_vapid_public_key_public_and_valid(self, client):
        r = client.get(f"{BASE}/push/vapid-public-key")
        assert r.status_code == 200, r.text
        key = r.json().get("public_key")
        assert isinstance(key, str)
        assert len(key) == 87, f"expected 87-char b64url key, got {len(key)}"
        assert "=" not in key and "+" not in key and "/" not in key

    def test_vapid_key_stable_across_calls(self, client):
        a = client.get(f"{BASE}/push/vapid-public-key").json()["public_key"]
        b = client.get(f"{BASE}/push/vapid-public-key").json()["public_key"]
        assert a == b
        # exactly one persisted settings doc
        cnt = mongo("print(db.settings.countDocuments({key:'vapid'}))")
        assert cnt.strip() == "1", f"expected 1 vapid settings doc, got {cnt}"

    def test_subscribe_requires_auth(self, client):
        r = client.post(f"{BASE}/push/subscribe",
                        json=sub_body(f"https://fcm.test/{RUN_PREFIX}anon"))
        assert r.status_code == 401, r.text

    def test_subscribe_invalid_body(self, client):
        _, tok = mint_user()
        r = client.post(f"{BASE}/push/subscribe", headers=auth(tok),
                        json={"subscription": {"keys": {}}})
        assert r.status_code == 400, r.text
        r2 = client.post(f"{BASE}/push/subscribe", headers=auth(tok), json={})
        assert r2.status_code == 422, r2.text

    def test_subscribe_upserts_single_doc(self, client):
        uid, tok = mint_user()
        ep = f"https://fcm.test/{RUN_PREFIX}up1"
        for _ in range(2):
            r = client.post(f"{BASE}/push/subscribe", headers=auth(tok), json=sub_body(ep))
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True
        cnt = mongo(f"print(db.push_subscriptions.countDocuments({{endpoint:'{ep}'}}))")
        assert cnt.strip() == "1", f"upsert created duplicates: {cnt}"
        doc = json.loads(mongo(
            f"print(JSON.stringify(db.push_subscriptions.findOne({{endpoint:'{ep}'}},{{_id:0}})))"))
        assert doc["user_id"] == uid
        assert doc["subscription"]["endpoint"] == ep
        assert doc.get("created_at") and doc.get("updated_at")

    def test_unsubscribe_only_deletes_own(self, client):
        uid_a, tok_a = mint_user()
        uid_b, tok_b = mint_user()
        ep_a = f"https://fcm.test/{RUN_PREFIX}own_a"
        ep_b = f"https://fcm.test/{RUN_PREFIX}own_b"
        client.post(f"{BASE}/push/subscribe", headers=auth(tok_a), json=sub_body(ep_a))
        client.post(f"{BASE}/push/subscribe", headers=auth(tok_b), json=sub_body(ep_b))
        # A tries to delete B's endpoint -> no-op
        r = client.post(f"{BASE}/push/unsubscribe", headers=auth(tok_a), json=sub_body(ep_b))
        assert r.status_code == 200, r.text
        assert mongo(f"print(db.push_subscriptions.countDocuments({{endpoint:'{ep_b}'}}))").strip() == "1"
        # A deletes own
        r2 = client.post(f"{BASE}/push/unsubscribe", headers=auth(tok_a), json=sub_body(ep_a))
        assert r2.status_code == 200
        assert mongo(f"print(db.push_subscriptions.countDocuments({{endpoint:'{ep_a}'}}))").strip() == "0"

    def test_unsubscribe_requires_auth(self, client):
        r = client.post(f"{BASE}/push/unsubscribe", json=sub_body("https://fcm.test/x"))
        assert r.status_code == 401

    def test_push_test_401_anon_and_200_auth(self, client):
        r = client.post(f"{BASE}/push/test")
        assert r.status_code == 401
        _, tok = mint_user()
        r2 = client.post(f"{BASE}/push/test", headers=auth(tok))
        assert r2.status_code == 200, r2.text
        assert r2.json() == {"sent": 0}  # no subscriptions yet


# ---------- H.2 notify() -> push fanout (in-process, mocked webpush) ----------
def _load_backend():
    """Make backend modules importable in-process (loads backend/.env first)."""
    for k, v in dotenv_values("/app/backend/.env").items():
        if v is not None:
            os.environ.setdefault(k, v)
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")


_LOOP = None


def _run(coro):
    """Run a coroutine on one persistent loop so motor's client stays bound
    to a live event loop across tests in this module."""
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        _LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)


@pytest.fixture
def inproc_db(monkeypatch):
    """A motor db bound to OUR loop, patched into the modules under test.

    Other suites in this worker may have already bound `deps.db` to a loop
    that is now closed (they use asyncio.run), so we build a fresh client
    inside our persistent loop instead of reusing deps.db.
    """
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


class TestPushFanout:
    def test_notify_dm_fans_out_to_each_subscription(self, monkeypatch, inproc_db):
        _load_backend()
        import push as push_mod
        from notifications import notify
        uid, _ = mint_user()
        eps = [f"https://fcm.test/{RUN_PREFIX}fan{i}" for i in range(2)]
        for ep in eps:
            mongo(f"""db.push_subscriptions.insertOne({{user_id:'{uid}',
              endpoint:'{ep}', subscription:{{endpoint:'{ep}',
              keys:{{p256dh:'BQ', auth:'AA'}}}}, created_at:new Date().toISOString()}});""")
        calls = []

        def fake_webpush(**kwargs):
            calls.append(kwargs)
            return True

        monkeypatch.setattr(push_mod, "webpush", fake_webpush)

        async def run():
            d = await notify(uid, "dm", "TEST_userH dm title",
                             body="hello", link="/messages")
            # fanout is fire-and-forget (asyncio.create_task) — let it drain
            await asyncio.sleep(0.5)
            return d

        doc = _run(run())
        assert doc["kind"] == "dm"
        assert "_id" not in doc
        assert len(calls) == 2, f"expected 2 push sends, got {len(calls)}"
        payload = json.loads(calls[0]["data"])
        assert payload["title"] == "TEST_userH dm title"
        assert payload["url"] == "/messages"
        assert payload["kind"] == "dm"
        # notification persisted
        n = mongo(f"print(db.notifications.countDocuments({{user_id:'{uid}', kind:'dm'}}))")
        assert n.strip() == "1"

    def test_non_push_kind_does_not_fan_out(self, monkeypatch, inproc_db):
        _load_backend()
        import push as push_mod
        from notifications import notify
        uid, _ = mint_user()
        ep = f"https://fcm.test/{RUN_PREFIX}nopush"
        mongo(f"""db.push_subscriptions.insertOne({{user_id:'{uid}', endpoint:'{ep}',
          subscription:{{endpoint:'{ep}', keys:{{p256dh:'BQ', auth:'AA'}}}},
          created_at:new Date().toISOString()}});""")
        calls = []
        monkeypatch.setattr(push_mod, "webpush", lambda **kw: calls.append(kw))

        async def run2():
            await notify(uid, "post_expiring", "TEST_userH expiring", body="x", link="/feed")
            await asyncio.sleep(0.3)

        _run(run2())
        assert calls == [], "post_expiring must not trigger a browser push"
        n = mongo(f"print(db.notifications.countDocuments({{user_id:'{uid}', kind:'post_expiring'}}))")
        assert n.strip() == "1"

    def test_410_prunes_subscription(self, monkeypatch, inproc_db):
        _load_backend()
        import push as push_mod
        uid, _ = mint_user()
        ep = f"https://fcm.test/{RUN_PREFIX}gone"
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
        sent = _run(push_mod.send_push_to_user(uid, {"title": "x"}))
        assert sent == 0
        left = mongo(f"print(db.push_subscriptions.countDocuments({{endpoint:'{ep}'}}))")
        assert left.strip() == "0", "410 endpoint should have been pruned"


# ---------- H.3 Discussions ----------
class TestDiscussions:
    def test_create_requires_auth(self, client):
        r = client.post(f"{BASE}/discussions",
                        json={"kind": "forum", "title": "TEST_userH x", "body": "b"})
        assert r.status_code == 401

    def test_invalid_kind_400(self, client):
        _, tok = mint_user()
        r = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "wiki", "title": "TEST_userH x", "body": "b"})
        assert r.status_code == 400, r.text

    def test_invalid_market_400(self, client):
        _, tok = mint_user()
        r = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "forum", "title": "TEST_userH x", "body": "b",
                              "market": "Atlantis"})
        assert r.status_code == 400, r.text

    def test_empty_title_400(self, client):
        _, tok = mint_user()
        r = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "forum", "title": "   ", "body": "b"})
        assert r.status_code == 400, r.text

    def test_forum_publishes_immediately_and_is_listed(self, client):
        _, tok = mint_user()
        r = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "forum", "title": "TEST_userH forum topic",
                              "body": "Anyone racing Thursday?", "market": MARKET,
                              "tags": ["racing", "  "]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "published"
        assert d["published_at"]
        assert d["tags"] == ["racing"]
        assert "_id" not in d
        lst = client.get(f"{BASE}/discussions", params={"kind": "forum"})
        assert lst.status_code == 200
        assert any(x["id"] == d["id"] for x in lst.json()), "forum post missing from public list"
        # single GET works anonymously
        one = client.get(f"{BASE}/discussions/{d['id']}")
        assert one.status_code == 200 and one.json()["id"] == d["id"]

    def test_blog_pending_hidden_from_public_visible_to_author_and_admin(self, client):
        uid, tok = mint_user()
        _, other_tok = mint_user()
        _, admin_tok = mint_user(is_admin=True)
        r = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "blog", "title": "TEST_userH blog draft",
                              "body": "Long form thoughts."})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "pending" and d["published_at"] is None
        # public list (default published) excludes it
        pub = client.get(f"{BASE}/discussions", params={"kind": "blog"}).json()
        assert all(x["id"] != d["id"] for x in pub), "pending blog leaked into published list"
        # anon single GET -> 403
        assert client.get(f"{BASE}/discussions/{d['id']}").status_code == 403
        # other user -> 403
        assert client.get(f"{BASE}/discussions/{d['id']}",
                          headers=auth(other_tok)).status_code == 403
        # author -> 200
        assert client.get(f"{BASE}/discussions/{d['id']}", headers=auth(tok)).status_code == 200
        # admin -> 200
        assert client.get(f"{BASE}/discussions/{d['id']}",
                          headers=auth(admin_tok)).status_code == 200
        # pending list is admin only
        assert client.get(f"{BASE}/discussions",
                          params={"kind": "blog", "status": "pending"}).status_code == 403
        assert client.get(f"{BASE}/discussions", params={"kind": "blog", "status": "pending"},
                          headers=auth(other_tok)).status_code == 403
        adm = client.get(f"{BASE}/discussions", params={"kind": "blog", "status": "pending"},
                         headers=auth(admin_tok))
        assert adm.status_code == 200, adm.text
        assert any(x["id"] == d["id"] for x in adm.json())

    def test_approve_admin_only_and_notifies_author(self, client):
        uid, tok = mint_user()
        _, other_tok = mint_user()
        _, admin_tok = mint_user(is_admin=True)
        d = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "blog", "title": "TEST_userH approve me",
                              "body": "body"}).json()
        assert client.post(f"{BASE}/discussions/{d['id']}/approve").status_code == 403
        assert client.post(f"{BASE}/discussions/{d['id']}/approve",
                           headers=auth(other_tok)).status_code == 403
        r = client.post(f"{BASE}/discussions/{d['id']}/approve", headers=auth(admin_tok))
        assert r.status_code == 200, r.text
        after = client.get(f"{BASE}/discussions/{d['id']}").json()
        assert after["status"] == "published" and after["published_at"]
        assert after["approved_by"]
        pub = client.get(f"{BASE}/discussions", params={"kind": "blog"}).json()
        assert any(x["id"] == d["id"] for x in pub)
        n = json.loads(mongo(
            f"print(JSON.stringify(db.notifications.findOne("
            f"{{user_id:'{uid}', kind:'blog_approved'}},{{_id:0}})))"))
        assert n and n["kind"] == "blog_approved"
        assert n["link"] == "/community-hub"

    def test_approve_missing_404(self, client):
        _, admin_tok = mint_user(is_admin=True)
        r = client.post(f"{BASE}/discussions/{uuid.uuid4()}/approve", headers=auth(admin_tok))
        assert r.status_code == 404

    def test_delete_author_cascades_comments(self, client):
        uid, tok = mint_user()
        d = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "forum", "title": "TEST_userH del topic",
                              "body": "body"}).json()
        mongo(f"""db.comments.insertOne({{id:'{RUN_PREFIX}c1', post_id:'{d['id']}',
          author_id:'{uid}', body:'TEST_userH comment',
          created_at:new Date().toISOString()}});""")
        r = client.delete(f"{BASE}/discussions/{d['id']}", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert client.get(f"{BASE}/discussions/{d['id']}").status_code == 404
        left = mongo(f"print(db.comments.countDocuments({{post_id:'{d['id']}'}}))")
        assert left.strip() == "0", "comments not cascaded"

    def test_delete_forbidden_for_other_user_allowed_for_admin(self, client):
        _, tok = mint_user()
        _, other_tok = mint_user()
        _, admin_tok = mint_user(is_admin=True)
        d = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "forum", "title": "TEST_userH del2",
                              "body": "body"}).json()
        assert client.delete(f"{BASE}/discussions/{d['id']}").status_code == 401
        assert client.delete(f"{BASE}/discussions/{d['id']}",
                             headers=auth(other_tok)).status_code == 403
        assert client.delete(f"{BASE}/discussions/{d['id']}",
                             headers=auth(admin_tok)).status_code == 200

    def test_market_filter(self, client):
        _, tok = mint_user()
        d = client.post(f"{BASE}/discussions", headers=auth(tok),
                        json={"kind": "forum", "title": "TEST_userH mkt",
                              "body": "b", "market": "Bellingham"}).json()
        hit = client.get(f"{BASE}/discussions",
                         params={"kind": "forum", "market": "Bellingham"}).json()
        assert any(x["id"] == d["id"] for x in hit)
        miss = client.get(f"{BASE}/discussions",
                          params={"kind": "forum", "market": "Eugene"}).json()
        assert all(x["id"] != d["id"] for x in miss)


# ---------- H.4 Digest send history ----------
class TestDigestSendHistory:
    def test_preview_includes_send_history(self, client):
        uid, tok = mint_user()
        stamps = ["2026-08-0%dT08:00:00+00:00" % i for i in range(1, 4)]
        mongo(f"""db.users.updateOne({{user_id:'{uid}'}},
          {{$set:{{digest_send_history:{json.dumps(stamps)}}}}});""")
        r = client.get(f"{BASE}/digest/preview", headers=auth(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "send_history" in body
        assert body["send_history"] == stamps
        assert len(body["send_history"]) <= 12

    def test_preview_send_history_capped_at_12(self, client):
        uid, tok = mint_user()
        stamps = ["2026-01-%02dT08:00:00+00:00" % i for i in range(1, 21)]
        mongo(f"""db.users.updateOne({{user_id:'{uid}'}},
          {{$set:{{digest_send_history:{json.dumps(stamps)}}}}});""")
        body = client.get(f"{BASE}/digest/preview", headers=auth(tok)).json()
        assert len(body["send_history"]) == 12
        assert body["send_history"] == stamps[-12:]

    def test_preview_requires_auth(self, client):
        assert client.get(f"{BASE}/digest/preview").status_code == 401

    def test_sunday_job_appends_history(self, client, inproc_db):
        _load_backend()
        mdb = inproc_db
        import scheduler as sched_mod
        import mailer as mailer_mod
        uid, tok = mint_user(newsletter=True)
        # ensure digest is non-empty for this market by seeding a crew listing
        mongo(f"""db.crew_bank_standalone.insertOne({{id:'{RUN_PREFIX}cb',
          user_id:'{uid}', user_name:'TEST_userH', markets:['{MARKET}'],
          status:'seeking', positions:['Trimmer'], expires_at:null,
          created_at:new Date().toISOString()}});""")
        sent_calls = []

        async def fake_send_email(**kwargs):
            sent_calls.append(kwargs)
            return {"ok": True}

        orig = mailer_mod.send_email
        mailer_mod.send_email = fake_send_email
        try:
            _run(sched_mod._sunday_digest_job(mdb))
        finally:
            mailer_mod.send_email = orig
        doc = json.loads(mongo(
            f"print(JSON.stringify(db.users.findOne({{user_id:'{uid}'}},"
            f"{{_id:0, digest_sent_at:1, digest_send_history:1}})))"))
        assert doc.get("digest_sent_at"), "digest_sent_at not stamped"
        hist = doc.get("digest_send_history") or []
        assert len(hist) == 1, f"expected 1 send_history entry, got {hist}"
        assert hist[0] == doc["digest_sent_at"]
        # cleanup crew listing
        mongo(f"db.crew_bank_standalone.deleteMany({{id:'{RUN_PREFIX}cb'}});")
        # preview reflects it
        body = client.get(f"{BASE}/digest/preview", headers=auth(tok)).json()
        assert body["send_history"] == hist


# ---------- H.5 VAPID key format accepted by py_vapid (real delivery path) ----------
class TestVapidKeyFormat:
    def test_stored_private_key_is_loadable_by_py_vapid(self):
        """Regression: send_push_to_user passes the stored private key straight to
        pywebpush -> py_vapid.Vapid.from_string, which only accepts a base64url
        RAW/DER key (NOT a PKCS8 PEM). If this fails, every real push delivery
        raises ValueError and `sent` is always 0."""
        _load_backend()
        from py_vapid import Vapid
        doc = json.loads(mongo(
            "print(JSON.stringify(db.settings.findOne({key:'vapid'},{_id:0})))"))
        assert doc and doc.get("private_key"), "no persisted VAPID key"
        assert "BEGIN" not in doc["private_key"], "PKCS8 PEM stored; py_vapid cannot parse it"
        Vapid.from_string(private_key=doc["private_key"])
