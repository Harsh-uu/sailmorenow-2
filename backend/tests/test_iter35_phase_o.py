"""Iteration 35 (Phase O) backend tests.

Covers:
  * GET /api/users/search -> returns handle, matches handle OR name prefix
  * PATCH /api/auth/handle -> 401 / 400 / 409 / 200
  * startup handle backfill + unique sparse index on users.handle
  * @-mention strict handle matching (exact handle only; partials ping nobody)
  * GET /api/searches/suggestions -> per-query 8-week trend buckets
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing from env and /app/frontend/.env")
API = base_url.rstrip("/") + "/api"

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")

TAG = "TEST_iter35_" + uuid.uuid4().hex[:8]
MARKET = "Greater Seattle"


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module", autouse=True)
def cleanup(mdb):
    yield
    ids = [d["user_id"] for d in mdb.users.find({"test_tag": TAG}, {"user_id": 1})]
    mdb.notifications.delete_many({"user_id": {"$in": ids}})
    mdb.comments.delete_many({"author_id": {"$in": ids}})
    mdb.posts.delete_many({"test_tag": TAG})
    mdb.user_sessions.delete_many({"test_tag": TAG})
    mdb.users.delete_many({"test_tag": TAG})


def mk_user(mdb, *, name, handle="__auto__", saved=None):
    """Insert a user. handle='__auto__' -> derive; handle=None -> omit field."""
    uid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    tok = f"TEST_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "name": name,
        "email": f"{uid}@sailmorenow.dev".lower(),
        "account_type": "sailor",
        "primary_market": MARKET,
        "markets": [MARKET],
        "onboarding_complete": True,
        "subscription_tier": "free",
        "newsletter_opt_in": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "test_tag": TAG,
    }
    if handle == "__auto__":
        doc["handle"] = f"h{uuid.uuid4().hex[:10]}"
    elif handle is not None:
        doc["handle"] = handle
    if saved:
        doc["saved_searches"] = saved
    mdb.users.insert_one(doc)
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": tok, "test_tag": TAG,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return uid, tok


def mk_post(mdb, author_id):
    pid = str(uuid.uuid4())
    mdb.posts.insert_one({
        "id": pid, "kind": "general", "title": f"{TAG} post",
        "body": "spinnaker practice this weekend", "market": MARKET,
        "author_id": author_id, "author_name": "TEST Author",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "test_tag": TAG,
    })
    return pid


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------- #
# 1. GET /api/users/search — handle + name prefix
# --------------------------------------------------------------------------- #
class TestUserSearch:
    def test_search_by_handle_and_name(self, mdb):
        suffix = uuid.uuid4().hex[:6]
        uid, _ = mk_user(mdb, name=f"Zephyr{suffix} Sailor", handle=f"zeph{suffix}")

        r = requests.get(f"{API}/users/search", params={"q": f"zeph{suffix}"}, timeout=30)
        assert r.status_code == 200, r.text
        users = r.json()["users"]
        hit = [x for x in users if x["user_id"] == uid]
        assert hit, f"handle prefix search missed user: {users}"
        assert hit[0]["handle"] == f"zeph{suffix}"
        assert hit[0]["name"] == f"Zephyr{suffix} Sailor"

        # name prefix (case-insensitive), and @ prefix stripped
        r2 = requests.get(f"{API}/users/search", params={"q": f"@zephyr{suffix}"}, timeout=30)
        assert r2.status_code == 200
        assert any(x["user_id"] == uid for x in r2.json()["users"]), r2.text

        r3 = requests.get(f"{API}/users/search", params={"q": f"ZEPH{suffix.upper()}"}, timeout=30)
        assert any(x["user_id"] == uid for x in r3.json()["users"]), r3.text

    def test_empty_query_returns_empty(self):
        r = requests.get(f"{API}/users/search", params={"q": ""}, timeout=30)
        assert r.status_code == 200
        assert r.json()["users"] == []


# --------------------------------------------------------------------------- #
# 2. PATCH /api/auth/handle
# --------------------------------------------------------------------------- #
class TestHandleUpdate:
    def test_unauthenticated(self):
        r = requests.patch(f"{API}/auth/handle", json={"handle": "somehandle"}, timeout=30)
        assert r.status_code == 401, r.text

    @pytest.mark.parametrize("bad", ["a", "a b", "x" * 21, "", "bad-dash", "hi!"])
    def test_invalid_handles(self, mdb, bad):
        _, tok = mk_user(mdb, name="Invalid Tester")
        r = requests.patch(f"{API}/auth/handle", json={"handle": bad},
                           headers=H(tok), timeout=30)
        assert r.status_code == 400, f"{bad!r} -> {r.status_code} {r.text}"

    def test_conflict_case_insensitive(self, mdb):
        taken = f"taken{uuid.uuid4().hex[:8]}"
        mk_user(mdb, name="Owner", handle=taken)
        _, tok = mk_user(mdb, name="Challenger")
        r = requests.patch(f"{API}/auth/handle", json={"handle": taken.upper()},
                           headers=H(tok), timeout=30)
        assert r.status_code == 409, r.text

    def test_success_lowercases_and_persists(self, mdb):
        uid, tok = mk_user(mdb, name="Happy Path")
        new = f"NewHandle{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/auth/handle", json={"handle": "@" + new},
                           headers=H(tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["handle"] == new.lower()
        assert data["user_id"] == uid
        assert "_id" not in data
        # persisted?
        me = requests.get(f"{API}/auth/me", headers=H(tok), timeout=30)
        assert me.status_code == 200
        assert me.json()["handle"] == new.lower()
        assert mdb.users.find_one({"user_id": uid})["handle"] == new.lower()

    def test_same_handle_idempotent(self, mdb):
        h = f"idem{uuid.uuid4().hex[:8]}"
        _, tok = mk_user(mdb, name="Idem", handle=h)
        r = requests.patch(f"{API}/auth/handle", json={"handle": h}, headers=H(tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["handle"] == h


# --------------------------------------------------------------------------- #
# 3. Startup backfill + unique sparse index
# --------------------------------------------------------------------------- #
class TestBackfillAndIndex:
    def test_unique_sparse_index_exists(self, mdb):
        info = mdb.users.index_information()
        matches = [v for v in info.values()
                   if [k for k, _ in v["key"]] == ["handle"]]
        assert matches, f"no index on handle: {list(info)}"
        idx = matches[0]
        assert idx.get("unique") is True, idx
        assert idx.get("sparse") is True, idx

    def test_no_users_missing_handle(self, mdb):
        missing = mdb.users.count_documents(
            {"$or": [{"handle": {"$exists": False}}, {"handle": None}, {"handle": ""}]})
        assert missing == 0, f"{missing} users still missing a handle"

    def test_backfill_on_restart(self, mdb):
        """Seed 2 handle-less users, restart backend, verify unique handles."""
        import subprocess, time
        u1, _ = mk_user(mdb, name="Backfill Bravo", handle=None)
        u2, _ = mk_user(mdb, name="Backfill Bravo", handle=None)
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       check=True, capture_output=True)
        ok = False
        for _ in range(30):
            time.sleep(2)
            try:
                if requests.get(f"{API}/", timeout=10).status_code == 200:
                    ok = True
                    break
            except Exception:
                pass
        assert ok, "backend did not come back up after restart"
        time.sleep(2)
        d1 = mdb.users.find_one({"user_id": u1})
        d2 = mdb.users.find_one({"user_id": u2})
        assert d1.get("handle"), "user 1 not backfilled"
        assert d2.get("handle"), "user 2 not backfilled"
        assert d1["handle"] != d2["handle"], "backfilled handles collide"
        assert d1["handle"].startswith("backfillbravo"), d1["handle"]
        assert d2["handle"].startswith("backfillbravo"), d2["handle"]

    def test_duplicate_handle_insert_rejected(self, mdb):
        from pymongo.errors import DuplicateKeyError
        h = f"dupe{uuid.uuid4().hex[:8]}"
        mk_user(mdb, name="Dupe One", handle=h)
        with pytest.raises(DuplicateKeyError):
            mk_user(mdb, name="Dupe Two", handle=h)


# --------------------------------------------------------------------------- #
# 4. Strict @handle mention matching
# --------------------------------------------------------------------------- #
class TestMentions:
    def _notifs(self, mdb, uid):
        return list(mdb.notifications.find({"user_id": uid, "kind": "mention"}))

    def test_exact_handle_notifies(self, mdb):
        target, _ = mk_user(mdb, name="QA Target", handle="qatestuser35")
        author, atok = mk_user(mdb, name="QA Author")
        pid = mk_post(mdb, author)
        r = requests.post(f"{API}/posts/{pid}/comments",
                          json={"body": "@qatestuser35 hi there"},
                          headers=H(atok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("mentioned_user_ids") == [target]
        assert len(self._notifs(mdb, target)) == 1

    def test_partial_handle_does_not_notify(self, mdb):
        target, _ = mk_user(mdb, name="QA Partial", handle="qapartial35user")
        author, atok = mk_user(mdb, name="QA Author2")
        pid = mk_post(mdb, author)
        r = requests.post(f"{API}/posts/{pid}/comments",
                          json={"body": "@qapartial hello"},
                          headers=H(atok), timeout=30)
        assert r.status_code == 200, r.text
        assert not r.json().get("mentioned_user_ids")
        assert self._notifs(mdb, target) == []

    def test_name_prefix_no_longer_notifies(self, mdb):
        a1, _ = mk_user(mdb, name="Alexandra Kite", handle=f"alexk{uuid.uuid4().hex[:6]}")
        a2, _ = mk_user(mdb, name="Alexander Boom", handle=f"alexb{uuid.uuid4().hex[:6]}")
        author, atok = mk_user(mdb, name="QA Author3")
        pid = mk_post(mdb, author)
        r = requests.post(f"{API}/posts/{pid}/comments",
                          json={"body": "@Alex do you know?"},
                          headers=H(atok), timeout=30)
        assert r.status_code == 200, r.text
        assert not r.json().get("mentioned_user_ids")
        assert self._notifs(mdb, a1) == []
        assert self._notifs(mdb, a2) == []

    def test_case_insensitive_and_self_mention_skipped(self, mdb):
        target, _ = mk_user(mdb, name="Case Target", handle="casetarget35")
        selfh = f"selfy{uuid.uuid4().hex[:6]}"
        author, atok = mk_user(mdb, name="Self Author", handle=selfh)
        pid = mk_post(mdb, author)
        r = requests.post(f"{API}/posts/{pid}/comments",
                          json={"body": f"@CaseTarget35 and @{selfh}"},
                          headers=H(atok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("mentioned_user_ids") == [target]
        assert self._notifs(mdb, author) == []


# --------------------------------------------------------------------------- #
# 5. GET /api/searches/suggestions trend buckets
# --------------------------------------------------------------------------- #
class TestTrendingSuggestions:
    def test_trend_buckets(self, mdb):
        q = f"spinnaker{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc)
        offsets = [1, 9, 17]  # this week, ~1 week ago, ~2 weeks ago
        for off in offsets:
            mk_user(mdb, name="Trend User", saved=[{
                "id": str(uuid.uuid4()), "q": q,
                "created_at": (now - timedelta(days=off)).isoformat(),
            }])
        r = requests.get(f"{API}/searches/suggestions", timeout=30)
        assert r.status_code == 200, r.text
        sug = r.json()["suggestions"]
        assert isinstance(sug, list) and len(sug) <= 5
        for s in sug:
            assert {"q", "count", "trend"} <= set(s)
            assert len(s["trend"]) == 8, s
            starts = [b["week_start"] for b in s["trend"]]
            assert starts == sorted(starts), f"trend not ascending: {starts}"
            for b in s["trend"]:
                assert isinstance(b["count"], int)

        mine = [s for s in sug if s["q"].lower() == q]
        if not mine:
            pytest.skip("seeded query not in global top-5; trend shape verified on others")
        entry = mine[0]
        assert entry["count"] == 3
        assert sum(b["count"] for b in entry["trend"]) == 3, entry["trend"]
        # buckets: index 7 = current week, 6 = one week ago, 5 = two weeks ago
        assert entry["trend"][7]["count"] == 1, entry["trend"]
        assert entry["trend"][6]["count"] == 1, entry["trend"]
        assert entry["trend"][5]["count"] == 1, entry["trend"]
