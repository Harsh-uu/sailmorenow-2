"""Phase B tests: Boat Pro credentials gating, self-serve account-type swap,
enriched author cards on GET /api/posts, plus Phase A regression spots."""
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
RUN_PREFIX = "TEST_userB_" + os.environ.get("PYTEST_XDIST_WORKER", "gw") + "_"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_User"):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'{account_type}',
      primary_market:'Greater Seattle', markets:['Greater Seattle'],
      onboarding_complete:true, subscription_tier:'{tier}', created_at:new Date()}});
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
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.posts.deleteMany({{id:{{$regex:'^TESTP_{RUN_PREFIX}'}}}});
    db.boat_pros.deleteMany({{user_id:{{$in:ids}}}});
    db.reviews.deleteMany({{target_id:{{$in:ids}}}});
    db.events.deleteMany({{organizer_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^TESTEV_{RUN_PREFIX}'}}}});
    db.crew_bank.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def _pro_payload(tier, name):
    return {
        "company_name": f"TEST_{name}", "short_bio": "TEST rigging shop",
        "contact_email": "test@sailmorenow.dev", "categories": ["Rigging"],
        "markets": ["Greater Seattle"], "tier": tier,
        "certifications": ["USCG OUPV Six-Pack"],
        "licenses": ["WA Marine Contractor #TEST123"],
        "insurance": ["General Liability $1M"],
    }


GATED = ("certifications", "licenses", "insurance")


# ---------- B.1 Boat Pro credentials + tier gating ----------
class TestBoatProCredentials:
    def test_upsert_requires_auth(self, client):
        r = client.post(f"{BASE}/boat-pros", json=_pro_payload("basic", "anon"))
        assert r.status_code == 401, r.text

    @pytest.mark.parametrize("tier,exposed", [("basic", False), ("featured", True), ("premium", True)])
    def test_creds_persist_and_tier_gating(self, client, tier, exposed):
        uid, tok = mint_user(account_type="boat_pro", tier=tier, name=f"TEST_Pro_{tier}")
        payload = _pro_payload(tier, f"pro_{tier}")
        r = client.post(f"{BASE}/boat-pros", json=payload, headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        # owner POST response returns the raw doc with credentials
        assert d["certifications"] == payload["certifications"], d
        assert d["licenses"] == payload["licenses"]
        assert d["insurance"] == payload["insurance"]

        # persisted in mongo
        doc = json.loads(mongo(f"JSON.stringify(db.boat_pros.findOne({{user_id:'{uid}'}},{{_id:0}}))"))
        assert doc["certifications"] == payload["certifications"]
        assert doc["tier"] == tier

        # DETAIL endpoint
        rd = client.get(f"{BASE}/boat-pros/{uid}")
        assert rd.status_code == 200, rd.text
        pro = rd.json()["pro"]
        for k in GATED:
            if exposed:
                assert pro.get(k) == payload[k], f"tier={tier} detail missing {k}: {pro}"
            else:
                assert k not in pro, f"basic tier leaked {k} in detail response: {pro}"

        # LIST endpoint
        rl = client.get(f"{BASE}/boat-pros?market=Greater+Seattle")
        assert rl.status_code == 200, rl.text
        mine = [p for p in rl.json() if p.get("user_id") == uid]
        assert mine, "created pro missing from list"
        p = mine[0]
        for k in GATED:
            if exposed:
                assert p.get(k) == payload[k], f"tier={tier} list missing {k}"
            else:
                assert k not in p, f"basic tier leaked {k} in list response"

    def test_defaults_empty_arrays(self, client):
        uid, tok = mint_user(account_type="boat_pro", tier="premium", name="TEST_Pro_default")
        payload = _pro_payload("premium", "default")
        for k in GATED:
            payload.pop(k)
        r = client.post(f"{BASE}/boat-pros", json=payload, headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in GATED:
            assert d[k] == [], d

    def test_get_unknown_pro_404(self, client):
        r = client.get(f"{BASE}/boat-pros/{RUN_PREFIX}nope")
        assert r.status_code == 404, r.text


# ---------- B.1b Server-derived tier + account_type enforcement (iteration_8) ----------
class TestBoatProTierServerDerived:
    def test_basic_pro_cannot_claim_premium(self, client):
        uid, tok = mint_user(account_type="boat_pro", tier="basic", name="TEST_Pro_escalate")
        payload = _pro_payload("premium", "escalate")  # client lies about tier
        r = client.post(f"{BASE}/boat-pros", json=payload, headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["tier"] == "basic", r.json()
        doc = json.loads(mongo(f"JSON.stringify(db.boat_pros.findOne({{user_id:'{uid}'}},{{_id:0}}))"))
        assert doc["tier"] == "basic", doc
        # gated fields must stay hidden on public detail
        pro = client.get(f"{BASE}/boat-pros/{uid}").json()["pro"]
        for k in GATED:
            assert k not in pro, f"basic pro leaked {k} after tier escalation attempt: {pro}"

    @pytest.mark.parametrize("tier,expected", [("free", "basic"), ("bogus", "basic"),
                                               ("featured", "featured"), ("premium", "premium")])
    def test_tier_mapping(self, client, tier, expected):
        uid, tok = mint_user(account_type="boat_pro", tier=tier, name=f"TEST_Pro_map_{tier}")
        r = client.post(f"{BASE}/boat-pros", json=_pro_payload("premium", f"map_{tier}"),
                        headers=auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["tier"] == expected, r.json()

    @pytest.mark.parametrize("acct", ["sailor", "boat_owner", "partner"])
    def test_non_pro_forbidden(self, client, acct):
        uid, tok = mint_user(account_type=acct, tier="premium", name=f"TEST_{acct}_pro")
        r = client.post(f"{BASE}/boat-pros", json=_pro_payload("premium", acct), headers=auth(tok))
        assert r.status_code == 403, r.text
        assert mongo(f"db.boat_pros.countDocuments({{user_id:'{uid}'}})") == "0"


# ---------- B.2 Self-serve account-type swap ----------
class TestAccountTypeSwap:
    def test_anon_401(self, client):
        r = client.patch(f"{BASE}/auth/account-type", json={"account_type": "boat_owner"})
        assert r.status_code == 401, r.text

    def test_sailor_to_owner_and_back(self, client):
        uid, tok = mint_user(account_type="sailor")
        r = client.patch(f"{BASE}/auth/account-type", json={"account_type": "boat_owner"},
                         headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["account_type"] == "boat_owner", d
        assert "_id" not in d
        # verify persistence via /auth/me
        me = client.get(f"{BASE}/auth/me", headers=auth(tok))
        assert me.status_code == 200
        assert me.json()["account_type"] == "boat_owner"

        r2 = client.patch(f"{BASE}/auth/account-type", json={"account_type": "sailor"},
                          headers=auth(tok))
        assert r2.status_code == 200, r2.text
        assert r2.json()["account_type"] == "sailor"
        assert client.get(f"{BASE}/auth/me", headers=auth(tok)).json()["account_type"] == "sailor"

    def test_sailor_cannot_become_boat_pro(self, client):
        uid, tok = mint_user(account_type="sailor")
        r = client.patch(f"{BASE}/auth/account-type", json={"account_type": "boat_pro"},
                         headers=auth(tok))
        assert r.status_code == 400, r.text
        assert client.get(f"{BASE}/auth/me", headers=auth(tok)).json()["account_type"] == "sailor"

    @pytest.mark.parametrize("acct", ["boat_pro", "partner"])
    def test_pro_and_partner_blocked(self, client, acct):
        uid, tok = mint_user(account_type=acct)
        r = client.patch(f"{BASE}/auth/account-type", json={"account_type": "boat_owner"},
                         headers=auth(tok))
        assert r.status_code == 400, r.text
        assert "support" in r.json().get("detail", "").lower(), r.text
        assert client.get(f"{BASE}/auth/me", headers=auth(tok)).json()["account_type"] == acct

    def test_missing_body_422(self, client):
        uid, tok = mint_user(account_type="sailor")
        r = client.patch(f"{BASE}/auth/account-type", json={}, headers=auth(tok))
        assert r.status_code == 422, r.text


# ---------- B.3 Enriched author cards on GET /api/posts ----------
class TestEnrichedAuthorCards:
    def test_author_fields_flow_through(self, client):
        uid, tok = mint_user(account_type="boat_owner", tier="premium", name="TEST_Author")
        r = client.post(f"{BASE}/posts", json={"type": "sailing_opportunity",
                        "title": "TEST_enriched_author", "body": "hello world",
                        "market": "Greater Seattle"}, headers=auth(tok))
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        last_active = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        mongo(f"""db.users.updateOne({{user_id:'{uid}'}},
              {{$set:{{identity_verified:true, last_active_at:'{last_active}'}}}});""")

        rl = client.get(f"{BASE}/posts", headers=auth(tok))
        assert rl.status_code == 200, rl.text
        mine = [p for p in rl.json() if p["id"] == pid]
        assert mine, "created post not in list"
        p = mine[0]
        assert p["author_account_type"] == "boat_owner", p
        assert p["author_verified"] is True, p
        assert p["author_last_active_at"] == last_active, p
        assert "_id" not in p

    def test_unverified_author_false_not_missing(self, client):
        uid, tok = mint_user(account_type="sailor", tier="premium", name="TEST_Author2")
        r = client.post(f"{BASE}/posts", json={"type": "sailing_opportunity",
                        "title": "TEST_unverified", "body": "x",
                        "market": "Greater Seattle"}, headers=auth(tok))
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        rl = client.get(f"{BASE}/posts", headers=auth(tok))
        p = next(x for x in rl.json() if x["id"] == pid)
        assert p["author_verified"] is False, p
        assert p["author_account_type"] == "sailor", p
        assert p["author_last_active_at"] is None or isinstance(p["author_last_active_at"], str)

    def test_crew_autopost_has_account_type(self, client):
        joiner, tok_j = mint_user(account_type="sailor", tier="premium", name="TEST_CrewPoster")
        org, _ = mint_user(account_type="boat_owner", name="TEST_Org2")
        eid = "TESTEV_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        starts = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST Crew Autopost',
            market:'Greater Seattle', starts_at:'{starts}', ends_at:'{starts}',
            organizer_id:'{org}', organizer_name:'TEST Org2',
            source:'community', approved:true, created_at:new Date().toISOString()}});""")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "contact_via": "in-app", "post_to_feed": True},
                        headers=auth(tok_j))
        assert r.status_code == 200, r.text
        doc = json.loads(mongo(
            f"JSON.stringify(db.posts.findOne({{author_id:'{joiner}'}},{{_id:0}}))"))
        assert doc, "crew auto-post not created"
        assert doc.get("author_account_type") == "sailor", doc
        rl = client.get(f"{BASE}/posts", headers=auth(tok_j))
        mine = [p for p in rl.json() if p.get("author_id") == joiner]
        assert mine, "crew auto-post missing from feed"
        assert mine[0]["author_account_type"] == "sailor", mine[0]

    def test_anon_list_posts_has_enrichment_keys(self, client):
        r = client.get(f"{BASE}/posts")
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        with_author = [p for p in items if p.get("author_id")]
        for p in with_author[:10]:
            assert "author_verified" in p, p
            assert isinstance(p["author_verified"], bool)
            assert "author_account_type" in p
            assert "author_last_active_at" in p


# ---------- Phase A regression ----------
class TestPhaseARegression:
    def test_expired_post_hidden(self, client):
        uid, tok = mint_user()
        past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        pid = "TESTP_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        mongo(f"""db.posts.insertOne({{id:'{pid}', type:'sailing_opportunity',
            title:'TEST_expired', body:'gone', market:'Greater Seattle',
            author_id:'{uid}', expires_at:'{past}', created_at:'{past}'}});""")
        r = client.get(f"{BASE}/posts", headers=auth(tok))
        assert r.status_code == 200
        assert pid not in [p["id"] for p in r.json()], "expired post leaked"

    def test_notifications_shape(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/notifications", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["items"], list) and isinstance(d["unread"], int)

    def test_crew_join_notify_and_mark_read(self, client):
        joiner, tok_j = mint_user(tier="premium", name="TEST_Joiner")
        org, tok_o = mint_user(account_type="boat_owner", name="TEST_Organizer")
        eid = "TESTEV_" + RUN_PREFIX + uuid.uuid4().hex[:6]
        starts = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST Regatta B',
            market:'Greater Seattle', starts_at:'{starts}', ends_at:'{starts}',
            organizer_id:'{org}', organizer_name:'TEST Org',
            source:'community', approved:true, created_at:new Date().toISOString()}});""")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "contact_via": "in-app", "post_to_feed": False},
                        headers=auth(tok_j))
        assert r.status_code == 200, r.text
        d = client.get(f"{BASE}/notifications", headers=auth(tok_o)).json()
        crew = [n for n in d["items"] if n["kind"] == "crew_join"]
        assert crew, f"organizer got no crew_join notification: {d}"
        nid = crew[0]["id"]
        rp = client.patch(f"{BASE}/notifications/{nid}/read", headers=auth(tok_o))
        assert rp.status_code == 200, rp.text
        after = client.get(f"{BASE}/notifications", headers=auth(tok_o)).json()
        assert next(n for n in after["items"] if n["id"] == nid)["read"] is True

    @pytest.mark.parametrize("path", ["/", "/markets", "/events", "/boat-pros", "/crew-positions"])
    def test_core_endpoints_200(self, client, path):
        r = client.get(f"{BASE}{path}")
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
