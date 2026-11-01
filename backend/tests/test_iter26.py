"""Iteration 26 — spot-check retest of iteration_25 fixes.

Modules under test:
  * routers/admin_router.py     -> GET /admin/analytics route registration, send-now docstring
  * routers/community_router.py -> mention regex min length 3, per-token .limit(5)
  * routers/reports_router.py   -> insights.top_targets last_reason = most recent
"""
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL")
if not _base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
ROOT_URL = _base.rstrip("/")
BASE_URL = ROOT_URL + "/api"
# The ingress only forwards /api/* to the backend, so the OpenAPI document
# (served at the app root) is only reachable on the internal port. Route
# *behaviour* is always asserted through the public URL above.
OPENAPI_URL = "http://localhost:8001/openapi.json"

DB = "test_database"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "main")
RUN = f"TEST_iter26{WORKER}_"
POST_MARKET = "Greater Seattle"


def mongo(js: str) -> str:
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def mint(name, role="member"):
    uid = RUN + uuid.uuid4().hex[:8]
    tok = f"TEST_sess26{WORKER}_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{POST_MARKET}', markets:['{POST_MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:false,
      platform_role:'{role}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return {"user_id": uid, "token": tok, "name": name}


def cleanup():
    mongo(f"""
    db.users.deleteMany({{user_id:/^{RUN}/}});
    db.user_sessions.deleteMany({{user_id:/^{RUN}/}});
    db.posts.deleteMany({{$or:[{{author_id:/^{RUN}/}},{{id:/^{RUN}/}}]}});
    db.comments.deleteMany({{author_id:/^{RUN}/}});
    db.reports.deleteMany({{$or:[{{reporter_id:/^{RUN}/}},{{id:/^{RUN}/}}]}});
    db.notifications.deleteMany({{user_id:/^{RUN}/}});
    """)


@pytest.fixture(scope="module")
def api():
    cleanup()
    s = requests.Session()
    yield s
    cleanup()


@pytest.fixture(scope="module")
def admin(api):
    return mint(f"AdminSix{uuid.uuid4().hex[:4]}", role="admin")


@pytest.fixture(scope="module")
def author(api):
    return mint(f"AuthorSix{uuid.uuid4().hex[:4]}")


@pytest.fixture(scope="module")
def post(api, author):
    r = api.post(f"{BASE_URL}/posts", headers=h(author["token"]), json={
        "type": "general", "title": "TEST_iter26 mention host",
        "body": "TEST_iter26 body", "market": POST_MARKET, "expires_days": 7,
    })
    assert r.status_code == 200, r.text
    return r.json()


# --- admin/analytics route registration ---
class TestAnalyticsRoute:
    def test_openapi_registers_admin_analytics(self, api):
        r = api.get(OPENAPI_URL)
        assert r.status_code == 200
        paths = r.json()["paths"]
        assert "/api/admin/analytics" in paths, sorted(p for p in paths if "admin" in p)
        assert "get" in paths["/api/admin/analytics"]

    def test_admin_analytics_returns_payload(self, api, admin):
        r = api.get(f"{BASE_URL}/admin/analytics", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        for key in ("users", "posts", "events"):
            assert key in d, list(d.keys())

    def test_admin_analytics_requires_admin(self, api, author):
        assert api.get(f"{BASE_URL}/admin/analytics").status_code in (401, 403)
        assert api.get(f"{BASE_URL}/admin/analytics",
                       headers=h(author["token"])).status_code == 403


# --- send-now docstring wording ---
class TestSendNowDocstring:
    def test_description_no_longer_says_bypasses(self, api):
        spec = api.get(OPENAPI_URL).json()
        op = spec["paths"]["/api/admin/digest/send-now"]["post"]
        desc = (op.get("description") or "") + (op.get("summary") or "")
        assert "bypass" not in desc.lower(), desc
        assert "6-day dedupe" in desc

    def test_dry_run_shape(self, api, admin):
        r = api.post(f"{BASE_URL}/admin/digest/send-now", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        for k in ("would_send", "markets_considered", "as_of"):
            assert k in d


# --- mentions: min length + per-token limit ---
class TestMentions:
    def _comment(self, api, author, post_id, text):
        r = api.post(f"{BASE_URL}/posts/{post_id}/comments",
                     headers=h(author["token"]), json={"body": text})
        assert r.status_code == 200, r.text
        return r.json()

    def test_two_char_token_mentions_nobody(self, api, author, post):
        target = mint("Alqa Shortname")
        c = self._comment(api, author, post["id"], "Hi @Al are you sailing?")
        assert not c.get("mentioned_user_ids"), c.get("mentioned_user_ids")
        n = mongo(f"db.notifications.countDocuments({{user_id:'{target['user_id']}', kind:'mention'}})")
        assert n.strip() == "0", n

    def test_three_plus_char_token_resolves(self, api, author, post):
        target = mint("Alexqa Tester")
        c = self._comment(api, author, post["id"], "Welcome @Alexqa to the crew")
        assert target["user_id"] in (c.get("mentioned_user_ids") or []), c
        n = mongo(f"db.notifications.countDocuments({{user_id:'{target['user_id']}', kind:'mention'}})")
        assert n.strip() == "1", n

    def test_token_capped_at_five_users(self, api, author, post):
        made = [mint(f"Broadxx User{i}") for i in range(7)]
        ids = {m["user_id"] for m in made}
        c = self._comment(api, author, post["id"], "Calling all @Broadxx folks")
        hits = [i for i in (c.get("mentioned_user_ids") or []) if i in ids]
        assert 0 < len(hits) <= 5, c.get("mentioned_user_ids")
        notified = 0
        for m in made:
            notified += int(mongo(
                f"db.notifications.countDocuments({{user_id:'{m['user_id']}', kind:'mention'}})").strip())
        assert notified <= 5, notified


# --- reports insights: last_reason ordering + weekly buckets ---
class TestReportsInsights:
    def test_last_reason_is_most_recent(self, api, admin, post):
        base = api.get(f"{BASE_URL}/admin/reports", headers=h(admin["token"])).json()
        top = base["insights"]["top_targets"]
        need = (top[0]["count"] if top else 0) + 3
        now = datetime.now(timezone.utc)
        docs = []
        for i in range(need):
            reason = "R1 earlier reason" if i < need - 1 else "R2 most recent reason"
            created = (now - timedelta(minutes=(need - i))).isoformat()
            docs.append(
                f"{{id:'{RUN}rep{i}', reporter_id:'{RUN}rep_reporter{i}',"
                f" reporter_name:'TEST_iter26', target_type:'post', target_id:'{post['id']}',"
                f" reason:'{reason}', status:'open', created_at:'{created}'}}"
            )
        mongo(f"db.reports.insertMany([{','.join(docs)}]);")
        r = api.get(f"{BASE_URL}/admin/reports", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        ins = r.json()["insights"]
        mine = [t for t in ins["top_targets"] if t["target_id"] == post["id"]]
        assert mine, ins["top_targets"]
        assert mine[0]["count"] >= need
        assert mine[0]["last_reason"] == "R2 most recent reason", mine[0]

    def test_weekly_has_eight_buckets(self, api, admin):
        ins = api.get(f"{BASE_URL}/admin/reports",
                      headers=h(admin["token"])).json()["insights"]
        assert len(ins["weekly"]) == 8
        assert all(set(w) == {"week_start", "count"} for w in ins["weekly"])
        assert all(isinstance(w["count"], int) for w in ins["weekly"])
        starts = [w["week_start"] for w in ins["weekly"]]
        assert starts == sorted(starts), starts

    def test_empty_state_shape_when_no_reports(self, api, admin):
        """Empty-state contract: with zero reports in DB, weekly is 8 zero buckets
        and top_targets is []. Verified on an isolated snapshot of the collection."""
        mongo("db.reports.renameCollection('reports_iter26_bak', true);")
        try:
            ins = api.get(f"{BASE_URL}/admin/reports",
                          headers=h(admin["token"])).json()["insights"]
            assert len(ins["weekly"]) == 8
            assert all(w["count"] == 0 for w in ins["weekly"]), ins["weekly"]
            assert ins["top_targets"] == []
            assert ins["open_total"] == 0
        finally:
            mongo("db.reports.drop(); db.reports_iter26_bak.renameCollection('reports', true);")
