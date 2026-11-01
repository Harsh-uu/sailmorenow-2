"""Iteration 67: tests for market-CSV filtering, PATCH /auth/markets,
and RSVP -> organizer notification."""
import os
import time
import uuid
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"


def _mint(user_email: str) -> str:
    """Mint a token via mongosh for a Google-only seeded user."""
    import subprocess
    token = f"test_session_it67_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    script = f"""
    const db = db.getSiblingDB('test_database');
    const u = db.users.findOne({{email:'{user_email}'}}, {{_id:0, user_id:1}});
    db.user_sessions.insertOne({{user_id: u.user_id, session_token: '{token}',
      expires_at: new Date(Date.now()+7*24*3600*1000), created_at: new Date()}});
    """
    subprocess.check_output(["mongosh", "--quiet", "--eval", script])
    return token


def _hdr(token): return {"Authorization": f"Bearer {token}"}


# --- Markets CSV filter ---
def test_posts_markets_csv_filter():
    r = requests.get(f"{API}/posts?markets=Greater%20Seattle,Kirkland", timeout=15)
    assert r.status_code == 200
    for p in r.json():
        assert p.get("market") in ("Greater Seattle", "Kirkland", None), p.get("market")


def test_events_markets_csv_filter():
    r = requests.get(f"{API}/events?markets=Greater%20Seattle", timeout=15)
    assert r.status_code == 200


def test_discussions_markets_csv_filter():
    r = requests.get(f"{API}/discussions?markets=Greater%20Seattle,Everett", timeout=15)
    assert r.status_code == 200


def test_crew_bank_open_markets_csv():
    r = requests.get(f"{API}/crew-bank/open?markets=Greater%20Seattle,Everett", timeout=15)
    assert r.status_code == 200
    for e in r.json():
        assert e.get("market") in ("Greater Seattle", "Everett", None)


def test_crew_bank_standalone_markets_csv():
    r = requests.get(f"{API}/crew-bank/standalone?markets=Greater%20Seattle", timeout=15)
    assert r.status_code == 200


# --- PATCH /api/auth/markets keeps primary_market ---
def test_patch_auth_markets_keeps_primary():
    tok = _mint("pro.marina@sailmorenow.dev")
    # Get current
    me = requests.get(f"{API}/auth/me", headers=_hdr(tok), timeout=15).json()
    primary = me.get("primary_market")
    assert primary, "seed_marina has a primary_market"
    # PATCH to a set without primary
    body = {"markets": ["Kirkland"]}
    r = requests.patch(f"{API}/auth/markets", headers=_hdr(tok), json=body, timeout=15)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert primary in (updated.get("markets") or []), \
        f"primary_market {primary} must remain in markets, got {updated.get('markets')}"
    # Restore full set
    requests.patch(f"{API}/auth/markets", headers=_hdr(tok),
                   json={"markets": ["Greater Seattle", "Kirkland", "Everett"]}, timeout=15)


# --- RSVP -> organizer notification ---
def test_rsvp_creates_organizer_notification():
    organizer = _mint("captain.jane@sailmorenow.dev")
    rsvper = _mint("crew.alex@sailmorenow.dev")

    # Get organizer id
    org_me = requests.get(f"{API}/auth/me", headers=_hdr(organizer), timeout=15).json()
    organizer_id = org_me["user_id"]

    # Create event as organizer
    payload = {
        "title": f"TEST_RSVP_{uuid.uuid4().hex[:6]}",
        "description": "iter67 rsvp notif test",
        "starts_at": "2099-01-01T10:00:00Z",
        "location": "Marina A",
        "market": "Greater Seattle",
    }
    r = requests.post(f"{API}/events", headers=_hdr(organizer), json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    event = r.json()
    ev_id = event.get("id") or event.get("_id") or event.get("event_id")
    assert ev_id, f"no id in {event}"

    # Snapshot organizer notif count before
    def _items(resp):
        j = resp.json()
        return j.get("items", j) if isinstance(j, dict) else j

    before = requests.get(f"{API}/notifications", headers=_hdr(organizer), timeout=15)
    before_ids = {n.get("id") for n in _items(before)} if before.status_code == 200 else set()

    # RSVP as another user (endpoint is /register with kind=attendee)
    r = requests.post(f"{API}/events/{ev_id}/register", headers=_hdr(rsvper),
                      json={"kind": "attendee"}, timeout=15)
    assert r.status_code in (200, 201), r.text

    time.sleep(1.0)

    after = requests.get(f"{API}/notifications", headers=_hdr(organizer), timeout=15)
    assert after.status_code == 200
    new_notifs = [n for n in _items(after) if n.get("id") not in before_ids]
    kinds = [n.get("kind") or n.get("type") for n in new_notifs]
    assert any(k in ("event_rsvp", "rsvp") for k in kinds), \
        f"expected event_rsvp notification, got kinds={kinds}, new={new_notifs[:3]}"
