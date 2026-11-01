"""Iter 70 — Phase 3 regression:
- Community Partner activate + founding_partner flag (first 5 ever)
- Lazy downgrade in current_user_from_token
- partner_badge on /api/u/{handle}, /api/posts, /api/events
- Hide-on-lapse: /api/boat-pros and /api/crew-bank/standalone
- Welcome email is fire-and-forget (activation never raises)
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

def _read_env(key: str, path: str) -> str:
    with open(path) as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    raise KeyError(key)

BASE = os.environ.get("REACT_APP_BACKEND_URL") or _read_env("REACT_APP_BACKEND_URL", "/app/frontend/.env")
BASE = BASE.rstrip("/")

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASS = os.environ.get("ADMIN_PASSWORD", "")

FOUNDING_PARTNER_EMAIL = "partner.psss@sailmorenow.dev"
PARTNER_HANDLE = "pugetsoundsailingsoc"


# ---------- helpers ----------

def _login_admin() -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _register(prefix: str, account_type: str = "boat_owner") -> dict:
    email = f"TEST_iter70_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE}/api/auth/register", json={
        "email": email, "password": "hunter2pass", "name": f"Iter70 {prefix}",
        "first_name": "Iter70", "last_name": prefix,
        "account_type": account_type, "primary_market": "Greater Seattle",
    }, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    return {"email": email, "token": j["session_token"], "user_id": j["user"]["user_id"]}


def _mongosh(js: str) -> str:
    import subprocess
    out = subprocess.run(["mongosh", "--quiet", "--eval",
                          f'const db=db.getSiblingDB("test_database");{js}'],
                         capture_output=True, text=True, timeout=20)
    return (out.stdout or "").strip()


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin_token():
    return _login_admin()


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    # remove TEST_iter70_ users + their sessions
    _mongosh(
        'const uids=db.users.find({email:/^test_iter70_/i},{_id:0,user_id:1}).toArray().map(u=>u.user_id);'
        'db.user_sessions.deleteMany({user_id:{$in:uids}});'
        'db.users.deleteMany({email:/^test_iter70_/i});'
        'db.boat_pros.deleteMany({user_id:{$in:uids}});'
        'db.crew_bank_standalone.deleteMany({user_id:{$in:uids}});'
    )


# ---------- 1) Community Partner activate (founding + repeat + revert) ----------

class TestCommunityPartnerActivate:
    def test_founding_partner_persists_on_reactivate(self, admin_token):
        # partner.psss should already be founding_partner=true from prior iters.
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{BASE}/api/admin/community-partner/activate",
                          json={"email": FOUNDING_PARTNER_EMAIL, "months": 12, "activate": True},
                          headers=h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["tier"] == "community_partner"
        assert data["founding_partner"] is True

    def test_revert_to_free(self, admin_token):
        # register a fresh partner-like account, activate then deactivate
        u = _register("revert", account_type="partner")
        h = {"Authorization": f"Bearer {admin_token}"}
        # activate
        r = requests.post(f"{BASE}/api/admin/community-partner/activate",
                          json={"email": u["email"], "months": 3, "activate": True},
                          headers=h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["tier"] == "community_partner"
        # deactivate
        r2 = requests.post(f"{BASE}/api/admin/community-partner/activate",
                           json={"email": u["email"], "activate": False},
                           headers=h, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["tier"] == "free"

    def test_unknown_email_404(self, admin_token):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{BASE}/api/admin/community-partner/activate",
                          json={"email": f"nobody_{uuid.uuid4().hex[:8]}@example.com",
                                "activate": True}, headers=h, timeout=15)
        assert r.status_code == 404

    def test_first_five_count_invariant(self):
        """Founding partners collection must be <=5 (per spec: first 5 ever)."""
        count = _mongosh('print(db.users.countDocuments({founding_partner:true}));')
        # Extract numeric line
        n = int([x for x in count.splitlines() if x.strip().isdigit()][-1])
        assert n <= 5, f"expected <=5 founding partners, got {n}"


# ---------- 2) Lazy downgrade ----------

class TestLazyDowngrade:
    def test_lapsed_premium_reverts_and_402s_on_post(self, admin_token):
        u = _register("lapse", account_type="boat_owner")
        # Force user to lapsed premium tier via mongosh
        past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        _mongosh(f'db.users.updateOne({{user_id:"{u["user_id"]}"}},'
                 f'{{$set:{{subscription_tier:"premium",subscription_expires:"{past}"}}}});')
        h = {"Authorization": f"Bearer {u['token']}"}
        # Auth-touching call triggers lazy downgrade
        me = requests.get(f"{BASE}/api/auth/me", headers=h, timeout=15)
        assert me.status_code == 200, me.text
        assert me.json().get("subscription_tier") == "free", me.json()
        # Now gated action (POST /api/posts) returns 402
        r = requests.post(f"{BASE}/api/posts", headers=h, json={
            "type": "discussion", "title": "TEST iter70 lapse post",
            "body": "should be blocked", "market": "Greater Seattle",
        }, timeout=15)
        assert r.status_code == 402, r.text
        detail = r.json().get("detail") or {}
        assert detail.get("code") == "upgrade_required"


# ---------- 3) partner_badge fields on public reads ----------

class TestPartnerBadgeFields:
    def test_handle_profile_returns_founding_badge(self):
        r = requests.get(f"{BASE}/api/u/{PARTNER_HANDLE}", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # Support both flat and nested (user.partner_badge) shapes.
        badge = j.get("partner_badge") or (j.get("user") or {}).get("partner_badge")
        assert badge == "founding", j

    def test_posts_include_author_partner_badge_key(self):
        r = requests.get(f"{BASE}/api/posts?limit=50", timeout=15)
        assert r.status_code == 200
        posts = r.json() if isinstance(r.json(), list) else r.json().get("posts", [])
        # Key must be present on all posts (may be null for non-partner authors)
        for p in posts:
            assert "author_partner_badge" in p, p
        # Optional: if any partner-authored post exists, badge should be founding/partner
        badged = [p for p in posts if p.get("author_partner_badge")]
        for p in badged:
            assert p["author_partner_badge"] in ("founding", "partner")

    def test_events_include_organizer_partner_badge_key(self):
        r = requests.get(f"{BASE}/api/events?limit=50", timeout=15)
        assert r.status_code == 200
        events = r.json() if isinstance(r.json(), list) else r.json().get("events", [])
        for e in events:
            assert "organizer_partner_badge" in e, e


# ---------- 4) Hide-on-lapse: boat-pros + crew-bank standalone ----------

class TestHideOnLapse:
    def test_lapsed_boat_pro_excluded(self, admin_token):
        u = _register("bp", account_type="boat_pro")
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        # Seed a boat_pros doc + set user lapsed
        _mongosh(
            f'db.boat_pros.insertOne({{user_id:"{u["user_id"]}",'
            f'company_name:"TEST_iter70_bp",tier:"premium",'
            f'short_bio:"lapsed pro",categories:["rigging"],'
            f'markets:["Greater Seattle"],photos:["a","b","c"]}});'
            f'db.users.updateOne({{user_id:"{u["user_id"]}"}},'
            f'{{$set:{{subscription_tier:"premium",subscription_expires:"{past}"}}}});'
        )
        r = requests.get(f"{BASE}/api/boat-pros?market=Greater Seattle", timeout=15)
        assert r.status_code == 200
        docs = r.json()
        assert not any(d.get("user_id") == u["user_id"] for d in docs), \
            "lapsed boat_pro should be hidden"

    def test_lapsed_standalone_crew_excluded(self, admin_token):
        u = _register("cb", account_type="boat_owner")
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        _mongosh(
            f'db.crew_bank_standalone.insertOne({{user_id:"{u["user_id"]}",'
            f'status:"seeking",positions:["Railmeat"],markets:["Greater Seattle"],'
            f'notes:"TEST_iter70_cb lapsed listing",'
            f'expires_at:"{future}",updated_at:"{future}"}});'
            f'db.users.updateOne({{user_id:"{u["user_id"]}"}},'
            f'{{$set:{{subscription_tier:"premium",subscription_expires:"{past}"}}}});'
        )
        r = requests.get(f"{BASE}/api/crew-bank/standalone?market=Greater Seattle", timeout=15)
        assert r.status_code == 200
        entries = r.json().get("entries", [])
        assert not any(e.get("user_id") == u["user_id"] for e in entries), \
            "lapsed standalone crew listing should be hidden"


# ---------- 5) Welcome email fire-and-forget ----------

class TestWelcomeEmail:
    def test_activation_succeeds_even_without_email_key(self, admin_token):
        """The activation endpoint must not raise if EMERGENT_EMAIL_KEY is
        missing / mailer returns skipped. This is a smoke test on the happy
        path — the mailer send is inside a try/except."""
        u = _register("welcome", account_type="partner")
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{BASE}/api/admin/community-partner/activate",
                          json={"email": u["email"], "months": 12, "activate": True},
                          headers=h, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["tier"] == "community_partner"
        # founding may be true if <5 exist; either bool is fine
        assert isinstance(data["founding_partner"], bool)
