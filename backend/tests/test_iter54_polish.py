"""Iter54 polish batch backend tests: push prefs validation, boat-pros order,
profile photo PATCH, boat-pro-categories contains Outboard Motor Specialist."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
MEMBER = "test_iter54_member_token"
PARTNER = "test_iter54_partner_token"
ADMIN = "test_iter54_admin_token"


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Push preferences validation ----------
class TestPushPrefs:
    def test_invalid_reminder_hour_25(self):
        r = requests.patch(f"{BASE}/api/push/preferences",
                            json={"preferences": {}, "reminder_hour": 25}, headers=H(MEMBER))
        assert r.status_code == 400, r.text

    def test_valid_reminder_hour_persists(self):
        # Set to 9
        r = requests.patch(f"{BASE}/api/push/preferences",
                            json={"preferences": {}, "reminder_hour": 9}, headers=H(MEMBER))
        assert r.status_code == 200, r.text
        assert r.json()["reminder_hour"] == 9
        g = requests.get(f"{BASE}/api/push/preferences", headers=H(MEMBER))
        assert g.status_code == 200
        assert g.json()["reminder_hour"] == 9

    def test_get_returns_reminder_hour_field(self):
        g = requests.get(f"{BASE}/api/push/preferences", headers=H(MEMBER))
        assert g.status_code == 200
        body = g.json()
        assert "reminder_hour" in body
        assert isinstance(body["reminder_hour"], int)


# ---------- Boat Pros ordering ----------
class TestBoatProsOrder:
    def test_featured_first(self):
        r = requests.get(f"{BASE}/api/boat-pros")
        assert r.status_code == 200
        pros = r.json()
        assert len(pros) >= 1
        rank = {"featured": 0, "premium": 1, "basic": 2}
        prev = -1
        for p in pros:
            cur = rank.get(p.get("tier", "basic"), 3)
            assert cur >= prev, f"Order broken: {p.get('tier')} after rank {prev}"
            prev = cur


# ---------- Boat pro categories ----------
class TestBoatProCategories:
    def test_has_outboard_motor_specialist(self):
        r = requests.get(f"{BASE}/api/markets")
        assert r.status_code == 200
        names = r.json().get("categories", [])
        assert "Outboard Motor Specialist" in names, f"missing; got {names}"
        assert "Outboard Engine Specialist" not in names


# ---------- Profile photo PATCH ----------
class TestProfilePhoto:
    def test_patch_profile_photo_persists(self):
        pic = "data:image/jpeg;base64,AAAA"
        r = requests.patch(f"{BASE}/api/profile/photo",
                            json={"picture": pic}, headers=H(MEMBER))
        assert r.status_code == 200, r.text
        me = requests.get(f"{BASE}/api/auth/me", headers=H(MEMBER))
        assert me.status_code == 200
        assert me.json().get("picture") == pic

    def test_patch_avatar_icon(self):
        r = requests.patch(f"{BASE}/api/profile/photo",
                            json={"avatar": "⛵"}, headers=H(MEMBER))
        assert r.status_code == 200, r.text

    def test_cleanup_restore_null(self):
        r = requests.patch(f"{BASE}/api/profile/photo",
                            json={"picture": None, "avatar": None}, headers=H(MEMBER))
        assert r.status_code == 200


# ---------- Identity friendly error ----------
class TestIdentityStripeError:
    def test_create_session_returns_stripe_error(self):
        # With placeholder Stripe key -> should return an error mentioning Stripe Identity
        r = requests.post(f"{BASE}/api/identity/session", headers=H(MEMBER))
        # 502 with detail; frontend surfaces friendly toast. Or 409 if already verified.
        assert r.status_code in (400, 409, 502), r.text
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        assert isinstance(detail, str)
