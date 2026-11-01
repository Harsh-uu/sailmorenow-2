"""Iteration 17 retest — all-day (date-only) event visibility, migration convergence
for ends_at == '', shared upcoming_event_predicate parity between
GET /api/events and GET /api/admin/events.

Modules under test:
  date_utils.py                -> is_date_only / end_of_day_iso
  aggregator.py                -> upcoming_event_predicate
  routers/community_router.py  -> create_event (date-only ends_at synthesis), list_events
  routers/admin_router.py      -> admin_list_events
  server.py                    -> startup normalize migration (ends_at '' -> null)
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
RUN_PREFIX = "TEST_i17_" + WORKER + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(is_admin=False):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST i17',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:true,
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
    db.events.deleteMany({{title:{{$regex:'^{RUN_PREFIX}'}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def create_event(client, tok, starts_at, ends_at=None, title="Event"):
    payload = {"title": RUN_PREFIX + title, "description": "TEST_i17", "market": MARKET,
               "starts_at": starts_at, "location": "Shilshole"}
    if ends_at is not None:
        payload["ends_at"] = ends_at
    return client.post(f"{BASE}/events", json=payload, headers=auth(tok))


# ---------- 1. All-day (date-only) event handling ----------
class TestAllDayEvents:
    def test_today_date_only_visible_all_day(self, client):
        _, tok = mint_user()
        today = datetime.now(timezone.utc).date()
        r = create_event(client, tok, today.isoformat(), None, "AllDayToday")
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["starts_at"] == f"{today.isoformat()}T00:00:00+00:00", ev["starts_at"]
        expected_end = (today + timedelta(days=1)).isoformat() + "T00:00:00+00:00"
        assert ev["ends_at"] == expected_end, ev["ends_at"]
        # persisted in mongo
        stored = mongo(f"var d=db.events.findOne({{id:'{ev['id']}'}});print(d.starts_at+'|'+d.ends_at);")
        assert stored == f"{today.isoformat()}T00:00:00+00:00|{expected_end}", stored
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] in ids, "all-day event dated TODAY must be visible"

    def test_yesterday_date_only_hidden(self, client):
        _, tok = mint_user()
        yday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        ev = create_event(client, tok, yday, None, "AllDayYesterday").json()
        assert ev["ends_at"] == datetime.now(timezone.utc).date().isoformat() + "T00:00:00+00:00"
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] not in ids, "yesterday's all-day event must be hidden"

    def test_explicit_ends_at_not_overwritten(self, client):
        """Date-only starts_at WITH an explicit ends_at must keep the caller's value."""
        _, tok = mint_user()
        today = datetime.now(timezone.utc).date().isoformat()
        end = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(microsecond=0).isoformat()
        ev = create_event(client, tok, today, end, "AllDayExplicitEnd").json()
        assert ev["ends_at"] == end, ev["ends_at"]
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] in ids


# ---------- 2. Intra-day precision preserved for timed events ----------
class TestTimedPrecision:
    def test_ended_one_hour_ago_hidden(self, client):
        _, tok = mint_user()
        now = datetime.now(timezone.utc)
        ev = create_event(client, tok, (now - timedelta(hours=4)).isoformat(),
                          (now - timedelta(hours=1)).isoformat(), "JustEnded").json()
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] not in ids, "timed event ended 1h ago must stay hidden"

    def test_ends_in_one_hour_visible(self, client):
        _, tok = mint_user()
        now = datetime.now(timezone.utc)
        ev = create_event(client, tok, (now - timedelta(hours=2)).isoformat(),
                          (now + timedelta(hours=1)).isoformat(), "Ongoing").json()
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert ev["id"] in ids, "in-progress timed event must be visible"


# ---------- 3. Shared predicate parity: /api/events vs /api/admin/events ----------
class TestPredicateParity:
    def test_same_ids_for_same_market(self, client):
        _, atok = mint_user(is_admin=True)
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        seeded = {
            "allday": create_event(client, atok, today, None, "P AllDay").json()["id"],
            "ongoing": create_event(client, atok, (now - timedelta(hours=2)).isoformat(),
                                    (now + timedelta(hours=2)).isoformat(), "P Ongoing").json()["id"],
            "future": create_event(client, atok, (now + timedelta(days=3)).isoformat(),
                                   None, "P Future").json()["id"],
        }
        past_id = create_event(client, atok, (now - timedelta(hours=5)).isoformat(),
                               (now - timedelta(hours=1)).isoformat(), "P Past").json()["id"]

        # /api/admin/events has no market param (admin UI is global) so compare the
        # unfiltered public list against it — both must use the same predicate.
        pub = client.get(f"{BASE}/events")
        adm = client.get(f"{BASE}/admin/events", headers=auth(atok))
        assert pub.status_code == 200 and adm.status_code == 200, (pub.status_code, adm.status_code)
        pub_ids = {d["id"] for d in pub.json()}
        adm_ids = {d["id"] for d in adm.json()}
        for key, eid in seeded.items():
            assert eid in pub_ids, f"{key} missing from /api/events"
            assert eid in adm_ids, f"{key} missing from /api/admin/events"
        assert past_id not in pub_ids and past_id not in adm_ids
        assert pub_ids == adm_ids, {
            "only_public": sorted(pub_ids - adm_ids), "only_admin": sorted(adm_ids - pub_ids)}
        assert all("_id" not in d for d in adm.json())
        # market-filtered public list must be a consistent subset of the admin list
        pub_m = client.get(f"{BASE}/events", params={"market": MARKET})
        assert pub_m.status_code == 200
        pub_m_ids = {d["id"] for d in pub_m.json()}
        assert pub_m_ids <= adm_ids
        adm2 = client.get(f"{BASE}/admin/events", headers=auth(atok))
        adm_m_ids = {d["id"] for d in adm2.json() if d.get("market") == MARKET}
        # restrict to this run's rows so parallel workers creating events can't race
        mine = set(seeded.values()) | {past_id}
        assert (pub_m_ids & mine) == (adm_m_ids & mine), {
            "only_public": sorted((pub_m_ids & mine) - adm_m_ids),
            "only_admin": sorted((adm_m_ids & mine) - pub_m_ids)}


# ---------- 4. Migration convergence ----------
class TestMigrationConvergence:
    def test_no_non_canonical_rows_remain(self, client):
        bad = mongo("""print(db.events.countDocuments({$or:[
          {starts_at:{$not:{$regex:'\\\\+00:00$'}}},
          {ends_at:{$exists:true,$ne:null,$not:{$regex:'\\\\+00:00$'}}}]}));""")
        assert bad == "0", f"{bad} events still have non-canonical timestamps"

    def test_no_empty_string_ends_at(self, client):
        cnt = mongo("print(db.events.countDocuments({ends_at:''}));")
        assert cnt == "0", f"{cnt} events still have ends_at == ''"

    @pytest.mark.skipif(os.environ.get("SMN_ALLOW_RESTART") != "1",
                        reason="restarts backend; run with SMN_ALLOW_RESTART=1 -o addopts=''")
    def test_empty_ends_at_repaired_and_converges(self, client):
        legacy_id = RUN_PREFIX + "empty_ends"
        future_date = (datetime.now(timezone.utc) + timedelta(days=20)).date().isoformat()
        mongo(f"""
        db.events.deleteMany({{id:'{legacy_id}'}});
        db.events.insertOne({{id:'{legacy_id}', title:'TEST_i17 emptyends', market:'{MARKET}',
          starts_at:'{future_date}T12:00:00+00:00', ends_at:'', approved:true}});
        """)

        def restart_and_get_log():
            subprocess.run(["truncate", "-s", "0", "/var/log/supervisor/backend.err.log"],
                           capture_output=True)
            subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                           capture_output=True, text=True, timeout=120)
            for _ in range(45):
                time.sleep(2)
                try:
                    if client.get(f"{BASE}/", timeout=5).status_code == 200:
                        break
                except Exception:
                    pass
            time.sleep(3)
            return subprocess.run(["grep", "-h", "normalized ISO timestamps",
                                   "/var/log/supervisor/backend.err.log"],
                                  capture_output=True, text=True).stdout

        log1 = restart_and_get_log()
        assert "normalized ISO timestamps on 1 legacy events" in log1, log1
        row = mongo(f"var d=db.events.findOne({{id:'{legacy_id}'}});"
                    f"print(d.starts_at+'|'+(d.ends_at===null?'NULL':typeof d.ends_at+':'+d.ends_at));")
        assert row.endswith("|NULL"), f"ends_at not nulled: {row}"
        # $ifNull falls back to starts_at → future event still visible
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        assert legacy_id in ids, "repaired row must be visible via $ifNull fallback to starts_at"

        # second restart → converged, this row no longer matched
        log2 = restart_and_get_log()
        assert "normalized ISO timestamps on 1 legacy events" not in log2, (
            f"migration did not converge: {log2}")
        mongo(f"db.events.deleteMany({{id:'{legacy_id}'}});")

    @pytest.mark.skipif(os.environ.get("SMN_ALLOW_RESTART") != "1",
                        reason="restarts backend; run with SMN_ALLOW_RESTART=1 -o addopts=''")
    def test_date_only_legacy_row_expanded(self, client):
        legacy_id = RUN_PREFIX + "dateonly"
        today = datetime.now(timezone.utc).date().isoformat()
        expected_end = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat() + "T00:00:00+00:00"
        mongo(f"""
        db.events.deleteMany({{id:'{legacy_id}'}});
        db.events.insertOne({{id:'{legacy_id}', title:'TEST_i17 legacy dateonly', market:'{MARKET}',
          starts_at:'{today}', approved:true}});
        """)
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, text=True, timeout=120)
        for _ in range(45):
            time.sleep(2)
            try:
                if client.get(f"{BASE}/", timeout=5).status_code == 200:
                    break
            except Exception:
                pass
        row = mongo(f"var d=db.events.findOne({{id:'{legacy_id}'}});print(d.starts_at+'|'+d.ends_at);")
        ids = [d["id"] for d in client.get(f"{BASE}/events").json()]
        mongo(f"db.events.deleteMany({{id:'{legacy_id}'}});")
        assert row == f"{today}T00:00:00+00:00|{expected_end}", row
        assert legacy_id in ids, "migrated legacy all-day row must be visible today"
