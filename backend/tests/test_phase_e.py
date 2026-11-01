"""Phase E tests: threaded post comments + 24h mutual-review reminder emails.

Covers:
  GET  /api/posts/{id}/comments
  POST /api/posts/{id}/comments   (auth, validation, allow_comments, threading, notifications)
  DELETE /api/comments/{id}       (auth, ownership, admin, cascade)
  scheduler._nightly_job step 5   (review reminder emails, idempotency)

xdist-safe via RUN_PREFIX; full teardown of TEST_userE_* artifacts.
"""
import os
import re
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
RUN_PREFIX = "TEST_userE_" + os.environ.get("PYTEST_XDIST_WORKER", "gw") + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint_user(account_type="sailor", tier="premium", name="TEST_UserE", is_admin=False):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'{account_type}',
      primary_market:'{MARKET}', markets:['{MARKET}'],
      onboarding_complete:true, subscription_tier:'{tier}',
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
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
    var pids = db.posts.find({{author_id:{{$in:ids}}}},{{id:1}}).toArray().map(p=>p.id);
    var sids = db.review_sessions.find({{'participants.user_id':{{$in:ids}}}},{{id:1}}).toArray().map(s=>s.id);
    db.comments.deleteMany({{post_id:{{$in:pids}}}});
    db.comments.deleteMany({{author_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.mutual_reviews.deleteMany({{session_id:{{$in:sids}}}});
    db.review_sessions.deleteMany({{id:{{$in:sids}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def make_post(client, tok, allow_comments=True, title="TEST_E post"):
    r = client.post(f"{BASE}/posts", json={
        "type": "sailing_opportunity", "title": title, "body": "TEST_E body",
        "market": MARKET, "allow_comments": allow_comments,
    }, headers=auth(tok))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- E.1 GET comments ----------
class TestListComments:
    def test_empty_list_for_new_post(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        r = client.get(f"{BASE}/posts/{post['id']}/comments")
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_unknown_post_returns_200_empty(self, client):
        r = client.get(f"{BASE}/posts/{uuid.uuid4().hex}/comments")
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_no_mongo_id_leak_and_ordering(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        for i in range(3):
            r = client.post(f"{BASE}/posts/{post['id']}/comments",
                            json={"body": f"TEST_E c{i}"}, headers=auth(tok))
            assert r.status_code == 200, r.text
        items = client.get(f"{BASE}/posts/{post['id']}/comments").json()
        assert len(items) == 3, items
        assert all("_id" not in c for c in items)
        assert [c["body"] for c in items] == ["TEST_E c0", "TEST_E c1", "TEST_E c2"]


# ---------- E.2 POST comments validation ----------
class TestCreateCommentValidation:
    def test_anon_401(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        r = client.post(f"{BASE}/posts/{post['id']}/comments", json={"body": "hi"})
        assert r.status_code == 401, r.text

    def test_empty_body_400(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        for bad in ("", "   ", "\n\t "):
            r = client.post(f"{BASE}/posts/{post['id']}/comments",
                            json={"body": bad}, headers=auth(tok))
            assert r.status_code == 400, (bad, r.status_code, r.text)

    def test_too_long_400(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        r = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "x" * 2001}, headers=auth(tok))
        assert r.status_code == 400, r.text
        # exactly 2000 is accepted
        r2 = client.post(f"{BASE}/posts/{post['id']}/comments",
                         json={"body": "y" * 2000}, headers=auth(tok))
        assert r2.status_code == 200, r2.text

    def test_unknown_post_404(self, client):
        uid, tok = mint_user()
        r = client.post(f"{BASE}/posts/{uuid.uuid4().hex}/comments",
                        json={"body": "TEST_E hi"}, headers=auth(tok))
        assert r.status_code == 404, r.text

    def test_comments_disabled_403(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok, allow_comments=False)
        assert post["allow_comments"] is False, post
        r = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E hi"}, headers=auth(tok))
        assert r.status_code == 403, r.text

    def test_bad_parent_id_404(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        r = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E hi", "parent_id": uuid.uuid4().hex},
                        headers=auth(tok))
        assert r.status_code == 404, r.text

    def test_parent_from_other_post_404(self, client):
        uid, tok = mint_user()
        p1 = make_post(client, tok, title="TEST_E p1")
        p2 = make_post(client, tok, title="TEST_E p2")
        c = client.post(f"{BASE}/posts/{p1['id']}/comments",
                        json={"body": "TEST_E root"}, headers=auth(tok)).json()
        r = client.post(f"{BASE}/posts/{p2['id']}/comments",
                        json={"body": "TEST_E cross", "parent_id": c["id"]},
                        headers=auth(tok))
        assert r.status_code == 404, r.text


# ---------- E.3 POST comments happy path + notifications ----------
class TestCreateComment:
    def test_creates_doc_with_author_fields(self, client):
        owner, t_owner = mint_user("boat_owner", name="TEST_E Owner")
        author, t_author = mint_user("sailor", name="TEST_E Commenter")
        post = make_post(client, t_owner)
        r = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "  TEST_E first comment  "}, headers=auth(t_author))
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["body"] == "TEST_E first comment"  # trimmed
        assert c["post_id"] == post["id"]
        assert c["parent_id"] is None
        assert c["author_id"] == author
        assert c["author_name"] == "TEST_E Commenter"
        assert c["author_account_type"] == "sailor"
        assert c["author_avatar"]
        assert isinstance(c["id"], str) and c["created_at"]
        assert "_id" not in c
        # persisted
        got = client.get(f"{BASE}/posts/{post['id']}/comments").json()
        assert [x["id"] for x in got] == [c["id"]]

    def test_notifies_post_author(self, client):
        owner, t_owner = mint_user("boat_owner", name="TEST_E Owner2")
        author, t_author = mint_user("sailor", name="TEST_E Commenter2")
        post = make_post(client, t_owner, title="TEST_E notify post")
        c = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E ping"}, headers=auth(t_author)).json()
        n = client.get(f"{BASE}/notifications", headers=auth(t_owner)).json()
        m = [x for x in n["items"] if x["kind"] == "comment"
             and x.get("meta", {}).get("comment_id") == c["id"]]
        assert m, n
        assert "TEST_E Commenter2" in m[0]["title"]
        assert m[0]["meta"]["post_id"] == post["id"]
        assert m[0]["link"] == "/feed"

    def test_no_self_notification(self, client):
        owner, t_owner = mint_user("boat_owner", name="TEST_E Solo")
        post = make_post(client, t_owner, title="TEST_E self post")
        c = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E mine"}, headers=auth(t_owner)).json()
        n = client.get(f"{BASE}/notifications", headers=auth(t_owner)).json()
        m = [x for x in n["items"] if x["kind"] == "comment"
             and x.get("meta", {}).get("comment_id") == c["id"]]
        assert not m, f"self-notified: {m}"

    def test_nested_reply_notifies_parent_author_and_post_author(self, client):
        owner, t_owner = mint_user("boat_owner", name="TEST_E POwner")
        first, t_first = mint_user("sailor", name="TEST_E First")
        second, t_second = mint_user("sailor", name="TEST_E Second")
        post = make_post(client, t_owner, title="TEST_E thread post")
        root = client.post(f"{BASE}/posts/{post['id']}/comments",
                           json={"body": "TEST_E root"}, headers=auth(t_first)).json()
        reply = client.post(f"{BASE}/posts/{post['id']}/comments",
                            json={"body": "TEST_E reply", "parent_id": root["id"]},
                            headers=auth(t_second))
        assert reply.status_code == 200, reply.text
        rc = reply.json()
        assert rc["parent_id"] == root["id"]

        # post author notified
        n_owner = client.get(f"{BASE}/notifications", headers=auth(t_owner)).json()
        assert [x for x in n_owner["items"] if x.get("meta", {}).get("comment_id") == rc["id"]]
        # parent comment author notified with reply wording
        n_first = client.get(f"{BASE}/notifications", headers=auth(t_first)).json()
        pm = [x for x in n_first["items"] if x.get("meta", {}).get("comment_id") == rc["id"]]
        assert pm, n_first
        assert "replied" in pm[0]["title"].lower(), pm[0]

    def test_reply_to_own_post_comment_no_duplicate(self, client):
        """Post author replies to a comment on their own post -> commenter gets 1 notification."""
        owner, t_owner = mint_user("boat_owner", name="TEST_E DupOwner")
        other, t_other = mint_user("sailor", name="TEST_E DupCommenter")
        post = make_post(client, t_owner, title="TEST_E dup post")
        root = client.post(f"{BASE}/posts/{post['id']}/comments",
                           json={"body": "TEST_E root"}, headers=auth(t_other)).json()
        reply = client.post(f"{BASE}/posts/{post['id']}/comments",
                            json={"body": "TEST_E owner reply", "parent_id": root["id"]},
                            headers=auth(t_owner)).json()
        n = client.get(f"{BASE}/notifications", headers=auth(t_other)).json()
        m = [x for x in n["items"] if x.get("meta", {}).get("comment_id") == reply["id"]]
        assert len(m) == 1, m


# ---------- E.4 DELETE comments ----------
class TestDeleteComment:
    def test_anon_401(self, client):
        uid, tok = mint_user()
        post = make_post(client, tok)
        c = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E del"}, headers=auth(tok)).json()
        r = client.delete(f"{BASE}/comments/{c['id']}")
        assert r.status_code == 401, r.text

    def test_unknown_404(self, client):
        uid, tok = mint_user()
        r = client.delete(f"{BASE}/comments/{uuid.uuid4().hex}", headers=auth(tok))
        assert r.status_code == 404, r.text

    def test_non_author_403(self, client):
        a, ta = mint_user()
        b, tb = mint_user()
        post = make_post(client, ta)
        c = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E mine"}, headers=auth(ta)).json()
        r = client.delete(f"{BASE}/comments/{c['id']}", headers=auth(tb))
        assert r.status_code == 403, r.text
        assert len(client.get(f"{BASE}/posts/{post['id']}/comments").json()) == 1

    def test_author_deletes_and_cascades_replies(self, client):
        a, ta = mint_user()
        b, tb = mint_user()
        post = make_post(client, ta)
        root = client.post(f"{BASE}/posts/{post['id']}/comments",
                          json={"body": "TEST_E root"}, headers=auth(ta)).json()
        rep1 = client.post(f"{BASE}/posts/{post['id']}/comments",
                          json={"body": "TEST_E rep1", "parent_id": root["id"]},
                          headers=auth(tb)).json()
        keep = client.post(f"{BASE}/posts/{post['id']}/comments",
                           json={"body": "TEST_E keep"}, headers=auth(tb)).json()
        assert len(client.get(f"{BASE}/posts/{post['id']}/comments").json()) == 3
        r = client.delete(f"{BASE}/comments/{root['id']}", headers=auth(ta))
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        left = client.get(f"{BASE}/posts/{post['id']}/comments").json()
        ids = [x["id"] for x in left]
        assert root["id"] not in ids
        assert rep1["id"] not in ids, "direct reply not cascade-deleted"
        assert keep["id"] in ids

    def test_admin_can_delete_others(self, client):
        a, ta = mint_user()
        adm, t_adm = mint_user("sailor", name="TEST_E Admin", is_admin=True)
        post = make_post(client, ta)
        c = client.post(f"{BASE}/posts/{post['id']}/comments",
                        json={"body": "TEST_E moderated"}, headers=auth(ta)).json()
        r = client.delete(f"{BASE}/comments/{c['id']}", headers=auth(t_adm))
        assert r.status_code == 200, r.text
        assert client.get(f"{BASE}/posts/{post['id']}/comments").json() == []


# ---------- E.5 Review reminder emails in nightly scheduler ----------
class TestReviewReminder:
    def _make_pending_session(self, client, age_hours=25, reveal_offset_hours=-1):
        a, ta = mint_user("sailor", name="TEST_E RemSailor")
        b, tb = mint_user("boat_pro", name="TEST_E RemPro")
        r = client.post(f"{BASE}/review-sessions",
                        json={"relationship": "customer_pro", "counterparty_id": b,
                              "context_note": "TEST_E reminder"}, headers=auth(ta))
        assert r.status_code == 200, r.text
        s = r.json()
        created = (datetime.now(timezone.utc) - timedelta(hours=age_hours)).isoformat()
        reveal = (datetime.now(timezone.utc) + timedelta(hours=reveal_offset_hours)).isoformat()
        mongo(f"db.review_sessions.updateOne({{id:'{s['id']}'}},"
              f"{{$set:{{created_at:'{created}', reveal_at:'{reveal}'}}}});")
        return a, ta, b, tb, s

    @staticmethod
    def _run_nightly():
        """Run scheduler._nightly_job with mailer.send_email captured. Returns sent list."""
        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        for k, v in dotenv_values("/app/backend/.env").items():
            os.environ.setdefault(k, v)
        sent = []
        # Fresh imports each call: motor clients bind to the loop of first use, and each
        # asyncio.run() creates (and closes) a new loop.
        for mod in ("scheduler", "notifications", "mailer", "deps",
                    "routers.reviews_router"):
            sys.modules.pop(mod, None)

        async def run():
            import mailer
            import scheduler as sched
            from deps import db as mdb

            orig = mailer.send_email

            async def fake(**kwargs):
                sent.append(kwargs)
                return await orig(**kwargs)

            mailer.send_email = fake
            try:
                await sched._nightly_job(mdb)
            finally:
                mailer.send_email = orig

        asyncio.run(run())
        return sent

    def test_reminder_sent_once_and_idempotent(self, client):
        a, ta, b, tb, s = self._make_pending_session(client)
        sent = self._run_nightly()
        mine = [m for m in sent if a in (m.get("recipient_email") or "")
                or b in (m.get("recipient_email") or "")]
        assert len(mine) == 2, f"expected 2 reminder emails, got {mine} (all={len(sent)})"
        for m in mine:
            assert "left to rate" in m["subject"], m["subject"]
            assert "TEST_E Rem" in m["subject"], m["subject"]
            assert "/reviews" in m["html_content"]
        # marker set
        marked = mongo(f"print(db.review_sessions.findOne({{id:'{s['id']}'}}).reminder_sent_at);")
        assert marked and marked != "null" and "undefined" not in marked, marked
        # idempotent re-run
        sent2 = self._run_nightly()
        mine2 = [m for m in sent2 if a in (m.get("recipient_email") or "")
                 or b in (m.get("recipient_email") or "")]
        assert mine2 == [], f"reminder resent: {mine2}"

    def test_hours_left_in_subject(self, client):
        a, ta, b, tb, s = self._make_pending_session(client, age_hours=26,
                                                     reveal_offset_hours=22)
        sent = self._run_nightly()
        mine = [m for m in sent if a in (m.get("recipient_email") or "")]
        assert mine, sent
        subj = mine[0]["subject"]
        assert "left to rate" in subj, subj
        hrs = int(re.search(r"(\d+)h left to rate", subj).group(1))
        assert hrs in (21, 22), subj

    def test_submitted_side_not_emailed(self, client):
        a, ta, b, tb, s = self._make_pending_session(client, reveal_offset_hours=10)
        r = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                        json={"ratings": {k: 4 for k in
                                          ["personality", "skill", "promptness",
                                           "communication", "safety"]},
                              "comment": "TEST_E submitted"}, headers=auth(ta))
        assert r.status_code == 200, r.text
        sent = self._run_nightly()
        to_a = [m for m in sent if a in (m.get("recipient_email") or "")]
        to_b = [m for m in sent if b in (m.get("recipient_email") or "")]
        assert to_a == [], f"emailed the submitter: {to_a}"
        assert len(to_b) == 1, to_b

    def test_recent_session_not_reminded(self, client):
        a, ta, b, tb, s = self._make_pending_session(client, age_hours=2,
                                                     reveal_offset_hours=46)
        sent = self._run_nightly()
        mine = [m for m in sent if a in (m.get("recipient_email") or "")
                or b in (m.get("recipient_email") or "")]
        assert mine == [], f"reminded a <24h session: {mine}"
        marker = mongo(f"print(db.review_sessions.findOne({{id:'{s['id']}'}}).reminder_sent_at);")
        assert marker in ("null", "undefined", ""), marker
    # iteration_12: race-safety — reminder_sent_at must be claimed BEFORE send_email
    def test_reminder_claim_before_send_race_safe(self, client):
        """One submitted / one pending, 25h old, reveal still ahead.

        (reveal_at in the past + >=1 submission auto-reveals in step 4, which
        legitimately removes the session from the reminder query, so we keep
        reveal_at in the future to exercise the reminder path.)

        Run 1: send_email raises. The claim must still be persisted (proving the
        conditional update happens before the send), so run 2 sends nothing.
        """
        a, ta, b, tb, s = self._make_pending_session(client, age_hours=25,
                                                     reveal_offset_hours=10)
        r = client.post(f"{BASE}/review-sessions/{s['id']}/submit",
                        json={"ratings": {k: 5 for k in
                                          ["personality", "skill", "promptness",
                                           "communication", "safety"]},
                              "comment": "TEST_E race submitted"}, headers=auth(ta))
        assert r.status_code == 200, r.text

        calls = self._run_nightly_boom()
        assert len(calls) == 1, f"expected exactly 1 send attempt, got {calls}"
        assert b in (calls[0].get("recipient_email") or ""), calls
        marked = mongo(f"print(db.review_sessions.findOne({{id:'{s['id']}'}}).reminder_sent_at);")
        assert marked and marked not in ("null", "undefined", ""), (
            f"reminder_sent_at not claimed before send: {marked}")

        sent2 = self._run_nightly()
        mine2 = [m for m in sent2 if a in (m.get("recipient_email") or "")
                 or b in (m.get("recipient_email") or "")]
        assert mine2 == [], f"second run re-sent reminder: {mine2}"

    @staticmethod
    def _run_nightly_boom():
        """Run _nightly_job with send_email replaced by a raising counter."""
        if "/app/backend" not in sys.path:
            sys.path.insert(0, "/app/backend")
        for k, v in dotenv_values("/app/backend/.env").items():
            os.environ.setdefault(k, v)
        calls = []
        for mod in ("scheduler", "notifications", "mailer", "deps",
                    "routers.reviews_router"):
            sys.modules.pop(mod, None)

        async def run():
            import mailer
            import scheduler as sched
            from deps import db as mdb

            orig = mailer.send_email

            async def boom(**kwargs):
                calls.append(kwargs)
                raise RuntimeError("TEST_E simulated SMTP failure")

            mailer.send_email = boom
            try:
                await sched._nightly_job(mdb)
            finally:
                mailer.send_email = orig

        asyncio.run(run())
        return calls




# ---------- Regression spot checks ----------
class TestRegression:
    def test_seed_alex_identity_verified(self, client):
        out = mongo("print(JSON.stringify(db.users.findOne({email:'crew.alex@sailmorenow.dev'},"
                    "{identity_verified:1,_id:0})));")
        assert '"identity_verified":true' in out.replace(" ", ""), out

    def test_posts_feed_ok(self, client):
        r = client.get(f"{BASE}/posts")
        assert r.status_code == 200, r.text

    def test_reviews_endpoints_ok(self, client):
        uid, tok = mint_user()
        r = client.get(f"{BASE}/review-sessions/mine", headers=auth(tok))
        assert r.status_code == 200, r.text
