"""Iter 84 backend tests — Suggestions (reason, dismiss), Followers/Block, Moderation Undo (remove/restore-doc/hide)."""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def _register(prefix: str):
    """Register a fresh disposable user; return (token, user_id, email)."""
    email = f"iter84_{prefix}_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={
            "email": email,
            "password": "hunter2pass!",
            "name": f"Iter84 {prefix}",
            "first_name": "Iter84",
            "last_name": prefix.title(),
            "account_type": "sailor",
            "primary_market": "Greater Seattle",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    return j["session_token"], j["user"]["user_id"], email


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# =========================================================
# SUGGESTIONS: reason + exclusions
# =========================================================
class TestSuggestions:
    def test_suggestions_carry_reason(self):
        tok, _uid, _ = _register("sug1")
        r = requests.get(f"{BASE}/api/follows/suggestions?limit=6", headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        sugs = r.json()["suggestions"]
        assert len(sugs) > 0, "expected some suggestions for a fresh user"
        for s in sugs:
            assert isinstance(s.get("reason"), str) and len(s["reason"]) > 0, s
            assert "user_id" in s and "is_org" in s and "follower_count" in s

    def test_suggestions_401_without_auth(self):
        r = requests.get(f"{BASE}/api/follows/suggestions", timeout=30)
        assert r.status_code == 401

    def test_dismiss_excludes_from_suggestions(self):
        tok, _uid, _ = _register("sug2")
        r = requests.get(f"{BASE}/api/follows/suggestions?limit=12", headers=_h(tok), timeout=30)
        first = r.json()["suggestions"]
        assert first, "need at least one suggestion"
        target = first[0]["user_id"]
        d = requests.post(f"{BASE}/api/follows/suggestions/{target}/dismiss", headers=_h(tok), timeout=30)
        assert d.status_code == 200 and d.json().get("ok") is True
        # dismiss is idempotent
        d2 = requests.post(f"{BASE}/api/follows/suggestions/{target}/dismiss", headers=_h(tok), timeout=30)
        assert d2.status_code == 200
        # Re-fetch: target must not appear
        r2 = requests.get(f"{BASE}/api/follows/suggestions?limit=12", headers=_h(tok), timeout=30)
        ids = [s["user_id"] for s in r2.json()["suggestions"]]
        assert target not in ids, f"dismissed target still present: ids={ids}"

    def test_already_followed_excluded(self):
        tok, _uid, _ = _register("sug3")
        r = requests.get(f"{BASE}/api/follows/suggestions?limit=12", headers=_h(tok), timeout=30)
        first = r.json()["suggestions"]
        assert first
        target = first[0]["user_id"]
        f = requests.post(f"{BASE}/api/follows/{target}", headers=_h(tok), timeout=30)
        assert f.status_code == 200 and f.json().get("following") is True
        r2 = requests.get(f"{BASE}/api/follows/suggestions?limit=12", headers=_h(tok), timeout=30)
        ids = [s["user_id"] for s in r2.json()["suggestions"]]
        assert target not in ids

    def test_cannot_follow_self(self):
        tok, uid, _ = _register("self")
        r = requests.post(f"{BASE}/api/follows/{uid}", headers=_h(tok), timeout=30)
        assert r.status_code == 400


# =========================================================
# BLOCK: followers list + block/unblock flow + re-follow prevention
# =========================================================
class TestBlockFlow:
    def test_full_block_flow(self):
        # Alice will block Bob after Bob follows her.
        alice_tok, alice_id, _ = _register("alice")
        bob_tok, bob_id, _ = _register("bob")

        # Bob follows Alice
        f = requests.post(f"{BASE}/api/follows/{alice_id}", headers=_h(bob_tok), timeout=30)
        assert f.status_code == 200 and f.json()["following"] is True

        # Alice sees Bob in her followers
        r = requests.get(f"{BASE}/api/follows/followers", headers=_h(alice_tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["count"] >= 1
        assert any(x.get("user_id") == bob_id for x in j["followers"])

        # Alice blocks Bob
        b = requests.post(f"{BASE}/api/follows/block/{bob_id}", headers=_h(alice_tok), timeout=30)
        assert b.status_code == 200 and b.json().get("ok") is True

        # Bob is no longer a follower
        r2 = requests.get(f"{BASE}/api/follows/followers", headers=_h(alice_tok), timeout=30)
        assert not any(x.get("user_id") == bob_id for x in r2.json()["followers"])

        # Bob can't re-follow Alice -> 403
        f2 = requests.post(f"{BASE}/api/follows/{alice_id}", headers=_h(bob_tok), timeout=30)
        assert f2.status_code == 403, f2.text

        # Alice's blocked list contains Bob
        bl = requests.get(f"{BASE}/api/follows/blocked", headers=_h(alice_tok), timeout=30)
        assert bl.status_code == 200
        assert any(x.get("user_id") == bob_id for x in bl.json()["blocked"])

        # Alice can't follow Bob while she blocks him -> 400
        af = requests.post(f"{BASE}/api/follows/{bob_id}", headers=_h(alice_tok), timeout=30)
        assert af.status_code == 400, af.text

        # Blocked user must NOT appear in Alice's suggestions
        sugs = requests.get(f"{BASE}/api/follows/suggestions?limit=12", headers=_h(alice_tok), timeout=30).json()["suggestions"]
        assert not any(s["user_id"] == bob_id for s in sugs)

        # Alice unblocks Bob
        ub = requests.delete(f"{BASE}/api/follows/block/{bob_id}", headers=_h(alice_tok), timeout=30)
        assert ub.status_code == 200

        # Bob CAN now follow Alice again
        f3 = requests.post(f"{BASE}/api/follows/{alice_id}", headers=_h(bob_tok), timeout=30)
        assert f3.status_code == 200 and f3.json()["following"] is True

    def test_cannot_block_self(self):
        tok, uid, _ = _register("blockself")
        r = requests.post(f"{BASE}/api/follows/block/{uid}", headers=_h(tok), timeout=30)
        assert r.status_code == 400


# =========================================================
# MODERATION UNDO: remove returns snapshot; restore-doc re-inserts; hide re-hides
# =========================================================
class TestModerationUndo:
    def _make_post_and_hide(self, admin_tok):
        """Admin creates a post then flags as inappropriate as another user to auto-hide it."""
        # admin has premium so can post
        p = requests.post(
            f"{BASE}/api/posts",
            headers=_h(admin_tok),
            json={"title": "TEST84 undo target", "body": "content", "type": "general", "market": "Greater Seattle"},
            timeout=30,
        )
        assert p.status_code == 200, p.text
        pj = p.json()
        post_id = (pj.get("post") or pj).get("id") if isinstance(pj, dict) else None
        assert post_id, f"no id in {pj}"
        # reporter flags inappropriate to auto-hide
        rep_tok, _, _ = _register("reporter")
        rr = requests.post(
            f"{BASE}/api/reports",
            headers=_h(rep_tok),
            json={"target_type": "post", "target_id": post_id, "reason": "spam", "category": "inappropriate"},
            timeout=30,
        )
        assert rr.status_code == 200, rr.text
        assert rr.json().get("hidden") is True
        return post_id

    def test_remove_returns_snapshot_and_restore_doc_reinserts(self, admin_token):
        post_id = self._make_post_and_hide(admin_token)
        # Remove
        r = requests.post(
            f"{BASE}/api/admin/moderation/remove",
            headers=_h(admin_token),
            json={"target_type": "post", "target_id": post_id},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True and j.get("removed") is True
        assert j.get("target_type") == "post"
        snap = j.get("snapshot")
        assert isinstance(snap, dict) and snap.get("id") == post_id, snap

        # Undo remove — restore-doc
        rd = requests.post(
            f"{BASE}/api/admin/moderation/restore-doc",
            headers=_h(admin_token),
            json={"target_type": "post", "snapshot": snap},
            timeout=30,
        )
        assert rd.status_code == 200, rd.text
        assert rd.json().get("restored") == post_id

        # Post should be visible (not hidden) via public list
        time.sleep(0.5)
        listing = requests.get(f"{BASE}/api/posts", headers=_h(admin_token), timeout=30)
        assert listing.status_code == 200
        body = listing.json(); posts = body.get("posts") if isinstance(body, dict) else body; ids = [p.get("id") for p in (posts or [])]
        assert post_id in ids, f"restored post missing from public list; got {ids[:5]}..."

    def test_restore_then_hide_reverses(self, admin_token):
        post_id = self._make_post_and_hide(admin_token)
        # Restore (unhide)
        r = requests.post(
            f"{BASE}/api/admin/moderation/restore",
            headers=_h(admin_token),
            json={"target_type": "post", "target_id": post_id},
            timeout=30,
        )
        assert r.status_code == 200 and r.json().get("restored") is True

        # Undo restore — hide
        h = requests.post(
            f"{BASE}/api/admin/moderation/hide",
            headers=_h(admin_token),
            json={"target_type": "post", "target_id": post_id},
            timeout=30,
        )
        assert h.status_code == 200, h.text
        assert h.json().get("hidden") is True

        # Post must NOT appear in public listing
        listing = requests.get(f"{BASE}/api/posts", headers=_h(admin_token), timeout=30)
        assert listing.status_code == 200
        body = listing.json(); posts = body.get("posts") if isinstance(body, dict) else body; ids = [p.get("id") for p in (posts or [])]
        assert post_id not in ids

    def test_admin_only_endpoints(self):
        user_tok, _, _ = _register("notadmin")
        for path, method in [
            ("/api/admin/moderation/remove", "post"),
            ("/api/admin/moderation/restore-doc", "post"),
            ("/api/admin/moderation/hide", "post"),
        ]:
            fn = getattr(requests, method)
            r = fn(f"{BASE}{path}", headers=_h(user_tok), json={"target_type": "post", "target_id": "x"}, timeout=30)
            assert r.status_code in (401, 403), f"{path} should require admin, got {r.status_code}"
