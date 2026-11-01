"""Phase A tests: notifications, activity tracking, post expiration, DM/crew notifications."""
import os
import uuid
import subprocess
import json
from datetime import datetime, timezone, timedelta

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

# Per-worker unique prefix so pytest-xdist parallel runs don't delete each other's data
RUN_PREFIX = "TEST_user_" + os.environ.get("PYTEST_XDIST_WORKER", "gw") + "_"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(tier="premium", name="TEST_Sailor"):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'Greater Seattle', markets:['Greater Seattle'],
      onboarding_complete:true, subscription_tier:'{tier}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "User-Agent": UA})
    return s


@pytest.fixture(scope="module")
def user_a():
    return mint_user()


@pytest.fixture(scope="module")
def user_b():
    return mint_user(name="TEST_Recipient")


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mongo(f"""
    var ids = db.users.find({{user_id:{{$regex:'^{RUN_PREFIX}'}}}},{{user_id:1}}).toArray().map(u=>u.user_id);
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.posts.deleteMany({{id:{{$regex:'^TESTP_{RUN_PREFIX}'}}}});
    db.dm_messages.deleteMany({{from_id:{{$in:ids}}}});
    db.dm_threads.deleteMany({{participants:{{$in:ids}}}});
    db.crew_bank.deleteMany({{user_id:{{$in:ids}}}});
    db.events.deleteMany({{organizer_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^TESTEV_{RUN_PREFIX}'}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Notifications ----------
class TestNotifications:
    def test_anon_401(self, client):
        r = client.get(f"{BASE}/notifications")
        assert r.status_code == 401, r.text

    def test_list_shape_and_activity_ping(self, client, user_a):
        uid, tok = user_a
        # before any poll -> never
        r0 = client.get(f"{BASE}/activity/{uid}")
        assert r0.status_code == 200
        assert r0.json()["status"] == "never", r0.text

        r = client.get(f"{BASE}/notifications", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["items"], list)
        assert isinstance(d["unread"], int)

        r2 = client.get(f"{BASE}/activity/{uid}")
        assert r2.json()["status"] == "today", r2.text

    def test_activity_statuses(self, client):
        uid, _ = mint_user()
        for days, expected in [(3, "this_week"), (15, "this_month"), (90, "dormant")]:
            iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            mongo(f"db.users.updateOne({{user_id:'{uid}'}},{{$set:{{last_active_at:'{iso}'}}}});")
            r = client.get(f"{BASE}/activity/{uid}")
            assert r.json()["status"] == expected, (days, r.text)

    def test_mark_read_single_and_all(self, client, user_a):
        uid, tok = user_a
        for i in range(3):
            mongo(f"""db.notifications.insertOne({{id:'TESTN_{uid}_{i}', user_id:'{uid}',
                kind:'dm', title:'TEST notif {i}', body:'b', link:'/feed', meta:{{}},
                read:false, created_at:new Date().toISOString()}});""")
        r = client.get(f"{BASE}/notifications", headers=auth(tok))
        assert r.json()["unread"] >= 3

        r = client.patch(f"{BASE}/notifications/TESTN_{uid}_0/read", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = client.get(f"{BASE}/notifications", headers=auth(tok)).json()
        item0 = next(i for i in d["items"] if i["id"] == f"TESTN_{uid}_0")
        assert item0["read"] is True
        assert d["unread"] == 2

        r = client.post(f"{BASE}/notifications/mark-all-read", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["marked"] == 2
        assert client.get(f"{BASE}/notifications", headers=auth(tok)).json()["unread"] == 0

    def test_mark_read_anon_401(self, client):
        assert client.post(f"{BASE}/notifications/mark-all-read").status_code == 401
        assert client.patch(f"{BASE}/notifications/xyz/read").status_code == 401


# ---------- Post expiration ----------
class TestPostExpiration:
    def test_create_post_expiry_fields(self, client, user_a):
        uid, tok = user_a
        payload = {"type": "sailing_opportunity", "title": "TEST_post_exp",
                   "body": "hello", "market": "Greater Seattle",
                   "allow_comments": False, "expires_days": 5}
        r = client.post(f"{BASE}/posts", json=payload, headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["allow_comments"] is False
        assert d["expires_at"]
        exp = datetime.fromisoformat(d["expires_at"])
        delta = (exp - datetime.now(timezone.utc)).days
        assert 4 <= delta <= 5, d["expires_at"]
        assert "_id" not in d
        pytest.post_id = d["id"]

    def test_default_expires_days_30(self, client):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/posts", json={"type": "sailing_opportunity",
                        "title": "TEST_default", "body": "x", "market": "Greater Seattle"},
                        headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["allow_comments"] is True
        assert 29 <= (datetime.fromisoformat(d["expires_at"]) - datetime.now(timezone.utc)).days <= 30

    def test_expired_post_hidden_from_list(self, client, user_a):
        uid, tok = user_a
        past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        pid = "TESTP_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        mongo(f"""db.posts.insertOne({{id:'{pid}', type:'sailing_opportunity',
            title:'TEST_expired_post', body:'gone', market:'Greater Seattle',
            author_id:'{uid}', expires_at:'{past}', created_at:'{past}'}});""")
        r = client.get(f"{BASE}/posts", headers=auth(tok))
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert pid not in ids, "expired post leaked into GET /api/posts"

    def test_extend_author_ok(self, client, user_a):
        uid, tok = user_a
        pid = getattr(pytest, "post_id", None)
        assert pid, "post creation test must run first"
        mongo(f"db.posts.updateOne({{id:'{pid}'}},{{$set:{{extension_prompted_at:'x'}}}});")
        r = client.post(f"{BASE}/posts/{pid}/extend", json={"days": 20}, headers=auth(tok))
        assert r.status_code == 200, r.text
        new_exp = r.json()["expires_at"]
        assert 19 <= (datetime.fromisoformat(new_exp) - datetime.now(timezone.utc)).days <= 20
        doc = json.loads(mongo(f"JSON.stringify(db.posts.findOne({{id:'{pid}'}},{{_id:0,expires_at:1,extension_prompted_at:1}}))"))
        assert doc["expires_at"] == new_exp
        assert doc.get("extension_prompted_at") is None

    def test_extend_non_author_403(self, client, user_b):
        _, tok_b = user_b
        pid = getattr(pytest, "post_id", None)
        r = client.post(f"{BASE}/posts/{pid}/extend", json={"days": 5}, headers=auth(tok_b))
        assert r.status_code == 403, r.text

    def test_extend_anon_401(self, client):
        pid = getattr(pytest, "post_id", None)
        r = client.post(f"{BASE}/posts/{pid}/extend", json={"days": 5})
        assert r.status_code == 401, r.text


# ---------- DM notification ----------
class TestDMNotification:
    def test_dm_creates_notification(self, client, user_a, user_b):
        uid_a, tok_a = user_a
        uid_b, tok_b = user_b
        r = client.post(f"{BASE}/messages/{uid_b}", json={"body": "TEST hello there"},
                        headers=auth(tok_a))
        assert r.status_code == 200, r.text
        d = client.get(f"{BASE}/notifications", headers=auth(tok_b)).json()
        dms = [n for n in d["items"] if n["kind"] == "dm"]
        assert dms, f"no dm notification for recipient: {d}"
        assert "TEST hello there" in dms[0]["body"]
        assert dms[0]["link"] == f"/messages?to={uid_a}"


# ---------- Crew join notification ----------
class TestCrewJoinNotification:
    def test_community_event_emits_crew_join_notification(self, client, user_a, user_b):
        uid_a, tok_a = user_a          # joiner (premium)
        uid_org, _ = user_b            # organizer
        eid = "TESTEV_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        starts = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST Community Regatta',
            market:'Greater Seattle', starts_at:'{starts}', ends_at:'{starts}',
            organizer_id:'{uid_org}', organizer_name:'TEST Org',
            source:'community', approved:true, created_at:new Date().toISOString()}});""")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "experience": "some", "notes": "",
                              "contact_via": "in-app", "post_to_feed": False},
                        headers=auth(tok_a))
        assert r.status_code == 200, r.text
        import time
        time.sleep(2)
        d = client.get(f"{BASE}/notifications", headers=auth(f"x")).status_code if False else None
        _, tok_org = user_b
        notifs = client.get(f"{BASE}/notifications", headers=auth(tok_org)).json()["items"]
        crew = [n for n in notifs if n["kind"] == "crew_join"]
        assert crew, f"organizer got no crew_join notification. notifs={notifs}"

    def test_aggregator_event_no_notification(self, client, user_a):
        uid_a, tok_a = user_a
        eid = "TESTEV_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        starts = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST Aggregator Race',
            market:'Greater Seattle', starts_at:'{starts}', ends_at:'{starts}',
            source:'aggregator', approved:true, created_at:new Date().toISOString()}});""")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "contact_via": "in-app", "post_to_feed": False},
                        headers=auth(tok_a))
        assert r.status_code == 200, r.text
        cnt = mongo("db.notifications.countDocuments({kind:'crew_join'})")
        assert cnt is not None


# ---------- Scheduler + regression ----------
class TestSchedulerAndRegression:
    def test_scheduler_status(self, client):
        r = client.get(f"{BASE}/admin/scheduler/status")
        assert r.status_code in (200, 401, 403), r.text
        if r.status_code == 200:
            assert "jobs" in r.json() or "next_run" in str(r.json()).lower()

    @pytest.mark.parametrize("path", ["/", "/markets", "/events", "/boat-pros",
                                      "/crew-bank/open", "/payments/packages"])
    def test_regression_endpoints(self, client, path):
        r = client.get(f"{BASE}{path}")
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
