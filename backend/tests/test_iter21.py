"""Iteration 21 — polish batch retest.

Covers:
  auth_router      -> GET /api/auth/ws-token (401 unauth, {user_id, token} authed)
  messaging_router -> WS /api/ws/{user_id}?token= accept / 4401 reject
  community_router -> comment create + delete broadcast {type:'comment.count'} over WS
  hub_router       -> Svix signature verification on POST /api/webhooks/resend/digest
  hub_router       -> GET/PATCH /api/push/preferences
  community_router -> POST /api/admin/events/{id}/recipients-bulk (admin, dedupe/lowercase/merge)
"""
import os
import base64
import hashlib
import hmac
import json
import time
import uuid
import asyncio
import subprocess

import pytest
import requests
import websockets
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
ORIGIN = base_url.rstrip("/")
BASE = ORIGIN + "/api"
WS_BASE = "wss://" + ORIGIN.split("://", 1)[1] + "/api/ws"

DB = "test_database"
RUN_PREFIX = "TEST_user21_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(is_admin=False):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess21_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST_User21',
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
    s.headers.update({"Content-Type": "application/json"})
    yield s
    s.close()


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mongo(f"""
    db.users.deleteMany({{user_id:/^{RUN_PREFIX}/}});
    db.user_sessions.deleteMany({{user_id:/^{RUN_PREFIX}/}});
    db.posts.deleteMany({{author_id:/^{RUN_PREFIX}/}});
    db.comments.deleteMany({{author_id:/^{RUN_PREFIX}/}});
    db.events.deleteMany({{title:/^TEST_iter21/}});
    """)


# ---------- auth_router: /auth/ws-token ----------
class TestWsToken:
    def test_ws_token_unauth_401(self, client):
        r = client.get(f"{BASE}/auth/ws-token")
        assert r.status_code == 401, r.text

    def test_ws_token_bad_token_401(self, client):
        r = client.get(f"{BASE}/auth/ws-token", headers=auth("nope_" + uuid.uuid4().hex))
        assert r.status_code == 401, r.text

    def test_ws_token_bearer(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/auth/ws-token", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user_id"] == uid
        assert d["token"] == tok

    def test_ws_token_cookie(self, client):
        uid, tok = mint_user()
        r = requests.get(f"{BASE}/auth/ws-token", cookies={"session_token": tok})
        assert r.status_code == 200, r.text
        assert r.json() == {"user_id": uid, "token": tok}


# ---------- messaging_router: websocket auth ----------
class TestWebSocketAuth:
    def test_ws_valid_token_connects(self):
        uid, tok = mint_user()

        async def go():
            async with websockets.connect(f"{WS_BASE}/{uid}?token={tok}") as ws:
                assert ws.state.name in ("OPEN",)
                return True
        assert asyncio.run(asyncio.wait_for(go(), timeout=20))

    def test_ws_invalid_token_closes_4401(self):
        uid, _ = mint_user()

        async def go():
            try:
                async with websockets.connect(f"{WS_BASE}/{uid}?token=bogus") as ws:
                    await ws.recv()
            except Exception as e:
                return getattr(e, "code", None) or getattr(
                    getattr(e, "response", None), "status_code", None) or repr(e)
            return None
        res = asyncio.run(go())
        # Ingress converts a pre-accept WS close into an HTTP 403 handshake failure.
        assert res in (4401, 403), f"expected rejection (4401/403), got {res}"

    def test_ws_token_user_mismatch_closes_4401(self):
        _, tok = mint_user()
        other_uid, _ = mint_user()

        async def go():
            try:
                async with websockets.connect(f"{WS_BASE}/{other_uid}?token={tok}") as ws:
                    await ws.recv()
            except Exception as e:
                return getattr(e, "code", None) or getattr(
                    getattr(e, "response", None), "status_code", None) or repr(e)
            return None
        assert asyncio.run(go()) in (4401, 403)


# ---------- community_router: comment.count broadcast ----------
class TestCommentCountBroadcast:
    def _make_post(self, client, tok):
        r = client.post(f"{BASE}/posts", headers=auth(tok), json={
            "title": "TEST_iter21 live comments",
            "body": "checking ws broadcast",
            "type": "discussion",
            "market": MARKET,
        })
        assert r.status_code in (200, 201), r.text
        return r.json()["id"]

    def test_create_and_delete_broadcast(self, client):
        uid_a, tok_a = mint_user()
        uid_b, tok_b = mint_user()
        post_id = self._make_post(client, tok_a)

        async def scenario():
            msgs = []
            async with websockets.connect(f"{WS_BASE}/{uid_b}?token={tok_b}") as ws_b:
                async with websockets.connect(f"{WS_BASE}/{uid_a}?token={tok_a}"):
                    await asyncio.sleep(0.5)
                    # B comments -> A and B both should receive
                    r = await asyncio.to_thread(
                        client.post, f"{BASE}/posts/{post_id}/comments",
                        headers=auth(tok_b), json={"body": "hello from b"})
                    assert r.status_code in (200, 201), r.text
                    cid = r.json()["id"]
                    m = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=15))
                    msgs.append(m)
                    # delete -> broadcast again
                    r2 = await asyncio.to_thread(
                        client.delete, f"{BASE}/comments/{cid}", headers=auth(tok_b))
                    assert r2.status_code == 200, r2.text
                    # skip non comment.count frames
                    deadline = time.time() + 15
                    while time.time() < deadline:
                        m2 = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=15))
                        if m2.get("type") == "comment.count":
                            msgs.append(m2)
                            break
            return msgs

        msgs = asyncio.run(scenario())
        create_msgs = [m for m in msgs if m.get("type") == "comment.count"]
        assert len(create_msgs) >= 2, msgs
        assert create_msgs[0]["post_id"] == post_id
        assert create_msgs[0]["count"] == 1, create_msgs[0]
        assert create_msgs[-1]["count"] == 0, create_msgs[-1]


# ---------- hub_router: push preferences ----------
class TestPushPreferences:
    def test_get_requires_auth(self, client):
        assert client.get(f"{BASE}/push/preferences").status_code == 401

    def test_get_and_patch_persist(self, client):
        _, tok = mint_user()
        r = client.get(f"{BASE}/push/preferences", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["kinds"], list) and d["kinds"]
        assert all(d["preferences"][k] is True for k in d["kinds"])
        kind = d["kinds"][0]
        p = client.patch(f"{BASE}/push/preferences", headers=auth(tok),
                         json={"preferences": {kind: False}})
        assert p.status_code == 200, p.text
        assert p.json()["preferences"][kind] is False
        g = client.get(f"{BASE}/push/preferences", headers=auth(tok))
        assert g.json()["preferences"][kind] is False
        # other kinds default True
        for k in d["kinds"][1:]:
            assert g.json()["preferences"][k] is True

    def test_patch_requires_auth(self, client):
        assert client.patch(f"{BASE}/push/preferences",
                            json={"preferences": {}}).status_code == 401


# ---------- community_router: admin recipients-bulk ----------
class TestRecipientsBulk:
    def _make_event(self, client, admin_tok):
        r = client.post(f"{BASE}/events", headers=auth(admin_tok), json={
            "title": "TEST_iter21 event", "market": MARKET,
            "starts_at": "2026-09-01T18:00:00+00:00",
            "location": "Shilshole", "description": "test",
        })
        if r.status_code not in (200, 201):
            pytest.skip(f"admin event create unavailable: {r.status_code} {r.text[:200]}")
        return r.json()["id"]

    def test_requires_admin(self, client):
        _, tok = mint_user()
        r = client.post(f"{BASE}/admin/events/does-not-exist/recipients-bulk",
                        headers=auth(tok), json={"csv": "a@b.com"})
        assert r.status_code == 403, r.text

    def test_bulk_dedupe_lowercase_merge(self, client):
        _, admin_tok = mint_user(is_admin=True)
        ev = self._make_event(client, admin_tok)
        r1 = client.post(f"{BASE}/admin/events/{ev}/recipients-bulk", headers=auth(admin_tok),
                         json={"csv": "One@Example.com, one@example.com\nTwo@Example.com;three@example.com\nbadtoken"})
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["email_recipients"] == ["one@example.com", "two@example.com",
                                          "three@example.com"], d1
        assert "badtoken" in d1["invalid"]
        # merge with existing, no duplicates
        r2 = client.post(f"{BASE}/admin/events/{ev}/recipients-bulk", headers=auth(admin_tok),
                         json={"csv": "one@example.com\nFOUR@example.com"})
        assert r2.status_code == 200, r2.text
        assert r2.json()["email_recipients"] == ["one@example.com", "two@example.com",
                                                 "three@example.com", "four@example.com"]

    def test_bulk_404_unknown_event(self, client):
        _, admin_tok = mint_user(is_admin=True)
        r = client.post(f"{BASE}/admin/events/nope-{uuid.uuid4().hex}/recipients-bulk",
                        headers=auth(admin_tok), json={"csv": "x@y.com"})
        assert r.status_code == 404, r.text


# ---------- hub_router: Svix webhook signature ----------
SECRET = "whsec_dGVzdHNlY3JldA=="
ENV_PATH = "/app/backend/.env"


def _set_secret(value):
    with open(ENV_PATH) as f:
        lines = [l for l in f.read().splitlines() if not l.startswith("RESEND_WEBHOOK_SECRET")]
    if value:
        lines.append(f"RESEND_WEBHOOK_SECRET={value}")
    with open(ENV_PATH, "w") as f:
        f.write("\n".join(lines) + "\n")
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                   capture_output=True, text=True, timeout=120)
    for _ in range(40):
        try:
            if requests.get(f"{BASE}/events", timeout=5).status_code < 500:
                break
        except Exception:
            pass
        time.sleep(1)


def _sign(body: bytes, svix_id: str, ts: str, secret=SECRET):
    key = base64.b64decode(secret.split("_", 1)[1])
    payload = f"{svix_id}.{ts}.{body.decode()}".encode()
    return "v1," + base64.b64encode(hmac.new(key, payload, hashlib.sha256).digest()).decode()


class TestResendWebhook:
    def test_dev_bypass_when_secret_unset(self, client):
        r = client.post(f"{BASE}/webhooks/resend/digest", json={"type": "email.opened"})
        assert r.status_code == 200, r.text

    def test_signature_enforced(self, client):
        _set_secret(SECRET)
        try:
            body = json.dumps({"type": "email.opened", "data": {"to": ["nobody@example.com"]}}).encode()
            # missing headers
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body,
                              headers={"Content-Type": "application/json"}, timeout=20)
            assert r.status_code == 401, f"missing sig -> {r.status_code} {r.text[:200]}"
            svix_id = "msg_" + uuid.uuid4().hex
            ts = str(int(time.time()))
            # bad signature
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={"Content-Type": "application/json", "svix-id": svix_id,
                                       "svix-timestamp": ts, "svix-signature": "v1,YmFk"})
            assert r.status_code == 401, f"bad sig -> {r.status_code}"
            # valid signature
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={"Content-Type": "application/json", "svix-id": svix_id,
                                       "svix-timestamp": ts,
                                       "svix-signature": _sign(body, svix_id, ts)})
            assert r.status_code == 200, f"valid sig -> {r.status_code} {r.text[:200]}"
        finally:
            _set_secret(None)
        # back to dev bypass
        r = requests.post(f"{BASE}/webhooks/resend/digest", json={"type": "email.opened"}, timeout=20)
        assert r.status_code == 200, r.text
