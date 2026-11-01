"""Phase F tests.

Covers:
  GET /api/posts                                  -> comment_count aggregation
  aggregator._strip_html                          -> HTML -> plain text
  server startup migration                        -> aggregator descriptions cleaned
  PATCH /api/admin/events/{id}/email-recipients   -> auth + validation + persistence
  POST /api/events/{id}/crew                      -> email fan-out / dedupe
  scheduler._sunday_digest_job                    -> market digest + idempotency

xdist-safe via RUN_PREFIX; full teardown of TEST_userF_* artifacts.
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

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

DB = "test_database"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw")
RUN_PREFIX = "TEST_userF_" + WORKER + "_"
MARKET = "Greater Seattle"
DIGEST_MARKET = "TEST_MarketF_" + WORKER


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_UserF",
              is_admin=False, market=MARKET, newsletter=False, digest_sent_at=None):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    dsa = "null" if digest_sent_at is None else f"'{digest_sent_at}'"
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'{account_type}',
      primary_market:'{market}', markets:['{market}'],
      onboarding_complete:true, subscription_tier:'{tier}',
      newsletter_opt_in:{'true' if newsletter else 'false'},
      digest_sent_at:{dsa},
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def make_event(market=MARKET, source="aggregator", description="TEST_F event",
               organizer_email=None, recipients=None, starts_in_days=5):
    eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
    starts = (datetime.now(timezone.utc) + timedelta(days=starts_in_days)).isoformat()
    oe = "null" if not organizer_email else f"'{organizer_email}'"
    rec = "null" if recipients is None else "[" + ",".join(f"'{r}'" for r in recipients) + "]"
    mongo(f"""
    db.events.insertOne({{id:'{eid}', source:'{source}', title:'TEST_F Event',
      description:'{description}', market:'{market}',
      starts_at:'{starts}', ends_at:null, location:'Shilshole',
      approved:true, organizer_id:null, organizer_name:'TEST_F Org',
      organizer_email:{oe}, email_recipients:{rec},
      created_at:new Date().toISOString()}});
    """)
    return eid


def make_event_raw(desc_js, market=MARKET, source="aggregator"):
    """Insert an event whose description is provided as a JS string literal."""
    eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
    starts = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    mongo(f"""
    db.events.insertOne({{id:'{eid}', source:'{source}', title:'TEST_F Event',
      description:{desc_js}, market:'{market}', starts_at:'{starts}',
      approved:true, created_at:new Date().toISOString()}});
    """)
    return eid


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
    var pids = db.posts.find({{author_id:{{$in:ids}}}},{{id:1}}).toArray().map(p=>p.id);
    db.comments.deleteMany({{post_id:{{$in:pids}}}});
    db.comments.deleteMany({{author_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.crew_bank.deleteMany({{user_id:{{$in:ids}}}});
    db.crew_bank_standalone.deleteMany({{user_id:{{$in:ids}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^{RUN_PREFIX}'}}}});
    """)


def make_post(client, tok, title="TEST_F post"):
    r = client.post(f"{BASE}/posts", json={
        "type": "sailing_opportunity", "title": title, "body": "TEST_F body",
        "market": MARKET, "allow_comments": True,
    }, headers=auth(tok))
    assert r.status_code == 200, r.text
    return r.json()


def find_post(client, pid, tok=None):
    r = client.get(f"{BASE}/posts", headers=auth(tok) if tok else None)
    assert r.status_code == 200, r.text
    docs = r.json()
    return docs, next((d for d in docs if d["id"] == pid), None)


# ---------- F.1 comment_count on GET /api/posts ----------
class TestCommentCount:
    def test_zero_comments_returns_zero_not_missing(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok, "TEST_F zero comments")
        docs, mine = find_post(client, post["id"], tok)
        assert mine is not None, "new post missing from feed"
        assert "comment_count" in mine, mine
        assert mine["comment_count"] == 0, mine["comment_count"]
        assert isinstance(mine["comment_count"], int)

    def test_all_docs_have_integer_comment_count(self, client):
        uid, tok = mint_user()
        make_post(client, tok, "TEST_F ensure docs")
        docs, _ = find_post(client, "n/a", tok)
        assert docs, "feed empty"
        missing = [d["id"] for d in docs if not isinstance(d.get("comment_count"), int)]
        assert not missing, f"docs without integer comment_count: {missing[:5]}"

    def test_count_reflects_three_comments(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok, "TEST_F three comments")
        for i in range(3):
            r = client.post(f"{BASE}/posts/{post['id']}/comments",
                            json={"body": f"TEST_F c{i}"}, headers=auth(tok))
            assert r.status_code == 200, r.text
        docs, mine = find_post(client, post["id"], tok)
        assert mine["comment_count"] == 3, mine

    def test_count_decrements_after_delete(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok, "TEST_F delete comment")
        c = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_F gone"}, headers=auth(tok)).json()
        _, mine = find_post(client, post["id"], tok)
        assert mine["comment_count"] == 1
        assert client.delete(f"{BASE}/comments/{c['id']}", headers=auth(tok)).status_code == 200
        _, mine = find_post(client, post["id"], tok)
        assert mine["comment_count"] == 0, mine


# ---------- F.2 _strip_html unit ----------
class TestStripHtml:
    @staticmethod
    def _strip(*args, **kwargs):
        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        from aggregator import _strip_html
        return _strip_html(*args, **kwargs)

    def test_anchor_br_and_p(self):
        raw = '<a href="https://x">REGISTER HERE</a><br>Line 2<br><p>Body</p>'
        out = self._strip(raw)
        assert "REGISTER HERE (https://x)" in out, out
        assert "<" not in out and ">" not in out, out
        assert "Line 2" in out and "Body" in out, out
        assert "\n" in out, repr(out)

    def test_empty_and_plain(self):
        assert self._strip("") == ""
        assert self._strip(None) == ""
        assert self._strip("plain text") == "plain text"

    def test_bare_href_anchor(self):
        out = self._strip('<a href="https://y.org">https://y.org</a>')
        assert out == "https://y.org", out

    def test_entities_decoded(self):
        out = self._strip("Race &amp; Rally &lt;fun&gt;")
        assert "&amp;" not in out, out
        assert "Race & Rally" in out, out

    def test_truncation_800(self):
        out = self._strip("<p>" + ("a" * 1200) + "</p>", max_len=800)
        assert len(out) <= 801, len(out)
        assert out.endswith("…"), out[-20:]

    def test_no_double_truncation_under_limit(self):
        body = "b" * 700
        out = self._strip(f"<p>{body}</p>", max_len=800)
        assert out == body, (len(out), out[:40])


# ---------- F.3 startup migration ----------
class TestStartupMigration:
    @pytest.mark.skipif(os.environ.get("SMN_ALLOW_RESTART") != "1",
                        reason="restarts backend; run with SMN_ALLOW_RESTART=1 -n 0 "
                               "(verified PASS in iteration_13)")
    def test_existing_aggregator_html_cleaned_on_restart(self, client):
        eid = make_event_raw("'<a href=\"https://z.io\">y</a><br>tail'")
        before = mongo(f"print(db.events.findOne({{id:'{eid}'}}).description);")
        assert "<a" in before, before
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, text=True, timeout=120)
        # wait for backend to come back up
        for _ in range(40):
            try:
                if client.get(f"{BASE}/events", timeout=10).status_code == 200:
                    break
            except Exception:
                pass
            import time
            time.sleep(2)
        after = mongo(f"print(db.events.findOne({{id:'{eid}'}}).description);")
        assert "<" not in after and ">" not in after, after
        assert "y (https://z.io)" in after, after
        assert "tail" in after, after

    def test_no_aggregator_event_has_html_left(self):
        n = mongo("print(db.events.countDocuments({source:'aggregator',"
                  "description:{$regex:'<[a-zA-Z][^>]*>'}}));")
        assert n.strip() == "0", f"{n} aggregator events still contain HTML"


# ---------- F.4 admin PATCH email-recipients ----------
class TestAdminRecipients:
    def test_anon_403(self, client):
        eid = make_event()
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": ["a@b.com"]})
        assert r.status_code == 403, (r.status_code, r.text)

    def test_non_admin_403(self, client):
        eid = make_event()
        uid, tok = mint_user()
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": ["a@b.com"]}, headers=auth(tok))
        assert r.status_code == 403, (r.status_code, r.text)

    def test_unknown_event_404(self, client):
        adm, t = mint_user(is_admin=True, name="TEST_F Admin")
        r = client.patch(f"{BASE}/admin/events/{uuid.uuid4().hex}/email-recipients",
                         json={"email_recipients": ["a@b.com"]}, headers=auth(t))
        assert r.status_code == 404, (r.status_code, r.text)

    @pytest.mark.parametrize("bad", ["nope", "has space@x.com", "x" * 250 + "@y.com"])
    def test_invalid_email_400(self, client, bad):
        eid = make_event()
        adm, t = mint_user(is_admin=True, name="TEST_F Admin")
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": [bad]}, headers=auth(t))
        assert r.status_code == 400, (bad, r.status_code, r.text)
        stored = mongo(f"print(JSON.stringify(db.events.findOne({{id:'{eid}'}}).email_recipients));")
        assert bad not in stored, stored

    def test_valid_saves_and_persists(self, client):
        eid = make_event()
        adm, t = mint_user(is_admin=True, name="TEST_F Admin")
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": [" ops@partner.org ", "captain@yacht.club"]},
                         headers=auth(t))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["event_id"] == eid
        assert body["email_recipients"] == ["ops@partner.org", "captain@yacht.club"], body
        stored = mongo(f"print(JSON.stringify(db.events.findOne({{id:'{eid}'}}).email_recipients));")
        assert "ops@partner.org" in stored and "captain@yacht.club" in stored, stored

    def test_empty_array_clears(self, client):
        eid = make_event(recipients=["old@x.com"])
        adm, t = mint_user(is_admin=True, name="TEST_F Admin")
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": []}, headers=auth(t))
        assert r.status_code == 200, r.text
        assert r.json()["email_recipients"] == []
        stored = mongo(f"print(JSON.stringify(db.events.findOne({{id:'{eid}'}}).email_recipients));")
        assert stored == "[]", stored


# ---------- F.5 crew join email fan-out ----------
def _run_join(event_id, token, positions=None):
    """Call the real join_event_crew endpoint in-process with send_email captured."""
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")
    for k, v in dotenv_values("/app/backend/.env").items():
        os.environ.setdefault(k, v)
    sent = []
    for mod in ("scheduler", "notifications", "mailer", "deps",
                "routers.community_router", "routers.reviews_router", "aggregator"):
        sys.modules.pop(mod, None)

    async def run():
        import routers.community_router as cr
        from schemas import CrewBankJoin

        async def fake(**kwargs):
            sent.append(kwargs)
            return {"status": "skipped"}

        cr.send_email = fake
        await cr.join_event_crew(
            event_id,
            CrewBankJoin(positions=positions or ["Railmeat"], experience="TEST_F exp",
                         notes="TEST_F notes", contact_via="in-app", post_to_feed=False),
            session_token=None,
            authorization=f"Bearer {token}",
        )
        await asyncio.sleep(1.5)  # let fire-and-forget email task finish

    asyncio.run(run())
    return sent


class TestCrewJoinFanout:
    def test_recipients_only_two_sends(self, client):
        eid = make_event(recipients=["ops@partner.org", "captain@yacht.club"])
        uid, tok = mint_user(tier="premium", name="TEST_F Joiner")
        sent = _run_join(eid, tok)
        to = sorted(m["recipient_email"] for m in sent)
        assert to == ["captain@yacht.club", "ops@partner.org"], sent
        assert all("TEST_F Event" in m["subject"] for m in sent), sent

    def test_organizer_plus_recipients_dedupe(self, client):
        eid = make_event(organizer_email="Ops@Partner.org",
                         recipients=["ops@partner.org", "captain@yacht.club"])
        uid, tok = mint_user(tier="premium", name="TEST_F Joiner2")
        sent = _run_join(eid, tok)
        to = [m["recipient_email"] for m in sent]
        assert len(to) == 2, to
        assert len({t.lower() for t in to}) == 2, to
        assert "captain@yacht.club" in to, to

    def test_no_recipients_no_email(self, client):
        eid = make_event()
        uid, tok = mint_user(tier="premium", name="TEST_F Joiner3")
        sent = _run_join(eid, tok)
        assert sent == [], sent

    def test_organizer_email_only_regression(self, client):
        eid = make_event(organizer_email="skipper@club.org", recipients=None)
        uid, tok = mint_user(tier="premium", name="TEST_F Joiner4")
        sent = _run_join(eid, tok)
        assert [m["recipient_email"] for m in sent] == ["skipper@club.org"], sent

    def test_crew_join_api_still_works(self, client):
        eid = make_event(recipients=["ops@partner.org"])
        uid, tok = mint_user(tier="premium", name="TEST_F ApiJoiner")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "contact_via": "in-app",
                              "post_to_feed": False}, headers=auth(tok))
        assert r.status_code == 200, r.text
        lst = client.get(f"{BASE}/events/{eid}/crew", headers=auth(tok))
        assert lst.status_code == 200, lst.text
        assert lst.json()["count"] >= 1, lst.json()

    def test_free_user_402(self, client):
        eid = make_event()
        uid, tok = mint_user(tier="free", name="TEST_F Free")
        r = client.post(f"{BASE}/events/{eid}/crew",
                        json={"positions": ["Railmeat"], "contact_via": "in-app"},
                        headers=auth(tok))
        assert r.status_code == 402, (r.status_code, r.text)


# ---------- F.6 Sunday digest scheduler ----------
def _run_digest():
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")
    for k, v in dotenv_values("/app/backend/.env").items():
        os.environ.setdefault(k, v)
    sent = []
    for mod in ("scheduler", "notifications", "mailer", "deps",
                "routers.community_router", "routers.reviews_router", "aggregator"):
        sys.modules.pop(mod, None)

    async def run():
        import mailer
        import scheduler as sched
        from deps import db as mdb

        async def fake(**kwargs):
            sent.append(kwargs)
            return {"status": "skipped"}

        orig = mailer.send_email
        mailer.send_email = fake
        try:
            await sched._sunday_digest_job(mdb)
        finally:
            mailer.send_email = orig

    asyncio.run(run())
    return sent


class TestSundayDigest:
    @staticmethod
    def _seed_market_content(market):
        """One fresh event in the market so the digest is non-empty."""
        starts = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
        mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
          title:'TEST_F Digest Regatta', market:'{market}', starts_at:'{starts}',
          location:'Shilshole', approved:true,
          created_at:new Date().toISOString(), description:'TEST_F'}});""")
        return eid

    def _mine(self, sent, uid):
        return [m for m in sent if uid in (m.get("recipient_email") or "")]

    def test_opted_in_user_emailed_once_and_idempotent(self, client):
        self._seed_market_content(DIGEST_MARKET)
        uid, tok = mint_user(market=DIGEST_MARKET, newsletter=True, name="TEST_F Digest")
        sent = self._mine(_run_digest(), uid)
        assert len(sent) == 1, sent
        assert f"Sunday digest — {DIGEST_MARKET}" in sent[0]["subject"], sent[0]["subject"]
        assert "TEST_F Digest Regatta" in sent[0]["html_content"]
        flag = mongo(f"print(db.users.findOne({{user_id:'{uid}'}}).digest_sent_at);")
        assert flag and flag not in ("null", "undefined", ""), flag
        # second back-to-back run -> not resent
        again = self._mine(_run_digest(), uid)
        assert again == [], again

    def test_stale_digest_sent_at_resends(self, client):
        self._seed_market_content(DIGEST_MARKET)
        old = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        uid, tok = mint_user(market=DIGEST_MARKET, newsletter=True,
                            name="TEST_F Stale", digest_sent_at=old)
        sent = self._mine(_run_digest(), uid)
        assert len(sent) == 1, sent

    def test_recent_digest_sent_at_not_resent(self, client):
        self._seed_market_content(DIGEST_MARKET)
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        uid, tok = mint_user(market=DIGEST_MARKET, newsletter=True,
                            name="TEST_F Recent", digest_sent_at=recent)
        assert self._mine(_run_digest(), uid) == []

    def test_opt_out_skipped(self, client):
        self._seed_market_content(DIGEST_MARKET)
        uid, tok = mint_user(market=DIGEST_MARKET, newsletter=False, name="TEST_F OptOut")
        assert self._mine(_run_digest(), uid) == []
        flag = mongo(f"print(db.users.findOne({{user_id:'{uid}'}}).digest_sent_at);")
        assert flag in ("null", "undefined", ""), flag

    def test_empty_digest_skipped_and_flag_untouched(self, client):
        empty_market = "TEST_MarketF_empty_" + WORKER + uuid.uuid4().hex[:4]
        uid, tok = mint_user(market=empty_market, newsletter=True, name="TEST_F Empty")
        assert self._mine(_run_digest(), uid) == []
        flag = mongo(f"print(db.users.findOne({{user_id:'{uid}'}}).digest_sent_at);")
        assert flag in ("null", "undefined", ""), f"digest_sent_at flipped on empty digest: {flag}"


# ---------- Regression ----------
class TestRegression:
    def test_seed_alex_identity_verified(self):
        out = mongo("print(JSON.stringify(db.users.findOne({email:'crew.alex@sailmorenow.dev'},"
                    "{identity_verified:1,_id:0})));")
        assert '"identity_verified":true' in out.replace(" ", ""), out

    def test_core_endpoints_ok(self, client):
        for path in ("/posts", "/events", "/boat-pros?market=Greater+Seattle"):
            r = client.get(f"{BASE}{path}")
            assert r.status_code == 200, (path, r.status_code, r.text[:200])

    def test_no_mongo_id_leak_in_posts(self, client):
        docs = client.get(f"{BASE}/posts").json()
        assert all("_id" not in d for d in docs)
