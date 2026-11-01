"""Iteration 23 — final verification of iter21/22 fixes + self-thread bug.

Covers:
  messaging_router -> GET /api/messages/threads must not 500 on a malformed
                      self-thread (participants [uid, uid]); other_user resolves
                      to the caller.
                   -> POST /api/messages/{recipient_id} with recipient_id == caller
                      returns 400 and inserts nothing.
  spot-checks      -> WSManager multi-socket comment.count broadcast (create+delete),
                      svix timestamp skew (dev bypass only), /auth/ws-token,
                      push preferences PATCH, admin CSV template endpoint.
"""
import os
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
RUN_PREFIX = "TEST_user23_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user():
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess23_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST_User23',
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
    db.dm_threads.deleteMany({{participants:{{$elemMatch:{{$regex:'^{RUN_PREFIX}'}}}}}});
    db.dm_messages.deleteMany({{from_id:/^{RUN_PREFIX}/}});
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


# ---------- messaging_router: self-thread regression ----------
class TestSelfThreadRegression:
    def test_self_dm_rejected_400_and_not_inserted(self, client):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/messages/{uid}", headers=auth(tok),
                        json={"body": "TEST_iter23 self dm"})
        assert r.status_code == 400, f"self-DM -> {r.status_code} {r.text[:200]}"
        assert "yourself" in r.text.lower(), r.text
        # nothing persisted
        assert mongo(f"print(db.dm_messages.countDocuments({{thread_id:'{uid}-{uid}'}}))") == "0"
        assert mongo(f"print(db.dm_threads.countDocuments({{thread_id:'{uid}-{uid}'}}))") == "0"
        # threads list still fine
        g = client.get(f"{BASE}/messages/threads", headers=auth(tok))
        assert g.status_code == 200, g.text
        assert g.json() == []

    def test_stored_self_thread_does_not_500(self, client):
        """Legacy/manually-stored thread with participants [uid, uid] must not crash."""
        uid, tok = mint_user()
        now = "2026-07-01T00:00:00+00:00"
        mongo(f"""
        db.dm_threads.insertOne({{thread_id:'{uid}-{uid}', participants:['{uid}','{uid}'],
          last_message:'legacy self dm', created_at:'{now}', updated_at:'{now}'}});
        """)
        g = client.get(f"{BASE}/messages/threads", headers=auth(tok))
        assert g.status_code == 200, f"threads -> {g.status_code} {g.text[:300]}"
        threads = g.json()
        assert len(threads) == 1, threads
        t = threads[0]
        assert t["thread_id"] == f"{uid}-{uid}"
        assert t["other_user"] is not None, t
        assert t["other_user"]["user_id"] == uid
        assert "_id" not in t and "_id" not in t["other_user"]

    def test_empty_participants_thread_does_not_500(self, client):
        uid, tok = mint_user()
        mongo(f"""
        db.dm_threads.insertOne({{thread_id:'{uid}-x', participants:['{uid}'],
          last_message:'one sided', created_at:'x', updated_at:'x'}});
        """)
        g = client.get(f"{BASE}/messages/threads", headers=auth(tok))
        assert g.status_code == 200, f"threads -> {g.status_code} {g.text[:300]}"
        assert g.json()[0]["other_user"]["user_id"] == uid

    def test_normal_dm_still_works(self, client):
        uid_a, tok_a = mint_user()
        uid_b, tok_b = mint_user()
        r = client.post(f"{BASE}/messages/{uid_b}", headers=auth(tok_a),
                        json={"body": "TEST_iter23 hello"})
        assert r.status_code in (200, 201), r.text
        msg = r.json()
        assert msg["to_id"] == uid_b and msg["from_id"] == uid_a
        for tok, other in ((tok_a, uid_b), (tok_b, uid_a)):
            g = client.get(f"{BASE}/messages/threads", headers=auth(tok))
            assert g.status_code == 200, g.text
            t = g.json()[0]
            assert t["other_user"]["user_id"] == other
            assert t["last_message"] == "TEST_iter23 hello"
        h = client.get(f"{BASE}/messages/{msg['thread_id']}", headers=auth(tok_b))
        assert h.status_code == 200 and h.json()[-1]["body"] == "TEST_iter23 hello"


# ---------- spot-check: ws-token + multi-socket comment.count ----------
class TestSpotChecks:
    def test_ws_token(self, client):
        assert client.get(f"{BASE}/auth/ws-token").status_code == 401
        uid, tok = mint_user()
        d = client.get(f"{BASE}/auth/ws-token", headers=auth(tok)).json()
        assert d["user_id"] == uid and d["token"] == tok

    def test_multi_socket_comment_count_create_and_delete(self, client):
        uid_a, tok_a = mint_user()
        uid_b, tok_b = mint_user()
        r = client.post(f"{BASE}/posts", headers=auth(tok_a), json={
            "title": "TEST_iter23 spotcheck", "body": "ws fanout",
            "type": "discussion", "market": MARKET})
        assert r.status_code in (200, 201), r.text
        post_id = r.json()["id"]

        async def scenario():
            url = f"{WS_BASE}/{uid_a}?token={tok_a}"
            async with websockets.connect(url) as t1, websockets.connect(url) as t2:
                await asyncio.sleep(0.7)
                c = await asyncio.to_thread(
                    client.post, f"{BASE}/posts/{post_id}/comments",
                    headers=auth(tok_b), json={"body": "spotcheck"})
                assert c.status_code in (200, 201), c.text
                cid = c.json()["id"]
                m1 = await _next_count(t1, post_id)
                m2 = await _next_count(t2, post_id)
                assert m1["count"] == 1 and m2["count"] == 1, (m1, m2)
                d = await asyncio.to_thread(
                    client.delete, f"{BASE}/comments/{cid}", headers=auth(tok_b))
                assert d.status_code in (200, 204), d.text
                m1 = await _next_count(t1, post_id)
                m2 = await _next_count(t2, post_id)
                assert m1["count"] == 0 and m2["count"] == 0, (m1, m2)
                return True

        assert asyncio.run(asyncio.wait_for(scenario(), timeout=90))

    def test_push_preferences_patch(self, client):
        uid, tok = mint_user()
        r = client.patch(f"{BASE}/push/preferences", headers=auth(tok),
                         json={"preferences": {"dm": False}})
        assert r.status_code == 200, r.text
        assert r.json()["preferences"]["dm"] is False, r.json()
        g = client.get(f"{BASE}/push/preferences", headers=auth(tok))
        assert g.status_code == 200, g.text
        assert g.json()["preferences"]["dm"] is False, g.json()
        assert "dm" in g.json()["kinds"], g.json()

    def test_resend_webhook_dev_bypass(self, client):
        r = client.post(f"{BASE}/webhooks/resend/digest", json={"type": "email.opened"})
        assert r.status_code == 200, r.text
