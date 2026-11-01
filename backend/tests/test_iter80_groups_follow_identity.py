"""Iter 80 backend tests — Group DMs, follow-user (people), identity session.

Covers:
  • Group DMs create/send/threads/messages/read (POST /messages/group,
    POST /messages/group/{tid}, GET /messages/threads, GET /messages/{tid},
    POST /messages/{tid}/read).
  • Route order regression: /api/messages/group is not shadowed by
    /api/messages/{recipient_id}.
  • 1:1 DM regression still works.
  • Follow a PERSON (not just orgs): POST/DELETE /api/follows/{user_id},
    GET /api/u/{handle} returns follower_count / following_count / is_following.
  • ID verification entry point: POST /api/identity/session returns friendly
    409 under a test Stripe key (not a 500).
"""
import os
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
ALEX_ID = "seed_alex"          # Alex Rivera / @alexrivera (free tier — can be added to a group)
MARINA_ID = "seed_marina"      # premium (can send/receive in DMs)
JANE_ID = "seed_jane"          # free
PARTNER_ID = "seed_partner"    # community_partner (Puget Sound Sailing Society)


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def jenn_session():
    """Login jenn (premium admin) and return a Bearer token."""
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("session_token")
    assert tok, "no session_token returned"
    return {"token": tok, "user_id": r.json()["user"]["user_id"]}


@pytest.fixture(scope="module")
def marina_session():
    """Mint a session for pro.marina (premium) via mongosh so we have a paid
    recipient that can also send messages back."""
    import subprocess
    tok = "test_iter80_marina_" + str(int(time.time()))
    js = ("const db=db.getSiblingDB(\"test_database\");"
          "db.user_sessions.insertOne({user_id:\"seed_marina\",session_token:\""
          + tok + "\",expires_at:new Date(Date.now()+7*24*3600*1000),created_at:new Date()});")
    subprocess.run(["mongosh", "--quiet", "--eval", js], check=True, capture_output=True)
    return {"token": tok, "user_id": "seed_marina"}


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Group DM tests ----------

class TestGroupDMs:
    def test_create_group_requires_two_members(self, jenn_session):
        r = requests.post(f"{BASE}/messages/group", headers=_h(jenn_session["token"]),
                          json={"participant_ids": [ALEX_ID], "title": "solo", "body": "hi"})
        assert r.status_code == 400, r.text

    def test_create_group_rejects_empty_body(self, jenn_session):
        r = requests.post(f"{BASE}/messages/group", headers=_h(jenn_session["token"]),
                          json={"participant_ids": [ALEX_ID, MARINA_ID], "title": "t", "body": "   "})
        assert r.status_code == 400

    def test_create_group_and_send_and_read(self, jenn_session, marina_session):
        # CREATE
        title = f"TEST_iter80 group {int(time.time())}"
        r = requests.post(f"{BASE}/messages/group", headers=_h(jenn_session["token"]),
                          json={"participant_ids": [ALEX_ID, MARINA_ID],
                                "title": title, "body": "hello group from jenn"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_group"] is True
        assert data["title"] == title
        assert set(data["participants"]) == {jenn_session["user_id"], ALEX_ID, MARINA_ID}
        tid = data["thread_id"]
        assert tid.startswith("group_")

        # Threads for MARINA include this group with unread=1 and is_group=true
        rt = requests.get(f"{BASE}/messages/threads", headers=_h(marina_session["token"]))
        assert rt.status_code == 200
        threads = rt.json()
        marina_thread = next((t for t in threads if t.get("thread_id") == tid), None)
        assert marina_thread is not None, "marina should see the new group thread"
        assert marina_thread.get("is_group") is True
        assert marina_thread.get("title") == title
        assert marina_thread.get("unread") == 1, f"marina should have 1 unread, got {marina_thread.get('unread')}"
        assert marina_thread.get("last_message") == "hello group from jenn"
        assert isinstance(marina_thread.get("members"), list)
        assert len(marina_thread["members"]) == 3

        # marina SENDs into the group
        rs = requests.post(f"{BASE}/messages/group/{tid}", headers=_h(marina_session["token"]),
                           json={"body": "marina reply"})
        assert rs.status_code == 200, rs.text
        assert rs.json().get("from_id") == MARINA_ID
        assert rs.json().get("thread_id") == tid

        # jenn now sees 1 unread (marina's message)
        rt2 = requests.get(f"{BASE}/messages/threads", headers=_h(jenn_session["token"]))
        jt = next((t for t in rt2.json() if t["thread_id"] == tid), None)
        assert jt is not None
        assert jt["unread"] == 1, f"jenn should have 1 unread after marina reply, got {jt['unread']}"

        # LIST messages for jenn
        rm = requests.get(f"{BASE}/messages/{tid}", headers=_h(jenn_session["token"]))
        assert rm.status_code == 200
        msgs = rm.json()
        assert len(msgs) == 2
        assert msgs[0]["body"] == "hello group from jenn"
        assert msgs[1]["body"] == "marina reply"

        # MARK READ for jenn -> group branch
        rr = requests.post(f"{BASE}/messages/{tid}/read", headers=_h(jenn_session["token"]))
        assert rr.status_code == 200
        assert rr.json().get("group") is True

        # jenn's unread now 0
        rt3 = requests.get(f"{BASE}/messages/threads", headers=_h(jenn_session["token"]))
        jt2 = next((t for t in rt3.json() if t["thread_id"] == tid), None)
        assert jt2["unread"] == 0, f"jenn unread should reset to 0 after read, got {jt2['unread']}"

        # non-member can't read the group  (use alex — free but participant, so pick a stranger)
        # jane is not a participant
        # mint jane session
        import subprocess
        jt_token = "test_iter80_jane_" + str(int(time.time()))
        subprocess.run(["mongosh", "--quiet", "--eval",
                        "const db=db.getSiblingDB('test_database');db.user_sessions.insertOne({user_id:'seed_jane',session_token:'"
                        + jt_token + "',expires_at:new Date(Date.now()+3600*1000),created_at:new Date()});"],
                       check=True, capture_output=True)
        rforbid = requests.get(f"{BASE}/messages/{tid}", headers=_h(jt_token))
        assert rforbid.status_code == 403

    def test_route_order_group_not_shadowed(self, jenn_session):
        """POST /messages/group must hit the group creator, NOT be interpreted
        as sending a DM to a user with user_id='group'."""
        r = requests.post(f"{BASE}/messages/group", headers=_h(jenn_session["token"]),
                          json={"participant_ids": [ALEX_ID, MARINA_ID],
                                "title": "TEST_iter80 order", "body": "ordercheck"})
        # If shadowed, the send_message handler would try to msg user_id='group'
        # and return 404 (Cannot message yourself is only for self); the group
        # handler returns 200 with is_group=true.
        assert r.status_code == 200
        assert r.json().get("is_group") is True


# ---------- 1:1 DM regression ----------

class TestOneToOneRegression:
    def test_send_and_read_one_to_one(self, jenn_session, marina_session):
        # jenn -> marina 1:1 send
        r = requests.post(f"{BASE}/messages/{MARINA_ID}", headers=_h(jenn_session["token"]),
                          json={"body": "hi marina - iter80 1:1"})
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["to_id"] == MARINA_ID
        assert msg["from_id"] == jenn_session["user_id"]
        tid = msg["thread_id"]

        # marina sees unread
        rt = requests.get(f"{BASE}/messages/threads", headers=_h(marina_session["token"]))
        assert rt.status_code == 200
        row = next((t for t in rt.json() if t["thread_id"] == tid), None)
        assert row is not None
        assert row.get("unread", 0) >= 1
        # 1:1 threads should NOT have is_group=true
        assert not row.get("is_group")

        # marina reads
        rr = requests.post(f"{BASE}/messages/{tid}/read", headers=_h(marina_session["token"]))
        assert rr.status_code == 200
        assert rr.json().get("marked", 0) >= 1

        # unread back to 0
        rt2 = requests.get(f"{BASE}/messages/threads", headers=_h(marina_session["token"]))
        row2 = next((t for t in rt2.json() if t["thread_id"] == tid), None)
        assert row2["unread"] == 0


# ---------- Follow a person ----------

class TestFollowUser:
    def test_public_profile_shape(self, jenn_session):
        r = requests.get(f"{BASE}/u/alexrivera", headers=_h(jenn_session["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("follower_count", "following_count", "is_following"):
            assert k in d, f"missing key {k}"
        user = d.get("user") or {}
        assert user.get("handle") == "alexrivera"
        assert user.get("user_id") == ALEX_ID
        assert isinstance(d["follower_count"], int)
        assert isinstance(d["following_count"], int)
        assert isinstance(d["is_following"], bool)

    def test_follow_and_unfollow_person(self, jenn_session):
        # Make sure jenn is NOT following alex (best-effort cleanup)
        requests.delete(f"{BASE}/follows/{ALEX_ID}", headers=_h(jenn_session["token"]))

        before = requests.get(f"{BASE}/u/alexrivera", headers=_h(jenn_session["token"])).json()
        assert before["is_following"] is False
        base_count = before["follower_count"]

        # FOLLOW
        r = requests.post(f"{BASE}/follows/{ALEX_ID}", headers=_h(jenn_session["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["following"] is True
        assert r.json()["follower_count"] == base_count + 1

        after = requests.get(f"{BASE}/u/alexrivera", headers=_h(jenn_session["token"])).json()
        assert after["is_following"] is True
        assert after["follower_count"] == base_count + 1

        # Idempotent — follow again shouldn't double-count
        r2 = requests.post(f"{BASE}/follows/{ALEX_ID}", headers=_h(jenn_session["token"]))
        assert r2.status_code == 200
        assert r2.json()["follower_count"] == base_count + 1

        # UNFOLLOW cleanup
        rd = requests.delete(f"{BASE}/follows/{ALEX_ID}", headers=_h(jenn_session["token"]))
        assert rd.status_code == 200
        assert rd.json()["following"] is False
        assert rd.json()["follower_count"] == base_count

        end = requests.get(f"{BASE}/u/alexrivera", headers=_h(jenn_session["token"])).json()
        assert end["is_following"] is False


# ---------- Identity session ----------

class TestIdentity:
    def test_create_session_returns_friendly_409(self, jenn_session):
        r = requests.post(f"{BASE}/identity/session", headers=_h(jenn_session["token"]), json={})
        # Under a TEST stripe key without Identity enabled, backend catches the
        # stripe error and raises 409 with a friendly message. Must NOT be 500.
        assert r.status_code in (409, 200), f"got {r.status_code}: {r.text}"
        if r.status_code == 409:
            body = r.json()
            msg = body.get("detail") or body.get("message") or ""
            assert isinstance(msg, str) and len(msg) > 0
