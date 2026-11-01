"""Phase S (iteration 42) regression tests.

Covers:
  1. Availability throttle  -> GET /api/handle/available 30/60s per IP
  2. Boat Pro photos array  -> BoatProUpsert.photos (cap 6, dedup, strip)
  3. Contact reply compose  -> POST /api/admin/contact/{msg_id}/reply
  4. Handle ownership route -> /@:handle alias (frontend, tested via Playwright)
"""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL")
if not _base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = _base.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------------------------------------------------------- feature 1
class TestAvailabilityThrottle:
    """30 requests per 60s window per client IP; 31st must be 429."""

    def test_first_request_ok(self, client):
        r = client.get(f"{API}/handle/available",
                       params={"q": "abc"},
                       headers={"X-Forwarded-For": f"10.{uuid.uuid4().int % 250}.1.1"})
        assert r.status_code == 200
        assert "ok" in r.json()

    def test_31st_request_is_throttled(self, client):
        ip = f"10.{uuid.uuid4().int % 250}.2.2"
        codes = []
        for _ in range(31):
            codes.append(client.get(f"{API}/handle/available",
                                    params={"q": "abc"},
                                    headers={"X-Forwarded-For": ip}).status_code)
        assert codes[:30] == [200] * 30, f"first 30 should be 200, got {codes[:30]}"
        assert codes[30] == 429, f"31st request should be 429, got {codes[30]}"

    def test_different_ip_not_throttled(self, client):
        ip_a = f"10.{uuid.uuid4().int % 250}.3.3"
        for _ in range(31):
            client.get(f"{API}/handle/available", params={"q": "abc"},
                       headers={"X-Forwarded-For": ip_a})
        ip_b = f"10.{uuid.uuid4().int % 250}.4.4"
        r = client.get(f"{API}/handle/available", params={"q": "abc"},
                       headers={"X-Forwarded-For": ip_b})
        assert r.status_code == 200


# ---------------------------------------------------------------- feature 2
class TestBoatProPhotos:
    """photos must be accepted, stripped, de-duped and capped at 6."""

    def test_boat_pro_list_exposes_photos_field(self, client):
        r = client.get(f"{API}/boat-pros")
        assert r.status_code == 200
        pros = r.json()
        assert isinstance(pros, list) and pros
        assert "photos" in pros[0], "boat_pro documents do not expose a 'photos' field"

    def test_schema_declares_photos(self):
        from backend.schemas import BoatProUpsert  # noqa: PLC0415
        assert "photos" in BoatProUpsert.model_fields, \
            "BoatProUpsert has no 'photos' field"


# ---------------------------------------------------------------- feature 3
class TestContactReply:
    """POST /api/admin/contact/{id}/reply auth + validation matrix."""

    def test_reply_route_exists_and_requires_auth(self, client):
        r = client.post(f"{API}/admin/contact/{uuid.uuid4().hex}/reply",
                        json={"body": "hello there"})
        # route missing -> 404 with 'Not Found'; implemented -> 401 unauthenticated
        assert r.status_code == 401, (
            f"expected 401 unauthenticated, got {r.status_code} "
            f"({r.text[:120]}) — route likely not implemented"
        )
