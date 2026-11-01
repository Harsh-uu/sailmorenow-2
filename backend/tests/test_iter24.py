"""Iteration 24 — Report Abuse, Multi-market digest, Admin analytics.

Modules covered:
  reports_router  -> POST /api/reports, GET /api/admin/reports, PATCH /api/admin/reports/{id}
  admin_router    -> GET /api/admin/analytics, GET /api/digest/preview?market=all
  scheduler       -> _sunday_digest_job multi-market (monkeypatched send_email)
  mailer          -> community_digest_email_html(markets=[...])
"""
import os
import sys
import uuid
import asyncio
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
ORIGIN = base_url.rstrip("/")
BASE = ORIGIN + "/api"

DB = "test_database"
# Per-xdist-worker prefix so one worker's teardown never deletes another's fixtures
RUN = "TEST_iter24_" + os.environ.get("PYTEST_XDIST_WORKER", "solo") + "_"
MARKET_A = "Greater Seattle"
MARKET_B = "TEST_iter24_Market_B"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=90)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(role="member", email=None, markets=(MARKET_A,), opt_in=False):
    uid = RUN + uuid.uuid4().hex[:10]
    tok = "TEST_sess24_" + uuid.uuid4().hex
    em = email or f"{uid}@sailmorenow.dev"
    mk = "[" + ",".join(f"'{m}'" for m in markets) + "]"
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{em}', name:'TEST_User24',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{markets[0] if markets else ""}', markets:{mk},
      onboarding_complete:true, subscription_tier:'premium',
      newsletter_opt_in:{str(opt_in).lower()},
      platform_role:'{role}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def insert_target(kind, author_id):
    tid = RUN + kind + "_" + uuid.uuid4().hex[:8]
    coll = {"post": "posts", "comment": "comments", "discussion": "discussions"}[kind]
    mongo(f"""db.{coll}.insertOne({{id:'{tid}', author_id:'{author_id}',
      author_name:'TEST_User24', content:'TEST_iter24 target', market:'{MARKET_A}',
      title:'TEST_iter24 target', kind:'question', status:'approved',
      created_at:new Date().toISOString()}});""")
    return tid


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    s.close()


@pytest.fixture(scope="module")
def member():
    return mint_user()


@pytest.fixture(scope="module")
def admin():
    return mint_user(role="admin")


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mongo(f"""
    db.users.deleteMany({{user_id:/^{RUN}/}});
    db.user_sessions.deleteMany({{user_id:/^{RUN}/}});
    db.posts.deleteMany({{id:/^{RUN}/}});
    db.comments.deleteMany({{id:/^{RUN}/}});
    db.discussions.deleteMany({{id:/^{RUN}/}});
    db.reports.deleteMany({{reporter_id:/^{RUN}/}});
    db.events.deleteMany({{market:'{MARKET_B}'}});
    """)


# ---------------- POST /api/reports ----------------
class TestCreateReport:
    def test_unauth_401(self, client):
        r = client.post(f"{BASE}/reports", json={"target_type": "post", "target_id": "x", "reason": "spam"})
        assert r.status_code == 401, r.text

    def test_invalid_target_type_400(self, client, member):
        r = client.post(f"{BASE}/reports", headers=auth(member[1]),
                        json={"target_type": "boat", "target_id": "x", "reason": "spam"})
        assert r.status_code == 400, r.text

    def test_empty_reason_400(self, client, member):
        r = client.post(f"{BASE}/reports", headers=auth(member[1]),
                        json={"target_type": "post", "target_id": "x", "reason": "   "})
        assert r.status_code == 400, r.text

    def test_missing_target_404(self, client, member):
        r = client.post(f"{BASE}/reports", headers=auth(member[1]),
                        json={"target_type": "post", "target_id": "nope-" + uuid.uuid4().hex,
                              "reason": "spam"})
        assert r.status_code == 404, r.text

    def test_create_and_duplicate(self, client, member):
        pid = insert_target("post", "someone_else")
        r = client.post(f"{BASE}/reports", headers=auth(member[1]),
                        json={"target_type": "post", "target_id": pid, "reason": "TEST spam"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["duplicate"] is False
        rep = d["report"]
        assert rep["status"] == "open" and rep["target_id"] == pid
        assert rep["reporter_id"] == member[0]
        assert isinstance(rep["id"], str) and "_id" not in rep
        r2 = client.post(f"{BASE}/reports", headers=auth(member[1]),
                         json={"target_type": "post", "target_id": pid, "reason": "TEST spam again"})
        assert r2.status_code == 200, r2.text
        assert r2.json()["duplicate"] is True
        assert r2.json()["report"]["id"] == rep["id"]


# ---------------- GET /api/admin/reports ----------------
class TestAdminListReports:
    def test_unauth_401(self, client):
        r = client.get(f"{BASE}/admin/reports")
        assert r.status_code == 401, r.text

    def test_non_admin_403(self, client, member):
        r = client.get(f"{BASE}/admin/reports", headers=auth(member[1]))
        assert r.status_code == 403, r.text

    def test_admin_200_hydrated(self, client, member, admin):
        pid = insert_target("post", "someone_else")
        cr = client.post(f"{BASE}/reports", headers=auth(member[1]),
                         json={"target_type": "post", "target_id": pid, "reason": "TEST hydrate"})
        assert cr.status_code == 200
        rid = cr.json()["report"]["id"]
        r = client.get(f"{BASE}/admin/reports?status=open", headers=auth(admin[1]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["count"] == len(d["reports"])
        mine = [x for x in d["reports"] if x["id"] == rid]
        assert mine, "created report missing from open queue"
        assert mine[0]["target"] is not None
        assert mine[0]["target"]["id"] == pid
        assert "_id" not in mine[0]

    def test_invalid_status_400(self, client, admin):
        r = client.get(f"{BASE}/admin/reports?status=bogus", headers=auth(admin[1]))
        assert r.status_code == 400, r.text

    @pytest.mark.parametrize("st", ["open", "resolved", "dismissed", "all"])
    def test_valid_filters(self, client, admin, st):
        r = client.get(f"{BASE}/admin/reports?status={st}", headers=auth(admin[1]))
        assert r.status_code == 200, r.text
        for rep in r.json()["reports"]:
            if st != "all":
                assert rep["status"] == st

    def test_target_null_when_deleted(self, client, member, admin):
        pid = insert_target("post", "someone_else")
        cr = client.post(f"{BASE}/reports", headers=auth(member[1]),
                         json={"target_type": "post", "target_id": pid, "reason": "TEST orphan"})
        rid = cr.json()["report"]["id"]
        mongo(f"db.posts.deleteOne({{id:'{pid}'}});")
        r = client.get(f"{BASE}/admin/reports?status=open", headers=auth(admin[1]))
        assert r.status_code == 200
        mine = [x for x in r.json()["reports"] if x["id"] == rid][0]
        assert mine["target"] is None


# ---------------- PATCH /api/admin/reports/{id} ----------------
class TestAdminResolve:
    def _report(self, client, member, kind="post"):
        tid = insert_target(kind, "someone_else")
        cr = client.post(f"{BASE}/reports", headers=auth(member[1]),
                         json={"target_type": kind, "target_id": tid, "reason": "TEST resolve"})
        assert cr.status_code == 200, cr.text
        return tid, cr.json()["report"]["id"]

    def test_non_admin_403(self, client, member):
        _, rid = self._report(client, member)
        r = client.patch(f"{BASE}/admin/reports/{rid}", headers=auth(member[1]),
                         json={"status": "dismissed"})
        assert r.status_code == 403, r.text

    def test_bad_status_400(self, client, member, admin):
        _, rid = self._report(client, member)
        r = client.patch(f"{BASE}/admin/reports/{rid}", headers=auth(admin[1]),
                         json={"status": "open"})
        assert r.status_code == 400, r.text

    def test_missing_report_404(self, client, admin):
        r = client.patch(f"{BASE}/admin/reports/{uuid.uuid4().hex}", headers=auth(admin[1]),
                         json={"status": "dismissed"})
        assert r.status_code == 404, r.text

    def test_dismiss(self, client, member, admin):
        _, rid = self._report(client, member)
        r = client.patch(f"{BASE}/admin/reports/{rid}", headers=auth(admin[1]),
                         json={"status": "dismissed", "notes": "TEST no violation"})
        assert r.status_code == 200, r.text
        lst = client.get(f"{BASE}/admin/reports?status=dismissed", headers=auth(admin[1])).json()
        got = [x for x in lst["reports"] if x["id"] == rid]
        assert got and got[0]["status"] == "dismissed"
        assert got[0]["resolved_by"] == admin[0]
        assert got[0]["resolution_notes"] == "TEST no violation"

    def test_resolve_without_delete_keeps_target(self, client, member, admin):
        tid, rid = self._report(client, member)
        r = client.patch(f"{BASE}/admin/reports/{rid}", headers=auth(admin[1]),
                         json={"status": "resolved"})
        assert r.status_code == 200, r.text
        assert mongo(f"db.posts.countDocuments({{id:'{tid}'}});") == "1"
        lst = client.get(f"{BASE}/admin/reports?status=resolved", headers=auth(admin[1])).json()
        got = [x for x in lst["reports"] if x["id"] == rid]
        assert got and got[0]["status"] == "resolved"

    @pytest.mark.parametrize("kind,coll", [("post", "posts"), ("comment", "comments"),
                                           ("discussion", "discussions")])
    def test_resolve_delete_target(self, client, member, admin, kind, coll):
        tid, rid = self._report(client, member, kind)
        r = client.patch(f"{BASE}/admin/reports/{rid}", headers=auth(admin[1]),
                         json={"status": "resolved", "delete_target": True})
        assert r.status_code == 200, r.text
        assert mongo(f"db.{coll}.countDocuments({{id:'{tid}'}});") == "0"

    def test_delete_target_auto_resolves_duplicates(self, client, member, admin):
        other = mint_user()
        tid = insert_target("post", "someone_else")
        r1 = client.post(f"{BASE}/reports", headers=auth(member[1]),
                         json={"target_type": "post", "target_id": tid, "reason": "TEST a"})
        r2 = client.post(f"{BASE}/reports", headers=auth(other[1]),
                         json={"target_type": "post", "target_id": tid, "reason": "TEST b"})
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, (r2.status_code, r2.text)
        rid1, rid2 = r1.json()["report"]["id"], r2.json()["report"]["id"]
        pr = client.patch(f"{BASE}/admin/reports/{rid1}", headers=auth(admin[1]),
                          json={"status": "resolved", "delete_target": True})
        assert pr.status_code == 200, pr.text
        allr = client.get(f"{BASE}/admin/reports?status=all", headers=auth(admin[1])).json()["reports"]
        by_id = {x["id"]: x for x in allr}
        assert by_id[rid1]["status"] == "resolved"
        assert by_id[rid2]["status"] == "resolved", "duplicate report not auto-resolved"
        assert by_id[rid2]["resolution_notes"] == "auto-resolved with target"


# ---------------- GET /api/admin/analytics ----------------
class TestAnalytics:
    def test_unauth(self, client):
        r = client.get(f"{BASE}/admin/analytics")
        assert r.status_code in (401, 403), r.text
        assert r.status_code == 401, f"spec expects 401 unauth, got {r.status_code}"

    def test_non_admin_403(self, client, member):
        r = client.get(f"{BASE}/admin/analytics", headers=auth(member[1]))
        assert r.status_code == 403, r.text

    def test_admin_shape(self, client, admin):
        r = client.get(f"{BASE}/admin/analytics", headers=auth(admin[1]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "as_of" in d
        for k in ("users", "posts", "events", "comments", "discussions", "reports",
                  "digest", "push"):
            assert k in d, f"missing {k}"
        assert set(d["users"]) >= {"total", "by_account_type", "by_subscription_tier",
                                   "verified", "active_last_7d"}
        assert set(d["posts"]) >= {"total", "last_7d"}
        assert set(d["events"]) >= {"total", "upcoming", "by_source", "by_market"}
        assert set(d["comments"]) >= {"total", "last_7d"}
        assert set(d["discussions"]) >= {"total", "pending", "by_kind"}
        assert set(d["reports"]) >= {"open", "total"}
        assert "sent_last_30d" in d["digest"] and "subscribers" in d["push"]
        assert isinstance(d["users"]["total"], int) and d["users"]["total"] > 0
        assert isinstance(d["users"]["by_account_type"], dict)

    def test_counts_reflect_new_report(self, client, member, admin):
        before = client.get(f"{BASE}/admin/analytics", headers=auth(admin[1])).json()["reports"]
        pid = insert_target("post", "someone_else")
        client.post(f"{BASE}/reports", headers=auth(member[1]),
                    json={"target_type": "post", "target_id": pid, "reason": "TEST counter"})
        after = client.get(f"{BASE}/admin/analytics", headers=auth(admin[1])).json()["reports"]
        # >= because parallel workers may create reports concurrently
        assert after["open"] >= before["open"] + 1
        assert after["total"] >= before["total"] + 1


# ---------------- GET /api/digest/preview?market=all ----------------
class TestDigestPreview:
    def test_unauth_401(self, client):
        r = client.get(f"{BASE}/digest/preview?market=all")
        assert r.status_code == 401, r.text

    def test_multi_market(self, client):
        uid, tok = mint_user(markets=(MARKET_A, MARKET_B))
        r = client.get(f"{BASE}/digest/preview?market=all", headers=auth(tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d["followed_markets"]) == {MARKET_A, MARKET_B}
        got = {m["market"] for m in d["markets"]}
        assert got == {MARKET_A, MARKET_B}
        for m in d["markets"]:
            assert set(m) >= {"market", "new_crew", "new_events", "new_comments"}
        assert isinstance(d["empty"], bool)

    def test_no_markets_400(self, client):
        uid, tok = mint_user(markets=())
        mongo(f"db.users.updateOne({{user_id:'{uid}'}},{{$set:{{markets:[],primary_market:null}}}});")
        r = client.get(f"{BASE}/digest/preview?market=all", headers=auth(tok))
        assert r.status_code == 400, r.text


# ---------------- mailer + scheduler ----------------
class TestMailerDigestHtml:
    def test_single_market_header(self):
        from mailer import community_digest_email_html
        html = community_digest_email_html(
            recipient_name="Jane",
            markets=[{"market": MARKET_A, "new_crew": [], "new_events": [], "new_comments": 3}],
            app_url="https://x.test")
        assert f"Sunday Digest &middot; {MARKET_A}" in html
        assert MARKET_A in html

    def test_multi_market_sections(self):
        from mailer import community_digest_email_html
        html = community_digest_email_html(
            recipient_name="Jane",
            markets=[{"market": MARKET_A, "new_crew": [], "new_events": [], "new_comments": 1},
                     {"market": MARKET_B, "new_crew": [], "new_events": [], "new_comments": 2}],
            app_url="https://x.test")
        assert "Sunday Digest &middot; Your markets" in html
        assert MARKET_A in html and MARKET_B in html
        assert html.count("New sailors ready for a boat") == 2


class TestSundayDigestJob:
    def test_multi_market_single_email_and_idempotent(self, monkeypatch):
        import mailer
        import scheduler as sched
        from motor.motor_asyncio import AsyncIOMotorClient

        uid, _ = mint_user(markets=(MARKET_A, MARKET_B), opt_in=True)
        # give MARKET_B a payload (upcoming event created recently)
        eid = RUN + "evt_" + uuid.uuid4().hex[:8]
        starts = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        created = datetime.now(timezone.utc).isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST_iter24 Regatta',
          market:'{MARKET_B}', starts_at:'{starts}', created_at:'{created}',
          source:'test', location:'TEST dock', status:'approved'}});""")

        sends = []

        async def fake_send(**kw):
            sends.append(kw)
            return True

        monkeypatch.setattr(mailer, "send_email", fake_send)

        async def run():
            cli = AsyncIOMotorClient(os.environ.get("MONGO_URL") or
                                     dotenv_values("/app/backend/.env")["MONGO_URL"])
            db = cli[dotenv_values("/app/backend/.env")["DB_NAME"]]
            await sched._sunday_digest_job(db)
            await sched._sunday_digest_job(db)  # idempotency
            cli.close()

        asyncio.run(run())
        mine = [s for s in sends if s["recipient_email"].startswith(uid)]
        assert len(mine) == 1, f"expected exactly one digest email, got {len(mine)}"
        subj = mine[0]["subject"]
        assert ("markets" in subj) or (MARKET_B in subj), subj
        assert MARKET_B in mine[0]["html_content"]
        stamped = mongo(f"db.users.countDocuments({{user_id:'{uid}', digest_sent_at:{{$ne:null}}}});")
        assert stamped == "1"
