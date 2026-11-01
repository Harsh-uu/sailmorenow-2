"""Iter 82 — Threshold rules, admin content_hidden notifications, admin event edit,
crew positions (no Helm/Navigator)."""
import os, uuid, time
import requests
import pytest

# Read backend URL from frontend .env (test env may not have it exported)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    envp = "/app/frontend/.env"
    if os.path.exists(envp):
        for ln in open(envp):
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip()
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL required"

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "")


def _admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _register_user(tag):
    email = f"iter82_{tag}_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "hunter2pass",
        "first_name": "T82", "last_name": tag,
        "name": f"T82 {tag}",
        "account_type": "sailor", "primary_market": "Greater Seattle",
    })
    assert r.status_code in (200, 201), r.text
    return {"email": email, "token": r.json()["session_token"], "user_id": r.json()["user"]["user_id"]}


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ========== Crew positions ==========
def test_crew_positions_no_helm_navigator():
    r = requests.get(f"{API}/crew-positions")
    assert r.status_code == 200
    data = r.json()
    # positions field could be under `positions` or list
    lst = data.get("positions") if isinstance(data, dict) else data
    assert isinstance(lst, list) and lst, f"Unexpected response {data}"
    assert "Helm" not in lst, f"Helm still present: {lst}"
    assert "Navigator" not in lst, f"Navigator still present: {lst}"


# ========== Moderation settings ==========
def test_moderation_settings_get_put():
    tok = _admin_token()
    # PUT threshold=3
    r = requests.put(f"{API}/admin/moderation-settings",
                     json={"inaccurate_auto_hide_threshold": 3}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["inaccurate_auto_hide_threshold"] == 3
    # GET
    r = requests.get(f"{API}/admin/moderation-settings", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["inaccurate_auto_hide_threshold"] == 3
    # Requires admin
    r2 = requests.get(f"{API}/admin/moderation-settings")
    assert r2.status_code in (401, 403)


# ========== Threshold flow ==========
def test_inaccurate_threshold_auto_hides_and_notifies_admins():
    admin_tok = _admin_token()
    # Set threshold=2
    r = requests.put(f"{API}/admin/moderation-settings",
                     json={"inaccurate_auto_hide_threshold": 2}, headers=_h(admin_tok))
    assert r.status_code == 200

    # Create post as user A
    userA = _register_user("A")
    body = {"type": "update", "title": f"TEST82 threshold {uuid.uuid4().hex[:6]}",
            "body": f"TEST82 threshold post {uuid.uuid4().hex[:6]}",
            "market": "Greater Seattle"}
    # Attempt to create a post — user A must be paid; if 402 skip
    rp = requests.post(f"{API}/posts", json=body, headers=_h(userA["token"]))
    if rp.status_code == 402:
        # Use admin to create the post instead (admin is premium)
        rp = requests.post(f"{API}/posts", json=body, headers=_h(admin_tok))
    assert rp.status_code in (200, 201), rp.text
    post_id = rp.json()["id"]

    # Reporter 1
    r1 = _register_user("R1")
    rr1 = requests.post(f"{API}/reports", headers=_h(r1["token"]), json={
        "target_type": "post", "target_id": post_id,
        "reason": "TEST82 not accurate #1", "category": "inaccurate",
    })
    assert rr1.status_code == 200, rr1.text
    assert rr1.json().get("hidden") is False, "post should NOT be hidden after 1 report"

    # Confirm still visible in /api/posts
    lst = requests.get(f"{API}/posts?market=Greater%20Seattle").json()
    posts_list = lst.get("posts") if isinstance(lst, dict) else lst
    ids = [p.get("id") for p in (posts_list or [])]
    assert post_id in ids, "post should still be visible after 1 inaccurate report"

    # Snapshot admin notifications before 2nd report
    n_before = requests.get(f"{API}/notifications", headers=_h(admin_tok)).json()
    n_before_count = sum(1 for n in (n_before.get("items") or []) if n.get("kind") == "content_hidden")

    # Reporter 2 (distinct) — this pushes count to 2 -> auto-hide
    r2 = _register_user("R2")
    rr2 = requests.post(f"{API}/reports", headers=_h(r2["token"]), json={
        "target_type": "post", "target_id": post_id,
        "reason": "TEST82 not accurate #2", "category": "inaccurate",
    })
    assert rr2.status_code == 200, rr2.text
    assert rr2.json().get("hidden") is True, f"post should be hidden after 2nd distinct inaccurate report: {rr2.json()}"

    # Should no longer be in /api/posts
    lst2 = requests.get(f"{API}/posts?market=Greater%20Seattle").json()
    posts_list2 = lst2.get("posts") if isinstance(lst2, dict) else lst2
    ids2 = [p.get("id") for p in (posts_list2 or [])]
    assert post_id not in ids2, "hidden post should not be in public list"

    # Admin got a new content_hidden notification
    time.sleep(1.0)
    n_after = requests.get(f"{API}/notifications", headers=_h(admin_tok)).json()
    ch_after = [n for n in (n_after.get("items") or []) if n.get("kind") == "content_hidden"]
    assert len(ch_after) >= n_before_count + 1, f"admin should receive a content_hidden notif. before={n_before_count}, after={len(ch_after)}"
    latest = ch_after[0]
    assert latest.get("link") == "/admin/reports", latest


def test_threshold_zero_never_auto_hides():
    admin_tok = _admin_token()
    # Turn threshold off
    r = requests.put(f"{API}/admin/moderation-settings",
                     json={"inaccurate_auto_hide_threshold": 0}, headers=_h(admin_tok))
    assert r.status_code == 200
    # Create a post
    body = {"type": "update", "title": f"TEST82 zero {uuid.uuid4().hex[:6]}",
            "body": f"TEST82 zero-threshold post {uuid.uuid4().hex[:6]}", "market": "Greater Seattle"}
    rp = requests.post(f"{API}/posts", json=body, headers=_h(admin_tok))
    assert rp.status_code in (200, 201), rp.text
    post_id = rp.json()["id"]
    # File 3 inaccurate reports from distinct users
    for i in range(3):
        u = _register_user(f"Z{i}")
        rr = requests.post(f"{API}/reports", headers=_h(u["token"]), json={
            "target_type": "post", "target_id": post_id,
            "reason": f"TEST82 zero #{i}", "category": "inaccurate",
        })
        assert rr.status_code == 200
        assert rr.json().get("hidden") is False
    # Still visible
    lst = requests.get(f"{API}/posts?market=Greater%20Seattle").json()
    posts_list = lst.get("posts") if isinstance(lst, dict) else lst
    ids = [p.get("id") for p in (posts_list or [])]
    assert post_id in ids


def test_inappropriate_still_hides_first_flag():
    admin_tok = _admin_token()
    body = {"type": "update", "title": f"TEST82 inapp {uuid.uuid4().hex[:6]}",
            "body": f"TEST82 inappropriate post {uuid.uuid4().hex[:6]}", "market": "Greater Seattle"}
    rp = requests.post(f"{API}/posts", json=body, headers=_h(admin_tok))
    assert rp.status_code in (200, 201)
    post_id = rp.json()["id"]
    u = _register_user("INAPP")
    rr = requests.post(f"{API}/reports", headers=_h(u["token"]), json={
        "target_type": "post", "target_id": post_id,
        "reason": "TEST82 bad", "category": "inappropriate",
    })
    assert rr.status_code == 200
    assert rr.json().get("hidden") is True


# ========== Admin event edit incl. aggregator ==========
def test_admin_can_edit_any_event_including_aggregator():
    tok = _admin_token()
    # Find aggregator event or make one
    r = requests.get(f"{API}/admin/events", headers=_h(tok))
    assert r.status_code == 200
    events = r.json()
    agg = next((e for e in events if e.get("source") == "aggregator"), None)
    if not agg:
        # No aggregator event available — fall back to any event, but flag.
        agg = events[0] if events else None
    assert agg, "No events available to test admin edit on"

    ev_id = agg["id"]
    new_title = f"TEST82 admin-edited {uuid.uuid4().hex[:6]}"
    payload = {
        "title": new_title,
        "organizer_name": "TEST82 Organizer",
        "organizer_email": "test82@example.com",
        "registration_url": "https://example.com/register",
        "location": "TEST82 Marina",
        "description": "TEST82 desc",
    }
    r2 = requests.patch(f"{API}/admin/events/{ev_id}", json=payload, headers=_h(tok))
    assert r2.status_code == 200, r2.text
    updated = r2.json()
    assert updated["title"] == new_title
    assert updated.get("admin_edited") is True
    assert updated.get("organizer_name") == "TEST82 Organizer"
    assert updated.get("organizer_email") == "test82@example.com"
    assert updated.get("registration_url") == "https://example.com/register"

    # Non-admin blocked
    u = _register_user("NA")
    r3 = requests.patch(f"{API}/admin/events/{ev_id}", json={"title": "hack"}, headers=_h(u["token"]))
    assert r3.status_code in (401, 403)
