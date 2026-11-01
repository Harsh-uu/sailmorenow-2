"""Phase L (iteration 27) tests.

Covers:
  - GET /api/users/search (mention autocomplete)
  - GET/POST/DELETE /api/searches (saved searches)
  - GET /api/admin/analytics weekly buckets
  - scheduler._monday_admin_report_digest_job
  - mailer.report_digest_email_html
"""
import os
import sys
import time
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
# backend modules (deps.py) read these at import time
for _k, _v in backend_env.items():
    if _v is not None:
        os.environ.setdefault(_k, _v)

STAMP = str(int(time.time()))


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def _mk_user(mdb, name, email, admin=False):
    uid = f"TEST_iter27_{uuid.uuid4().hex[:8]}"
    tok = f"test_session_iter27_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid, "email": email, "name": name,
        "picture": "https://via.placeholder.com/64",
        "account_type": "sailor", "primary_market": "Greater Seattle",
        "markets": ["Greater Seattle"], "onboarding_complete": True,
        "subscription_tier": "free", "newsletter_opt_in": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if admin:
        doc["platform_role"] = "admin"
    mdb.users.insert_one(doc)
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return uid, tok


@pytest.fixture(scope="module")
def users(mdb):
    """Regular user + admin user + a mention-target named AlexqaUser."""
    ru, rt = _mk_user(mdb, f"TEST_Regular_{STAMP}", f"TEST_reg_{STAMP}@sailmorenow.dev")
    au, at = _mk_user(mdb, f"TEST_Admin_{STAMP}", f"TEST_admin_{STAMP}@sailmorenow.dev", admin=True)
    mu, _ = _mk_user(mdb, "AlexqaUser", f"TEST_alexqa_{STAMP}@sailmorenow.dev")
    data = {"regular": (ru, rt), "admin": (au, at), "mention": (mu, None)}
    yield data
    mdb.users.delete_many({"user_id": {"$in": [ru, au, mu]}})
    mdb.user_sessions.delete_many({"user_id": {"$in": [ru, au, mu]}})


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------- users/search
class TestUsersSearch:
    def test_public_prefix_search(self, users):
        r = requests.get(f"{API}/users/search", params={"q": "Alexqa", "limit": 6}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "users" in data and isinstance(data["users"], list)
        names = [u["name"] for u in data["users"]]
        assert "AlexqaUser" in names
        u = next(x for x in data["users"] if x["name"] == "AlexqaUser")
        assert set(u.keys()) == {"user_id", "name", "avatar"}, u
        assert u["user_id"] == users["mention"][0]
        assert u["avatar"] == "https://via.placeholder.com/64"

    def test_partial_prefix_case_insensitive(self):
        r = requests.get(f"{API}/users/search", params={"q": "al"}, timeout=30)
        assert r.status_code == 200
        assert any(x["name"].lower().startswith("al") for x in r.json()["users"])

    def test_empty_query_returns_empty(self):
        r = requests.get(f"{API}/users/search", params={"q": ""}, timeout=30)
        assert r.status_code == 200
        assert r.json()["users"] == []

    def test_no_query_param_returns_empty(self):
        r = requests.get(f"{API}/users/search", timeout=30)
        assert r.status_code == 200
        assert r.json()["users"] == []

    def test_limit_clamped_high(self):
        r = requests.get(f"{API}/users/search", params={"q": "a", "limit": 500}, timeout=30)
        assert r.status_code == 200
        assert len(r.json()["users"]) <= 20

    def test_limit_clamped_low(self):
        r = requests.get(f"{API}/users/search", params={"q": "a", "limit": 0}, timeout=30)
        assert r.status_code == 200
        assert len(r.json()["users"]) >= 0
        assert len(r.json()["users"]) <= 1

    def test_limit_respected(self):
        r = requests.get(f"{API}/users/search", params={"q": "a", "limit": 2}, timeout=30)
        assert r.status_code == 200
        assert len(r.json()["users"]) <= 2

    def test_no_mongo_id_leak(self):
        r = requests.get(f"{API}/users/search", params={"q": "a"}, timeout=30)
        assert '"_id"' not in r.text
        assert "email" not in r.text


# ---------------------------------------------------------------- saved search
class TestSavedSearches:
    def test_list_unauth_401(self):
        r = requests.get(f"{API}/searches", timeout=30)
        assert r.status_code == 401

    def test_post_unauth_401(self):
        r = requests.post(f"{API}/searches", json={"q": "sail"}, timeout=30)
        assert r.status_code == 401

    def test_delete_unauth_401(self):
        r = requests.delete(f"{API}/searches/{uuid.uuid4()}", timeout=30)
        assert r.status_code == 401

    def test_fresh_user_empty(self, users):
        _, tok = users["regular"]
        r = requests.get(f"{API}/searches", headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == {"searches": []}

    def test_full_crud_and_duplicate(self, users, mdb):
        uid, tok = users["regular"]
        # create
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "sail"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True and "search" in body
        sid = body["search"]["id"]
        assert body["search"]["q"] == "sail"
        assert isinstance(body["search"]["created_at"], str)

        # GET persistence
        r = requests.get(f"{API}/searches", headers=_h(tok), timeout=30)
        got = r.json()["searches"]
        assert len(got) == 1 and got[0]["id"] == sid and got[0]["q"] == "sail"

        # persisted on users.saved_searches
        doc = mdb.users.find_one({"user_id": uid}, {"saved_searches": 1})
        assert [s["q"] for s in doc["saved_searches"]] == ["sail"]

        # duplicate (exact)
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "sail"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("duplicate") is True

        # duplicate (case-insensitive)
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "SaIl"}, timeout=30)
        assert r.json().get("duplicate") is True
        assert len(requests.get(f"{API}/searches", headers=_h(tok), timeout=30).json()["searches"]) == 1

        # delete
        r = requests.delete(f"{API}/searches/{sid}", headers=_h(tok), timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True
        assert requests.get(f"{API}/searches", headers=_h(tok), timeout=30).json()["searches"] == []

        # delete again -> 404
        r = requests.delete(f"{API}/searches/{sid}", headers=_h(tok), timeout=30)
        assert r.status_code == 404

    def test_validation_too_short(self, users):
        _, tok = users["regular"]
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "a"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_validation_empty(self, users):
        _, tok = users["regular"]
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "   "}, timeout=30)
        assert r.status_code == 400

    def test_validation_too_long(self, users):
        _, tok = users["regular"]
        r = requests.post(f"{API}/searches", headers=_h(tok), json={"q": "x" * 61}, timeout=30)
        assert r.status_code == 400

    def test_max_slice_10(self, users, mdb):
        uid, tok = users["regular"]
        mdb.users.update_one({"user_id": uid}, {"$set": {"saved_searches": []}})
        for i in range(13):
            r = requests.post(f"{API}/searches", headers=_h(tok),
                              json={"q": f"query-{i:02d}"}, timeout=30)
            assert r.status_code == 200, r.text
        saved = requests.get(f"{API}/searches", headers=_h(tok), timeout=30).json()["searches"]
        assert len(saved) == 10, f"expected max 10, got {len(saved)}"
        # oldest trimmed, newest kept
        assert [s["q"] for s in saved] == [f"query-{i:02d}" for i in range(3, 13)]
        mdb.users.update_one({"user_id": uid}, {"$set": {"saved_searches": []}})

    def test_isolation_between_users(self, users):
        _, rtok = users["regular"]
        _, atok = users["admin"]
        requests.post(f"{API}/searches", headers=_h(rtok), json={"q": "isolationcheck"}, timeout=30)
        other = requests.get(f"{API}/searches", headers=_h(atok), timeout=30).json()["searches"]
        assert all(s["q"] != "isolationcheck" for s in other)


# ---------------------------------------------------------------- analytics
class TestAnalyticsWeekly:
    def test_requires_admin(self, users):
        _, tok = users["regular"]
        r = requests.get(f"{API}/admin/analytics", headers=_h(tok), timeout=60)
        assert r.status_code == 403

    def test_weekly_buckets(self, users):
        _, tok = users["admin"]
        r = requests.get(f"{API}/admin/analytics", headers=_h(tok), timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "weekly" in data
        weekly = data["weekly"]
        for key in ("posts", "events", "comments", "discussions", "users", "digest"):
            assert key in weekly, f"missing weekly.{key}"
            arr = weekly[key]
            assert isinstance(arr, list) and len(arr) == 8, f"{key}: {len(arr)} buckets"
            starts = [b["week_start"] for b in arr]
            assert starts == sorted(starts), f"{key} buckets not ascending: {starts}"
            for b in arr:
                assert isinstance(b["count"], int) and b["count"] >= 0
        # sanity: existing top-level keys preserved (no decorator regression)
        for k in ("users", "posts", "events", "comments", "discussions", "reports", "digest", "push"):
            assert k in data


# ---------------------------------------------------------------- mailer html
class TestReportDigestHtml:
    def test_renders_all_sections(self):
        from mailer import report_digest_email_html
        html = report_digest_email_html(
            new_count=4, resolved_count=2, dismissed_count=1, open_total=3,
            oldest_open={"created_at": "2026-06-01T10:00:00+00:00", "reason": "spam post"},
            recent_open=[{"target_type": "post", "reason": "spam", "reporter_name": "Jane",
                          "created_at": "2026-07-01T10:00:00+00:00"}],
            app_url="https://example.test",
        )
        assert html.strip().startswith("<!DOCTYPE html>")
        assert "Moderation" in html
        assert "Reports queue — weekly digest" in html
        for label in (">New<", ">Resolved<", ">Dismissed<"):
            assert label in html, label
        assert ">4<" in html and ">2<" in html and ">1<" in html
        assert 'href="https://example.test/admin/reports"' in html
        assert "2026-06-01" in html
        assert "Jane" in html
        assert html.count("<html>") == 1 and "</html>" in html

    def test_empty_state_and_escaping(self):
        from mailer import report_digest_email_html
        html = report_digest_email_html(
            new_count=0, resolved_count=0, dismissed_count=0, open_total=1,
            oldest_open=None, recent_open=[], app_url="https://example.test",
        )
        assert "No open reports right now." in html
        assert "report still open" in html  # singular pluralisation
        html2 = report_digest_email_html(
            new_count=1, resolved_count=0, dismissed_count=0, open_total=0,
            oldest_open=None,
            recent_open=[{"target_type": "post", "reason": "<script>x</script>",
                          "reporter_name": "Bob", "created_at": "2026-07-01"}],
            app_url="https://example.test",
        )
        assert "<script>" not in html2


# ---------------------------------------------------------------- scheduler job
class TestMondayAdminReportDigest:
    def test_job_sends_and_guards(self, mdb, users):
        import mailer
        import scheduler
        from motor.motor_asyncio import AsyncIOMotorClient

        admin_uid, _ = users["admin"]
        admin_email = mdb.users.find_one({"user_id": admin_uid})["email"]
        mdb.users.update_one({"user_id": admin_uid},
                             {"$unset": {"admin_report_digest_sent_at": ""}})

        # Seed reports: 2 new in last 7 days, 1 resolved, 1 dismissed
        now = datetime.now(timezone.utc)
        rid = lambda: f"TEST_iter27_rep_{uuid.uuid4().hex[:8]}"  # noqa: E731
        seeded = []
        for i in range(2):
            _id = rid()
            seeded.append(_id)
            mdb.reports.insert_one({
                "id": _id, "status": "open", "target_type": "post",
                "target_id": "x", "reason": f"TEST_iter27 spam {i}",
                "reporter_name": "TEST Reporter",
                "created_at": (now - timedelta(days=i + 1)).isoformat(),
            })
        for st in ("resolved", "dismissed"):
            _id = rid()
            seeded.append(_id)
            mdb.reports.insert_one({
                "id": _id, "status": st, "target_type": "post", "target_id": "x",
                "reason": f"TEST_iter27 {st}", "reporter_name": "TEST Reporter",
                "created_at": (now - timedelta(days=3)).isoformat(),
                "resolved_at": (now - timedelta(days=2)).isoformat(),
            })

        sent = []

        async def fake_send_email(*, recipient_email, subject, html_content, reply_to=None):
            sent.append({"to": recipient_email, "subject": subject, "html": html_content})
            return {"status": "ok"}

        orig = mailer.send_email
        mailer.send_email = fake_send_email
        try:
            async def run():
                client = AsyncIOMotorClient(MONGO_URL)
                adb = client[DB_NAME]
                await scheduler._monday_admin_report_digest_job(adb)
                first = list(sent)
                await scheduler._monday_admin_report_digest_job(adb)
                second = sent[len(first):]
                client.close()
                return first, second

            first, second = asyncio.run(run())

            # (a) admin user's email picked up
            assert any(s["to"] == admin_email for s in first), \
                f"admin email {admin_email} not in {[s['to'] for s in first]}"
            # (c) subject mentions new reports
            subj = next(s["subject"] for s in first if s["to"] == admin_email)
            assert "new report" in subj, subj
            assert "Reports queue" in next(s["html"] for s in first if s["to"] == admin_email)
            # claim stamp written
            doc = mdb.users.find_one({"user_id": admin_uid})
            assert doc.get("admin_report_digest_sent_at")
            # (b) second run must not re-send to the same admin user
            assert all(s["to"] != admin_email for s in second), \
                f"claim guard failed, resent to {admin_email}"
        finally:
            mailer.send_email = orig
            mdb.reports.delete_many({"id": {"$in": seeded}})
            mdb.users.update_one({"user_id": admin_uid},
                                 {"$unset": {"admin_report_digest_sent_at": ""}})

    def test_cron_job_registered(self):
        import inspect
        import scheduler
        src = inspect.getsource(scheduler.start_scheduler)
        assert 'id="monday_admin_report_digest"' in src
        assert 'day_of_week="mon"' in src and "hour=8" in src and "minute=30" in src
