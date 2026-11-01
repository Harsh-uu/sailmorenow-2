"""Iter51 backend tests: event categorizer, admin category override, forum threads."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

ADMIN_TOKEN = "test_iter51_admin_token"
PARTNER_TOKEN = "test_iter51_partner_token"
CATEGORIES = {"racing", "cruising", "education", "volunteering", "other"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin(client):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {ADMIN_TOKEN}"})
    r = s.get(f"{BASE_URL}/api/auth/me")
    if r.status_code != 200:
        pytest.fail(f"admin session invalid: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def partner():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {PARTNER_TOKEN}"})
    r = s.get(f"{BASE_URL}/api/auth/me")
    if r.status_code != 200:
        pytest.fail(f"partner session invalid: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def created_event_ids():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(created_event_ids):
    yield
    from pymongo import MongoClient
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    for eid in created_event_ids:
        db.events.delete_one({"id": eid})


def _future(days=10, hour=18):
    d = datetime.now(timezone.utc) + timedelta(days=days)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


# ---------- GET /api/events category ----------
class TestListEventsCategory:
    def test_all_events_have_valid_category(self, client):
        r = client.get(f"{BASE_URL}/api/events")
        assert r.status_code == 200
        evs = r.json()
        assert isinstance(evs, list) and len(evs) > 0
        missing = [e["id"] for e in evs if e.get("category") not in CATEGORIES]
        assert not missing, f"events without valid category: {missing[:5]}"
        assert all("category_needs_review" in e for e in evs), "category_needs_review missing"

    def test_category_racing_filter(self, client):
        r = client.get(f"{BASE_URL}/api/events", params={"category": "racing"})
        assert r.status_code == 200
        evs = r.json()
        assert len(evs) > 0, "no racing events returned"
        assert all(e["category"] == "racing" for e in evs)
        all_ev = client.get(f"{BASE_URL}/api/events").json()
        expected = {e["id"] for e in all_ev if e["category"] == "racing"}
        assert {e["id"] for e in evs} == expected

    @pytest.mark.parametrize("cat", ["cruising", "volunteering", "other", "education"])
    def test_other_category_filters(self, client, cat):
        r = client.get(f"{BASE_URL}/api/events", params={"category": cat})
        assert r.status_code == 200
        assert all(e["category"] == cat for e in r.json())

    def test_invalid_category_ignored(self, client):
        r = client.get(f"{BASE_URL}/api/events", params={"category": "bogus"})
        assert r.status_code == 200
        assert len(r.json()) == len(client.get(f"{BASE_URL}/api/events").json())

    def test_market_filter(self, client):
        r = client.get(f"{BASE_URL}/api/events", params={"market": "Greater Seattle"})
        assert r.status_code == 200
        evs = r.json()
        assert len(evs) > 0, "no Greater Seattle events"
        assert all(e["market"] == "Greater Seattle" for e in evs)

    def test_market_all_returns_all(self, client):
        r = client.get(f"{BASE_URL}/api/events", params={"market": "all"})
        assert r.status_code == 200
        assert len(r.json()) == len(client.get(f"{BASE_URL}/api/events").json())


# ---------- POST /api/events auto/manual category ----------
class TestCreateEventCategory:
    def test_manual_category_education(self, partner, created_event_ids):
        payload = {"title": f"TEST_ Manual Cat {uuid.uuid4().hex[:6]}", "description": "regatta race series",
                   "market": "Greater Seattle", "starts_at": _future(11), "location": "TEST_ dock",
                   "category": "education"}
        r = partner.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        created_event_ids.append(d["id"])
        assert d["category"] == "education"
        assert d.get("category_manual") is True
        assert d.get("category_needs_review") is False
        got = [e for e in partner.get(f"{BASE_URL}/api/events").json() if e["id"] == d["id"]]
        assert got and got[0]["category"] == "education"

    def test_auto_category_from_title(self, partner, created_event_ids):
        payload = {"title": f"TEST_ Spinnaker clinic {uuid.uuid4().hex[:6]}", "description": "hands on",
                   "market": "Greater Seattle", "starts_at": _future(12), "location": "TEST_ dock"}
        r = partner.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        created_event_ids.append(d["id"])
        assert d["category"] == "education", d
        assert d.get("category_manual") is not True

    def test_auto_category_is_race(self, partner, created_event_ids):
        payload = {"title": f"TEST_ Mystery gathering {uuid.uuid4().hex[:6]}", "description": "no keywords here",
                   "market": "Greater Seattle", "starts_at": _future(13), "location": "TEST_ dock",
                   "is_race": True}
        r = partner.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        created_event_ids.append(d["id"])
        assert d["category"] == "racing"
        assert d["category_needs_review"] is False

    def test_auto_category_unknown_needs_review(self, partner, created_event_ids):
        payload = {"title": f"TEST_ Zzz {uuid.uuid4().hex[:6]}", "description": "nondescript text",
                   "market": "Greater Seattle", "starts_at": _future(14), "location": "TEST_ dock"}
        r = partner.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        created_event_ids.append(d["id"])
        assert d["category"] == "other"
        assert d["category_needs_review"] is True

    def test_invalid_category_falls_back_to_auto(self, partner, created_event_ids):
        payload = {"title": f"TEST_ Frostbite regatta {uuid.uuid4().hex[:6]}", "description": "",
                   "market": "Greater Seattle", "starts_at": _future(15), "location": "TEST_ dock",
                   "category": "not-a-cat"}
        r = partner.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        created_event_ids.append(d["id"])
        assert d["category"] == "racing"
        assert d.get("category_manual") is not True


# ---------- PATCH /api/admin/events/{id}/category ----------
class TestAdminCategoryOverride:
    def test_admin_list_events_has_category_fields(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/events")
        assert r.status_code == 200
        evs = r.json() if isinstance(r.json(), list) else r.json().get("events", [])
        assert len(evs) > 0
        assert all(e.get("category") in CATEGORIES for e in evs)
        assert all("category_needs_review" in e for e in evs)
        assert all("_id" not in e for e in evs)

    def test_override_category(self, admin, partner, created_event_ids):
        payload = {"title": f"TEST_ Override target {uuid.uuid4().hex[:6]}", "description": "",
                   "market": "Greater Seattle", "starts_at": _future(16), "location": "TEST_ dock"}
        eid = partner.post(f"{BASE_URL}/api/events", json=payload).json()["id"]
        created_event_ids.append(eid)
        r = admin.patch(f"{BASE_URL}/api/admin/events/{eid}/category", json={"category": "volunteering"})
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["category"] == "volunteering"
        assert d["category_manual"] is True
        assert d["category_needs_review"] is False
        evs = admin.get(f"{BASE_URL}/api/admin/events").json()
        evs = evs if isinstance(evs, list) else evs.get("events", [])
        row = next((e for e in evs if e["id"] == eid), None)
        assert row and row["category"] == "volunteering" and row["category_needs_review"] is False
        pub = next((e for e in admin.get(f"{BASE_URL}/api/events").json() if e["id"] == eid), None)
        assert pub and pub["category"] == "volunteering"
        f = admin.get(f"{BASE_URL}/api/events", params={"category": "volunteering"}).json()
        assert eid in {e["id"] for e in f}

    def test_invalid_category_400(self, admin, partner, created_event_ids):
        payload = {"title": f"TEST_ Bad cat {uuid.uuid4().hex[:6]}", "description": "",
                   "market": "Greater Seattle", "starts_at": _future(17), "location": "TEST_ dock"}
        eid = partner.post(f"{BASE_URL}/api/events", json=payload).json()["id"]
        created_event_ids.append(eid)
        r = admin.patch(f"{BASE_URL}/api/admin/events/{eid}/category", json={"category": "sailing"})
        assert r.status_code == 400, r.status_code

    def test_non_admin_403(self, partner, created_event_ids):
        payload = {"title": f"TEST_ Nonadmin {uuid.uuid4().hex[:6]}", "description": "",
                   "market": "Greater Seattle", "starts_at": _future(18), "location": "TEST_ dock"}
        eid = partner.post(f"{BASE_URL}/api/events", json=payload).json()["id"]
        created_event_ids.append(eid)
        r = partner.patch(f"{BASE_URL}/api/admin/events/{eid}/category", json={"category": "racing"})
        assert r.status_code == 403, r.status_code

    def test_unauthenticated_401_or_403(self, client, created_event_ids):
        eid = created_event_ids[0] if created_event_ids else "missing"
        r = client.patch(f"{BASE_URL}/api/admin/events/{eid}/category", json={"category": "racing"})
        assert r.status_code in (401, 403), r.status_code

    def test_unknown_event_404(self, admin):
        r = admin.patch(f"{BASE_URL}/api/admin/events/{uuid.uuid4()}/category", json={"category": "racing"})
        assert r.status_code == 404, f"expected 404 for unknown event, got {r.status_code}"


# ---------- Forum ----------
class TestForum:
    def test_forum_threads_seeded(self, client):
        r = client.get(f"{BASE_URL}/api/discussions", params={"kind": "forum"})
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", data.get("discussions", []))
        assert len(items) >= 5, f"expected >=5 forum threads, got {len(items)}"
        assert all(i.get("kind") == "forum" for i in items)
        assert all("_id" not in i for i in items)
