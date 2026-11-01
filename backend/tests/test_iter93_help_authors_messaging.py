"""Iter 93 — backend regression for:
TASK 1 — Help & support contact form (POST /support/contact signed-in, POST /contact public)
TASK 3 — author_handle on /api/posts, /api/posts/{id}/comments, /api/discussions, /api/discussions/{id}
TASK 4 — DELETE /api/messages/item/{message_id}?scope=me|everyone; list_messages filters deleted_for
         ; broadcast message.deleted via ws; sender-only for everyone
         ; block via /api/follows/block/{id}
Uses only the shared backend (REACT_APP_BACKEND_URL).
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "")
STRONG_PW = "Hunter2!pass"


def _reg_user(role="boat_owner"):
    """Register a fresh (free) end-user and return (session_token, user dict)."""
    uniq = uuid.uuid4().hex[:8]
    payload = {
        "first_name": "TEST", "last_name": f"Iter93 {uniq}",
        "email": f"test.iter93.{uniq}@example.com",
        "password": STRONG_PW,
        "account_type": role,
        "primary_market": "Greater Seattle",
        "agreed_to_guidelines": True,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=20)
    assert r.status_code == 200, f"register failed {r.status_code} {r.text}"
    j = r.json()
    return j["session_token"], j["user"]


def _login_admin():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    return j["session_token"], j["user"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ----------------------------- TASK 1 — Help / contact -----------------------------
class TestTask1HelpContact:
    def test_public_contact_requires_fields(self):
        r = requests.post(f"{API}/contact", json={"name": "", "email": "a@b.co", "message": "short"}, timeout=20)
        assert r.status_code == 400

    def test_public_contact_valid(self):
        payload = {"name": "TEST Iter93", "email": "test93+pub@example.com",
                   "subject": "General question",
                   "message": "This is a TEST message from iter93 regression."}
        r = requests.post(f"{API}/contact", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_support_contact_requires_auth(self):
        r = requests.post(f"{API}/support/contact",
                          json={"subject": "x", "message": "hello world test"}, timeout=20)
        assert r.status_code == 401

    def test_support_contact_signed_in(self):
        tok, _ = _reg_user()
        r = requests.post(f"{API}/support/contact", headers=_hdr(tok),
                          json={"subject": "TEST Iter93 subject",
                                "message": "This is a TEST support message from iter93."}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_support_contact_bad_subject(self):
        tok, _ = _reg_user()
        r = requests.post(f"{API}/support/contact", headers=_hdr(tok),
                          json={"subject": "", "message": "This is a TEST message long enough"}, timeout=20)
        assert r.status_code == 400


# ----------------------------- TASK 3 — author_handle -----------------------------
class TestTask3AuthorHandle:
    def test_posts_include_author_handle(self):
        tok, _ = _login_admin()  # admin acts as premium
        # Create a post (required: type, title, body, market)
        r = requests.post(f"{API}/posts", headers=_hdr(tok),
                          json={"type": "general",
                                "title": "TEST iter93 feed post " + uuid.uuid4().hex[:6],
                                "body": "TEST iter93 body",
                                "market": "Greater Seattle"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        # List posts and look for author_handle on at least one row
        r = requests.get(f"{API}/posts", headers=_hdr(tok), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) > 0
        has_handle = any(("author_handle" in p) for p in rows[:20])
        assert has_handle, "Expected at least one post row to carry author_handle"

    def test_post_comments_include_author_handle(self):
        tok, me = _login_admin()
        r = requests.post(f"{API}/posts", headers=_hdr(tok),
                          json={"type": "general",
                                "title": "TEST iter93 comments-root " + uuid.uuid4().hex[:6],
                                "body": "root body",
                                "market": "Greater Seattle"}, timeout=20)
        post_id = r.json().get("id") or r.json().get("post_id")
        assert post_id, r.text
        r = requests.post(f"{API}/posts/{post_id}/comments", headers=_hdr(tok),
                          json={"body": "TEST iter93 comment"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        r = requests.get(f"{API}/posts/{post_id}/comments", timeout=20)
        assert r.status_code == 200
        cs = r.json()
        assert cs, "no comments returned"
        assert "author_handle" in cs[0], f"comment missing author_handle: {cs[0]}"
        # The handle should match the admin's handle if present
        if me.get("handle"):
            assert cs[0]["author_handle"] == me["handle"]

    def test_discussions_include_author_handle(self):
        tok, _ = _login_admin()
        # Create a discussion (hub forum). Required: kind, title, body
        r = requests.post(f"{API}/discussions", headers=_hdr(tok),
                          json={"kind": "forum", "title": "TEST iter93 disc " + uuid.uuid4().hex[:6],
                                "body": "body", "market": "Greater Seattle"}, timeout=20)
        if r.status_code not in (200, 201):
            pytest.skip(f"discussions POST not supported here: {r.status_code} {r.text}")
        disc_id = r.json().get("id") or r.json().get("disc_id")
        r = requests.get(f"{API}/discussions", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        has_handle = any(("author_handle" in d) for d in rows[:20])
        assert has_handle, "list_discussions didn't carry author_handle"
        if disc_id:
            r = requests.get(f"{API}/discussions/{disc_id}", timeout=20)
            assert r.status_code == 200
            assert "author_handle" in r.json(), r.text


# ----------------------------- TASK 4 — Messaging delete -----------------------------
class TestTask4Messaging:
    @classmethod
    def setup_class(cls):
        # Sender = admin (paid, can DM). Recipient = fresh free user (they just receive).
        cls.tok_a, cls.user_a = _login_admin()
        cls.tok_b, cls.user_b = _reg_user()

    def _send(self, tok, to_id, body):
        r = requests.post(f"{API}/messages/{to_id}", headers=_hdr(tok),
                          json={"body": body}, timeout=20)
        return r

    def test_send_then_list(self):
        r = self._send(self.tok_a, self.user_b["user_id"], "TEST iter93 msg1")
        assert r.status_code in (200, 201, 402), r.text
        if r.status_code == 402:
            pytest.skip("admin lacks DM entitlement in this env")
        thread_id = r.json().get("thread_id") or r.json().get("id")
        # list for sender
        # find thread_id from threads list if not returned
        if not thread_id:
            rl = requests.get(f"{API}/messages/threads", headers=_hdr(self.tok_a), timeout=20)
            threads = rl.json()
            # find thread with participant b
            for t in threads:
                if self.user_b["user_id"] in (t.get("participants") or []):
                    thread_id = t.get("thread_id")
                    break
        assert thread_id, "no thread_id resolved"
        r = requests.get(f"{API}/messages/{thread_id}", headers=_hdr(self.tok_a), timeout=20)
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 1
        self.__class__.thread_id = thread_id
        self.__class__.msg_id = msgs[-1]["id"]

    def test_delete_for_me_hides_only_for_caller(self):
        if not hasattr(self.__class__, "msg_id"):
            pytest.skip("prior send step was skipped")
        mid = self.__class__.msg_id
        tid = self.__class__.thread_id
        r = requests.delete(f"{API}/messages/item/{mid}?scope=me", headers=_hdr(self.tok_a), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("scope") == "me"
        # Caller (a) should no longer see it
        r = requests.get(f"{API}/messages/{tid}", headers=_hdr(self.tok_a), timeout=20)
        assert r.status_code == 200
        ids_a = [m["id"] for m in r.json()]
        assert mid not in ids_a, "message still visible to deleter"
        # Recipient (b) should still see it
        r = requests.get(f"{API}/messages/{tid}", headers=_hdr(self.tok_b), timeout=20)
        assert r.status_code == 200
        ids_b = [m["id"] for m in r.json()]
        assert mid in ids_b, "message disappeared for other participant too (should only be delete-for-me)"

    def test_delete_for_everyone_sender_only(self):
        # Send a 2nd message, then test "everyone" scope paths.
        r = self._send(self.tok_a, self.user_b["user_id"], "TEST iter93 msg2 for everyone")
        if r.status_code == 402:
            pytest.skip("admin lacks DM entitlement in this env")
        assert r.status_code in (200, 201), r.text
        tid = self.__class__.thread_id
        # list to grab the new id
        r2 = requests.get(f"{API}/messages/{tid}", headers=_hdr(self.tok_a), timeout=20)
        new_id = r2.json()[-1]["id"]
        # recipient tries "everyone" -> should 403
        r = requests.delete(f"{API}/messages/item/{new_id}?scope=everyone", headers=_hdr(self.tok_b), timeout=20)
        assert r.status_code == 403, f"expected 403 for non-sender everyone, got {r.status_code} {r.text}"
        # sender does "everyone" -> ok; body cleared; both see the row (with empty body)
        r = requests.delete(f"{API}/messages/item/{new_id}?scope=everyone", headers=_hdr(self.tok_a), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("scope") == "everyone"
        for tok_label, tok in [("a", self.tok_a), ("b", self.tok_b)]:
            msgs = requests.get(f"{API}/messages/{tid}", headers=_hdr(tok), timeout=20).json()
            match = [m for m in msgs if m["id"] == new_id]
            assert match, f"message row disappeared for {tok_label}"
            assert match[0].get("deleted_for_all") is True, f"deleted_for_all not set for {tok_label}: {match[0]}"
            assert (match[0].get("body") or "") == "", f"body not cleared for {tok_label}: {match[0]}"

    def test_block_via_follows(self):
        # Admin blocks recipient; endpoint should 200 and be idempotent
        r = requests.post(f"{API}/follows/block/{self.user_b['user_id']}", headers=_hdr(self.tok_a), timeout=20)
        assert r.status_code in (200, 201), r.text
        # idempotent
        r2 = requests.post(f"{API}/follows/block/{self.user_b['user_id']}", headers=_hdr(self.tok_a), timeout=20)
        assert r2.status_code in (200, 201), r2.text
