"""iter43 / Phase S backend regression tests (retest of iter42).

Features under test:
  1. GET  /api/handle/available        -> 30 req / 60s throttle per X-Forwarded-For
  2. POST /api/boat-pros               -> BoatProUpsert.photos strip + dedup + cap 6
  3. POST /api/admin/contact/{id}/reply-> 401/403/404/400/200 + replies persistence
Fixtures seeded by /app/backend/tests/seed_iter43_ui.py
"""
import os
import sys
import uuid

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, "/app/backend")

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing from env and /app/frontend/.env")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

TOK_ADMIN = "test_sess_iter43_admin"
TOK_USER = "test_sess_iter43_user"
TOK_PRO = "test_sess_iter43_pro"
CONTACT_ID = "test-iter43-contact"
PRO_UID = "test-iter43-pro"


def client(token=None):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def rand_ip():
    n = uuid.uuid4().int
    return f"7.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250}"


# ------------------------------------------------------- feature 1: throttle
class TestAvailabilityThrottle:
    def test_single_request_ok(self):
        r = client().get(f"{API}/handle/available", params={"q": "abc"},
                         headers={"X-Forwarded-For": rand_ip()})
        assert r.status_code == 200
        body = r.json()
        assert "ok" in body and isinstance(body["ok"], bool)

    def test_30_ok_then_429(self):
        ip = rand_ip()
        c = client()
        codes = [c.get(f"{API}/handle/available", params={"q": "abc"},
                       headers={"X-Forwarded-For": ip}).status_code for _ in range(31)]
        assert codes[:30] == [200] * 30, f"first 30 should be 200: {codes[:30]}"
        assert codes[30] == 429, f"31st should be 429, got {codes[30]}"

    def test_429_detail_message(self):
        ip = rand_ip()
        c = client()
        for _ in range(30):
            c.get(f"{API}/handle/available", params={"q": "abc"},
                  headers={"X-Forwarded-For": ip})
        r = c.get(f"{API}/handle/available", params={"q": "abc"},
                  headers={"X-Forwarded-For": ip})
        assert r.status_code == 429
        assert "too many" in r.json().get("detail", "").lower()

    def test_other_ip_unaffected(self):
        ip_a, ip_b = rand_ip(), rand_ip()
        c = client()
        for _ in range(31):
            c.get(f"{API}/handle/available", params={"q": "abc"},
                  headers={"X-Forwarded-For": ip_a})
        r = c.get(f"{API}/handle/available", params={"q": "abc"},
                  headers={"X-Forwarded-For": ip_b})
        assert r.status_code == 200

    def test_taken_handle_still_reported(self):
        r = client().get(f"{API}/handle/available", params={"q": "captainjane"},
                         headers={"X-Forwarded-For": rand_ip()})
        assert r.status_code == 200
        assert r.json() == {"ok": False, "reason": "taken", "handle": "captainjane"}


# ------------------------------------------------------- feature 2: pro photos
class TestBoatProPhotos:
    def test_schema_declares_photos(self):
        from schemas import BoatProUpsert  # noqa: PLC0415
        assert "photos" in BoatProUpsert.model_fields

    def test_upsert_strips_dedups_and_caps_at_six(self):
        payload = {
            "company_name": "TEST_iter43 Pro Co",
            "contact_email": "test.iter43.pro@sailmorenow.dev",
            "categories": ["Rigging"],
            "markets": ["Greater Seattle"],
            "photos": [" a ", "", "b", "a", "c", "d", "e", "f", "g"],
        }
        r = client(TOK_PRO).post(f"{API}/boat-pros", json=payload)
        assert r.status_code == 200, r.text[:300]
        doc = r.json()
        assert "_id" not in doc
        assert doc["photos"] == ["a", "b", "c", "d", "e", "f"], doc["photos"]
        assert doc["user_id"] == PRO_UID

    def test_get_list_returns_photos(self):
        r = client().get(f"{API}/boat-pros", params={"market": "Greater Seattle"})
        assert r.status_code == 200
        pros = r.json()
        mine = next((p for p in pros if p.get("user_id") == PRO_UID), None)
        assert mine is not None, "seeded TEST_iter43 pro missing from listing"
        assert mine.get("photos") == ["a", "b", "c", "d", "e", "f"], mine.get("photos")

    def test_empty_photos_default(self):
        payload = {
            "company_name": "TEST_iter43 Pro Co",
            "contact_email": "test.iter43.pro@sailmorenow.dev",
            "categories": ["Rigging"],
            "markets": ["Greater Seattle"],
        }
        r = client(TOK_PRO).post(f"{API}/boat-pros", json=payload)
        assert r.status_code == 200
        assert r.json()["photos"] == []

    def test_non_pro_cannot_upsert(self):
        r = client(TOK_USER).post(f"{API}/boat-pros", json={
            "company_name": "TEST_iter43 Nope",
            "contact_email": "test.iter43.user@sailmorenow.dev",
            "categories": ["Rigging"], "markets": ["Greater Seattle"], "photos": ["x"]})
        assert r.status_code == 403


# ------------------------------------------------------- feature 3: contact reply
class TestContactReply:
    def test_unauthenticated_401(self):
        r = client().post(f"{API}/admin/contact/{CONTACT_ID}/reply",
                          json={"body": "hello there"})
        assert r.status_code == 401, r.text[:200]

    def test_non_admin_403(self):
        r = client(TOK_USER).post(f"{API}/admin/contact/{CONTACT_ID}/reply",
                                  json={"body": "hello there"})
        assert r.status_code == 403, r.text[:200]

    def test_unknown_id_404(self):
        r = client(TOK_ADMIN).post(f"{API}/admin/contact/{uuid.uuid4().hex}/reply",
                                   json={"body": "hello there"})
        assert r.status_code == 404, r.text[:200]

    def test_body_too_short_400(self):
        r = client(TOK_ADMIN).post(f"{API}/admin/contact/{CONTACT_ID}/reply",
                                   json={"body": "hi"})
        assert r.status_code == 400, r.text[:200]

    def test_body_too_long_400(self):
        r = client(TOK_ADMIN).post(f"{API}/admin/contact/{CONTACT_ID}/reply",
                                   json={"body": "x" * 6001})
        assert r.status_code == 400, r.text[:200]

    def test_admin_reply_persists(self):
        text = f"TEST_iter43 reply {uuid.uuid4().hex[:8]}"
        c = client(TOK_ADMIN)
        r = c.post(f"{API}/admin/contact/{CONTACT_ID}/reply", json={"body": text})
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        entry = data["reply"]
        for k in ("id", "body", "at", "by", "by_name", "delivered"):
            assert k in entry, f"missing {k} in {entry}"
        assert entry["body"] == text
        assert entry["by"] == "test-iter43-admin"

        # GET verify persistence
        g = c.get(f"{API}/admin/contact")
        assert g.status_code == 200
        msg = next((m for m in g.json()["messages"] if m["id"] == CONTACT_ID), None)
        assert msg is not None
        assert msg["status"] == "replied"
        assert msg.get("last_reply_at")
        assert any(rp["body"] == text for rp in msg.get("replies", [])), msg.get("replies")
        assert "_id" not in msg
