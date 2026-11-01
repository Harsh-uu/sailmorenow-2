"""Phase C tests: Standalone Crew Bank (event-independent listings).

Covers POST/GET/GET-mine/PATCH-status/POST-renew/DELETE on
/api/crew-bank/standalone plus Phase A/B regression spots.
xdist-safe via RUN_PREFIX; full teardown of TEST_userC_* artifacts.
"""
import os
import json
import uuid
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
RUN_PREFIX = "TEST_userC_" + os.environ.get("PYTEST_XDIST_WORKER", "gw") + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_UserC"):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'{account_type}',
      primary_market:'{MARKET}', markets:['{MARKET}'],
      onboarding_complete:true, subscription_tier:'{tier}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def payload(**over):
    p = {"positions": ["Foredeck"], "markets": [MARKET],
         "experience": "TEST 5 seasons foredeck", "notes": "TEST notes",
         "availability": "Weekends", "contact_via": "in-app"}
    p.update(over)
    return p


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
    db.crew_bank_standalone.deleteMany({{user_id:{{$regex:'^{RUN_PREFIX}'}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.crew_bank.deleteMany({{user_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^TESTEVC_{RUN_PREFIX}'}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


# ---------- C.1 POST /api/crew-bank/standalone (upsert + gating + validation) ----------
class TestStandaloneUpsert:
    def test_anon_401(self, client):
        r = client.post(f"{BASE}/crew-bank/standalone", json=payload())
        assert r.status_code == 401, r.text

    def test_free_tier_402(self, client):
        uid, tok = mint_user(tier="free")
        r = client.post(f"{BASE}/crew-bank/standalone", json=payload(), headers=auth(tok))
        assert r.status_code == 402, r.text
        assert mongo(f"db.crew_bank_standalone.countDocuments({{user_id:'{uid}'}})") == "0"

    @pytest.mark.parametrize("tier", ["basic", "featured", "premium"])
    def test_paid_creates_listing(self, client, tier):
        uid, tok = mint_user(tier=tier, name=f"TEST_C_{tier}")
        r = client.post(f"{BASE}/crew-bank/standalone", json=payload(), headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        assert d["status"] == "seeking", d
        assert d["positions"] == ["Foredeck"], d
        assert d["markets"] == [MARKET], d
        assert d["user_name"] == f"TEST_C_{tier}", d
        assert d["user_avatar"] == "https://via.placeholder.com/150", d
        assert d["user_primary_market"] == MARKET, d
        assert d["experience"] == "TEST 5 seasons foredeck"
        assert d["contact_via"] == "in-app"
        # expires_at ~90 days out
        exp = datetime.fromisoformat(d["expires_at"])
        delta_days = (exp - datetime.now(timezone.utc)).total_seconds() / 86400
        assert 89 < delta_days < 91, f"expires_at not ~90d: {delta_days}"
        # persisted
        doc = json.loads(mongo(
            f"JSON.stringify(db.crew_bank_standalone.findOne({{user_id:'{uid}'}},{{_id:0}}))"))
        assert doc["status"] == "seeking"
        assert doc["user_email"] == f"{uid}@sailmorenow.dev"
        assert doc["created_at"]

    @pytest.mark.parametrize("bad,field", [
        ({"positions": ["Chef"]}, "position"),
        ({"markets": ["Atlantis"]}, "market"),
        ({"contact_via": "carrier-pigeon"}, "contact_via"),
    ])
    def test_invalid_values_400(self, client, bad, field):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/crew-bank/standalone", json=payload(**bad), headers=auth(tok))
        assert r.status_code == 400, f"{field}: {r.status_code} {r.text}"
        assert mongo(f"db.crew_bank_standalone.countDocuments({{user_id:'{uid}'}})") == "0"

    def test_repost_upserts_no_duplicate(self, client):
        uid, tok = mint_user(name="TEST_C_upsert")
        r1 = client.post(f"{BASE}/crew-bank/standalone", json=payload(), headers=auth(tok))
        assert r1.status_code == 200, r1.text
        created_1 = r1.json().get("created_at")
        exp1 = r1.json()["expires_at"]
        # age the doc so refresh is observable
        old = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        mongo(f"""db.crew_bank_standalone.updateOne({{user_id:'{uid}'}},
              {{$set:{{expires_at:'{old}'}}}});""")
        r2 = client.post(f"{BASE}/crew-bank/standalone",
                         json=payload(positions=["Pit", "Trimmer"], notes="TEST updated"),
                         headers=auth(tok))
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["positions"] == ["Pit", "Trimmer"], d2
        assert d2["notes"] == "TEST updated"
        assert d2["created_at"] == created_1, "created_at should be preserved on upsert"
        assert datetime.fromisoformat(d2["expires_at"]) > datetime.fromisoformat(old), \
            "expires_at not refreshed"
        assert mongo(f"db.crew_bank_standalone.countDocuments({{user_id:'{uid}'}})") == "1", \
            "upsert duplicated the doc"
        assert exp1  # sanity

    def test_empty_positions_defaults_to_any(self, client):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/crew-bank/standalone",
                        json=payload(positions=[]), headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["positions"] == ["Railmeat"], r.json()


# ---------- C.2 GET /api/crew-bank/standalone (public list) ----------
class TestStandaloneList:
    def test_anon_shape_and_email_stripped(self, client):
        uid, tok = mint_user(name="TEST_C_list")
        assert client.post(f"{BASE}/crew-bank/standalone", json=payload(),
                           headers=auth(tok)).status_code == 200
        r = client.get(f"{BASE}/crew-bank/standalone")
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(["count", "entries", "can_list_yourself"]).issubset(d.keys()), d
        assert d["can_list_yourself"] is False, d
        assert d["count"] == len(d["entries"])
        mine = [e for e in d["entries"] if e["user_id"] == uid]
        assert mine, "own listing missing from public list"
        for e in d["entries"]:
            assert "user_email" not in e, f"email leaked: {e}"
            assert "_id" not in e

    def test_authed_paid_can_list_yourself_true(self, client):
        uid, tok = mint_user(tier="premium")
        r = client.get(f"{BASE}/crew-bank/standalone", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["can_list_yourself"] is True, r.json()

    def test_free_user_can_list_yourself_false(self, client):
        uid, tok = mint_user(tier="free")
        r = client.get(f"{BASE}/crew-bank/standalone", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["can_list_yourself"] is False, r.json()

    def test_market_filter(self, client):
        uid, tok = mint_user(name="TEST_C_market")
        assert client.post(f"{BASE}/crew-bank/standalone",
                           json=payload(markets=[MARKET]), headers=auth(tok)).status_code == 200
        r = client.get(f"{BASE}/crew-bank/standalone", params={"market": MARKET})
        assert r.status_code == 200, r.text
        ids = [e["user_id"] for e in r.json()["entries"]]
        assert uid in ids
        for e in r.json()["entries"]:
            assert MARKET in e["markets"], e

        other = client.get(f"{BASE}/crew-bank/standalone", params={"market": "Bellingham"})
        assert other.status_code == 200, other.text
        assert uid not in [e["user_id"] for e in other.json()["entries"]], \
            "market filter leaked non-matching entry"

    def test_found_and_expired_hidden(self, client):
        found_uid, found_tok = mint_user(name="TEST_C_found")
        exp_uid, exp_tok = mint_user(name="TEST_C_expired")
        for tok in (found_tok, exp_tok):
            assert client.post(f"{BASE}/crew-bank/standalone", json=payload(),
                               headers=auth(tok)).status_code == 200
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        mongo(f"""db.crew_bank_standalone.updateOne({{user_id:'{found_uid}'}},{{$set:{{status:'found'}}}});
                  db.crew_bank_standalone.updateOne({{user_id:'{exp_uid}'}},{{$set:{{expires_at:'{past}'}}}});""")
        ids = [e["user_id"] for e in client.get(f"{BASE}/crew-bank/standalone").json()["entries"]]
        assert found_uid not in ids, "status=found entry visible in public list"
        assert exp_uid not in ids, "expired entry visible in public list"


# ---------- C.3 GET /api/crew-bank/standalone/mine ----------
class TestStandaloneMine:
    def test_anon_401(self, client):
        r = client.get(f"{BASE}/crew-bank/standalone/mine")
        assert r.status_code == 401, r.text

    def test_no_listing_returns_null(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/crew-bank/standalone/mine", headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json() == {"entry": None}, r.json()

    def test_owner_gets_full_entry(self, client):
        uid, tok = mint_user(name="TEST_C_mine")
        assert client.post(f"{BASE}/crew-bank/standalone", json=payload(),
                           headers=auth(tok)).status_code == 200
        r = client.get(f"{BASE}/crew-bank/standalone/mine", headers=auth(tok))
        assert r.status_code == 200, r.text
        e = r.json()["entry"]
        assert e["user_id"] == uid
        assert e["user_email"] == f"{uid}@sailmorenow.dev", e
        assert "_id" not in e


# ---------- C.4 PATCH /api/crew-bank/standalone/status ----------
class TestStandaloneStatus:
    def test_anon_401(self, client):
        r = client.patch(f"{BASE}/crew-bank/standalone/status", json={"status": "found"})
        assert r.status_code == 401, r.text

    def test_invalid_status_400(self, client):
        uid, tok = mint_user()
        client.post(f"{BASE}/crew-bank/standalone", json=payload(), headers=auth(tok))
        r = client.patch(f"{BASE}/crew-bank/standalone/status",
                         json={"status": "sunk"}, headers=auth(tok))
        assert r.status_code == 400, r.text

    def test_no_listing_404(self, client):
        uid, tok = mint_user()
        r = client.patch(f"{BASE}/crew-bank/standalone/status",
                         json={"status": "found"}, headers=auth(tok))
        assert r.status_code == 404, r.text

    def test_found_then_seeking(self, client):
        uid, tok = mint_user(name="TEST_C_status")
        assert client.post(f"{BASE}/crew-bank/standalone", json=payload(),
                           headers=auth(tok)).status_code == 200
        r = client.patch(f"{BASE}/crew-bank/standalone/status",
                         json={"status": "found"}, headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "found", r.json()
        assert client.get(f"{BASE}/crew-bank/standalone/mine",
                          headers=auth(tok)).json()["entry"]["status"] == "found"
        r2 = client.patch(f"{BASE}/crew-bank/standalone/status",
                          json={"status": "seeking"}, headers=auth(tok))
        assert r2.status_code == 200, r2.text
        assert client.get(f"{BASE}/crew-bank/standalone/mine",
                          headers=auth(tok)).json()["entry"]["status"] == "seeking"


# ---------- C.5 POST /api/crew-bank/standalone/renew ----------
class TestStandaloneRenew:
    def test_anon_401(self, client):
        r = client.post(f"{BASE}/crew-bank/standalone/renew")
        assert r.status_code == 401, r.text

    def test_no_listing_404(self, client):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/crew-bank/standalone/renew", headers=auth(tok))
        assert r.status_code == 404, r.text

    def test_renew_extends_and_reopens(self, client):
        uid, tok = mint_user(name="TEST_C_renew")
        assert client.post(f"{BASE}/crew-bank/standalone", json=payload(),
                           headers=auth(tok)).status_code == 200
        stale = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        old_updated = "2020-01-01T00:00:00+00:00"
        mongo(f"""db.crew_bank_standalone.updateOne({{user_id:'{uid}'}},
              {{$set:{{expires_at:'{stale}', status:'found', updated_at:'{old_updated}'}}}});""")
        r = client.post(f"{BASE}/crew-bank/standalone/renew", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        exp = datetime.fromisoformat(d["expires_at"])
        days = (exp - datetime.now(timezone.utc)).total_seconds() / 86400
        assert 89 < days < 91, f"renew did not set +90d: {days}"
        entry = client.get(f"{BASE}/crew-bank/standalone/mine", headers=auth(tok)).json()["entry"]
        assert entry["status"] == "seeking", entry
        assert entry["updated_at"] != old_updated, entry
        assert "_id" not in d.get("entry", {})


# ---------- C.6 DELETE /api/crew-bank/standalone ----------
class TestStandaloneDelete:
    def test_anon_401(self, client):
        r = client.delete(f"{BASE}/crew-bank/standalone")
        assert r.status_code == 401, r.text

    def test_delete_is_idempotent(self, client):
        uid, tok = mint_user(name="TEST_C_delete")
        assert client.post(f"{BASE}/crew-bank/standalone", json=payload(),
                           headers=auth(tok)).status_code == 200
        r1 = client.delete(f"{BASE}/crew-bank/standalone", headers=auth(tok))
        assert r1.status_code in (200, 204), r1.text
        if r1.status_code == 200:
            assert r1.json() == {"ok": True}, r1.text
        assert mongo(f"db.crew_bank_standalone.countDocuments({{user_id:'{uid}'}})") == "0"
        assert client.get(f"{BASE}/crew-bank/standalone/mine",
                          headers=auth(tok)).json()["entry"] is None
        r2 = client.delete(f"{BASE}/crew-bank/standalone", headers=auth(tok))
        assert r2.status_code in (200, 204), r2.text
        if r2.status_code == 200:
            assert r2.json() == {"ok": True}, r2.text


# ---------- Phase A/B regression ----------
class TestPhaseABRegression:
    def test_posts_enriched_author_cards(self, client):
        uid, tok = mint_user(account_type="boat_owner", name="TEST_C_Author")
        r = client.post(f"{BASE}/posts", json={"type": "sailing_opportunity",
                        "title": "TEST_C_enriched", "body": "hello",
                        "market": MARKET}, headers=auth(tok))
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        rl = client.get(f"{BASE}/posts", headers=auth(tok))
        assert rl.status_code == 200, rl.text
        p = next(x for x in rl.json() if x["id"] == pid)
        assert p["author_account_type"] == "boat_owner", p
        assert isinstance(p["author_verified"], bool), p
        assert "author_last_active_at" in p
        assert "_id" not in p

    def test_notifications_ok(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/notifications", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["items"], list) and isinstance(d["unread"], int)

    def test_event_crew_join_emits_notification(self, client):
        joiner, tok_j = mint_user(name="TEST_C_Joiner")
        org, tok_o = mint_user(account_type="boat_owner", name="TEST_C_Org")
        eid = "TESTEVC_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        starts = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST C Regatta',
            market:'{MARKET}', starts_at:'{starts}', ends_at:'{starts}',
            organizer_id:'{org}', organizer_name:'TEST C Org',
            source:'community', approved:true, created_at:new Date().toISOString()}});""")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "contact_via": "in-app", "post_to_feed": False},
                        headers=auth(tok_j))
        assert r.status_code == 200, r.text
        d = client.get(f"{BASE}/notifications", headers=auth(tok_o)).json()
        assert [n for n in d["items"] if n["kind"] == "crew_join"], d

    def test_seed_alex_identity_verified_preserved(self, client):
        out = mongo("JSON.stringify(db.users.findOne({email:'crew.alex@sailmorenow.dev'},"
                    "{_id:0,identity_verified:1}))")
        if out in ("null", ""):
            pytest.skip("seed_alex not present")
        assert json.loads(out).get("identity_verified") is True, out

    @pytest.mark.parametrize("path", ["/", "/markets", "/events", "/boat-pros", "/crew-positions"])
    def test_core_endpoints_200(self, client, path):
        r = client.get(f"{BASE}{path}")
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
