"""iter40 / Phase R backend tests.

Covers:
 - GET /api/messages/threads  -> per-thread `unread` counts
 - GET /api/handle/available  -> availability badge endpoint
 - GET /api/admin/contact     -> admin contact queue
"""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

TOK_A = "test_sess_iter40_a"
TOK_B = "test_sess_iter40_b"
TOK_ADMIN = "test_sess_iter40_admin"
UID_A = "test-iter40-a"
UID_B = "test-iter40-b"
UID_ADMIN = "test-iter40-admin"
THREAD_AB = "-".join(sorted([UID_A, UID_B]))


def client(token=None):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---------------------------------------------------------------- unread badges
class TestThreadUnread:
    def test_unauthenticated_threads_401(self):
        r = client().get(f"{BASE_URL}/api/messages/threads")
        assert r.status_code == 401

    def test_recipient_sees_unread_two(self):
        r = client(TOK_B).get(f"{BASE_URL}/api/messages/threads")
        assert r.status_code == 200
        threads = r.json()
        assert isinstance(threads, list)
        t = next((x for x in threads if x["thread_id"] == THREAD_AB), None)
        assert t is not None, f"thread {THREAD_AB} missing from {[x.get('thread_id') for x in threads]}"
        assert t["unread"] == 2, t
        assert isinstance(t["unread"], int)
        assert t["other_user"]["user_id"] == UID_A
        assert "_id" not in t

    def test_sender_side_unread_zero(self):
        r = client(TOK_A).get(f"{BASE_URL}/api/messages/threads")
        assert r.status_code == 200
        t = next((x for x in r.json() if x["thread_id"] == THREAD_AB), None)
        assert t is not None
        assert t["unread"] == 0, t
        # Thread where A sent the only message -> still 0 for A
        t2 = next((x for x in r.json() if x["thread_id"] == "-".join(sorted([UID_A, UID_ADMIN]))), None)
        assert t2 is not None
        assert t2["unread"] == 0, t2

    def test_unread_zero_after_mark_read(self):
        rd = client(TOK_B).post(f"{BASE_URL}/api/messages/{THREAD_AB}/read")
        assert rd.status_code == 200, rd.text[:300]
        body = rd.json()
        assert body.get("marked", 0) >= 2 or body.get("ok"), body

        r = client(TOK_B).get(f"{BASE_URL}/api/messages/threads")
        assert r.status_code == 200
        t = next((x for x in r.json() if x["thread_id"] == THREAD_AB), None)
        assert t["unread"] == 0, t


# ------------------------------------------------------------ handle availability
class TestHandleAvailable:
    def test_fresh_handle_available(self):
        r = client().get(f"{BASE_URL}/api/handle/available", params={"q": "test40freshhandle"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["reason"] is None
        assert d["handle"] == "test40freshhandle"

    def test_existing_handle_taken(self):
        r = client().get(f"{BASE_URL}/api/handle/available", params={"q": "test40alpha"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is False
        assert d["reason"] == "taken"

    def test_case_insensitive_taken(self):
        r = client().get(f"{BASE_URL}/api/handle/available", params={"q": "TEST40Alpha"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is False, d
        assert d["reason"] == "taken"
        assert d["handle"] == "test40alpha"

    def test_at_prefix_stripped(self):
        r = client().get(f"{BASE_URL}/api/handle/available", params={"q": "@test40alpha"})
        assert r.status_code == 200
        assert r.json()["reason"] == "taken"

    @pytest.mark.parametrize("bad", ["ab", "", "a" * 21, "bad handle", "bad-handle", "bad!", "@"])
    def test_invalid_handles(self, bad):
        r = client().get(f"{BASE_URL}/api/handle/available", params={"q": bad})
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["ok"] is False
        assert d["reason"] == "invalid", (bad, d)

    def test_boundary_lengths_valid(self):
        for h in ["ab3", "a" * 20]:
            d = client().get(f"{BASE_URL}/api/handle/available", params={"q": h}).json()
            assert d["reason"] != "invalid", (h, d)

    def test_no_q_param(self):
        r = client().get(f"{BASE_URL}/api/handle/available")
        assert r.status_code == 200
        assert r.json()["reason"] == "invalid"


# --------------------------------------------------------------- admin contact
class TestAdminContact:
    def test_unauthenticated_401(self):
        r = client().get(f"{BASE_URL}/api/admin/contact")
        assert r.status_code == 401, r.status_code

    def test_non_admin_403(self):
        r = client(TOK_A).get(f"{BASE_URL}/api/admin/contact")
        assert r.status_code == 403, r.status_code

    def test_admin_200_shape_and_sort(self):
        r = client(TOK_ADMIN).get(f"{BASE_URL}/api/admin/contact")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert set(["count", "total", "messages"]).issubset(d.keys())
        assert isinstance(d["messages"], list)
        assert d["count"] == len(d["messages"])
        assert d["total"] >= d["count"]
        created = [m["created_at"] for m in d["messages"] if m.get("created_at")]
        assert created == sorted(created, reverse=True), "not sorted DESC by created_at"
        for m in d["messages"]:
            assert "_id" not in m
        seeded = [m for m in d["messages"] if str(m.get("name", "")).startswith("TEST_iter40")]
        assert len(seeded) >= 2, "seeded TEST_iter40 contact rows not returned"
        assert {"id", "name", "email", "message", "created_at"}.issubset(seeded[0].keys())

    def test_limit_param_respected(self):
        d = client(TOK_ADMIN).get(f"{BASE_URL}/api/admin/contact", params={"limit": 1}).json()
        assert d["count"] == 1

    def test_limit_zero_clamped_to_one(self):
        d = client(TOK_ADMIN).get(f"{BASE_URL}/api/admin/contact", params={"limit": 0}).json()
        assert d["count"] == 1, d["count"]

    def test_limit_above_cap_clamped(self):
        d = client(TOK_ADMIN).get(f"{BASE_URL}/api/admin/contact", params={"limit": 100000}).json()
        assert d["count"] <= 500
