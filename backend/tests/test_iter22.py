"""Iteration 22 — retest of iteration-21 P0 fixes.

Covers:
  deps.WSManager   -> multi-socket-per-user (2 tabs both get broadcasts;
                      closing one socket does not evict the other)
  community_router -> comment create/delete broadcast {type:'comment.count'}
  hub_router       -> Svix signature + 5-minute timestamp skew rejection
  auth_router      -> GET /api/auth/ws-token
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
RUN_PREFIX = "TEST_user22_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user():
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess22_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST_User22',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'],
      onboarding_complete:true, subscription_tier:'premium', newsletter_opt_in:false,
      platform_role:'member', created_at:new Date()}});
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
    """)


async def _next_count(ws, post_id, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if m.get("type") == "comment.count" and m.get("post_id") == post_id:
            return m
    raise AssertionError("no comment.count frame received")


# ---------- auth_router: /auth/ws-token ----------
class TestWsToken:
    def test_unauth_401(self, client):
        assert client.get(f"{BASE}/auth/ws-token").status_code == 401

    def test_authed_returns_token(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/auth/ws-token", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user_id"] == uid and d["token"] == tok


# ---------- deps.WSManager multi-socket ----------
class TestMultiSocketBroadcast:
    def _make_post(self, client, tok):
        r = client.post(f"{BASE}/posts", headers=auth(tok), json={
            "title": "TEST_iter22 multi socket", "body": "ws fanout",
            "type": "discussion", "market": MARKET,
        })
        assert r.status_code in (200, 201), r.text
        return r.json()["id"]

    def test_two_sockets_same_user_both_receive(self, client):
        uid_a, tok_a = mint_user()
        uid_b, tok_b = mint_user()
        post_id = self._make_post(client, tok_a)

        async def scenario():
            url_a = f"{WS_BASE}/{uid_a}?token={tok_a}"
            async with websockets.connect(url_a) as tab1, websockets.connect(url_a) as tab2:
                await asyncio.sleep(0.7)
                r = await asyncio.to_thread(
                    client.post, f"{BASE}/posts/{post_id}/comments",
                    headers=auth(tok_b), json={"body": "hello tabs"})
                assert r.status_code in (200, 201), r.text
                cid = r.json()["id"]
                m1 = await _next_count(tab1, post_id)
                m2 = await _next_count(tab2, post_id)
                assert m1["count"] == 1 and m2["count"] == 1, (m1, m2)

                # Close tab2 only; tab1 must still receive the delete broadcast.
                await tab2.close()
                await asyncio.sleep(0.7)
                r2 = await asyncio.to_thread(
                    client.delete, f"{BASE}/comments/{cid}", headers=auth(tok_b))
                assert r2.status_code == 200, r2.text
                m3 = await _next_count(tab1, post_id)
                assert m3["count"] == 0, m3
                return True

        assert asyncio.run(asyncio.wait_for(scenario(), timeout=90))

    def test_three_sockets_all_receive(self, client):
        uid_a, tok_a = mint_user()
        _, tok_b = mint_user()
        post_id = self._make_post(client, tok_a)

        async def scenario():
            url = f"{WS_BASE}/{uid_a}?token={tok_a}"
            async with websockets.connect(url) as w1, websockets.connect(url) as w2, \
                    websockets.connect(url) as w3:
                await asyncio.sleep(0.7)
                r = await asyncio.to_thread(
                    client.post, f"{BASE}/posts/{post_id}/comments",
                    headers=auth(tok_b), json={"body": "fanout"})
                assert r.status_code in (200, 201), r.text
                counts = [(await _next_count(w, post_id))["count"] for w in (w1, w2, w3)]
                assert counts == [1, 1, 1], counts
                return True

        assert asyncio.run(asyncio.wait_for(scenario(), timeout=90))


# ---------- messaging: DM delivery over shared socket ----------
class TestDmDelivery:
    def test_dm_pushed_to_all_sockets(self, client):
        uid_a, tok_a = mint_user()
        _, tok_b = mint_user()

        async def scenario():
            url = f"{WS_BASE}/{uid_a}?token={tok_a}"
            async with websockets.connect(url) as w1, websockets.connect(url) as w2:
                await asyncio.sleep(0.7)
                r = await asyncio.to_thread(
                    client.post, f"{BASE}/messages/{uid_a}", headers=auth(tok_b),
                    json={"body": "TEST_iter22 dm"})
                assert r.status_code in (200, 201), r.text
                out = []
                for w in (w1, w2):
                    m = json.loads(await asyncio.wait_for(w.recv(), timeout=15))
                    out.append(m)
                assert all(m.get("type") == "message" for m in out), out
                assert all(m["message"]["body"] == "TEST_iter22 dm" for m in out), out
                return True

        assert asyncio.run(asyncio.wait_for(scenario(), timeout=90))


# ---------- messaging_router: self-thread crashes /messages/threads (BUG) ----------
class TestSelfThreadRegression:
    def test_self_dm_does_not_break_threads_list(self, client):
        """Sending a DM to yourself creates participants:[uid, uid]; list_threads then
        raises IndexError -> HTTP 500, which blanks the whole /messages page."""
        uid, tok = mint_user()
        r = client.post(f"{BASE}/messages/{uid}", headers=auth(tok),
                        json={"body": "TEST_iter22 self dm"})
        assert r.status_code in (200, 201, 400, 403), r.text
        g = client.get(f"{BASE}/messages/threads", headers=auth(tok))
        try:
            assert g.status_code == 200, f"threads -> {g.status_code} {g.text[:200]}"
        finally:
            mongo(f"db.dm_threads.deleteMany({{thread_id:'{uid}-{uid}'}});"
                  f"db.dm_messages.deleteMany({{thread_id:'{uid}-{uid}'}});")


# ---------- hub_router: Svix webhook signature + timestamp skew ----------
SECRET = "whsec_dGVzdHNlY3JldA=="
ENV_PATH = "/app/backend/.env"


def _set_secret(value):
    with open(ENV_PATH) as f:
        lines = [line for line in f.read().splitlines()
                 if not line.startswith("RESEND_WEBHOOK_SECRET")]
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

    def test_signature_and_timestamp_skew(self, client):
        _set_secret(SECRET)
        try:
            body = json.dumps({"type": "email.opened",
                               "data": {"to": ["nobody@example.com"]}}).encode()
            hdr = {"Content-Type": "application/json"}
            # missing headers -> 401
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body,
                              headers=hdr, timeout=20)
            assert r.status_code == 401, f"missing sig -> {r.status_code}"

            svix_id = "msg_" + uuid.uuid4().hex
            # stale timestamp with an otherwise-valid signature -> 401
            stale_ts = "0"
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": stale_ts,
                                       "svix-signature": _sign(body, svix_id, stale_ts)})
            assert r.status_code == 401, f"stale ts (0) -> {r.status_code} {r.text[:200]}"

            old_ts = str(int(time.time()) - 3600)
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": old_ts,
                                       "svix-signature": _sign(body, svix_id, old_ts)})
            assert r.status_code == 401, f"stale ts (-1h) -> {r.status_code}"

            future_ts = str(int(time.time()) + 3600)
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": future_ts,
                                       "svix-signature": _sign(body, svix_id, future_ts)})
            assert r.status_code == 401, f"future ts (+1h) -> {r.status_code}"

            bad_ts = "not-a-number"
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": bad_ts,
                                       "svix-signature": _sign(body, svix_id, bad_ts)})
            assert r.status_code == 401, f"non-numeric ts -> {r.status_code}"

            # bad signature, fresh ts -> 401
            ts = str(int(time.time()))
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": ts,
                                       "svix-signature": "v1,YmFk"})
            assert r.status_code == 401, f"bad sig -> {r.status_code}"

            # fresh + valid -> 200
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": ts,
                                       "svix-signature": _sign(body, svix_id, ts)})
            assert r.status_code == 200, f"valid sig -> {r.status_code} {r.text[:200]}"

            # edge: within tolerance (-240s) -> 200
            near_ts = str(int(time.time()) - 240)
            r = requests.post(f"{BASE}/webhooks/resend/digest", data=body, timeout=20,
                              headers={**hdr, "svix-id": svix_id, "svix-timestamp": near_ts,
                                       "svix-signature": _sign(body, svix_id, near_ts)})
            assert r.status_code == 200, f"-240s -> {r.status_code}"
        finally:
            _set_secret(None)
        r = requests.post(f"{BASE}/webhooks/resend/digest",
                          json={"type": "email.opened"}, timeout=20)
        assert r.status_code == 200, r.text
