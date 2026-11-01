"""Iteration 18 polish batch.

Modules under test:
  aggregator.upcoming_event_predicate  -> custom starts_field/ends_field kwargs
  routers/community_router.open_crew_slots -> /api/crew-bank/open past-filter parity
  routers/newsletter (digest)          -> /api/digest/preview?market= override regression
"""
import os
import sys
import uuid
import subprocess
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, "/app/backend")

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
DB = "test_database"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw")
RUN_PREFIX = "TEST_userH_" + WORKER + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user():
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST i18',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:true,
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
    s.headers.update({"Content-Type": "application/json", "User-Agent": UA})
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mongo(f"""
    var ids = db.users.find({{user_id:{{$regex:'^{RUN_PREFIX}'}}}},{{user_id:1}}).toArray().map(u=>u.user_id);
    db.crew_bank.deleteMany({{$or:[{{user_id:{{$in:ids}}}},{{event_id:{{$regex:'^{RUN_PREFIX}'}}}}]}});
    db.events.deleteMany({{id:{{$regex:'^{RUN_PREFIX}'}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def iso(dt):
    return dt.replace(microsecond=0).isoformat()


def seed_crew_row(tag, starts_at, ends_at, status="seeking", market=MARKET):
    eid = RUN_PREFIX + tag
    uid = RUN_PREFIX + "u_" + tag
    ends_js = "null" if ends_at is None else f"'{ends_at}'"
    mongo(f"""
    db.crew_bank.deleteMany({{event_id:'{eid}'}});
    db.crew_bank.insertOne({{event_id:'{eid}', user_id:'{uid}', user_name:'TEST i18 {tag}',
      user_email:'{uid}@sailmorenow.dev', positions:['Railmeat'], contact_via:'in-app',
      event_title:'TEST_userH {tag}', event_starts_at:'{starts_at}', event_ends_at:{ends_js},
      event_market:'{market}', status:'{status}',
      created_at:new Date().toISOString(), updated_at:new Date().toISOString()}});
    """)
    return eid


def open_ids(client, days=400, limit=200):
    r = client.get(f"{BASE}/crew-bank/open", params={"days": days, "limit": limit})
    assert r.status_code == 200, r.text
    return r, {e["event_id"] for e in r.json()}


# ---------- 1. aggregator.upcoming_event_predicate signature ----------
class TestPredicateSignature:
    def test_default_fields(self):
        from aggregator import upcoming_event_predicate
        p = upcoming_event_predicate("2026-01-01T00:00:00+00:00")
        assert p == {"$expr": {"$gte": [{"$ifNull": ["$ends_at", "$starts_at"]},
                                        "2026-01-01T00:00:00+00:00"]}}, p

    def test_custom_fields_dollar_prefixed(self):
        from aggregator import upcoming_event_predicate
        p = upcoming_event_predicate("NOW", "event_starts_at", "event_ends_at")
        assert p == {"$expr": {"$gte": [{"$ifNull": ["$event_ends_at", "$event_starts_at"]},
                                        "NOW"]}}, p

    def test_kwargs_accepted(self):
        from aggregator import upcoming_event_predicate
        p = upcoming_event_predicate("NOW", starts_field="a", ends_field="b")
        assert p["$expr"]["$gte"][0] == {"$ifNull": ["$b", "$a"]}, p

    def test_structure_shared_with_events_router(self):
        """Both call-sites must produce the identical $expr shape (only field names differ)."""
        from aggregator import upcoming_event_predicate
        ev = upcoming_event_predicate("NOW")
        cb = upcoming_event_predicate("NOW", "event_starts_at", "event_ends_at")
        assert list(ev.keys()) == list(cb.keys()) == ["$expr"]
        assert list(ev["$expr"].keys()) == list(cb["$expr"].keys()) == ["$gte"]
        assert list(ev["$expr"]["$gte"][0].keys()) == list(cb["$expr"]["$gte"][0].keys()) == ["$ifNull"]


# ---------- 2. /api/crew-bank/open past filter parity ----------
class TestCrewBankOpenPastFilter:
    def test_ended_one_hour_ago_excluded(self, client):
        now = datetime.now(timezone.utc)
        eid = seed_crew_row("past1h", iso(now - timedelta(hours=4)), iso(now - timedelta(hours=1)))
        _, ids = open_ids(client)
        assert eid not in ids, "crew slot for an event that ended 1h ago must be hidden"

    def test_ends_in_one_hour_included(self, client):
        now = datetime.now(timezone.utc)
        eid = seed_crew_row("future1h", iso(now - timedelta(hours=2)), iso(now + timedelta(hours=1)))
        r, ids = open_ids(client)
        assert eid in ids, f"in-progress crew slot must be returned: {r.text[:400]}"

    def test_all_day_today_included(self, client):
        today = datetime.now(timezone.utc).date()
        eid = seed_crew_row("allday",
                            f"{today.isoformat()}T00:00:00+00:00",
                            f"{(today + timedelta(days=1)).isoformat()}T00:00:00+00:00")
        _, ids = open_ids(client)
        assert eid in ids, "all-day crew slot dated today must be returned"

    def test_all_day_yesterday_excluded(self, client):
        yday = datetime.now(timezone.utc).date() - timedelta(days=1)
        eid = seed_crew_row("alldayY",
                            f"{yday.isoformat()}T00:00:00+00:00",
                            f"{datetime.now(timezone.utc).date().isoformat()}T00:00:00+00:00")
        _, ids = open_ids(client)
        assert eid not in ids, "yesterday's all-day crew slot must be hidden"

    def test_null_ends_at_falls_back_to_starts_at(self, client):
        now = datetime.now(timezone.utc)
        fut = seed_crew_row("nullendfut", iso(now + timedelta(days=2)), None)
        past = seed_crew_row("nullendpast", iso(now - timedelta(days=2)), None)
        _, ids = open_ids(client)
        assert fut in ids, "null ends_at must fall back to starts_at (future → visible)"
        assert past not in ids, "null ends_at must fall back to starts_at (past → hidden)"

    def test_non_seeking_status_excluded(self, client):
        now = datetime.now(timezone.utc)
        eid = seed_crew_row("filled", iso(now + timedelta(days=1)),
                            iso(now + timedelta(days=1, hours=3)), status="filled")
        _, ids = open_ids(client)
        assert eid not in ids, "non-seeking crew rows must not be returned"

    def test_horizon_days_respected(self, client):
        now = datetime.now(timezone.utc)
        eid = seed_crew_row("far", iso(now + timedelta(days=30)), iso(now + timedelta(days=30, hours=3)))
        r = client.get(f"{BASE}/crew-bank/open", params={"days": 3, "limit": 200})
        assert r.status_code == 200
        assert eid not in {e["event_id"] for e in r.json()}
        r2, ids2 = open_ids(client, days=60)
        assert eid in ids2

    def test_response_shape_no_objectid_no_email(self, client):
        now = datetime.now(timezone.utc)
        seed_crew_row("shape", iso(now + timedelta(hours=5)), iso(now + timedelta(hours=8)))
        r, _ = open_ids(client)
        rows = r.json()
        assert isinstance(rows, list) and rows
        mine = [x for x in rows if x["event_id"] == RUN_PREFIX + "shape"]
        assert mine, "seeded row missing"
        row = mine[0]
        assert "_id" not in row and "user_email" not in row, row.keys()
        assert row["status"] == "seeking"
        assert row["event_starts_at"].endswith("+00:00")

    def test_sorted_by_event_starts_at(self, client):
        r, _ = open_ids(client)
        starts = [e["event_starts_at"] for e in r.json()]
        assert starts == sorted(starts), starts[:8]


# ---------- 3. Digest preview market override (regression) ----------
class TestDigestMarketOverride:
    def test_default_market_is_primary(self, client):
        _, tok = mint_user()
        r = client.get(f"{BASE}/digest/preview", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["market"] == MARKET

    def test_override_market(self, client):
        _, tok = mint_user()
        r = client.get(f"{BASE}/digest/preview", params={"market": "Bellingham"}, headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["market"] == "Bellingham"
        for k in ("new_crew", "new_events", "new_comments", "newsletter_opt_in"):
            assert k in d, d.keys()

    @pytest.mark.xfail(reason="KNOWN GAP: /api/digest/preview echoes any ?market= string "
                              "instead of validating against MARKETS (returns 200 for 'Atlantis')",
                       strict=False)
    def test_invalid_market_rejected(self, client):
        _, tok = mint_user()
        r = client.get(f"{BASE}/digest/preview", params={"market": "Atlantis"}, headers=auth(tok))
        assert r.status_code in (400, 422), (r.status_code, r.text[:300])

    def test_requires_auth(self, client):
        r = client.get(f"{BASE}/digest/preview")
        assert r.status_code in (401, 403), r.status_code

    def test_markets_endpoint_lists_all_pnw(self, client):
        r = client.get(f"{BASE}/markets")
        assert r.status_code == 200
        markets = r.json()["markets"]
        for m in ["Portland/Vancouver", "Greater Seattle", "Bellingham",
                  "Anacortes/San Juan Islands", "Tacoma", "Olympia", "Everett",
                  "Kirkland", "Hood River", "Eugene"]:
            assert m in markets, markets


# ---------- 4. seed_alex identity_verified guard ----------
class TestSeedInvariant:
    def test_alex_identity_verified_preserved(self, client):
        out = mongo("var u=db.users.findOne({email:'crew.alex@sailmorenow.dev'});"
                    "print(u?(''+u.identity_verified):'MISSING');")
        assert out == "true", f"seed_alex.identity_verified expected true, got {out}"
