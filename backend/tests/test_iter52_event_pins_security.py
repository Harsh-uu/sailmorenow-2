"""Iter52: event location pins (lat/lng) + security hardening (events PII, users/search auth, seed no-op, admin reminder endpoints)."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ENV = dotenv_values("/app/backend/.env")
PARTNER_TOKEN = "test_iter51_partner_token"
ADMIN_TOKEN = "test_iter51_admin_token"
MEMBER_TOKEN = "test_iter52_member_token"
MARKET = "Greater Seattle"


def _sess(token=None):
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
    return s


@pytest.fixture(scope="session")
def db():
    return MongoClient(os.environ.get("MONGO_URL") or ENV["MONGO_URL"])[
        os.environ.get("DB_NAME") or ENV["DB_NAME"]]


@pytest.fixture(scope="session", autouse=True)
def mint_member(db):
    """Mint a member (crew.alex) session used for 403/401 checks."""
    u = db.users.find_one({"email": "crew.alex@sailmorenow.dev"}, {"user_id": 1})
    assert u, "seeded crew.alex missing"
    db.user_sessions.delete_many({"session_token": MEMBER_TOKEN})
    db.user_sessions.insert_one({
        "user_id": u["user_id"], "session_token": MEMBER_TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=2),
        "created_at": datetime.now(timezone.utc),
    })
    yield u["user_id"]


@pytest.fixture(scope="session")
def anon():
    return _sess()


@pytest.fixture(scope="session")
def partner():
    return _sess(PARTNER_TOKEN)


@pytest.fixture(scope="session")
def member(mint_member):
    return _sess(MEMBER_TOKEN)


@pytest.fixture(scope="session")
def admin():
    return _sess(ADMIN_TOKEN)


@pytest.fixture(scope="session")
def created_ids(db):
    ids = []
    yield ids
    if ids:
        db.events.delete_many({"id": {"$in": ids}})
    db.user_sessions.delete_many({"session_token": MEMBER_TOKEN})


def _payload(**kw):
    body = {
        "title": "TEST_iter52 " + uuid.uuid4().hex[:6],
        "description": "Pin test event",
        "market": MARKET,
        "starts_at": (datetime.now(timezone.utc) + timedelta(days=6)).isoformat(),
    }
    body.update(kw)
    return body


# ---------- Module: POST /api/events lat/lng ----------
class TestEventPins:
    def test_create_event_with_pin_persists(self, partner, created_ids):
        r = partner.post(f"{BASE}/events", json=_payload(lat=47.68, lng=-122.4))
        assert r.status_code == 200, r.text
        d = r.json()
        created_ids.append(d["id"])
        assert d["lat"] == 47.68 and d["lng"] == -122.4
        assert "_id" not in d
        # GET verification via public list
        lst = requests.get(f"{BASE}/events").json()
        row = next((e for e in lst if e["id"] == d["id"]), None)
        assert row, "created pinned event not in GET /api/events"
        assert row["lat"] == 47.68 and row["lng"] == -122.4

    def test_create_event_bad_lat_422(self, partner):
        r = partner.post(f"{BASE}/events", json=_payload(lat=999, lng=-122.4))
        assert r.status_code == 422, f"{r.status_code} {r.text[:200]}"

    def test_create_event_bad_lng_422(self, partner):
        r = partner.post(f"{BASE}/events", json=_payload(lat=47.6, lng=-500))
        assert r.status_code == 422, f"{r.status_code} {r.text[:200]}"

    def test_create_event_without_pin_has_null_latlng(self, partner, created_ids):
        r = partner.post(f"{BASE}/events", json=_payload())
        assert r.status_code == 200, r.text
        d = r.json()
        created_ids.append(d["id"])
        assert d.get("lat") is None and d.get("lng") is None
        lst = requests.get(f"{BASE}/events").json()
        row = next(e for e in lst if e["id"] == d["id"])
        assert row.get("lat") is None and row.get("lng") is None

    def test_anon_cannot_create_event(self, anon):
        r = anon.post(f"{BASE}/events", json=_payload(lat=47.6, lng=-122.3))
        assert r.status_code == 401


# ---------- Module: events PII exposure ----------
class TestEventsPII:
    @pytest.fixture(scope="class", autouse=True)
    def own_event(self, partner, created_ids):
        """Own event (has organizer_email in DB) so the admin view has something to expose."""
        r = partner.post(f"{BASE}/events", json=_payload(lat=47.62, lng=-122.35))
        assert r.status_code == 200, r.text
        created_ids.append(r.json()["id"])
        return r.json()["id"]

    def test_public_events_hide_organizer_email(self, anon, own_event):
        items = anon.get(f"{BASE}/events").json()
        assert any(e["id"] == own_event for e in items)
        assert isinstance(items, list) and items
        assert all("organizer_email" not in e for e in items)
        assert all("email_recipients" not in e for e in items)
        assert all("_id" not in e for e in items)

    def test_member_events_hide_organizer_email(self, member):
        items = member.get(f"{BASE}/events").json()
        assert all("organizer_email" not in e for e in items)

    def test_admin_events_still_expose_organizer_email(self, admin, own_event):
        r = admin.get(f"{BASE}/admin/events")
        assert r.status_code == 200, r.text
        items = r.json()
        items = items.get("events", items) if isinstance(items, dict) else items
        row = next((e for e in items if e["id"] == own_event), None)
        assert row, "own event missing from admin events"
        assert row.get("organizer_email") == "partner.psss@sailmorenow.dev", row


# ---------- Module: users/search auth + seed no-op ----------
class TestSearchAndSeed:
    def test_users_search_anon_401(self, anon):
        r = anon.get(f"{BASE}/users/search?q=a")
        assert r.status_code == 401, f"{r.status_code} {r.text[:200]}"

    def test_users_search_member_200(self, member):
        r = member.get(f"{BASE}/users/search?q=a")
        assert r.status_code == 200, r.text
        data = r.json()
        items = data.get("users", data) if isinstance(data, dict) else data
        assert isinstance(items, list)

    def test_seed_is_noop(self, anon):
        r = anon.post(f"{BASE}/seed")
        assert r.status_code == 200, r.text
        assert r.json().get("seeded") is False, r.text[:200]


# ---------- Module: admin reminder / review-alert endpoints ----------
class TestAdminEventJobs:
    def test_send_reminders_member_403(self, member):
        assert member.post(f"{BASE}/admin/events/send-reminders").status_code == 403

    def test_review_alert_member_403(self, member):
        assert member.post(f"{BASE}/admin/events/review-alert").status_code == 403

    def test_send_reminders_anon_401_403(self, anon):
        assert anon.post(f"{BASE}/admin/events/send-reminders").status_code in (401, 403)

    def test_send_reminders_admin_200(self, admin):
        r = admin.post(f"{BASE}/admin/events/send-reminders")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, dict) and d, r.text[:300]
        assert any(isinstance(v, int) for v in d.values()), f"no numeric counts: {d}"

    def test_review_alert_admin_200(self, admin):
        r = admin.post(f"{BASE}/admin/events/review-alert")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), dict)
