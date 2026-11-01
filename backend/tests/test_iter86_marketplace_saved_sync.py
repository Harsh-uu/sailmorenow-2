"""Iter 86 — backend tests for Sail More Now:
- For Sale posts (image_urls cap 6, price/condition, type=for_sale filter)
- Saved items CRUD + /saved/ids
- Discussion comments (POST /api/posts/{discussionId}/comments must succeed)
- GET /api/discussions returns comment_count
- GET /api/admin/events/sync-status
- Event create/update persists volunteer_reminder_lead_days
"""
import os
import pytest
import requests
import uuid
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "jenn@sailmorenow.com"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("session_token")
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


# --------- For Sale posts: image_urls cap 6, price/condition, filter ---------
class TestForSalePosts:
    def test_create_for_sale_caps_images_to_6(self, admin_session):
        imgs = [f"https://picsum.photos/seed/{i}/300/200" for i in range(10)]
        payload = {
            "type": "for_sale",
            "title": "TEST86 Winch for sale",
            "body": "Lightly used Lewmar #40 winch.",
            "market": "Greater Seattle",
            "image_urls": imgs,
            "price": 125.5,
            "condition": "Good",
            "expires_days": 7,
        }
        r = admin_session.post(f"{BASE_URL}/api/posts", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d.get("image_urls", [])) == 6
        assert d.get("image_url") == imgs[0]
        assert d.get("price") == 125.5
        assert d.get("condition") == "Good"
        assert d.get("type") == "for_sale"

        # GET filter by type=for_sale returns it
        r2 = admin_session.get(f"{BASE_URL}/api/posts?type=for_sale", timeout=15)
        assert r2.status_code == 200
        found = next((p for p in r2.json() if p.get("id") == d["id"]), None)
        assert found, "created for_sale post not found in filter"
        assert found.get("price") == 125.5
        assert found.get("condition") == "Good"
        assert len(found.get("image_urls", [])) == 6


# --------- Saved items (bookmarks) ---------
class TestSavedItems:
    def test_saved_post_roundtrip(self, admin_session):
        # Create a post to save
        r = admin_session.post(f"{BASE_URL}/api/posts", json={
            "type": "discussion", "title": "TEST86 Saved post",
            "body": "body", "market": "Greater Seattle", "expires_days": 7,
        }, timeout=15)
        assert r.status_code == 200
        pid = r.json()["id"]

        # Save
        r = admin_session.post(f"{BASE_URL}/api/saved",
                               json={"target_type": "post", "target_id": pid}, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"saved": True}

        # /saved/ids contains it
        r = admin_session.get(f"{BASE_URL}/api/saved/ids", timeout=15)
        assert r.status_code == 200
        assert pid in r.json().get("ids", [])

        # /saved list hydrates the doc + flags saved_type
        r = admin_session.get(f"{BASE_URL}/api/saved", timeout=15)
        assert r.status_code == 200
        hit = next((x for x in r.json() if x.get("id") == pid), None)
        assert hit is not None
        assert hit.get("saved_type") == "post"
        assert hit.get("saved_at")

        # Delete
        r = admin_session.delete(f"{BASE_URL}/api/saved/{pid}", timeout=15)
        assert r.status_code == 200
        assert r.json() == {"saved": False}

        # No longer in ids
        r = admin_session.get(f"{BASE_URL}/api/saved/ids", timeout=15)
        assert pid not in r.json().get("ids", [])

    def test_saved_discussion_roundtrip(self, admin_session):
        # Create a forum discussion (auto-published)
        r = admin_session.post(f"{BASE_URL}/api/discussions", json={
            "kind": "forum", "title": "TEST86 Saved disc",
            "body": "body", "market": "Greater Seattle",
        }, timeout=15)
        assert r.status_code == 200
        did = r.json()["id"]

        r = admin_session.post(f"{BASE_URL}/api/saved",
                               json={"target_type": "discussion", "target_id": did}, timeout=15)
        assert r.status_code == 200
        r = admin_session.get(f"{BASE_URL}/api/saved", timeout=15)
        hit = next((x for x in r.json() if x.get("id") == did), None)
        assert hit is not None
        assert hit.get("saved_type") == "discussion"

        admin_session.delete(f"{BASE_URL}/api/saved/{did}", timeout=15)

    def test_saved_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/saved",
                          json={"target_type": "post", "target_id": "x"}, timeout=15)
        assert r.status_code == 401


# --------- Discussion comments via /posts/{id}/comments ---------
class TestDiscussionComments:
    def test_comment_on_discussion_succeeds(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/discussions", json={
            "kind": "forum", "title": "TEST86 comment target",
            "body": "body", "market": "Greater Seattle",
        }, timeout=15)
        assert r.status_code == 200
        did = r.json()["id"]

        # This used to return 'post not found' — must now succeed.
        r = admin_session.post(f"{BASE_URL}/api/posts/{did}/comments",
                               json={"body": "TEST86 comment hi"}, timeout=15)
        assert r.status_code == 200, f"unexpected: {r.status_code} {r.text}"
        cid = r.json().get("id")
        assert cid

        # Comment list reflects it
        r = admin_session.get(f"{BASE_URL}/api/posts/{did}/comments", timeout=15)
        assert r.status_code == 200
        assert any(c.get("id") == cid for c in r.json())

        # GET /api/discussions includes comment_count >= 1 for this item
        r = admin_session.get(f"{BASE_URL}/api/discussions?kind=forum", timeout=15)
        assert r.status_code == 200
        hit = next((d for d in r.json() if d.get("id") == did), None)
        assert hit is not None
        assert hit.get("comment_count", 0) >= 1


# --------- Sync status ---------
class TestSyncStatus:
    def test_admin_sync_status_shape(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/events/sync-status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        # keys present (values may be null if never synced)
        for k in ("last_run_at", "next_run_at", "last_inserted", "last_updated", "last_errors", "sources"):
            assert k in d, f"missing {k} in sync-status response"

    def test_sync_status_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/events/sync-status", timeout=15)
        assert r.status_code in (401, 403)


# --------- Event volunteer_reminder_lead_days persistence ---------
class TestVolunteerLeadDays:
    def test_event_create_and_update_lead_days(self, admin_session):
        starts = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
        r = admin_session.post(f"{BASE_URL}/api/events", json={
            "title": "TEST86 Volunteer event",
            "description": "Help us rig the J/80.",
            "market": "Greater Seattle",
            "starts_at": starts,
            "is_volunteer": True,
            "volunteer_reminder_lead_days": 3,
        }, timeout=15)
        assert r.status_code == 200, r.text
        ev = r.json()
        eid = ev.get("id")
        assert eid
        assert ev.get("volunteer_reminder_lead_days") == 3

        # GET verifies persistence via list endpoint
        r = admin_session.get(f"{BASE_URL}/api/events?market=Greater Seattle", timeout=15)
        assert r.status_code == 200
        hit = next((e for e in r.json() if e.get("id") == eid), None)
        assert hit is not None
        assert hit.get("volunteer_reminder_lead_days") == 3

        # Update to 7
        r = admin_session.patch(f"{BASE_URL}/api/events/{eid}",
                              json={"volunteer_reminder_lead_days": 7}, timeout=15)
        assert r.status_code == 200, r.text

        r = admin_session.get(f"{BASE_URL}/api/events?market=Greater Seattle", timeout=15)
        assert r.status_code == 200
        hit = next((e for e in r.json() if e.get("id") == eid), None)
        assert hit is not None
        assert hit.get("volunteer_reminder_lead_days") == 7

        # Clean up
        admin_session.delete(f"{BASE_URL}/api/events/{eid}", timeout=15)
