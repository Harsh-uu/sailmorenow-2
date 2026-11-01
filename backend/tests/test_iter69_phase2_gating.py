"""Iter 69 — Phase-2 paywall enforcement + tiers regression.

Covers, for the shared backend:
- 402 upgrade_required on gated writes for FREE users, 2xx for PAID.
- Organization events: free partner → volunteer only (402 on regular).
- /api/payments/packages exposes owner_premium_{1,3,6,12} @ $6.99.
- /api/payments/checkout owner_premium_1 returns a Stripe url (test mode).
- /api/admin/community-partner/activate sets/reverts subscription_tier.
- /api/admin/contact annotates each message with an account object + subject.
"""
from __future__ import annotations
import os
import time
import uuid
import subprocess
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
DB_NAME = "test_database"
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASS = os.environ.get("ADMIN_PASSWORD", "")


def _mongo(js: str) -> str:
    """Run a mongosh eval and return stdout."""
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", f'const db=db.getSiblingDB("{DB_NAME}");{js}'],
        capture_output=True, text=True, timeout=15,
    )
    return (out.stdout or "").strip()


def _uid_for(email: str) -> str:
    """Return user_id for an email (backend stores emails lowercase)."""
    out = _mongo(f'const u=db.users.findOne({{email:"{email.lower()}"}},'
                 f'{{_id:0,user_id:1}});print(u?u.user_id:"");')
    lines = [l for l in (out or "").strip().splitlines() if l.strip()]
    return lines[-1] if lines else ""


def _tier_for(email: str) -> str:
    out = _mongo(f'const u=db.users.findOne({{email:"{email.lower()}"}},'
                 f'{{_id:0,subscription_tier:1}});'
                 f'print(u?u.subscription_tier:"");')
    lines = [l for l in (out or "").strip().splitlines() if l.strip()]
    return lines[-1] if lines else ""


def _mint_token(email: str) -> str:
    """Create a session_token row in mongo for the given user email."""
    token = f"TEST_iter69_{uuid.uuid4().hex[:8]}"
    js = (
        f'const u=db.users.findOne({{email:"{email.lower()}"}},{{_id:0,user_id:1}});'
        f'if(!u){{print("NOUSER");}}else{{'
        f'db.user_sessions.insertOne({{user_id:u.user_id, session_token:"{token}", '
        f'expires_at:new Date(Date.now()+3600*1000), created_at:new Date()}});'
        f'print("OK");}}'
    )
    r = _mongo(js)
    assert "OK" in r, f"mint failed for {email}: {r}"
    return token


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def free_user():
    """Register a fresh free boat_owner. Return (email, token)."""
    email = f"TEST_iter69_free_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "hunter2pass",
        "first_name": "Iter69", "last_name": "Free",
        "account_type": "boat_owner", "primary_market": "Greater Seattle",
    }, timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json().get("session_token")
    assert tok
    return {"email": email, "token": tok}


@pytest.fixture(scope="module")
def paid_user():
    """Mint a token for seeded premium sailor crew.alex@sailmorenow.dev."""
    email = "crew.alex@sailmorenow.dev"
    # Ensure the user exists (seed if needed) then force premium tier.
    exists = _mongo(f'print(db.users.countDocuments({{email:"{email.lower()}"}}));')
    if exists.strip() == "0":
        requests.post(f"{API}/seed", timeout=30)
    _mongo(f'db.users.updateOne({{email:"{email.lower()}"}},{{$set:{{subscription_tier:"premium"}}}});')
    tok = _mint_token(email)
    return {"email": email, "token": tok}


@pytest.fixture(scope="module")
def free_partner():
    """Register a free partner (organization)."""
    email = f"TEST_iter69_partner_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "hunter2pass",
        "first_name": "Iter69", "last_name": "Org",
        "account_type": "partner", "primary_market": "Greater Seattle",
        "org_name": "TEST_iter69 Org",
    }, timeout=20)
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["session_token"]}


@pytest.fixture(scope="module")
def paid_partner(free_partner):
    """Promote an existing partner to community_partner via admin."""
    _mongo(f'db.users.updateOne({{email:"{free_partner["email"].lower()}"}},'
           f'{{$set:{{subscription_tier:"community_partner"}}}});')
    return free_partner  # same token; tier flipped in DB


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASS,
    }, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


# ---------- gating: 402 upgrade_required for FREE, 2xx for PAID ----------
class TestPaywallGating:
    def _assert_upgrade(self, r):
        assert r.status_code == 402, f"expected 402 got {r.status_code}: {r.text}"
        d = r.json().get("detail")
        assert isinstance(d, dict) and d.get("code") == "upgrade_required", d

    def test_posts_free_402(self, free_user):
        r = requests.post(f"{API}/posts",
                          headers=_auth(free_user["token"]),
                          json={"type": "discussion", "title": "TEST_iter69",
                                "body": "TEST_iter69 hi", "market": "Greater Seattle"},
                          timeout=15)
        self._assert_upgrade(r)

    def test_posts_paid_2xx(self, paid_user):
        r = requests.post(f"{API}/posts",
                          headers=_auth(paid_user["token"]),
                          json={"type": "discussion", "title": "TEST_iter69",
                                "body": "TEST_iter69 paid post", "market": "Greater Seattle"},
                          timeout=15)
        assert r.status_code in (200, 201), r.text
        pytest.paid_post_id = r.json().get("id")

    def test_comment_free_402(self, free_user):
        pid = getattr(pytest, "paid_post_id", None) or "nonexistent"
        r = requests.post(f"{API}/posts/{pid}/comments",
                          headers=_auth(free_user["token"]),
                          json={"body": "TEST_iter69 comment"}, timeout=15)
        self._assert_upgrade(r)

    def test_comment_paid_2xx(self, paid_user):
        pid = getattr(pytest, "paid_post_id", None)
        if not pid:
            pytest.skip("no paid_post_id from earlier test")
        r = requests.post(f"{API}/posts/{pid}/comments",
                          headers=_auth(paid_user["token"]),
                          json={"body": "TEST_iter69 paid comment"}, timeout=15)
        assert r.status_code in (200, 201), r.text

    def test_reactions_free_402(self, free_user):
        pid = getattr(pytest, "paid_post_id", None) or "nonexistent"
        r = requests.post(f"{API}/reactions",
                          headers=_auth(free_user["token"]),
                          json={"target_type": "post", "target_id": pid, "value": 1},
                          timeout=15)
        self._assert_upgrade(r)

    def test_reactions_paid_2xx(self, paid_user):
        pid = getattr(pytest, "paid_post_id", None)
        if not pid:
            pytest.skip("no paid_post_id")
        r = requests.post(f"{API}/reactions",
                          headers=_auth(paid_user["token"]),
                          json={"target_type": "post", "target_id": pid, "value": 1},
                          timeout=15)
        assert r.status_code in (200, 201), r.text

    def test_messages_free_402(self, free_user, paid_user):
        rid = _uid_for(paid_user["email"])
        assert rid, "recipient uid missing"
        r = requests.post(f"{API}/messages/{rid}",
                          headers=_auth(free_user["token"]),
                          json={"body": "TEST_iter69 hi"}, timeout=15)
        self._assert_upgrade(r)

    def test_messages_paid_2xx(self, paid_user, free_user):
        rid = _uid_for(free_user["email"])
        assert rid, "recipient uid missing"
        r = requests.post(f"{API}/messages/{rid}",
                          headers=_auth(paid_user["token"]),
                          json={"body": "TEST_iter69 paid dm"}, timeout=15)
        assert r.status_code in (200, 201), r.text

    def test_review_session_free_402(self, free_user, paid_user):
        rid = _uid_for(paid_user["email"])
        assert rid, "counterparty uid missing"
        r = requests.post(f"{API}/review-sessions",
                          headers=_auth(free_user["token"]),
                          json={"counterparty_id": rid, "relationship": "boat_owner_sailor"},
                          timeout=15)
        self._assert_upgrade(r)


# ---------- Org events ----------
class TestOrgEvents:
    def _payload(self, is_vol: bool):
        return {
            "title": "TEST_iter69 org evt",
            "description": "x",
            "market": "Greater Seattle",
            "starts_at": "2027-01-15T18:00:00+00:00",
            "location": "Marina",
            "is_volunteer": is_vol,
        }

    def test_free_partner_regular_event_402(self, free_partner):
        r = requests.post(f"{API}/events",
                          headers=_auth(free_partner["token"]),
                          json=self._payload(False), timeout=15)
        assert r.status_code == 402, r.text
        assert r.json().get("detail", {}).get("code") == "upgrade_required"

    def test_free_partner_volunteer_event_200(self, free_partner):
        r = requests.post(f"{API}/events",
                          headers=_auth(free_partner["token"]),
                          json=self._payload(True), timeout=15)
        assert r.status_code in (200, 201), r.text
        assert r.json().get("is_volunteer") is True

    def test_community_partner_regular_event_200(self, paid_partner):
        r = requests.post(f"{API}/events",
                          headers=_auth(paid_partner["token"]),
                          json=self._payload(False), timeout=15)
        assert r.status_code in (200, 201), r.text


# ---------- Payments packages ----------
class TestPayments:
    def test_owner_premium_packages_present(self):
        r = requests.get(f"{API}/payments/packages", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # response may be a plain list, or {"packages": [...]}, or a dict-of-dicts
        if isinstance(data, dict) and "packages" in data:
            data = data["packages"]
        if isinstance(data, list):
            by_id = {p.get("id") or p.get("package_id") or p.get("key"): p for p in data}
        else:
            by_id = data
        for pid in ("owner_premium_1", "owner_premium_3", "owner_premium_6", "owner_premium_12"):
            assert pid in by_id, f"missing {pid}; keys={list(by_id.keys())}"
            pkg = by_id[pid]
            assert pkg.get("audience") == "boat_owner", pkg
            assert abs(float(pkg.get("monthly") or 0) - 6.99) < 0.001, pkg

    def test_checkout_owner_premium_1(self, free_user):
        # boat_owner buys owner_premium_1
        r = requests.post(f"{API}/payments/checkout",
                          headers=_auth(free_user["token"]),
                          json={"package_id": "owner_premium_1",
                                "origin_url": BASE}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and "stripe" in body["url"].lower(), body


# ---------- Admin community-partner activate ----------
class TestAdminActivate:
    def test_activate_and_revert(self, admin_token, free_partner):
        email = free_partner["email"]
        r = requests.post(f"{API}/admin/community-partner/activate",
                          headers=_auth(admin_token),
                          json={"email": email, "months": 6, "activate": True},
                          timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("tier") == "community_partner"
        # verify persistence
        tier = _tier_for(email)
        assert tier == "community_partner", tier
        # revert
        r2 = requests.post(f"{API}/admin/community-partner/activate",
                           headers=_auth(admin_token),
                           json={"email": email, "activate": False}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("tier") == "free"

    def test_activate_unknown_email_404(self, admin_token):
        r = requests.post(f"{API}/admin/community-partner/activate",
                          headers=_auth(admin_token),
                          json={"email": f"TEST_iter69_ghost_{uuid.uuid4().hex}@nope.dev",
                                "activate": True}, timeout=15)
        assert r.status_code == 404, r.text


# ---------- Admin contact annotations ----------
class TestAdminContactAnnotation:
    def test_contact_has_account_and_subject(self, admin_token, free_partner):
        # Seed a contact_messages row directly (bypass rate limit).
        cid = f"TEST_iter69_{uuid.uuid4().hex[:8]}"
        email_lc = free_partner["email"].lower()
        _mongo(
            f'db.contact_messages.insertOne({{'
            f'id:"{cid}", name:"Iter69 Org", email:"{email_lc}", '
            f'subject:"Community Partner inquiry", message:"TEST_iter69 admin contact", '
            f'created_at:new Date(), status:"new"}});'
        )
        r = requests.get(f"{API}/admin/contact?limit=50",
                         headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        msgs = r.json().get("messages", [])
        mine = next((m for m in msgs if m.get("id") == cid), None)
        assert mine, f"seeded contact not found; got {len(msgs)}"
        assert mine.get("subject") == "Community Partner inquiry"
        acct = mine.get("account")
        assert isinstance(acct, dict), f"account missing/None: {mine}"
        assert (acct.get("email") or "").lower() == email_lc
        assert acct.get("account_type") == "partner"
        assert "subscription_tier" in acct


# ---------- Cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    try:
        _mongo(
            'db.users.deleteMany({email:/^TEST_iter69_/});'
            'db.contact_messages.deleteMany({id:/^TEST_iter69_/});'
            'db.posts.deleteMany({body:/TEST_iter69/});'
            'db.events.deleteMany({title:/TEST_iter69/});'
            'db.user_sessions.deleteMany({session_token:/^TEST_iter69_/});'
        )
    except Exception:
        pass
