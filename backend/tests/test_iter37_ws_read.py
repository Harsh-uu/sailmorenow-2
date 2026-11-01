"""Iteration 37 — WS `message.read` broadcast test (two live sockets)."""
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
import requests
import websockets
from dotenv import dotenv_values, load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")
frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"


def _mk(db, suffix):
    uid = f"TEST_iter37ws_{suffix}_{uuid.uuid4().hex[:8]}"
    token = f"TEST_iter37ws_sess_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    return uid, token, now


@pytest.mark.timeout(60)
def test_ws_message_read_broadcast():
    from deps import db

    async def main():
        sender_id, sender_tok, now = _mk(db, "sender")
        reader_id, reader_tok, _ = _mk(db, "reader")
        for uid, tok in ((sender_id, sender_tok), (reader_id, reader_tok)):
            await db.users.insert_one({"user_id": uid, "email": f"{uid}@x.dev", "name": f"TEST {uid}",
                                       "account_type": "sailor", "onboarding_complete": True})
            await db.user_sessions.insert_one({"user_id": uid, "session_token": tok,
                                               "expires_at": now.replace(year=now.year + 1),
                                               "created_at": now})
        tid = "-".join(sorted([sender_id, reader_id]))
        try:
            async with websockets.connect(f"{WS_BASE}/{sender_id}?token={sender_tok}") as ws_s, \
                       websockets.connect(f"{WS_BASE}/{reader_id}?token={reader_tok}") as ws_r:
                # sender sends a DM over REST
                r = requests.post(f"{API}/messages/{reader_id}", json={"body": "TEST_iter37 ws hello"},
                                  headers={"Authorization": f"Bearer {sender_tok}"}, timeout=30)
                assert r.status_code == 200, r.text
                incoming = json.loads(await asyncio.wait_for(ws_r.recv(), timeout=15))
                assert incoming["type"] == "message"
                assert incoming["message"]["read_at"] is None

                # reader marks read
                rr = requests.post(f"{API}/messages/{tid}/read",
                                   headers={"Authorization": f"Bearer {reader_tok}"}, timeout=30)
                assert rr.status_code == 200, rr.text
                assert rr.json()["marked"] == 1

                ev_s = json.loads(await asyncio.wait_for(ws_s.recv(), timeout=15))
                ev_r = json.loads(await asyncio.wait_for(ws_r.recv(), timeout=15))
                for ev in (ev_s, ev_r):
                    assert ev["type"] == "message.read", ev
                    assert ev["thread_id"] == tid
                    assert ev["reader_id"] == reader_id
                    assert ev["read_at"]
        finally:
            ids = [sender_id, reader_id]
            await db.users.delete_many({"user_id": {"$in": ids}})
            await db.user_sessions.delete_many({"user_id": {"$in": ids}})
            await db.dm_messages.delete_many({"thread_id": tid})
            await db.dm_threads.delete_many({"thread_id": tid})

    asyncio.get_event_loop().run_until_complete(main())
