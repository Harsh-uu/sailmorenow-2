"""Iteration 16 retest — intra-day precision past-filter, POST /api/events validation,
startup normalize migration selectivity, admin events filter.

Modules under test:
  routers/community_router.py  -> list_events (full now-ISO $expr), create_event validation
  routers/admin_router.py      -> admin_list_events (full now-ISO $expr)
  server.py                    -> startup normalize_iso migration filter
"""
import os
import uuid
import time
import subprocess
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
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw")
RUN_PREFIX = "TEST_i16_" + WORKER + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(is_admin=False, tier="premium"):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST i16',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'{tier}', newsletter_opt_in:true,
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
    db.events.deleteMany({{organizer_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^{RUN_PREFIX}'}}}});
    db.events.deleteMany({{title:{{$regex:'^TEST_i16'}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def create_event(client, tok, starts_at, ends_at=None, title="TEST_i16 Event"):
    payload = {"title": title, "description": "TEST_i16", "market": MARKET,
               "starts_at": starts_at, "location": "Shilshole"}
    if ends_at is not None:
        payload["ends_at"] = ends_at
    return client.post(f"{BASE}/events", json=payload, headers=auth(tok))


# ---------- 1. GET /api/events intra-day precision ----------
class TestIntradayPrecision:
    def test_ended_one_hour_ago_hidden(self, client):
        _, tok = mint_user()
        now = datetime.now(timezone.utc)
        r = create_event(client, tok, (now - timedelta(hours=4)).isoformat(),
                         (now - timedelta(hours=1)).isoformat(), "TEST_i16 JustEnded")
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["ends_at"].endswith("+00:00")
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] not in ids, "event ended 1h ago must be hidden"

    def test_ends_in_one_hour_visible(self, client):
        _, tok = mint_user()
        now = datetime.now(timezone.utc)
        ev = create_event(client, tok, (now - timedelta(hours=2)).isoformat(),
                          (now + timedelta(hours=1)).isoformat(), "TEST_i16 Ongoing").json()
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] in ids, "in-progress event must be visible"

    def test_starts_in_30m_no_ends_visible(self, client):
        _, tok = mint_user()
        starts = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        ev = create_event(client, tok, starts, None, "TEST_i16 Soon").json()
        assert ev["ends_at"] is None
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] in ids

    def test_date_only_today_all_day_event(self, client):
        """REGRESSION CHECK: date-only (all-day) events normalize to 00:00Z, so with a
        full-precision now comparison they vanish for the whole day of the event."""
        _, tok = mint_user()
        today = datetime.now(timezone.utc).date().isoformat()
        ev = create_event(client, tok, today, None, "TEST_i16 AllDayToday").json()
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] in ids, (
            "all-day event dated TODAY is hidden from GET /api/events — date-only "
            "starts_at is normalized to midnight UTC which is already < now")


# ---------- 2. POST /api/events validation ----------
class TestCreateEventValidation:
    def test_garbage_starts_at_400(self, client):
        _, tok = mint_user()
        r = create_event(client, tok, "not-a-date", None, "TEST_i16 BadStart")
        assert r.status_code == 400, (r.status_code, r.text)
        assert "starts_at" in r.json().get("detail", "")

    def test_garbage_ends_at_400(self, client):
        _, tok = mint_user()
        r = create_event(client, tok, "2026-09-01T10:00:00Z", "garbage", "TEST_i16 BadEnd")
        assert r.status_code == 400, (r.status_code, r.text)
        assert "ends_at" in r.json().get("detail", "")

    def test_empty_starts_at_400(self, client):
        _, tok = mint_user()
        r = create_event(client, tok, "", None, "TEST_i16 EmptyStart")
        assert r.status_code == 400, (r.status_code, r.text)

    @pytest.mark.parametrize("raw,expected", [
        ("2026-09-01", "2026-09-01T00:00:00+00:00"),
        ("2026-09-01T15:30:00Z", "2026-09-01T15:30:00+00:00"),
        ("2026-09-01T15:30:00", "2026-09-01T15:30:00+00:00"),
        ("2026-09-01T08:30:00-07:00", "2026-09-01T15:30:00+00:00"),
    ])
    def test_valid_formats_canonicalized_and_persisted(self, client, raw, expected):
        _, tok = mint_user()
        r = create_event(client, tok, raw, raw, f"TEST_i16 Fmt {raw}")
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["starts_at"] == expected, ev["starts_at"]
        assert ev["ends_at"] == expected, ev["ends_at"]
        assert "_id" not in ev
        stored = mongo(f"var d=db.events.findOne({{id:'{ev['id']}'}});print(d.starts_at+'|'+d.ends_at);")
        assert stored == f"{expected}|{expected}", stored


# ---------- 3. GET /api/admin/events past filter ----------
class TestAdminEventsFilter:
    def test_admin_hides_event_ended_one_hour_ago(self, client):
        _, atok = mint_user(is_admin=True)
        now = datetime.now(timezone.utc)
        past = create_event(client, atok, (now - timedelta(hours=4)).isoformat(),
                            (now - timedelta(hours=1)).isoformat(), "TEST_i16 AdminEnded").json()
        future = create_event(client, atok, (now + timedelta(days=2)).isoformat(),
                              None, "TEST_i16 AdminFuture").json()
        r = client.get(f"{BASE}/admin/events", headers=auth(atok))
        assert r.status_code == 200, r.text
        ids = [d["id"] for d in r.json()]
        assert past["id"] not in ids, "admin list must hide event ended 1h ago"
        assert future["id"] in ids

    def test_non_admin_403(self, client):
        _, tok = mint_user()
        r = client.get(f"{BASE}/admin/events", headers=auth(tok))
        assert r.status_code == 403, r.status_code


# ---------- 4. Startup normalize migration selectivity ----------
class TestNormalizeMigrationSelectivity:
    @pytest.mark.skipif(os.environ.get("SMN_ALLOW_RESTART") != "1",
                        reason="restarts backend; run with SMN_ALLOW_RESTART=1 -p no:xdist -n 0")
    def test_only_legacy_rows_touched(self, client):
        legacy_id = RUN_PREFIX + "legacy"
        canon_id = RUN_PREFIX + "canon"
        future = (datetime.now(timezone.utc) + timedelta(days=30))
        canon_iso = future.replace(microsecond=0).isoformat()
        mongo(f"""
        db.events.deleteMany({{id:{{$in:['{legacy_id}','{canon_id}']}}}});
        db.events.insertOne({{id:'{legacy_id}', title:'TEST_i16 legacy', market:'{MARKET}',
          starts_at:'{future.date().isoformat()}', ends_at:null, updated_at:'sentinel-legacy',
          approved:true}});
        db.events.insertOne({{id:'{canon_id}', title:'TEST_i16 canon', market:'{MARKET}',
          starts_at:'{canon_iso}', ends_at:'{canon_iso}', updated_at:'sentinel-canon',
          approved:true}});
        """)
        subprocess.run(["truncate", "-s", "0", "/var/log/supervisor/backend.err.log"],
                       capture_output=True)
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, text=True, timeout=90)
        for _ in range(40):
            time.sleep(2)
            try:
                if client.get(f"{BASE}/", timeout=5).status_code == 200:
                    break
            except Exception:
                pass
        log = subprocess.run(["grep", "-h", "normalized ISO timestamps",
                              "/var/log/supervisor/backend.err.log"],
                             capture_output=True, text=True).stdout
        legacy = mongo(f"var d=db.events.findOne({{id:'{legacy_id}'}});print(d.starts_at+'|'+d.updated_at);")
        canon = mongo(f"var d=db.events.findOne({{id:'{canon_id}'}});print(d.starts_at+'|'+d.updated_at);")
        mongo(f"db.events.deleteMany({{id:{{$in:['{legacy_id}','{canon_id}']}}}});")
        assert legacy.startswith(f"{future.date().isoformat()}T00:00:00+00:00"), legacy
        assert legacy.endswith("sentinel-legacy"), legacy
        assert canon == f"{canon_iso}|sentinel-canon", canon
        assert "normalized ISO timestamps on 1 legacy events" in log, log

    def test_no_non_canonical_rows_remain(self, client):
        bad = mongo("""print(db.events.countDocuments({$or:[
          {starts_at:{$not:{$regex:'\\\\+00:00$'}}},
          {ends_at:{$exists:true,$ne:null,$not:{$regex:'\\\\+00:00$'}}}]}));""")
        assert bad == "0", f"{bad} events still have non-canonical timestamps"
