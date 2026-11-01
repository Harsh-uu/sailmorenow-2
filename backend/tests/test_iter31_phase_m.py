"""Iteration 31 (Phase M) backend tests.

Covers:
  * GET /api/searches/suggestions  (public, top-5 most-saved queries)
  * GET /api/admin/digest/render   (admin-only HTML digest preview)
  * GET/PATCH /api/push/preferences ('mention' kind still present + persists)
  * GET /api/admin/analytics       (regression: still registered)
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
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")

TAG = f"iter31_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def mdb():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _mk_user(mdb, *, admin=False, saved=None, markets=None, primary="Greater Seattle"):
    uid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    token = f"test_session_{uid}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@sailmorenow.dev",
        "name": f"TEST_{uid}",
        "account_type": "sailor",
        "primary_market": primary,
        "markets": markets if markets is not None else ([primary] if primary else []),
        "onboarding_complete": True,
        "subscription_tier": "free",
        "newsletter_opt_in": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "test_tag": TAG,
    }
    if admin:
        doc["platform_role"] = "admin"
    if saved:
        doc["saved_searches"] = [
            {"id": str(uuid.uuid4()), "q": q,
             "created_at": datetime.now(timezone.utc).isoformat()} for q in saved
        ]
    mdb.users.insert_one(doc)
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc), "test_tag": TAG,
    })
    return uid, token


@pytest.fixture(scope="module")
def actors(mdb):
    """Seed: 1 admin, 1 plain user, 3 users with 'sailing', 2 with 'race'.

    Existing saved_searches on other users are temporarily stashed so the
    global suggestions aggregate is deterministic.
    """
    stashed = list(mdb.users.find({"saved_searches": {"$exists": True, "$ne": []}},
                                 {"_id": 1, "saved_searches": 1}))
    for d in stashed:
        mdb.users.update_one({"_id": d["_id"]}, {"$unset": {"saved_searches": ""}})

    admin_id, admin_token = _mk_user(mdb, admin=True)
    user_id, user_token = _mk_user(mdb)
    multi_id, _ = _mk_user(mdb, primary="Greater Seattle",
                           markets=["Greater Seattle", "Bellingham"])
    nomarket_id, _ = _mk_user(mdb, primary=None, markets=[])
    for _ in range(3):
        _mk_user(mdb, saved=[f"sailing{TAG}"])
    for _ in range(2):
        _mk_user(mdb, saved=[f"race{TAG}"])

    yield {"admin_id": admin_id, "admin_token": admin_token,
           "user_id": user_id, "user_token": user_token,
           "multi_id": multi_id, "nomarket_id": nomarket_id}

    mdb.users.delete_many({"test_tag": TAG})
    mdb.user_sessions.delete_many({"test_tag": TAG})
    for d in stashed:
        mdb.users.update_one({"_id": d["_id"]},
                             {"$set": {"saved_searches": d["saved_searches"]}})


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- GET /api/searches/suggestions ----------------
class TestSearchSuggestions:
    def test_public_200_and_ranking(self, actors):
        r = requests.get(f"{API}/searches/suggestions", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "suggestions" in data and isinstance(data["suggestions"], list)
        # NOTE: xdist runs classes in parallel workers, each seeding its own TAG,
        # so filter to this worker's rows and assert relative ranking/counts.
        sug = [s for s in data["suggestions"] if s["q"].endswith(TAG)]
        assert len(sug) >= 2, data["suggestions"]
        by_q = {s["q"]: s["count"] for s in sug}
        assert by_q.get(f"sailing{TAG}") == 3, data["suggestions"]
        assert by_q.get(f"race{TAG}") == 2, data["suggestions"]
        # 'sailing' (3) must rank above 'race' (2)
        order = [s["q"] for s in sug]
        assert order.index(f"sailing{TAG}") < order.index(f"race{TAG}"), order
        assert isinstance(sug[0]["count"], int)

    def test_limit_5(self, mdb, actors):
        extra = []
        for i in range(6):
            uid, _ = _mk_user(mdb, saved=[f"extra{i}{TAG}"])
            extra.append(uid)
        try:
            r = requests.get(f"{API}/searches/suggestions", timeout=30)
            assert r.status_code == 200
            assert len(r.json()["suggestions"]) == 5
        finally:
            mdb.users.delete_many({"user_id": {"$in": extra}})

    def test_empty_when_no_saved_searches(self, mdb, actors):
        docs = list(mdb.users.find({"saved_searches": {"$exists": True, "$ne": []}},
                                   {"_id": 1, "saved_searches": 1}))
        for d in docs:
            mdb.users.update_one({"_id": d["_id"]}, {"$unset": {"saved_searches": ""}})
        try:
            r = requests.get(f"{API}/searches/suggestions", timeout=30)
            assert r.status_code == 200
            assert r.json() == {"suggestions": []}, r.text
        finally:
            for d in docs:
                mdb.users.update_one({"_id": d["_id"]},
                                     {"$set": {"saved_searches": d["saved_searches"]}})

    def test_pin_then_appears_in_suggestions(self, actors):
        q = f"TEST_pin_{TAG}"
        r = requests.post(f"{API}/searches", json={"q": q},
                          headers=_h(actors["user_token"]), timeout=30)
        assert r.status_code == 200, r.text
        time.sleep(0.3)
        s = requests.get(f"{API}/searches/suggestions", timeout=30).json()["suggestions"]
        assert any(x["q"] == q for x in s), s


# ---------------- GET /api/admin/digest/render ----------------
class TestDigestRender:
    def test_401_unauth(self, actors):
        r = requests.get(f"{API}/admin/digest/render?market=Greater+Seattle", timeout=30)
        assert r.status_code == 401, r.status_code

    def test_403_non_admin(self, actors):
        r = requests.get(f"{API}/admin/digest/render?market=Greater+Seattle",
                         headers=_h(actors["user_token"]), timeout=30)
        assert r.status_code == 403, r.status_code

    def test_200_admin_market_html(self, actors):
        r = requests.get(f"{API}/admin/digest/render?market=Greater+Seattle",
                         headers=_h(actors["admin_token"]), timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert "text/html" in r.headers.get("content-type", "").lower(), r.headers
        assert "Sunday Digest &middot; Greater Seattle" in r.text, r.text[:800]

    def test_400_missing_params(self, actors):
        r = requests.get(f"{API}/admin/digest/render",
                         headers=_h(actors["admin_token"]), timeout=30)
        assert r.status_code == 400, r.status_code

    def test_200_by_user_id_multi_market(self, actors):
        r = requests.get(f"{API}/admin/digest/render?user_id={actors['multi_id']}",
                         headers=_h(actors["admin_token"]), timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert "text/html" in r.headers.get("content-type", "").lower()
        # two markets -> generic header label, both market names present in body
        assert "Sunday Digest &middot; Your markets" in r.text, r.text[:800]
        assert "Bellingham" in r.text

    def test_404_unknown_user(self, actors):
        r = requests.get(f"{API}/admin/digest/render?user_id=does-not-exist-xyz",
                         headers=_h(actors["admin_token"]), timeout=30)
        assert r.status_code == 404, r.status_code

    def test_400_user_without_market(self, actors):
        r = requests.get(f"{API}/admin/digest/render?user_id={actors['nomarket_id']}",
                         headers=_h(actors["admin_token"]), timeout=30)
        assert r.status_code == 400, r.status_code


# ---------------- push preferences ('mention') ----------------
class TestPushPreferences:
    def test_kinds_include_mention_and_patch_persists(self, actors):
        tok = actors["user_token"]
        r = requests.get(f"{API}/push/preferences", headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "mention" in data["kinds"], data
        assert data["preferences"]["mention"] is True

        prefs = dict(data["preferences"]); prefs["mention"] = False
        p = requests.patch(f"{API}/push/preferences", json={"preferences": prefs},
                           headers=_h(tok), timeout=30)
        assert p.status_code == 200, p.text
        assert p.json()["preferences"]["mention"] is False

        g = requests.get(f"{API}/push/preferences", headers=_h(tok), timeout=30)
        assert g.json()["preferences"]["mention"] is False, g.text

        prefs["mention"] = True
        requests.patch(f"{API}/push/preferences", json={"preferences": prefs},
                       headers=_h(tok), timeout=30)


# ---------------- regression: /admin/analytics still registered ----------------
class TestAnalyticsRegression:
    def test_analytics_admin_200_with_weekly(self, actors):
        r = requests.get(f"{API}/admin/analytics", headers=_h(actors["admin_token"]), timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        for k in ("users", "posts", "events", "comments", "discussions",
                  "reports", "digest", "push", "weekly"):
            assert k in d, f"missing {k}"
        for k in ("users", "posts", "events", "comments", "discussions", "digest"):
            assert isinstance(d["weekly"].get(k), list), k

    def test_analytics_403_non_admin(self, actors):
        r = requests.get(f"{API}/admin/analytics", headers=_h(actors["user_token"]), timeout=30)
        assert r.status_code == 403
