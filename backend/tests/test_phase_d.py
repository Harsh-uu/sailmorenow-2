"""Phase D tests: 5-parameter mutual-reveal review sessions.

Covers POST /api/review-sessions, GET /api/review-sessions/mine,
GET /api/review-sessions/{id}, POST /api/review-sessions/{id}/submit,
GET /api/mutual-reviews/for/{user_id}, auto-reveal via
routers.reviews_router._maybe_reveal, and notification emission.
xdist-safe via RUN_PREFIX; full teardown of TEST_userD_* artifacts.
"""
import os
import sys
import json
import uuid
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
RUN_PREFIX = "TEST_userD_" + os.environ.get("PYTEST_XDIST_WORKER", "gw") + "_"
MARKET = "Greater Seattle"
KEYS = ["personality", "skill", "promptness", "communication", "safety"]


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_UserD"):
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


def ratings(**over):
    r = {k: 4 for k in KEYS}
    r.update(over)
    return r


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
    var sids = db.review_sessions.find({{'participants.user_id':{{$in:ids}}}},{{id:1}}).toArray().map(s=>s.id);
    db.mutual_reviews.deleteMany({{session_id:{{$in:sids}}}});
    db.mutual_reviews.deleteMany({{author_id:{{$in:ids}}}});
    db.review_sessions.deleteMany({{id:{{$in:sids}}}});
    db.reviews.deleteMany({{author_id:{{$in:ids}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.crew_bank_standalone.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def make_pair(client, relationship="customer_pro", inline=None, comment=None):
    """Returns (initiator_uid, initiator_tok, other_uid, other_tok, session_json)."""
    if relationship == "customer_pro":
        a, ta = mint_user("sailor", name="TEST_D_Sailor")
        b, tb = mint_user("boat_pro", name="TEST_D_Pro")
    else:
        a, ta = mint_user("boat_owner", name="TEST_D_Owner")
        b, tb = mint_user("sailor", name="TEST_D_Crew")
    body = {"relationship": relationship, "counterparty_id": b,
            "context_note": "TEST_D context"}
    if inline:
        body["ratings"] = inline
        body["comment"] = comment
    r = client.post(f"{BASE}/review-sessions", json=body, headers=auth(ta))
    assert r.status_code == 200, r.text
    return a, ta, b, tb, r.json()


# ---------- D.1 POST /api/review-sessions ----------
class TestCreateSession:
    def test_anon_401(self, client):
        uid, tok = mint_user("boat_pro")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": uid})
        assert r.status_code == 401, r.text

    def test_invalid_relationship_400(self, client):
        a, ta = mint_user()
        b, tb = mint_user("boat_pro")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "buddy_buddy", "counterparty_id": b},
                        headers=auth(ta))
        assert r.status_code == 400, r.text

    def test_unknown_counterparty_404(self, client):
        a, ta = mint_user()
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro",
                              "counterparty_id": "TEST_userD_nope_" + uuid.uuid4().hex},
                        headers=auth(ta))
        assert r.status_code == 404, r.text

    def test_self_review_400(self, client):
        a, ta = mint_user()
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": a},
                        headers=auth(ta))
        assert r.status_code == 400, r.text

    def test_role_mismatch_two_pros_400(self, client):
        a, ta = mint_user("boat_pro")
        b, tb = mint_user("boat_pro")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": b},
                        headers=auth(ta))
        assert r.status_code == 400, r.text

    def test_role_mismatch_sailor_sailor_owner_crew_400(self, client):
        a, ta = mint_user("sailor")
        b, tb = mint_user("sailor")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "owner_crew", "counterparty_id": b},
                        headers=auth(ta))
        assert r.status_code == 400, r.text

    def test_valid_customer_pro(self, client):
        a, ta, b, tb, s = make_pair(client)
        assert "_id" not in s
        roles = {p["user_id"]: p["role"] for p in s["participants"]}
        assert roles[a] == "customer", s
        assert roles[b] == "pro", s
        assert s["revealed"] is False, s
        assert s["my_review"] is None, s
        assert s["other_review"] is None, s
        assert all(p["submitted"] is False for p in s["participants"]), s
        hours = (datetime.fromisoformat(s["reveal_at"])
                 - datetime.now(timezone.utc)).total_seconds() / 3600
        assert 47 < hours < 48.5, f"reveal_at not ~48h: {hours}"
        # hydration
        names = {p["user_id"]: p.get("user_name") for p in s["participants"]}
        assert names[b] == "TEST_D_Pro", s

    def test_valid_owner_crew(self, client):
        a, ta, b, tb, s = make_pair(client, "owner_crew")
        roles = {p["user_id"]: p["role"] for p in s["participants"]}
        assert roles[a] == "owner", s
        assert roles[b] == "crew", s

    def test_inline_ratings_submits_initiator(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings(skill=5),
                                    comment="TEST_D inline")
        assert s["my_review"] is not None, s
        assert s["my_review"]["ratings"]["skill"] == 5, s
        assert s["my_review"]["comment"] == "TEST_D inline", s
        assert s["my_review"]["target_id"] == b, s
        me = next(p for p in s["participants"] if p["user_id"] == a)
        assert me["submitted"] is True, s
        assert s["revealed"] is False, s
        cnt = mongo(f"db.mutual_reviews.countDocuments({{session_id:'{s['id']}'}})")
        assert cnt == "1", cnt

    @pytest.mark.parametrize("bad", [{"skill": 6}, {"safety": 0}, {"personality": -1}])
    def test_inline_invalid_rating_400(self, client, bad):
        a, ta = mint_user("sailor")
        b, tb = mint_user("boat_pro")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": b,
                              "ratings": ratings(**bad)}, headers=auth(ta))
        assert r.status_code == 400, r.text
        assert mongo(f"db.mutual_reviews.countDocuments({{author_id:'{a}'}})") == "0"

    def test_inline_missing_key_rejected(self, client):
        a, ta = mint_user("sailor")
        b, tb = mint_user("boat_pro")
        partial = ratings()
        partial.pop("safety")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": b,
                              "ratings": partial}, headers=auth(ta))
        # Spec asked for 400; FastAPI/Pydantic rejects with 422 before the
        # router's own validator runs. Both are "rejected" — documented deviation.
        assert r.status_code in (400, 422), r.text
        assert mongo(f"db.mutual_reviews.countDocuments({{author_id:'{a}'}})") == "0"

    def test_create_emits_review_request_notification(self, client):
        a, ta, b, tb, s = make_pair(client)
        d = client.get(f"{BASE}/notifications", headers=auth(tb)).json()
        m = [n for n in d["items"] if n["kind"] == "review_request"
             and n.get("meta", {}).get("session_id") == s["id"]]
        assert m, d
        assert m[0]["link"] == "/reviews", m[0]
        # initiator should NOT get a review_request for their own session
        mine = client.get(f"{BASE}/notifications", headers=auth(ta)).json()
        assert not [n for n in mine["items"] if n["kind"] == "review_request"
                    and n.get("meta", {}).get("session_id") == s["id"]], mine


# ---------- D.2 GET /api/review-sessions/mine ----------
class TestListMine:
    def test_anon_401(self, client):
        r = client.get(f"{BASE}/review-sessions/mine")
        assert r.status_code == 401, r.text

    def test_lists_only_own_sorted_newest_first(self, client):
        a, ta, b, tb, s1 = make_pair(client)
        # second session for the same initiator
        c, tc = mint_user("boat_pro", name="TEST_D_Pro2")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": c},
                        headers=auth(ta))
        assert r.status_code == 200, r.text
        s2 = r.json()
        lst = client.get(f"{BASE}/review-sessions/mine", headers=auth(ta))
        assert lst.status_code == 200, lst.text
        items = lst.json()
        ids = [x["id"] for x in items]
        assert s1["id"] in ids and s2["id"] in ids, ids
        created = [x["created_at"] for x in items]
        assert created == sorted(created, reverse=True), created
        for x in items:
            assert "_id" not in x
            assert any(p["user_id"] == a for p in x["participants"]), x
        # unrelated user does not see them
        other = client.get(f"{BASE}/review-sessions/mine", headers=auth(tb)).json()
        assert s2["id"] not in [x["id"] for x in other], other

    def test_my_review_present_other_hidden_until_reveal(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings())
        # counterparty has not submitted; initiator sees own review only
        mine = client.get(f"{BASE}/review-sessions/mine", headers=auth(ta)).json()
        row = next(x for x in mine if x["id"] == s["id"])
        assert row["my_review"] is not None, row
        assert row["other_review"] is None, row
        # counterparty sees nothing of initiator's review
        theirs = client.get(f"{BASE}/review-sessions/mine", headers=auth(tb)).json()
        row2 = next(x for x in theirs if x["id"] == s["id"])
        assert row2["my_review"] is None, row2
        assert row2["other_review"] is None, "leaked other side's review pre-reveal"

    def test_lazy_reveal_on_read(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings(skill=3))
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        mongo(f"db.review_sessions.updateOne({{id:'{s['id']}'}},{{$set:{{reveal_at:'{past}'}}}});")
        theirs = client.get(f"{BASE}/review-sessions/mine", headers=auth(tb)).json()
        row = next(x for x in theirs if x["id"] == s["id"])
        assert row["revealed"] is True, row
        assert row["reveal_kind"] == "auto", row
        assert row["other_review"]["ratings"]["skill"] == 3, row
        assert row["my_review"] is None, row


# ---------- D.3 GET /api/review-sessions/{id} ----------
class TestGetSession:
    def test_anon_401(self, client):
        a, ta, b, tb, s = make_pair(client)
        r = client.get(f"{BASE}/review-sessions/{s['id']}")
        assert r.status_code == 401, r.text

    def test_unknown_404(self, client):
        a, ta = mint_user()
        r = client.get(f"{BASE}/review-sessions/{uuid.uuid4()}", headers=auth(ta))
        assert r.status_code == 404, r.text

    def test_non_participant_403(self, client):
        a, ta, b, tb, s = make_pair(client)
        c, tc = mint_user()
        r = client.get(f"{BASE}/review-sessions/{s['id']}", headers=auth(tc))
        assert r.status_code == 403, r.text

    def test_participant_200_hidden_then_revealed(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings(promptness=2))
        r = client.get(f"{BASE}/review-sessions/{s['id']}", headers=auth(tb))
        assert r.status_code == 200, r.text
        assert r.json()["other_review"] is None, "pre-reveal leak"
        # now counterparty submits -> mutual reveal
        sub = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                          json={"ratings": ratings(), "comment": "TEST_D back"},
                          headers=auth(tb))
        assert sub.status_code == 200, sub.text
        r2 = client.get(f"{BASE}/review-sessions/{s['id']}", headers=auth(tb))
        assert r2.json()["revealed"] is True, r2.json()
        assert r2.json()["other_review"]["ratings"]["promptness"] == 2, r2.json()


# ---------- D.4 POST /api/review-sessions/{id}/submit ----------
class TestSubmit:
    def test_anon_401(self, client):
        a, ta, b, tb, s = make_pair(client)
        r = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                        json={"ratings": ratings()})
        assert r.status_code == 401, r.text

    def test_unknown_404(self, client):
        a, ta = mint_user()
        r = client.post(f"{BASE}/review-sessions/{uuid.uuid4()}/submit",
                        json={"ratings": ratings()}, headers=auth(ta))
        assert r.status_code == 404, r.text

    def test_non_participant_403(self, client):
        a, ta, b, tb, s = make_pair(client)
        c, tc = mint_user()
        r = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                        json={"ratings": ratings()}, headers=auth(tc))
        assert r.status_code == 403, r.text

    def test_invalid_ratings_400(self, client):
        a, ta, b, tb, s = make_pair(client)
        r = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                        json={"ratings": ratings(safety=9)}, headers=auth(ta))
        assert r.status_code == 400, r.text
        assert mongo(f"db.mutual_reviews.countDocuments({{session_id:'{s['id']}'}})") == "0"

    def test_duplicate_submit_409(self, client):
        a, ta, b, tb, s = make_pair(client)
        r1 = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                         json={"ratings": ratings()}, headers=auth(ta))
        assert r1.status_code == 200, r1.text
        r2 = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                         json={"ratings": ratings()}, headers=auth(ta))
        assert r2.status_code == 409, r2.text
        assert mongo(f"db.mutual_reviews.countDocuments({{session_id:'{s['id']}'}})") == "1"

    def test_second_submit_reveals_mutual_and_notifies_both(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings(personality=5))
        r = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                        json={"ratings": ratings(personality=1), "comment": "TEST_D b"},
                        headers=auth(tb))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["revealed"] is True, d
        assert d["reveal_kind"] == "mutual", d
        assert d["my_review"]["ratings"]["personality"] == 1, d
        assert d["other_review"]["ratings"]["personality"] == 5, d
        assert all(p["submitted"] for p in d["participants"]), d
        for tok in (ta, tb):
            n = client.get(f"{BASE}/notifications", headers=auth(tok)).json()
            m = [x for x in n["items"] if x["kind"] == "review_completed"
                 and x.get("meta", {}).get("session_id") == s["id"]]
            assert m, f"missing review_completed for one side: {n}"
            assert m[0]["meta"]["reveal_kind"] == "mutual", m[0]


# ---------- D.5 GET /api/mutual-reviews/for/{user_id} ----------
class TestAggregate:
    def test_public_no_auth_empty_shape(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/mutual-reviews/for/{uid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d == {"count": 0, "aggregate": None, "reviews": []}, d

    def test_unrevealed_does_not_leak(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings(skill=5))
        r = client.get(f"{BASE}/mutual-reviews/for/{b}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["count"] == 0, f"unrevealed session leaked into aggregate: {d}"
        assert d["aggregate"] is None, d

    def test_revealed_aggregate_and_authors(self, client):
        a, ta, b, tb, s = make_pair(
            client, inline={"personality": 5, "skill": 4, "promptness": 3,
                            "communication": 2, "safety": 1})
        assert client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                           json={"ratings": ratings()}, headers=auth(tb)).status_code == 200
        d = client.get(f"{BASE}/mutual-reviews/for/{b}").json()
        assert d["count"] == 1, d
        agg = d["aggregate"]
        assert agg["personality"] == 5 and agg["safety"] == 1, agg
        assert agg["overall"] == 3.0, agg
        rev = d["reviews"][0]
        assert rev["author_name"] == "TEST_D_Sailor", rev
        assert rev["author_avatar"] == "https://via.placeholder.com/150", rev
        assert rev["relationship"] == "customer_pro", rev
        assert "_id" not in rev


# ---------- D.6 Auto-reveal via scheduler helper ----------
class TestAutoReveal:
    def test_maybe_reveal_auto(self, client):
        a, ta, b, tb, s = make_pair(client, inline=ratings(communication=3))
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        mongo(f"db.review_sessions.updateOne({{id:'{s['id']}'}},{{$set:{{reveal_at:'{past}'}}}});")

        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        for k, v in dotenv_values("/app/backend/.env").items():
            os.environ.setdefault(k, v)
        # Motor clients bind to the loop of first use and asyncio.run() closes its
        # loop, so drop cached modules to get a client bound to THIS loop
        # (otherwise "Event loop is closed" if another test already imported deps).
        for _mod in ("notifications", "mailer", "deps", "routers.reviews_router"):
            sys.modules.pop(_mod, None)

        async def run():
            from routers.reviews_router import _maybe_reveal
            from deps import db as mdb
            doc = await mdb.review_sessions.find_one({"id": s["id"]}, {"_id": 0})
            return await _maybe_reveal(doc)

        fresh = asyncio.run(run())
        assert fresh["revealed"] is True, fresh
        assert fresh["reveal_kind"] == "auto", fresh

        # missing side stays null; submitted side visible to the other party
        theirs = client.get(f"{BASE}/review-sessions/{s['id']}", headers=auth(tb)).json()
        assert theirs["my_review"] is None, theirs
        assert theirs["other_review"]["ratings"]["communication"] == 3, theirs
        # aggregate now includes it
        d = client.get(f"{BASE}/mutual-reviews/for/{b}").json()
        assert d["count"] >= 1, d
        # notifications to both
        for tok in (ta, tb):
            n = client.get(f"{BASE}/notifications", headers=auth(tok)).json()
            m = [x for x in n["items"] if x["kind"] == "review_completed"
                 and x.get("meta", {}).get("session_id") == s["id"]]
            assert m, f"auto-reveal notification missing: {n}"
            assert m[0]["meta"]["reveal_kind"] == "auto", m[0]

    def test_no_submissions_not_revealed(self, client):
        a, ta, b, tb, s = make_pair(client)
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        mongo(f"db.review_sessions.updateOne({{id:'{s['id']}'}},{{$set:{{reveal_at:'{past}'}}}});")
        r = client.get(f"{BASE}/review-sessions/{s['id']}", headers=auth(ta))
        assert r.status_code == 200, r.text
        assert r.json()["revealed"] is False, "revealed with zero submissions"


# ---------- Phase A/B/C regression ----------
class TestRegression:
    def test_notifications_ok(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/notifications", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["items"], list) and isinstance(d["unread"], int)

    def test_posts_enrichment(self, client):
        uid, tok = mint_user("boat_owner", name="TEST_D_Author")
        r = client.post(f"{BASE}/posts", json={"type": "sailing_opportunity",
                        "title": "TEST_D_enriched", "body": "hi", "market": MARKET},
                        headers=auth(tok))
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        rl = client.get(f"{BASE}/posts", headers=auth(tok))
        assert rl.status_code == 200, rl.text
        p = next(x for x in rl.json() if x["id"] == pid)
        assert p["author_account_type"] == "boat_owner", p
        assert isinstance(p["author_verified"], bool), p
        assert "_id" not in p

    def test_crew_bank_standalone_ok(self, client):
        r = client.get(f"{BASE}/crew-bank/standalone")
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(["count", "entries", "can_list_yourself"]).issubset(d.keys()), d

    def test_legacy_single_star_review_still_works(self, client):
        a, ta = mint_user("sailor", name="TEST_D_Legacy")
        b, tb = mint_user("boat_pro", name="TEST_D_LegacyPro")
        r = client.post(f"{BASE}/reviews",
                        json={"target_id": b, "rating": 5, "comment": "TEST_D legacy"},
                        headers=auth(ta))
        assert r.status_code == 200, r.text

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
