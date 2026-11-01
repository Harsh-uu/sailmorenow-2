"""Iter 81 — tests for the 5 new features:
   1) Moderation (POST /api/reports, admin resolve/dismiss, delete, hide/restore)
   2) Support inbox (POST /api/support/contact with subject → source=profile_support)
   3) Following list (GET /api/follows returns people + orgs with account_type)
   4) Verified filter (crew-bank standalone/open ?verified_only=true, boat-pros identity_verified)
   5) Duplicate/idempotent reports; hide-on-inappropriate; restore on dismiss
"""
import os, time, uuid, requests, pytest

def _read_env():
    try:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return ""

BASE = os.environ.get("REACT_APP_BACKEND_URL") or _read_env()
BASE = BASE.rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL not set"
API = f"{BASE}/api"

ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PW    = os.environ.get("ADMIN_PASSWORD", "")


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user1():
    # disposable free user
    email = f"iter81_u1_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "first_name": "Iter", "last_name": "One", "email": email, "password": "hunter2pass",
        "primary_market": "Greater Seattle", "account_type": "boat_owner",
    }, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    s.user = r.json()["user"]
    return s


@pytest.fixture(scope="module")
def user2():
    email = f"iter81_u2_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "first_name": "Iter", "last_name": "Two", "email": email, "password": "hunter2pass",
        "primary_market": "Greater Seattle", "account_type": "boat_owner",
    }, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    s.user = r.json()["user"]
    return s


# --- Moderation ------------------------------------------------------------

def test_flag_requires_auth():
    r = requests.post(f"{API}/reports", json={"target_type": "post", "target_id": "x", "reason": "spam"}, timeout=10)
    assert r.status_code == 401


def _make_post(admin, tag: str) -> str:
    r = admin.post(f"{API}/posts", json={
        "type": "note", "title": f"TEST iter81 {tag}",
        "body": f"TEST iter81 {tag} {uuid.uuid4().hex[:6]}",
        "market": "Greater Seattle",
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_inappropriate_flag_hides_post_and_admin_restore(admin, user1, user2):
    post_id = _make_post(admin, "flag")

    # user1 flags as inappropriate
    r = user1.post(f"{API}/reports", json={
        "target_type": "post", "target_id": post_id,
        "reason": "Bad content", "category": "inappropriate",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["hidden"] is True and body["duplicate"] is False
    report_id = body["report"]["id"]

    # Idempotent — same reporter, same target
    r2 = user1.post(f"{API}/reports", json={
        "target_type": "post", "target_id": post_id,
        "reason": "Bad content", "category": "inappropriate",
    })
    assert r2.status_code == 200 and r2.json()["duplicate"] is True

    # Post no longer in public list
    r = requests.get(f"{API}/posts?limit=200", timeout=15)
    assert r.status_code == 200
    d = r.json(); posts = d if isinstance(d, list) else d.get("posts", [])
    assert not any(p.get("id") == post_id for p in posts)

    # Admin lists reports and can see it
    r = admin.get(f"{API}/admin/reports?status=open")
    assert r.status_code == 200
    assert any(rep["id"] == report_id for rep in r.json()["reports"])

    # Admin dismisses -> post is restored (unhidden)
    r = admin.patch(f"{API}/admin/reports/{report_id}", json={"status": "dismissed"})
    assert r.status_code == 200 and r.json()["ok"] is True

    r = requests.get(f"{API}/posts?limit=200", timeout=15)
    d = r.json(); posts = d if isinstance(d, list) else d.get("posts", [])
    assert any(p.get("id") == post_id for p in posts), "Post should be restored after dismiss"

    # Cleanup
    admin.delete(f"{API}/posts/{post_id}")


def test_resolve_with_delete_removes_target(admin, user1):
    post_id = _make_post(admin, "delete")
    r = user1.post(f"{API}/reports", json={
        "target_type": "post", "target_id": post_id,
        "reason": "abuse", "category": "inappropriate",
    })
    assert r.status_code == 200
    rid = r.json()["report"]["id"]
    r = admin.patch(f"{API}/admin/reports/{rid}", json={"status": "resolved", "delete_target": True})
    assert r.status_code == 200
    # Verify the post is gone even for admin (whole doc deleted)
    r = admin.get(f"{API}/posts/{post_id}")
    assert r.status_code == 404


def test_inaccurate_flag_does_not_hide(admin, user2):
    post_id = _make_post(admin, "inacc")
    r = user2.post(f"{API}/reports", json={
        "target_type": "post", "target_id": post_id,
        "reason": "bad info", "category": "inaccurate",
    })
    assert r.status_code == 200 and r.json()["hidden"] is False
    # Post still public
    r = requests.get(f"{API}/posts?limit=200", timeout=15)
    d = r.json(); posts = d if isinstance(d, list) else d.get("posts", [])
    assert any(p.get("id") == post_id for p in posts)
    # cleanup
    admin.delete(f"{API}/posts/{post_id}")


def test_flag_invalid_target_type(user1):
    r = user1.post(f"{API}/reports", json={"target_type": "nope", "target_id": "x", "reason": "y"})
    assert r.status_code == 400


def test_flag_missing_reason(user1, admin):
    pid = _make_post(admin, "noreason")
    r = user1.post(f"{API}/reports", json={"target_type": "post", "target_id": pid, "reason": "", "category": "other"})
    assert r.status_code == 400
    admin.delete(f"{API}/posts/{pid}")


# --- Support inbox + subject presets --------------------------------------

def test_support_contact_writes_profile_source(admin, user1):
    subj = "Bug"  # simulates 'bug' preset chip
    msg = "This is a TEST iter81 support message — please ignore."
    r = user1.post(f"{API}/support/contact", json={"subject": subj, "message": msg})
    assert r.status_code == 200, r.text
    # Admin sees it in /admin/contact and it has source=profile_support
    r = admin.get(f"{API}/admin/contact?limit=50")
    assert r.status_code == 200
    msgs = r.json().get("messages") or r.json().get("items") or []
    hit = next((m for m in msgs if m.get("subject") == subj and m.get("source") == "profile_support"
                and msg in (m.get("message") or "")), None)
    assert hit is not None, f"Support message not found with source=profile_support. Got: {msgs[:2]}"


def test_public_contact_has_no_profile_source(admin):
    # Public /contact endpoint (unauthenticated)
    body = {"name": "Iter81 Tester", "email": "iter81@example.com",
            "message": "TEST iter81 public contact message for source-badge check", "subject": "Feedback"}
    r = requests.post(f"{API}/contact", json=body, timeout=10)
    assert r.status_code == 200, r.text
    r = admin.get(f"{API}/admin/contact?limit=50")
    msgs = r.json().get("messages") or r.json().get("items") or []
    hit = next((m for m in msgs if m.get("email") == "iter81@example.com"), None)
    assert hit is not None
    assert hit.get("source") != "profile_support", "Public contact must NOT be tagged as profile_support"


# --- Following list --------------------------------------------------------

def test_follows_returns_account_type(user1):
    # Follow the seeded pro (Salish Marina Services — seed_marina)
    r = user1.post(f"{API}/follows/seed_marina")
    assert r.status_code == 200
    r = user1.get(f"{API}/follows")
    assert r.status_code == 200
    orgs = r.json().get("orgs", [])
    hit = next((o for o in orgs if o["user_id"] == "seed_marina"), None)
    assert hit is not None, f"seed_marina not in follows: {orgs}"
    assert "account_type" in hit and hit["account_type"], "account_type missing from /follows entry"
    # Cleanup
    r = user1.delete(f"{API}/follows/seed_marina")
    assert r.status_code == 200
    r = user1.get(f"{API}/follows")
    assert not any(o["user_id"] == "seed_marina" for o in r.json().get("orgs", []))


# --- Verified filter -------------------------------------------------------

def test_boat_pros_expose_identity_verified():
    r = requests.get(f"{API}/boat-pros", timeout=15)
    assert r.status_code == 200
    data = r.json()
    pros = data if isinstance(data, list) else (data.get("pros") or data.get("items") or [])
    assert len(pros) > 0
    # every pro card must expose an identity_verified field (bool)
    for p in pros[:20]:
        assert "identity_verified" in p, f"Boat Pro card missing identity_verified: {list(p.keys())}"


def test_crew_bank_standalone_verified_filter():
    r_all = requests.get(f"{API}/crew-bank/standalone?limit=200", timeout=15)
    assert r_all.status_code == 200
    d = r_all.json()
    all_items = d.get("entries") or d.get("items") or (d if isinstance(d, list) else [])
    # user_verified must be present on cards (only if any exist)
    for c in all_items[:10]:
        assert "user_verified" in c, f"crew card missing user_verified: {list(c.keys())}"
    r_v = requests.get(f"{API}/crew-bank/standalone?verified_only=true&limit=200", timeout=15)
    assert r_v.status_code == 200
    dv = r_v.json()
    v_items = dv.get("entries") or dv.get("items") or (dv if isinstance(dv, list) else [])
    # Verified-only subset should all be user_verified=True (may be empty in fresh DB — that's fine)
    for c in v_items:
        assert c.get("user_verified") is True
    assert len(v_items) <= len(all_items)


def test_crew_bank_open_verified_filter():
    r = requests.get(f"{API}/crew-bank/open?verified_only=true&limit=200", timeout=15)
    assert r.status_code == 200
    d = r.json()
    items = d if isinstance(d, list) else (d.get("items") or d.get("entries") or [])
    for c in items:
        assert c.get("user_verified") is True


# --- Admin reports insights + hidden badge ---------------------------------

def test_admin_reports_has_insights(admin):
    r = admin.get(f"{API}/admin/reports?status=all")
    assert r.status_code == 200
    body = r.json()
    assert "insights" in body
    ins = body["insights"]
    assert "weekly" in ins and isinstance(ins["weekly"], list) and len(ins["weekly"]) == 8
    assert "top_targets" in ins and isinstance(ins["top_targets"], list)
    assert "open_total" in ins
