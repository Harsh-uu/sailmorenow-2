"""Iter53: IP ban list (ipban_router), event PATCH/DELETE (community_router) and flyer size guard."""
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

fe = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or fe["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE}/api"

ADMIN = "test_iter53_admin_token"
PARTNER = "test_iter53_partner_token"
MEMBER = "test_iter53_member_token"

BAN_IP = "203.0.113.9"


def H(tok, ip=None):
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if ip:
        h["X-Forwarded-For"] = ip
    return h


def notifs(tok):
    r = requests.get(f"{API}/notifications", headers=H(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    return d["items"] if isinstance(d, dict) else d


def future(days=20):
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0).isoformat()


# ---------- IP ban list ----------
class TestIpBans:
    def test_member_cannot_ban(self):
        r = requests.post(f"{API}/admin/ip-bans", json={"ip": BAN_IP}, headers=H(MEMBER))
        assert r.status_code == 403, r.text

    def test_anon_cannot_list(self):
        r = requests.get(f"{API}/admin/ip-bans")
        assert r.status_code in (401, 403), r.text

    def test_ban_own_ip_rejected(self):
        own = "198.51.100.55"
        r = requests.post(f"{API}/admin/ip-bans", json={"ip": own}, headers=H(ADMIN, ip=own))
        assert r.status_code == 400, r.text
        assert "own IP" in r.json().get("detail", "")

    def test_ban_enforce_unban_cycle(self):
        # create
        r = requests.post(f"{API}/admin/ip-bans", json={"ip": BAN_IP, "reason": "TEST_iter53"},
                          headers=H(ADMIN, ip="198.51.100.55"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ip"] == BAN_IP and body["reason"] == "TEST_iter53"
        assert body.get("banned_by") and "_id" not in body

        # listed
        lst = requests.get(f"{API}/admin/ip-bans", headers=H(ADMIN)).json()
        assert BAN_IP in [b["ip"] for b in lst]

        # enforced
        blocked = requests.get(f"{API}/markets", headers={"X-Forwarded-For": BAN_IP})
        assert blocked.status_code == 403, blocked.text
        ok = requests.get(f"{API}/markets")
        assert ok.status_code == 200

        # ban endpoint itself still reachable from banned IP (undo path)
        undo_reachable = requests.get(f"{API}/admin/ip-bans", headers=H(ADMIN, ip=BAN_IP))
        assert undo_reachable.status_code == 200, undo_reachable.text

        # delete
        d = requests.delete(f"{API}/admin/ip-bans/{BAN_IP}", headers=H(ADMIN))
        assert d.status_code == 200 and d.json()["ok"] is True
        assert requests.get(f"{API}/markets", headers={"X-Forwarded-For": BAN_IP}).status_code == 200
        assert BAN_IP not in [b["ip"] for b in requests.get(f"{API}/admin/ip-bans", headers=H(ADMIN)).json()]

    def test_delete_unknown_ip_404(self):
        r = requests.delete(f"{API}/admin/ip-bans/203.0.113.250", headers=H(ADMIN))
        assert r.status_code == 404, r.text

    def test_invalid_ip_400(self):
        r = requests.post(f"{API}/admin/ip-bans", json={"ip": "  "}, headers=H(ADMIN))
        assert r.status_code == 400, r.text


# ---------- Event edit / cancel ----------
class TestEventEditCancel:
    created = []

    @classmethod
    def teardown_class(cls):
        for eid in cls.created:
            requests.delete(f"{API}/events/{eid}", headers=H(ADMIN))

    def _make(self, title="TEST_iter53 Edit Me", ip="198.51.100.61"):
        r = requests.post(f"{API}/events", headers=H(PARTNER, ip=ip), json={
            "title": title, "description": "TEST_iter53 event", "market": "Greater Seattle",
            "starts_at": future(), "location": "Old dock", "category": "cruising"})
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        TestEventEditCancel.created.append(eid)
        return eid

    def test_patch_notifies_rsvps_and_persists(self):
        eid = self._make()
        reg = requests.post(f"{API}/events/{eid}/register", json={"kind": "attendee"}, headers=H(MEMBER))
        assert reg.status_code == 200, reg.text

        p = requests.patch(f"{API}/events/{eid}", json={"location": "New dock"}, headers=H(PARTNER))
        assert p.status_code == 200, p.text
        assert p.json()["location"] == "New dock"

        got = [e for e in requests.get(f"{API}/events").json() if e["id"] == eid]
        assert got and got[0]["location"] == "New dock"

        items = notifs(MEMBER)
        mine = [n for n in items if n.get("meta", {}).get("event_id") == eid and n["kind"] == "event_updated"]
        assert mine, f"no event_updated notification: {str(items)[:400]}"

        # actor must not notify themselves
        pitems = notifs(PARTNER)
        assert not [n for n in pitems if n.get("meta", {}).get("event_id") == eid and n["kind"] == "event_updated"]

    def test_patch_by_other_user_404(self):
        eid = self._make(title="TEST_iter53 Perms", ip="198.51.100.62")
        r = requests.patch(f"{API}/events/{eid}", json={"location": "hax"}, headers=H(MEMBER))
        assert r.status_code == 404, r.text
        r2 = requests.patch(f"{API}/events/{eid}", json={"location": "hax"})
        assert r2.status_code == 401, r2.text

    def test_patch_aggregator_event_400(self):
        aggs = [e for e in requests.get(f"{API}/events").json() if str(e["id"]).startswith("agg_")]
        assert aggs, "no aggregator events present"
        r = requests.patch(f"{API}/events/{aggs[0]['id']}", json={"title": "TEST_iter53 nope"}, headers=H(ADMIN))
        assert r.status_code == 400, r.text

    def test_patch_invalid_market_and_bad_date(self):
        eid = self._make(title="TEST_iter53 Validation", ip="198.51.100.63")
        assert requests.patch(f"{API}/events/{eid}", json={"market": "Atlantis"}, headers=H(PARTNER)).status_code == 400
        assert requests.patch(f"{API}/events/{eid}", json={"starts_at": "not-a-date"}, headers=H(PARTNER)).status_code == 400
        assert requests.patch(f"{API}/events/{eid}", json={"category": "bogus"}, headers=H(PARTNER)).status_code == 400

    def test_patch_large_flyer_400(self):
        eid = self._make(title="TEST_iter53 BigFlyer", ip="198.51.100.64")
        r = requests.patch(f"{API}/events/{eid}", json={"image_url": "a" * 500000}, headers=H(PARTNER))
        assert r.status_code == 400, r.text

    def test_delete_cancels_and_notifies(self):
        eid = self._make(title="TEST_iter53 Cancel Me", ip="198.51.100.65")
        assert requests.post(f"{API}/events/{eid}/register", json={"kind": "attendee"}, headers=H(MEMBER)).status_code == 200

        d = requests.delete(f"{API}/events/{eid}", headers=H(PARTNER))
        assert d.status_code == 200, d.text
        assert d.json()["id"] == eid
        assert eid not in [e["id"] for e in requests.get(f"{API}/events").json()]

        items = notifs(MEMBER)
        assert [n for n in items if n.get("meta", {}).get("event_id") == eid and n["kind"] == "event_cancelled"]

        # registrations gone
        regs = requests.get(f"{API}/events/{eid}/registrations", headers=H(PARTNER))
        assert regs.status_code in (200, 404)
        if regs.status_code == 200:
            data = regs.json()
            assert not data.get("mine")
            assert not data.get("registrations")


# ---------- Flyer size guard on create ----------
class TestFlyerCreate:
    created = []

    @classmethod
    def teardown_class(cls):
        for eid in cls.created:
            requests.delete(f"{API}/events/{eid}", headers=H(ADMIN))

    def test_create_with_huge_image_url_rejected(self):
        r = requests.post(f"{API}/events", headers=H(PARTNER, ip="198.51.100.71"), json={
            "title": "TEST_iter53 Huge Flyer", "description": "x", "market": "Greater Seattle",
            "starts_at": future(), "image_url": "a" * 500000})
        if r.status_code == 200:
            TestFlyerCreate.created.append(r.json()["id"])
        assert r.status_code == 400, f"expected 400, got {r.status_code}"

    def test_create_with_small_data_url_roundtrips(self):
        data_url = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
                    "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        r = requests.post(f"{API}/events", headers=H(PARTNER, ip="198.51.100.72"), json={
            "title": "TEST_iter53 Small Flyer", "description": "x", "market": "Greater Seattle",
            "starts_at": future(), "image_url": data_url})
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        TestFlyerCreate.created.append(eid)
        assert r.json()["image_url"] == data_url
        got = [e for e in requests.get(f"{API}/events").json() if e["id"] == eid]
        assert got and got[0]["image_url"] == data_url


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
