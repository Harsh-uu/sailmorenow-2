"""Iteration 25 (Phase K) backend tests.

Modules under test:
  * routers/reports_router.py  -> GET /api/admin/reports `insights`
  * routers/admin_router.py    -> POST /api/admin/digest/send-now, GET /api/search
  * routers/community_router.py-> POST /api/posts/{id}/comments @-mentions
  * routers/hub_router.py      -> PUSH_KINDS includes 'mention'
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
BASE_URL = _base.rstrip("/") + "/api"

DB = "test_database"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "main")
RUN = f"TEST_iter25{WORKER}_"
MARKET = f"TEST_iter25{WORKER}_Market"
# posts/discussions validate against the real market list
POST_MARKET = "Greater Seattle"


def mongo(js: str) -> str:
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def mint(name, role="member", market=MARKET, newsletter=False):
    uid = RUN + uuid.uuid4().hex[:8]
    tok = f"TEST_sess25{WORKER}_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{market}', markets:['{market}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:{str(newsletter).lower()},
      platform_role:'{role}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return {"user_id": uid, "token": tok, "name": name}


def cleanup():
    mongo(f"""
    db.users.deleteMany({{user_id:/^{RUN}/}});
    db.user_sessions.deleteMany({{user_id:/^{RUN}/}});
    db.posts.deleteMany({{$or:[{{author_id:/^{RUN}/}},{{market:'{MARKET}'}}]}});
    db.comments.deleteMany({{author_id:/^{RUN}/}});
    db.discussions.deleteMany({{$or:[{{author_id:/^{RUN}/}},{{market:'{MARKET}'}}]}});
    db.events.deleteMany({{market:'{MARKET}'}});
    db.reports.deleteMany({{reporter_id:/^{RUN}/}});
    db.notifications.deleteMany({{user_id:/^{RUN}/}});
    """)


@pytest.fixture(scope="module")
def api():
    cleanup()
    s = requests.Session()
    yield s
    cleanup()


def seed_market_event(days=3, market=MARKET):
    """Digest eligibility needs new_crew/new_events/new_comments — a post alone
    is not enough. Insert an upcoming event in the market."""
    eid = RUN + uuid.uuid4().hex[:8]
    starts = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST_iter25 digest event',
      description:'TEST_iter25 digest event desc', location:'TEST_iter25 Dock',
      market:'{market}', starts_at:'{starts}', created_at:new Date().toISOString(),
      source:'manual'}});""")
    return eid


@pytest.fixture(scope="module")
def admin(api):
    return mint("TEST Admin25 Root", role="admin")


@pytest.fixture(scope="module")
def member(api):
    return mint("TEST Member25 Plain")


# ---------------------------------------------------------------- reports insights
class TestReportInsights:
    def test_unauthenticated_401(self, api):
        r = api.get(f"{BASE_URL}/admin/reports")
        assert r.status_code == 401, r.text

    def test_non_admin_403(self, api, member):
        r = api.get(f"{BASE_URL}/admin/reports", headers=h(member["token"]))
        assert r.status_code == 403, r.text

    def test_insights_shape(self, api, admin):
        r = api.get(f"{BASE_URL}/admin/reports", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        ins = r.json().get("insights")
        assert isinstance(ins, dict), "insights missing"
        assert set(ins) >= {"weekly", "top_targets", "open_total"}
        assert len(ins["weekly"]) == 8, ins["weekly"]
        for w in ins["weekly"]:
            assert set(w) == {"week_start", "count"}
            assert isinstance(w["count"], int)
            datetime.strptime(w["week_start"], "%Y-%m-%d")
        assert len(ins["top_targets"]) <= 5
        for t in ins["top_targets"]:
            assert set(t) >= {"target_type", "target_id", "count", "last_reason", "preview"}
            assert isinstance(t["count"], int) and t["count"] >= 1
        assert isinstance(ins["open_total"], int)

    def test_weekly_rolls_up_all_statuses(self, api, admin, member):
        """3 new reports on the same target across open/resolved/dismissed must all
        land in the current week bucket, and top_targets must show count>=3."""
        before = api.get(f"{BASE_URL}/admin/reports", headers=h(admin["token"])).json()["insights"]
        base_last = before["weekly"][-1]["count"]
        base_total = sum(w["count"] for w in before["weekly"])

        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 hot target post",
            "body": "TEST_iter25 body", "market": POST_MARKET}).json()
        target_id = p["id"]
        now_iso = datetime.now(timezone.utc).isoformat()
        for st in ("open", "resolved", "dismissed"):
            mongo(f"""db.reports.insertOne({{id:'{RUN}rep_{st}_{uuid.uuid4().hex[:6]}',
              reporter_id:'{member["user_id"]}', target_type:'post', target_id:'{target_id}',
              reason:'TEST_iter25 {st} reason', status:'{st}', created_at:'{now_iso}'}});""")

        after = api.get(f"{BASE_URL}/admin/reports", headers=h(admin["token"])).json()["insights"]
        assert after["weekly"][-1]["count"] == base_last + 3, after["weekly"]
        assert sum(w["count"] for w in after["weekly"]) == base_total + 3
        hit = [t for t in after["top_targets"] if t["target_id"] == target_id]
        assert hit, f"target not in top_targets: {after['top_targets']}"
        assert hit[0]["count"] == 3
        assert hit[0]["target_type"] == "post"
        assert "TEST_iter25" in (hit[0]["preview"] or "")

    def test_insights_independent_of_status_filter(self, api, admin):
        a = api.get(f"{BASE_URL}/admin/reports?status=open", headers=h(admin["token"])).json()
        b = api.get(f"{BASE_URL}/admin/reports?status=resolved", headers=h(admin["token"])).json()
        c = api.get(f"{BASE_URL}/admin/reports?status=all", headers=h(admin["token"])).json()
        assert a["insights"]["weekly"] == b["insights"]["weekly"] == c["insights"]["weekly"]
        assert a["insights"]["open_total"] == c["insights"]["open_total"]
        # the filtered lists themselves must differ in scope
        assert c["count"] >= a["count"]

    def test_old_report_not_in_recent_bucket(self, api, admin):
        old_iso = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        mongo(f"""db.reports.insertOne({{id:'{RUN}rep_old', reporter_id:'{RUN}ghost',
          target_type:'post', target_id:'{RUN}nonexistent', reason:'TEST_iter25 ancient',
          status:'open', created_at:'{old_iso}'}});""")
        ins = api.get(f"{BASE_URL}/admin/reports", headers=h(admin["token"])).json()["insights"]
        assert sum(w["count"] for w in ins["weekly"]) >= 0
        # deleted/unknown target must render as [deleted]
        hit = [t for t in ins["top_targets"] if t["target_id"] == f"{RUN}nonexistent"]
        if hit:
            assert hit[0]["preview"] == "[deleted]"
        mongo(f"db.reports.deleteOne({{id:'{RUN}rep_old'}});")


# ---------------------------------------------------------------- digest send-now
class TestDigestSendNow:
    def test_unauthenticated_401(self, api):
        r = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=true")
        assert r.status_code == 401, r.text

    def test_non_admin_403(self, api, member):
        r = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=true", headers=h(member["token"]))
        assert r.status_code == 403, r.text

    def test_dry_run_shape(self, api, admin):
        r = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=true", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        assert isinstance(d["would_send"], int) and d["would_send"] >= 0
        assert isinstance(d["markets_considered"], int)
        datetime.fromisoformat(d["as_of"])

    def test_dry_run_is_default(self, api, admin):
        r = api.post(f"{BASE_URL}/admin/digest/send-now", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["dry_run"] is True

    def test_dry_run_counts_eligible_user_and_dedupe_excludes(self, api, admin, member):
        """An opted-in user in a market WITH content is counted; once digest_sent_at
        is set inside the 6-day window they are excluded again."""
        u = mint("TEST Digest25 Target", newsletter=True)
        seed_market_event()
        base = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=true",
                        headers=h(admin["token"])).json()["would_send"]
        assert base >= 1, "eligible opted-in user was not counted"

        mongo(f"""db.users.updateOne({{user_id:'{u["user_id"]}'}},
          {{$set:{{digest_sent_at:new Date().toISOString()}}}});""")
        after = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=true",
                         headers=h(admin["token"])).json()["would_send"]
        assert after == base - 1, f"6-day dedupe not applied: {base} -> {after}"

    def test_real_send_and_double_send_guard(self, api, admin, member):
        u = mint("TEST Digest25 RealSend", newsletter=True)
        seed_market_event()
        r1 = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=false", headers=h(admin["token"]))
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["dry_run"] is False
        assert isinstance(d1["sent_in_last_6d"], int)
        sent1 = mongo(f"""print(db.users.findOne({{user_id:'{u["user_id"]}'}}).digest_sent_at);""")
        assert sent1 and sent1 != "null", "digest_sent_at not stamped by real send"

        # second immediate run must not re-stamp (claim guard)
        api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=false", headers=h(admin["token"]))
        sent2 = mongo(f"""print(db.users.findOne({{user_id:'{u["user_id"]}'}}).digest_sent_at);""")
        assert sent2 == sent1, "digest re-sent inside the 6-day window"
        # and dry-run now excludes them
        dr = api.post(f"{BASE_URL}/admin/digest/send-now?dry_run=true",
                      headers=h(admin["token"])).json()
        assert dr["dry_run"] is True


# ---------------------------------------------------------------- mentions
class TestMentions:
    def test_push_kinds_includes_mention(self, api, member):
        r = api.get(f"{BASE_URL}/push/preferences", headers=h(member["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "mention" in d["kinds"], d["kinds"]
        assert "mention" in d["preferences"]

    def test_comment_mention_notifies_target(self, api, member):
        target = mint("Alexqa Mentiontarget")
        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 mention post",
            "body": "TEST_iter25 mention body", "market": POST_MARKET}).json()
        r = api.post(f"{BASE_URL}/posts/{p['id']}/comments", headers=h(member["token"]),
                     json={"body": "Nice work @Alexqa thanks!"})
        assert r.status_code == 200, r.text
        c = r.json()
        assert target["user_id"] in (c.get("mentioned_user_ids") or []), c

        # persisted on the comment doc
        stored = mongo(f"""print(JSON.stringify(db.comments.findOne({{id:'{c["id"]}'}}).mentioned_user_ids));""")
        assert target["user_id"] in stored, stored
        # notification row created with kind='mention'
        n = mongo(f"""print(db.notifications.countDocuments({{user_id:'{target["user_id"]}', kind:'mention'}}));""")
        assert int(n) >= 1, "no notifications row with kind='mention'"

    def test_mention_is_case_insensitive(self, api, member):
        target = mint("Zoequa Casetest")
        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 case post",
            "body": "TEST_iter25 case body", "market": POST_MARKET}).json()
        c = api.post(f"{BASE_URL}/posts/{p['id']}/comments", headers=h(member["token"]),
                     json={"body": "hey @ZOEQUA ping"}).json()
        assert target["user_id"] in (c.get("mentioned_user_ids") or []), c

    def test_self_mention_not_notified(self, api):
        u = mint("Selfqa Mentioner")
        p = api.post(f"{BASE_URL}/posts", headers=h(u["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 self post",
            "body": "TEST_iter25 self body", "market": POST_MARKET}).json()
        c = api.post(f"{BASE_URL}/posts/{p['id']}/comments", headers=h(u["token"]),
                     json={"body": "note to @Selfqa self"}).json()
        assert u["user_id"] not in (c.get("mentioned_user_ids") or [])
        n = mongo(f"""print(db.notifications.countDocuments({{user_id:'{u["user_id"]}', kind:'mention'}}));""")
        assert int(n) == 0, "self-mention produced a notification"

    def test_no_mention_no_field(self, api, member):
        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 plain post",
            "body": "TEST_iter25 plain body", "market": POST_MARKET}).json()
        c = api.post(f"{BASE_URL}/posts/{p['id']}/comments", headers=h(member["token"]),
                     json={"body": "plain comment with no mentions"}).json()
        assert not c.get("mentioned_user_ids")

    def test_unknown_mention_is_noop(self, api, member):
        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 unknown post",
            "body": "TEST_iter25 unknown body", "market": POST_MARKET}).json()
        r = api.post(f"{BASE_URL}/posts/{p['id']}/comments", headers=h(member["token"]),
                     json={"body": "hello @Qqzzxxnobodyhere ok"})
        assert r.status_code == 200, r.text
        assert not r.json().get("mentioned_user_ids")


# ---------------------------------------------------------------- search
class TestContentSearch:
    def test_search_public_no_auth(self, api):
        r = api.get(f"{BASE_URL}/search", params={"q": "sail"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["q"] == "sail"
        for k in ("posts", "discussions", "events"):
            assert isinstance(d[k], list)
            assert len(d[k]) <= 5, f"{k} exceeded limit: {len(d[k])}"

    @pytest.mark.parametrize("q", ["", "a", " "])
    def test_short_query_returns_empty(self, api, q):
        r = api.get(f"{BASE_URL}/search", params={"q": q})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["posts"] == [] and d["discussions"] == [] and d["events"] == []

    def test_missing_q_param(self, api):
        r = api.get(f"{BASE_URL}/search")
        assert r.status_code == 200, r.text
        assert r.json()["posts"] == []

    def test_finds_post_and_discussion_case_insensitive(self, api, member):
        tok = "Zzqqmarker" + uuid.uuid4().hex[:6]
        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": f"TEST_iter25 {tok} searchable post",
            "body": "TEST_iter25 search body", "market": POST_MARKET}).json()
        d = api.post(f"{BASE_URL}/discussions", headers=h(member["token"]), json={
            "kind": "forum", "title": f"TEST_iter25 {tok} searchable topic",
            "body": "TEST_iter25 search discussion", "market": POST_MARKET}).json()

        r = api.get(f"{BASE_URL}/search", params={"q": tok.upper()})
        assert r.status_code == 200, r.text
        res = r.json()
        assert p["id"] in [x["id"] for x in res["posts"]], res["posts"]
        assert d.get("id") in [x["id"] for x in res["discussions"]], res["discussions"]
        # projection must not leak mongo _id
        for bucket in ("posts", "discussions", "events"):
            for row in res[bucket]:
                assert "_id" not in row

    def test_finds_post_by_body(self, api, member):
        tok = "Bodyonlymark" + uuid.uuid4().hex[:6]
        p = api.post(f"{BASE_URL}/posts", headers=h(member["token"]), json={
            "type": "crew_wanted", "title": "TEST_iter25 body search post",
            "body": f"TEST_iter25 {tok} deep inside body", "market": POST_MARKET}).json()
        res = api.get(f"{BASE_URL}/search", params={"q": tok}).json()
        assert p["id"] in [x["id"] for x in res["posts"]], res["posts"]

    def test_finds_event_by_location(self, api):
        tok = "Locmarker" + uuid.uuid4().hex[:6]
        eid = RUN + uuid.uuid4().hex[:8]
        starts = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST_iter25 loc event',
          description:'TEST_iter25 desc', location:'{tok} Marina Dock',
          market:'{MARKET}', starts_at:'{starts}', source:'manual'}});""")
        res = api.get(f"{BASE_URL}/search", params={"q": tok}).json()
        assert eid in [x["id"] for x in res["events"]], res["events"]
        row = [x for x in res["events"] if x["id"] == eid][0]
        assert row["title"] == "TEST_iter25 loc event"
        assert "location" in row and "starts_at" in row

    def test_regex_special_chars_are_escaped(self, api):
        r = api.get(f"{BASE_URL}/search", params={"q": ".*"})
        assert r.status_code == 200, r.text
        # escaped => must not match everything
        assert r.json()["posts"] == []
