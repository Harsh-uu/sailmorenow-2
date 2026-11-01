"""Iter44 / Phase T backend tests.

Modules covered:
- directory_router: GET /api/boat-pros/mine, PATCH /api/boat-pros/photos
- admin_router: GET /api/handle/available + db.handle_enum_log writes
- admin_router: POST /api/admin/contact/{msg_id}/reply (reply templates flow)
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")


@pytest.fixture(scope="session")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _mint(mdb, email):
    u = mdb.users.find_one({"email": email})
    assert u, f"seeded user {email} not found"
    tok = f"test_iter44_{uuid.uuid4().hex[:10]}"
    mdb.user_sessions.insert_one({
        "user_id": u["user_id"], "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return tok, u["user_id"]


@pytest.fixture(scope="session")
def pro_session(mongo):
    return _mint(mongo, "pro.marina@sailmorenow.dev")


@pytest.fixture(scope="session")
def owner_session(mongo):
    return _mint(mongo, "captain.jane@sailmorenow.dev")


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _handle_check(client, q):
    """GET /handle/available with one retry if the 30/60s throttle trips."""
    r = client.get(f"{API}/handle/available", params={"q": q})
    if r.status_code == 429:
        time.sleep(61)
        r = client.get(f"{API}/handle/available", params={"q": q})
    return r


# ---------------------------------------------------------------- boat-pros/mine
class TestBoatProMine:
    def test_unauthenticated_401(self, client):
        r = client.get(f"{API}/boat-pros/mine")
        assert r.status_code == 401, r.text

    def test_pro_gets_own_listing_with_photos_array(self, client, pro_session):
        tok, uid = pro_session
        r = client.get(f"{API}/boat-pros/mine", headers=_auth(tok))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == uid
        assert "_id" not in data
        assert isinstance(data.get("photos", []), list)

    def test_non_pro_without_listing_404(self, client, owner_session):
        tok, _ = owner_session
        r = client.get(f"{API}/boat-pros/mine", headers=_auth(tok))
        assert r.status_code == 404, r.text


# ------------------------------------------------------------- boat-pros/photos
class TestBoatProPhotos:
    P1 = "data:image/png;base64,AAA"
    P2 = "data:image/png;base64,BBB"

    @pytest.fixture(scope="class", autouse=True)
    def restore_photos(self, mongo, pro_session):
        _, uid = pro_session
        original = (mongo.boat_pros.find_one({"user_id": uid}) or {}).get("photos", [])
        yield
        mongo.boat_pros.update_one({"user_id": uid}, {"$set": {"photos": original}})

    def test_unauthenticated_401(self, client):
        r = client.patch(f"{API}/boat-pros/photos", json={"photos": [self.P1]})
        assert r.status_code == 401, r.text

    def test_non_pro_403(self, client, owner_session):
        tok, _ = owner_session
        r = client.patch(f"{API}/boat-pros/photos", json={"photos": [self.P1]}, headers=_auth(tok))
        assert r.status_code == 403, r.text

    def test_persists_and_dedupes(self, client, pro_session, mongo):
        tok, uid = pro_session
        r = client.patch(f"{API}/boat-pros/photos",
                         json={"photos": [self.P1, self.P2, self.P1, "  ", ""]},
                         headers=_auth(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["photos"] == [self.P1, self.P2]
        assert "_id" not in body
        # DB persistence
        doc = mongo.boat_pros.find_one({"user_id": uid})
        assert doc["photos"] == [self.P1, self.P2]
        # GET verification
        g = client.get(f"{API}/boat-pros/mine", headers=_auth(tok))
        assert g.json()["photos"] == [self.P1, self.P2]

    def test_caps_at_six(self, client, pro_session):
        tok, _ = pro_session
        many = [f"data:image/png;base64,X{i}" for i in range(10)]
        r = client.patch(f"{API}/boat-pros/photos", json={"photos": many}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        assert len(r.json()["photos"]) == 6
        assert r.json()["photos"] == many[:6]

    def test_rejects_oversize_photo(self, client, pro_session):
        tok, _ = pro_session
        big = "data:image/png;base64," + ("A" * 400_001)
        r = client.patch(f"{API}/boat-pros/photos", json={"photos": [big]}, headers=_auth(tok))
        assert r.status_code == 400, r.text
        assert "400KB" in r.json().get("detail", "")

    def test_rejects_non_list(self, client, pro_session):
        tok, _ = pro_session
        r = client.patch(f"{API}/boat-pros/photos", json={"photos": "nope"}, headers=_auth(tok))
        assert r.status_code == 400, r.text

    def test_clear_photos(self, client, pro_session, mongo):
        tok, uid = pro_session
        r = client.patch(f"{API}/boat-pros/photos", json={"photos": []}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["photos"] == []
        assert mongo.boat_pros.find_one({"user_id": uid})["photos"] == []


# ------------------------------------------------------------- handle available
class TestHandleAvailable:
    def test_taken_returns_suggestions_and_logs(self, client, mongo):
        before = mongo.handle_enum_log.count_documents({"handle": "captainjane"})
        r = _handle_check(client, "captainjane")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False
        assert d["reason"] == "taken"
        assert isinstance(d["suggestions"], list) and len(d["suggestions"]) == 3
        assert all(isinstance(s, str) and s for s in d["suggestions"])
        time.sleep(0.5)
        after = mongo.handle_enum_log.count_documents({"handle": "captainjane"})
        assert after == before + 1, "enum log entry not written for taken handle"
        entry = mongo.handle_enum_log.find_one({"handle": "captainjane"}, sort=[("at", -1)])
        assert entry.get("ip")
        assert entry.get("at")
        datetime.fromisoformat(entry["at"])  # valid ISO

    def test_free_handle_no_log(self, client, mongo):
        # NOTE: 'zz_no_such_handle_xxx' from the spec is 21 chars → fails the
        # 3-20 regex, so we use a 20-char free handle here and assert the
        # 21-char variant separately.
        q = "zz_no_such_handle_xx"
        assert len(q) == 20
        before = mongo.handle_enum_log.count_documents({"handle": q.lower()})
        r = _handle_check(client, q)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True, r.text
        time.sleep(0.5)
        assert mongo.handle_enum_log.count_documents({"handle": q.lower()}) == before

    def test_over_20_chars_is_invalid(self, client, mongo):
        q = "zz_no_such_handle_xxx"  # 21 chars
        before = mongo.handle_enum_log.count_documents({"handle": q.lower()})
        r = _handle_check(client, q)
        assert r.status_code == 200, r.text
        assert r.json()["reason"] == "invalid", r.text
        time.sleep(0.5)
        assert mongo.handle_enum_log.count_documents({"handle": q.lower()}) == before

    def test_too_short_invalid_no_log(self, client, mongo):
        before = mongo.handle_enum_log.count_documents({"handle": "ab"})
        r = _handle_check(client, "ab")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False and d["reason"] == "invalid"
        time.sleep(0.5)
        assert mongo.handle_enum_log.count_documents({"handle": "ab"}) == before

    def test_rate_limit_30_per_60s(self, client):
        # Burst until throttled; must throttle within a reasonable number of calls.
        got_429 = False
        for _ in range(40):
            r = client.get(f"{API}/handle/available", params={"q": f"rl{uuid.uuid4().hex[:8]}"})
            if r.status_code == 429:
                got_429 = True
                break
        assert got_429, "rate limit never triggered within 40 requests"
        time.sleep(61)  # let the window clear for any later tests


# ---------------------------------------------------------- admin contact reply
class TestAdminContactReply:
    def test_reply_with_template_body(self, client, mongo):
        msg_id = str(uuid.uuid4())
        mongo.contact_messages.insert_one({
            "id": msg_id, "name": "TEST_Iter44", "email": "test.iter44@example.com",
            "message": "TEST_ reply template check message body",
            "ip": "127.0.0.1",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        admin_uid = "TEST_iter44_admin"
        mongo.users.update_one(
            {"user_id": admin_uid},
            {"$set": {"user_id": admin_uid, "email": "test.iter44.admin@sailmorenow.dev",
                      "name": "TEST Admin", "platform_role": "admin",
                      "account_type": "sailor", "onboarding_complete": True}},
            upsert=True,
        )
        tok = f"test_iter44_{uuid.uuid4().hex[:10]}"
        mongo.user_sessions.insert_one({
            "user_id": admin_uid, "session_token": tok,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        template_body = ("Thanks for reaching out to Sail More Now! "
                         "We've received your note and will reply shortly.")
        r = client.post(f"{API}/admin/contact/{msg_id}/reply",
                        json={"body": template_body}, headers=_auth(tok))
        try:
            assert r.status_code == 200, r.text
            payload = r.json()
            assert "ok" in payload and payload["reply"]["body"] == template_body
            doc = mongo.contact_messages.find_one({"id": msg_id})
            replies = doc.get("replies") or []
            assert len(replies) >= 1
            assert replies[-1]["body"] == template_body
            assert doc.get("status") == "replied"
            if payload["ok"] is not True:
                print("NOTE: reply email delivery returned ok=False (mailer likely unconfigured)")
        finally:
            mongo.contact_messages.delete_one({"id": msg_id})
            mongo.user_sessions.delete_many({"user_id": admin_uid})
            mongo.users.delete_one({"user_id": admin_uid})

    def test_reply_requires_admin(self, client, owner_session):
        tok, _ = owner_session
        r = client.post(f"{API}/admin/contact/{uuid.uuid4()}/reply",
                        json={"body": "should not work"}, headers=_auth(tok))
        assert r.status_code == 403, r.text

    def test_reply_unauthenticated_401(self, client):
        r = client.post(f"{API}/admin/contact/{uuid.uuid4()}/reply", json={"body": "nope nope"})
        assert r.status_code == 401, r.text
