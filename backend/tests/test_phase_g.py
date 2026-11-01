"""Phase G tests.

Covers:
  date_utils.normalize_iso                -> unit cases
  POST /api/events                        -> starts_at/ends_at canonicalization
  GET  /api/events                        -> past filter on canonical format
  GET  /api/digest/preview                -> auth, 400 no market, parity w/ scheduler
  GET  /api/admin/events                  -> 403 anon / non-admin, 200 admin, past hidden
  server startup migration                -> legacy date-only starts_at rewritten

xdist-safe via RUN_PREFIX; full teardown of TEST_userG_* artifacts.
"""
import os
import sys
import uuid
import time
import asyncio
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
RUN_PREFIX = "TEST_userG_" + WORKER + "_"
MARKET = "Greater Seattle"
G_MARKET = "TEST_MarketG_" + WORKER


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_UserG",
              is_admin=False, market=MARKET, newsletter=True):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mkt = "null" if market is None else f"'{market}'"
    mkts = "[]" if market is None else f"['{market}']"
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'{account_type}',
      primary_market:{mkt}, markets:{mkts},
      onboarding_complete:true, subscription_tier:'{tier}',
      newsletter_opt_in:{'true' if newsletter else 'false'},
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
    db.crew_bank_standalone.deleteMany({{user_id:{{$in:ids}}}});
    db.crew_bank.deleteMany({{user_id:{{$in:ids}}}});
    db.events.deleteMany({{organizer_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^{RUN_PREFIX}'}}}});
    db.events.deleteMany({{title:{{$regex:'^TEST_userG'}}}});
    db.events.deleteMany({{market:'{G_MARKET}'}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


# ---------- G.1 normalize_iso unit ----------
class TestNormalizeIso:
    @staticmethod
    def _n(v):
        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        from date_utils import normalize_iso
        return normalize_iso(v)

    def test_date_only_expands_to_midnight_utc(self):
        assert self._n("2026-08-21") == "2026-08-21T00:00:00+00:00"

    def test_trailing_z_becomes_offset(self):
        assert self._n("2026-08-21T15:30:00Z") == "2026-08-21T15:30:00+00:00"

    def test_naive_treated_as_utc(self):
        assert self._n("2026-08-21T15:30:00") == "2026-08-21T15:30:00+00:00"

    def test_offset_converted_to_utc(self):
        assert self._n("2026-08-21T05:26:30-07:00") == "2026-08-21T12:26:30+00:00"

    def test_positive_offset_converted(self):
        assert self._n("2026-08-21T14:00:00+02:00") == "2026-08-21T12:00:00+00:00"

    def test_none_and_empty(self):
        assert self._n(None) is None
        assert self._n("") is None
        assert self._n("   ") is None

    def test_unparseable_returned_unchanged(self):
        assert self._n("not-a-date") == "not-a-date"
        assert self._n("2026-13-99") == "2026-13-99"

    def test_datetime_and_date_objects(self):
        from datetime import date as _d, datetime as _dt
        assert self._n(_d(2026, 8, 21)) == "2026-08-21T00:00:00+00:00"
        assert self._n(_dt(2026, 8, 21, 5, 0, 0)) == "2026-08-21T05:00:00+00:00"

    def test_microseconds_truncated_to_seconds(self):
        assert self._n("2026-08-21T15:30:00.123456+00:00") == "2026-08-21T15:30:00+00:00"

    def test_idempotent(self):
        once = self._n("2026-08-21")
        assert self._n(once) == once


# ---------- G.2 POST /api/events canonicalization ----------
class TestCreateEventCanonical:
    created = []

    def _create(self, client, tok, starts_at, ends_at=None, title="TEST_userG Event"):
        payload = {"title": title, "description": "TEST_userG desc", "market": MARKET,
                   "starts_at": starts_at, "location": "Shilshole"}
        if ends_at is not None:
            payload["ends_at"] = ends_at
        r = client.post(f"{BASE}/events", json=payload, headers=auth(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "_id" not in body
        self.created.append(body["id"])
        return body

    def test_date_only_canonicalized_and_persisted(self, client):
        uid, tok = mint_user()
        ev = self._create(client, tok, "2026-08-21")
        assert ev["starts_at"] == "2026-08-21T00:00:00+00:00", ev["starts_at"]
        stored = mongo(f"print(db.events.findOne({{id:'{ev['id']}'}}).starts_at);")
        assert stored == "2026-08-21T00:00:00+00:00", stored

    def test_z_suffix_canonicalized(self, client):
        uid, tok = mint_user()
        ev = self._create(client, tok, "2026-08-21T15:30:00Z", "2026-08-22T02:00:00Z")
        assert ev["starts_at"] == "2026-08-21T15:30:00+00:00", ev
        assert ev["ends_at"] == "2026-08-22T02:00:00+00:00", ev

    def test_offset_converted_to_utc(self, client):
        uid, tok = mint_user()
        ev = self._create(client, tok, "2026-08-21T05:26:30-07:00")
        assert ev["starts_at"] == "2026-08-21T12:26:30+00:00", ev

    def test_missing_starts_at_400(self, client):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/events", json={
            "title": "TEST_userG bad", "description": "x", "market": MARKET,
            "starts_at": ""}, headers=auth(tok))
        assert r.status_code == 400, (r.status_code, r.text)

    def test_anon_401(self, client):
        r = client.post(f"{BASE}/events", json={
            "title": "TEST_userG anon", "description": "x", "market": MARKET,
            "starts_at": "2026-08-21"})
        assert r.status_code == 401, (r.status_code, r.text)

    def test_today_date_only_still_visible(self, client):
        uid, tok = mint_user()
        today = datetime.now(timezone.utc).date().isoformat()
        ev = self._create(client, tok, today, title="TEST_userG Today Event")
        r = client.get(f"{BASE}/events")
        assert r.status_code == 200, r.text
        ids = [d["id"] for d in r.json()]
        assert ev["id"] in ids, "same-day date-only event should stay visible"

    def test_fully_past_event_hidden(self, client):
        uid, tok = mint_user()
        past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        ev = self._create(client, tok, past, past, title="TEST_userG Past Event")
        r = client.get(f"{BASE}/events")
        ids = [d["id"] for d in r.json()]
        assert ev["id"] not in ids, "past event should be hidden"

    def test_ended_one_hour_ago_hidden(self, client):
        """Spec: event that ended 1h ago should be hidden from GET /api/events."""
        uid, tok = mint_user()
        ended = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        started = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
        ev = self._create(client, tok, started, ended, title="TEST_userG JustEnded")
        r = client.get(f"{BASE}/events")
        ids = [d["id"] for d in r.json()]
        assert ev["id"] not in ids, ("event ended 1h ago is still listed — today_iso "
                                     "date-only comparison keeps same-day past events")


# ---------- G.3 GET /api/digest/preview ----------
class TestDigestPreview:
    def test_anon_401(self, client):
        r = client.get(f"{BASE}/digest/preview")
        assert r.status_code == 401, (r.status_code, r.text)

    def test_no_primary_market_400(self, client):
        uid, tok = mint_user(market=None, name="TEST_userG NoMarket")
        r = client.get(f"{BASE}/digest/preview", headers=auth(tok))
        assert r.status_code == 400, (r.status_code, r.text)
        assert "primary market" in r.json()["detail"].lower(), r.text

    def test_shape_and_defaults(self, client):
        uid, tok = mint_user(name="TEST_userG Shape")
        r = client.get(f"{BASE}/digest/preview", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("market", "newsletter_opt_in", "last_sent_at", "empty",
                  "new_crew", "new_events", "new_comments"):
            assert k in d, (k, d.keys())
        assert d["market"] == MARKET
        assert d["newsletter_opt_in"] is True
        assert isinstance(d["new_crew"], list)
        assert isinstance(d["new_events"], list)
        assert isinstance(d["new_comments"], int)
        assert isinstance(d["empty"], bool)
        assert all("_id" not in c for c in d["new_crew"])
        assert all("_id" not in e for e in d["new_events"])

    def test_market_override_honored(self, client):
        uid, tok = mint_user(name="TEST_userG Override")
        r = client.get(f"{BASE}/digest/preview?market={G_MARKET}", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["market"] == G_MARKET

    def test_empty_flag_for_quiet_market(self, client):
        quiet = "TEST_MarketG_quiet_" + WORKER + uuid.uuid4().hex[:4]
        uid, tok = mint_user(name="TEST_userG Quiet")
        r = client.get(f"{BASE}/digest/preview?market={quiet}", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["empty"] is True, d
        assert d["new_crew"] == [] and d["new_events"] == [] and d["new_comments"] == 0

    def test_new_crew_populated_and_not_empty(self, client):
        """2 fresh crew_bank_standalone rows in the market show up in new_crew."""
        uid, tok = mint_user(market=G_MARKET, name="TEST_userG CrewOwner")
        now = datetime.now(timezone.utc)
        for i in range(2):
            created = (now - timedelta(days=i + 1)).isoformat()
            mongo(f"""db.crew_bank_standalone.insertOne({{
              id:'{RUN_PREFIX}cb_{uuid.uuid4().hex[:8]}', user_id:'{uid}',
              user_name:'TEST_userG Crew{i}', user_avatar:'⛵',
              markets:['{G_MARKET}'], positions:['Foredeck'], status:'seeking',
              expires_at:null, created_at:'{created}'}});""")
        r = client.get(f"{BASE}/digest/preview", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        names = [c["user_name"] for c in d["new_crew"]]
        assert "TEST_userG Crew0" in names and "TEST_userG Crew1" in names, names
        assert d["empty"] is False, d

    def test_parity_with_compute_digest_payload(self, client):
        """Endpoint output must match scheduler.compute_digest_payload for same market."""
        uid, tok = mint_user(market=G_MARKET, name="TEST_userG Parity")
        now = datetime.now(timezone.utc)
        for i in range(2):
            created = (now - timedelta(days=i + 1)).isoformat()
            mongo(f"""db.crew_bank_standalone.insertOne({{
              id:'{RUN_PREFIX}cbp_{uuid.uuid4().hex[:8]}', user_id:'{uid}',
              user_name:'TEST_userG Parity{i}', user_avatar:'⛵',
              markets:['{G_MARKET}'], positions:['Trim'], status:'seeking',
              expires_at:null, created_at:'{created}'}});""")
        api_payload = client.get(f"{BASE}/digest/preview", headers=auth(tok)).json()
        direct = _compute(G_MARKET)
        assert sorted(c["user_name"] for c in api_payload["new_crew"]) == \
               sorted(c["user_name"] for c in direct["new_crew"]), (api_payload["new_crew"], direct["new_crew"])
        assert sorted(e["id"] for e in api_payload["new_events"]) == \
               sorted(e["id"] for e in direct["new_events"])
        assert api_payload["new_comments"] == direct["new_comments"]

    def test_opt_out_reflected(self, client):
        uid, tok = mint_user(name="TEST_userG OptOut", newsletter=False)
        d = client.get(f"{BASE}/digest/preview", headers=auth(tok)).json()
        assert d["newsletter_opt_in"] is False, d
        r = client.patch(f"{BASE}/auth/newsletter", json={"newsletter_opt_in": True},
                         headers=auth(tok))
        assert r.status_code == 200, r.text
        d2 = client.get(f"{BASE}/digest/preview", headers=auth(tok)).json()
        assert d2["newsletter_opt_in"] is True, d2


def _compute(market):
    """Run scheduler.compute_digest_payload directly (in-process)."""
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")
    for k, v in dotenv_values("/app/backend/.env").items():
        os.environ.setdefault(k, v)
    for mod in ("scheduler", "notifications", "mailer", "deps",
                "routers.community_router", "routers.reviews_router", "aggregator"):
        sys.modules.pop(mod, None)

    async def run():
        import scheduler as sched
        from deps import db as mdb
        return await sched.compute_digest_payload(mdb, market, datetime.now(timezone.utc))

    return asyncio.run(run())


# ---------- G.4 GET /api/admin/events ----------
class TestAdminEventsList:
    def test_anon_403(self, client):
        r = client.get(f"{BASE}/admin/events")
        assert r.status_code == 403, (r.status_code, r.text)

    def test_non_admin_403(self, client):
        uid, tok = mint_user(name="TEST_userG Member")
        r = client.get(f"{BASE}/admin/events", headers=auth(tok))
        assert r.status_code == 403, (r.status_code, r.text)

    def test_admin_200_shape(self, client):
        adm, t = mint_user(is_admin=True, name="TEST_userG Admin")
        r = client.get(f"{BASE}/admin/events", headers=auth(t))
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list)
        assert docs, "no upcoming events returned"
        for d in docs[:20]:
            assert "_id" not in d
            assert "id" in d and "title" in d
            assert isinstance(d.get("email_recipients"), list), d

    def test_past_event_hidden(self, client):
        adm, t = mint_user(is_admin=True, name="TEST_userG Admin2")
        eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
        past = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
          title:'TEST_userG Past', market:'{MARKET}', starts_at:'{past}',
          ends_at:'{past}', approved:true, created_at:new Date().toISOString()}});""")
        ids = [d["id"] for d in client.get(f"{BASE}/admin/events", headers=auth(t)).json()]
        assert eid not in ids, "past event leaked into /admin/events"

    def test_upcoming_event_present_with_default_recipients(self, client):
        adm, t = mint_user(is_admin=True, name="TEST_userG Admin3")
        eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
        soon = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
          title:'TEST_userG Upcoming', market:'{MARKET}', starts_at:'{soon}',
          approved:true, created_at:new Date().toISOString()}});""")
        docs = client.get(f"{BASE}/admin/events", headers=auth(t)).json()
        mine = next((d for d in docs if d["id"] == eid), None)
        assert mine is not None, "upcoming event missing from /admin/events"
        assert mine["email_recipients"] == [], mine

    def test_patch_then_list_reflects_recipients(self, client):
        adm, t = mint_user(is_admin=True, name="TEST_userG Admin4")
        eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
        soon = (datetime.now(timezone.utc) + timedelta(days=8)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
          title:'TEST_userG Patchable', market:'{MARKET}', starts_at:'{soon}',
          approved:true, created_at:new Date().toISOString()}});""")
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": ["ops@partner.org"]}, headers=auth(t))
        assert r.status_code == 200, r.text
        docs = client.get(f"{BASE}/admin/events", headers=auth(t)).json()
        mine = next((d for d in docs if d["id"] == eid), None)
        assert mine and mine["email_recipients"] == ["ops@partner.org"], mine

    def test_sorted_by_starts_at(self, client):
        adm, t = mint_user(is_admin=True, name="TEST_userG Admin5")
        docs = client.get(f"{BASE}/admin/events", headers=auth(t)).json()
        starts = [d.get("starts_at") or "" for d in docs]
        assert starts == sorted(starts), "admin/events not sorted by starts_at"


# ---------- G.5 startup migration ----------
class TestStartupNormalizeMigration:
    @pytest.mark.skipif(os.environ.get("SMN_ALLOW_RESTART") != "1",
                        reason="restarts backend; run with SMN_ALLOW_RESTART=1 -n 0")
    def test_legacy_date_only_rewritten_on_restart(self, client):
        eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
        legacy = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
          title:'TEST_userG Legacy', market:'{MARKET}', starts_at:'{legacy}',
          ends_at:'{legacy}', approved:true, created_at:new Date().toISOString()}});""")
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, text=True, timeout=120)
        for _ in range(40):
            try:
                if client.get(f"{BASE}/events", timeout=10).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(2)
        after = mongo(f"print(db.events.findOne({{id:'{eid}'}}).starts_at);")
        assert after == legacy + "T00:00:00+00:00", after
        after_e = mongo(f"print(db.events.findOne({{id:'{eid}'}}).ends_at);")
        assert after_e == legacy + "T00:00:00+00:00", after_e
        log = subprocess.run(
            "grep -h 'normalized ISO timestamps on' /var/log/supervisor/backend.*.log | tail -3",
            shell=True, capture_output=True, text=True).stdout
        assert "normalized ISO timestamps on" in log, log

    def test_no_date_only_timestamps_remain(self):
        n = mongo("print(db.events.countDocuments({starts_at:{$regex:'^\\\\d{4}-\\\\d{2}-\\\\d{2}$'}}));")
        assert n.strip() == "0", f"{n} events still have date-only starts_at"


# ---------- Regression ----------
class TestRegression:
    def test_seed_alex_identity_verified(self):
        out = mongo("print(JSON.stringify(db.users.findOne({email:'crew.alex@sailmorenow.dev'},"
                    "{identity_verified:1,_id:0})));")
        assert '"identity_verified":true' in out.replace(" ", ""), out

    def test_core_endpoints_ok(self, client):
        for path in ("/posts", "/events", "/boat-pros?market=Greater+Seattle"):
            r = client.get(f"{BASE}{path}")
            assert r.status_code == 200, (path, r.status_code, r.text[:200])

    def test_scheduler_uses_compute_digest_payload(self):
        src = open("/app/backend/scheduler.py").read()
        assert "async def compute_digest_payload" in src
        assert "compute_digest_payload(db, market, now)" in src, \
            "sunday digest job no longer calls compute_digest_payload"
