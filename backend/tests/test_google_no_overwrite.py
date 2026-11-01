"""Proves POST /auth/session (Google exchange) does NOT overwrite in-app profile
edits on an existing-account login, seeds a picture only when absent, and sets
first_name/last_name on first creation.

The ONLY thing mocked is the external Emergent/Google session lookup
(EMERGENT_AUTH_SESSION_URL) — everything else is the real create_session code
path and the real Mongo DB. Run: python tests/test_google_no_overwrite.py
"""
import os, sys, uuid, asyncio
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import routers.auth_router as ar
from deps import db

TAG = "TEST_gno_" + uuid.uuid4().hex[:6]
RESULTS = []
def ck(cond, msg): RESULTS.append((cond, msg)); print(("PASS " if cond else "FAIL ") + msg)


class _FakeResp:
    def __init__(self, payload): self.status_code = 200; self._p = payload
    def json(self): return self._p

class _FakeClient:
    def __init__(self, payload): self._p = payload
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get(self, *a, **k): return _FakeResp(self._p)

class _FakeReq:
    def __init__(self, session_id): self._s = session_id
    async def json(self): return {"session_id": self._s}

class _FakeResponse:  # only needs set_cookie
    def set_cookie(self, **k): pass


async def _exchange(google_payload):
    """Invoke the REAL create_session with the external auth call mocked."""
    with patch.object(ar, "httpx") as mock_httpx:
        mock_httpx.AsyncClient.return_value = _FakeClient(google_payload)
        return await ar.create_session(_FakeReq("sess_" + uuid.uuid4().hex), _FakeResponse())


async def main():
    created_emails = []
    try:
        # --- Case A: existing account with edited name + picture + avatar ---
        emailA = f"{TAG}_a@example.com"; created_emails.append(emailA)
        uidA = f"{TAG}_a"
        await db.users.insert_one({
            "user_id": uidA, "email": emailA, "name": "Edited Name",
            "first_name": "Edited", "last_name": "Name",
            "picture": "https://app/edited-pic.png", "avatar": "https://app/uploaded-avatar.png",
            "handle": f"{TAG}handlea", "platform_role": None,
        })
        await _exchange({"email": emailA, "name": "Google Overwrite",
                         "picture": "https://google/pic.png", "session_token": "tokA"})
        a = await db.users.find_one({"user_id": uidA}, {"_id": 0})
        ck(a["name"] == "Edited Name", f"existing login keeps edited name (got {a['name']!r})")
        ck(a["picture"] == "https://app/edited-pic.png", f"existing login keeps edited picture (got {a['picture']!r})")
        ck(a["avatar"] == "https://app/uploaded-avatar.png", "existing login keeps uploaded avatar")

        # --- Case B: existing account with NO picture and NO avatar -> seed picture ---
        emailB = f"{TAG}_b@example.com"; created_emails.append(emailB)
        uidB = f"{TAG}_b"
        await db.users.insert_one({
            "user_id": uidB, "email": emailB, "name": "Kept Name",
            "picture": None, "avatar": None, "handle": f"{TAG}handleb", "platform_role": None,
        })
        await _exchange({"email": emailB, "name": "Google B",
                         "picture": "https://google/picB.png", "session_token": "tokB"})
        b = await db.users.find_one({"user_id": uidB}, {"_id": 0})
        ck(b["name"] == "Kept Name", "existing login still does not touch name when picture seeded")
        ck(b["picture"] == "https://google/picB.png", f"picture seeded only when absent (got {b['picture']!r})")

        # --- Case C: first creation sets first_name/last_name from Google name ---
        emailC = f"{TAG}_c@example.com"; created_emails.append(emailC)
        await _exchange({"email": emailC, "name": "Ada Lovelace",
                         "picture": "https://google/picC.png", "session_token": "tokC"})
        c = await db.users.find_one({"email": emailC}, {"_id": 0})
        ck(c is not None and c["name"] == "Ada Lovelace", "new account keeps Google name")
        ck(c and c.get("first_name") == "Ada", f"new account first_name split (got {c and c.get('first_name')!r})")
        ck(c and c.get("last_name") == "Lovelace", f"new account last_name split (got {c and c.get('last_name')!r})")
        ck(c and c.get("picture") == "https://google/picC.png", "new account picture from Google")

        # --- Case D: single-word Google name -> last_name empty, no crash ---
        emailD = f"{TAG}_d@example.com"; created_emails.append(emailD)
        await _exchange({"email": emailD, "name": "Cher",
                         "picture": None, "session_token": "tokD"})
        d = await db.users.find_one({"email": emailD}, {"_id": 0})
        ck(d and d.get("first_name") == "Cher" and d.get("last_name") == "", "single-word name -> last_name empty")
    finally:
        for em in created_emails:
            u = await db.users.find_one({"email": em}, {"_id": 0, "user_id": 1})
            if u:
                await db.user_sessions.delete_many({"user_id": u["user_id"]})
            await db.users.delete_many({"email": em})
        print(f"\ncleaned up {len(created_emails)} temp accounts ({TAG})")
        passed = sum(1 for c, _ in RESULTS if c); failed = sum(1 for c, _ in RESULTS if not c)
        print(f"RESULT: {passed} passed, {failed} failed")
        if failed:
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
