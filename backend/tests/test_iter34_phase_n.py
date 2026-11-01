"""Iteration 34 (Phase N) backend tests.

Covers:
  * community_router.create_comment -> @-mention EMAIL fallback matrix
      (a) 0 push subs + mention pref absent/true  -> send_email called
      (b) >=1 push sub                            -> send_email NOT called
      (c) push_preferences.mention == False       -> send_email NOT called
      (d) no email on user doc                    -> send_email NOT called
      (e) two mentioned users -> exactly one email each (no duplicates)
  * mailer.mention_email_html / mailer.report_digest_email_html render
  * regression: GET /api/admin/analytics, POST /api/webhooks/resend/digest,
                GET /api/searches/suggestions, GET /api/admin/digest/render
"""
import asyncio
import os
import sys
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

TAG = "TEST_iter34_" + uuid.uuid4().hex[:8]
MARKET = "Greater Seattle"


# --------------------------------------------------------------------------- #
# shared fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module", autouse=True)
def cleanup(mdb):
    yield
    ids = [d["user_id"] for d in mdb.users.find({"test_tag": TAG}, {"user_id": 1})]
    mdb.push_subscriptions.delete_many({"user_id": {"$in": ids}})
    mdb.notifications.delete_many({"user_id": {"$in": ids}})
    mdb.comments.delete_many({"author_id": {"$in": ids}})
    mdb.posts.delete_many({"test_tag": TAG})
    mdb.user_sessions.delete_many({"test_tag": TAG})
    mdb.users.delete_many({"test_tag": TAG})


def mk_user(mdb, *, name, email=True, admin=False, prefs=None, subs=0, saved=None):
    uid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    tok = f"TEST_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "name": name,
        "account_type": "sailor",
        "primary_market": MARKET,
        "markets": [MARKET],
        "onboarding_complete": True,
        "subscription_tier": "free",
        "newsletter_opt_in": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "test_tag": TAG,
    }
    if email:
        doc["email"] = f"{uid}@sailmorenow.dev".lower()
    if admin:
        doc["platform_role"] = "admin"
    if prefs is not None:
        doc["push_preferences"] = prefs
    if saved:
        doc["saved_searches"] = [
            {"id": str(uuid.uuid4()), "q": q,
             "created_at": datetime.now(timezone.utc).isoformat()} for q in saved
        ]
    mdb.users.insert_one(doc)
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": tok, "test_tag": TAG,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    for i in range(subs):
        mdb.push_subscriptions.insert_one({
            "user_id": uid,
            "endpoint": f"https://push.example/{TAG}/{uid}/{i}",
            "keys": {"p256dh": "x", "auth": "y"},
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


# --------------------------------------------------------------------------- #
# in-process harness (needed to monkeypatch mailer.send_email)
# --------------------------------------------------------------------------- #
_LOOP = None


def _run(coro):
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        _LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)


def _load_backend():
    for k, v in dotenv_values("/app/backend/.env").items():
        if v is not None:
            os.environ.setdefault(k, v)
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")
    # bind the motor client to the loop we will re-use for every _run()
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        _LOOP = asyncio.new_event_loop()
    asyncio.set_event_loop(_LOOP)


class TestMailerTemplates:
    """Unit-level render checks (report_digest_email_html was restored)."""

    def test_mention_email_html_renders(self):
        _load_backend()
        from mailer import mention_email_html
        html = mention_email_html(mentioner_name="Jane Skipper",
                                  snippet="@AlexQA hey <script>",
                                  app_url="https://app.example.com")
        assert "Jane Skipper" in html
        assert "You were mentioned" in html
        assert "https://app.example.com/feed" in html
        assert "<script>" not in html  # `<` escaped in the snippet

    def test_report_digest_email_html_restored(self):
        _load_backend()
        from mailer import report_digest_email_html
        html = report_digest_email_html(
            new_count=3, resolved_count=1, dismissed_count=2, open_total=4,
            oldest_open={"created_at": "2026-06-01T00:00:00+00:00", "reason": "spam <b>"},
            recent_open=[{"target_type": "post", "reason": "abuse",
                          "reporter_name": "TEST Rep",
                          "created_at": "2026-06-20T00:00:00+00:00"}],
            app_url="https://app.example.com",
        )
        assert "Reports queue — weekly digest" in html
        assert "TEST Rep" in html
        assert "&lt;b>" in html  # reason is HTML-escaped


class TestMentionEmailFallback:
    """Direct in-process calls to create_comment with mailer.send_email mocked."""

    @pytest.fixture(autouse=True)
    def harness(self, mdb, monkeypatch):
        _load_backend()
        import mailer
        from routers import community_router as cr
        from schemas import CommentCreate

        self.sent = []

        async def fake_send(**kw):
            self.sent.append(kw)
            return True

        monkeypatch.setattr(mailer, "send_email", fake_send)
        self.cr = cr
        self.CommentCreate = CommentCreate
        # commenter
        self.author_uid, self.author_tok = mk_user(mdb, name="TEST Commenter")
        self.post_id = mk_post(mdb, self.author_uid)
        yield

    def _comment(self, text):
        return _run(self.cr.create_comment(
            self.post_id, self.CommentCreate(body=text),
            session_token=self.author_tok, authorization=None,
        ))

    def test_a_no_subs_pref_absent_sends_email(self, mdb):
        uid, _ = mk_user(mdb, name="AlexQAalpha", subs=0)
        res = self._comment("@AlexQAalpha hey")
        assert uid in (res.get("mentioned_user_ids") or [])
        mine = [s for s in self.sent if uid.lower() in (s.get("recipient_email") or "").lower()]
        assert len(mine) == 1, f"expected 1 email, got {len(mine)} ({self.sent})"
        assert "mentioned you" in mine[0]["subject"]
        assert "TEST Commenter" in mine[0]["subject"]
        assert "You were mentioned" in mine[0]["html_content"]

    def test_a2_pref_mention_true_sends_email(self, mdb):
        uid, _ = mk_user(mdb, name="AlexQAtrue", subs=0,
                         prefs={"mention": True, "comment": False})
        self._comment("@AlexQAtrue ping")
        mine = [s for s in self.sent if uid.lower() in (s.get("recipient_email") or "").lower()]
        assert len(mine) == 1

    def test_b_with_push_subscription_no_email(self, mdb):
        uid, _ = mk_user(mdb, name="AlexQAbravo", subs=1)
        res = self._comment("@AlexQAbravo hey")
        assert uid in (res.get("mentioned_user_ids") or [])
        mine = [s for s in self.sent if uid.lower() in (s.get("recipient_email") or "").lower()]
        assert mine == [], f"email should be suppressed when push exists: {mine}"

    def test_c_mention_pref_false_no_email(self, mdb):
        uid, _ = mk_user(mdb, name="AlexQAcharlie", subs=0, prefs={"mention": False})
        res = self._comment("@AlexQAcharlie hey")
        assert uid in (res.get("mentioned_user_ids") or [])
        mine = [s for s in self.sent if uid.lower() in (s.get("recipient_email") or "").lower()]
        assert mine == [], f"mention=false must be silent: {mine}"

    def test_d_no_email_on_user_no_send(self, mdb):
        uid, _ = mk_user(mdb, name="AlexQAdelta", email=False, subs=0)
        res = self._comment("@AlexQAdelta hey")
        assert uid in (res.get("mentioned_user_ids") or [])
        assert self.sent == [], f"no recipient address -> no send: {self.sent}"

    def test_e_two_mentions_one_email_each(self, mdb):
        u1, _ = mk_user(mdb, name="AlexQAecho", subs=0)
        u2, _ = mk_user(mdb, name="BravoQAecho", subs=0)
        self._comment("@AlexQAecho and @BravoQAecho please read")
        for uid in (u1, u2):
            mine = [s for s in self.sent if uid.lower() in (s.get("recipient_email") or "").lower()]
            assert len(mine) == 1, f"{uid}: expected 1 email, got {len(mine)}"

    def test_f_self_mention_no_email(self, mdb):
        self._comment("@TEST hello myself")
        mine = [s for s in self.sent if self.author_uid.lower() in (s.get("recipient_email") or "").lower()]
        assert mine == []


# --------------------------------------------------------------------------- #
# HTTP regressions
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestHttpRegressions:
    def test_admin_analytics_admin_ok(self, client, mdb):
        _, tok = mk_user(mdb, name="TEST Admin34", admin=True)
        r = client.get(f"{API}/admin/analytics", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data, dict)
        assert "events" in data

    def test_admin_analytics_requires_admin(self, client, mdb):
        _, tok = mk_user(mdb, name="TEST Plain34")
        r = client.get(f"{API}/admin/analytics", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code in (401, 403), r.status_code

    def test_admin_digest_render_html(self, client, mdb):
        _, tok = mk_user(mdb, name="TEST Admin34b", admin=True)
        r = client.get(f"{API}/admin/digest/render", params={"market": MARKET},
                       headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text[:300]
        assert "text/html" in r.headers.get("content-type", "")
        assert "<html" in r.text.lower()

    def test_admin_digest_render_requires_admin(self, client):
        r = client.get(f"{API}/admin/digest/render", params={"market": MARKET})
        assert r.status_code in (401, 403)

    def test_resend_digest_webhook_ignores_unknown_type(self, client):
        r = client.post(f"{API}/webhooks/resend/digest",
                        json={"type": "email.sent", "data": {"to": ["x@y.dev"]}})
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

    def test_resend_digest_webhook_records_open(self, client, mdb):
        uid, _ = mk_user(mdb, name="TEST Digest34")
        u = mdb.users.find_one({"user_id": uid})
        stamp = "2026-07-05"
        mdb.users.update_one({"user_id": uid},
                             {"$set": {"digest_send_history": [stamp]}})
        r = client.post(f"{API}/webhooks/resend/digest",
                        json={"type": "email.opened",
                              "data": {"to": [u["email"]],
                                       "created_at": "2026-07-05T10:00:00Z"}})
        assert r.status_code == 200, r.text[:300]
        after = mdb.users.find_one({"user_id": uid}, {"_id": 0, "digest_engagement": 1})
        assert (after.get("digest_engagement") or {}).get(stamp, {}).get("opened_at")

    def test_search_suggestions_shape(self, client, mdb):
        mk_user(mdb, name="TEST Sug34a", saved=["spinnaker"])
        mk_user(mdb, name="TEST Sug34b", saved=["spinnaker"])
        r = client.get(f"{API}/searches/suggestions")
        assert r.status_code == 200, r.text[:300]
        sug = r.json().get("suggestions")
        assert isinstance(sug, list)
        for s in sug:
            assert isinstance(s.get("q"), str) and isinstance(s.get("count"), int)
