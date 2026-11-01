"""Backend tests for the aggregator past-event filter bug fix.

Verifies:
- GET /api/events includes Race Week Bellingham (in-progress multi-day event)
- POST /api/admin/events/aggregate keeps it (pre-sweep uses ends_at/$ifNull)
- Regression: past single-day and past multi-day events are still filtered
- Regression: crew bank endpoints still work
- Regression: aggregator idempotency
"""
import os
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN")
PREMIUM_TOKEN = os.environ.get("PREMIUM_TOKEN")
FREE_TOKEN = os.environ.get("FREE_TOKEN")

RACE_WEEK_TITLE = "Race Week Bellingham (48N Top 25)"


def _h(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


RACE_WEEK_ENDS = datetime(2026, 7, 25, tzinfo=timezone.utc)
# The Race Week fixture is date-bound; once it is over the read-time past filter
# (and the startup purge) correctly removes it, so these assertions no longer apply.
RACE_WEEK_OVER = datetime.now(timezone.utc) > RACE_WEEK_ENDS
race_week_obsolete = pytest.mark.skipif(
    RACE_WEEK_OVER,
    reason="Race Week Bellingham (ends 2026-07-25) is in the past; correctly filtered by GET /api/events",
)


def _find_race_week(events):
    for e in events:
        if e.get("title") == RACE_WEEK_TITLE:
            return e
    return None


# --- Bug fix: GET /api/events shows the in-progress multi-day event ---
class TestRaceWeekVisible:
    @race_week_obsolete
    def test_get_events_contains_race_week(self):
        r = requests.get(f"{API}/events", timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        assert isinstance(events, list)
        assert len(events) >= 66, f"expected >=66 events, got {len(events)}"
        rw = _find_race_week(events)
        assert rw is not None, "Race Week Bellingham not found in /api/events"
        assert rw.get("starts_at", "").startswith("2026-07-20")
        assert rw.get("ends_at", "").startswith("2026-07-25")
        assert rw.get("market") == "Bellingham"


# --- Bug fix: aggregate does not sweep in-progress multi-day events ---
class TestAggregatePreservesInProgress:
    @race_week_obsolete
    def test_admin_aggregate_keeps_race_week(self):
        if not ADMIN_TOKEN:
            pytest.skip("no admin token")
        r = requests.post(f"{API}/admin/events/aggregate", headers=_h(ADMIN_TOKEN), timeout=120)
        assert r.status_code == 200, r.text
        result = r.json()
        print("aggregate result 1:", result)
        # Race Week must still be present afterwards
        events = requests.get(f"{API}/events", timeout=30).json()
        rw = _find_race_week(events)
        assert rw is not None, "Race Week Bellingham was removed after aggregate (regression!)"

    @race_week_obsolete
    def test_aggregate_idempotent_no_dupes(self):
        if not ADMIN_TOKEN:
            pytest.skip("no admin token")
        before = requests.get(f"{API}/events", timeout=30).json()
        rw_count_before = sum(1 for e in before if e.get("title") == RACE_WEEK_TITLE)
        r = requests.post(f"{API}/admin/events/aggregate", headers=_h(ADMIN_TOKEN), timeout=120)
        assert r.status_code == 200
        result = r.json()
        print("aggregate result 2:", result)
        after = requests.get(f"{API}/events", timeout=30).json()
        rw_count_after = sum(1 for e in after if e.get("title") == RACE_WEEK_TITLE)
        assert rw_count_after == rw_count_before == 1, f"Race Week duped: before={rw_count_before} after={rw_count_after}"
        # totals shouldn't grow unexpectedly (allow +/- a few due to source refresh)
        assert abs(len(after) - len(before)) <= 5, f"event count drifted a lot: {len(before)}->{len(after)}"


# --- Regression: fully-past events are still filtered by the aggregator ---
class TestPastEventsStillFiltered:
    def test_no_far_past_events_visible(self):
        events = requests.get(f"{API}/events", timeout=30).json()
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=1)
        offenders = []
        for e in events:
            # only aggregator-sourced (community-posted events are user-created)
            if e.get("source") != "aggregator":
                continue
            ends = e.get("ends_at") or e.get("starts_at")
            if not ends:
                continue
            try:
                d = datetime.fromisoformat(ends.replace("Z", "+00:00"))
                if d.tzinfo is None:
                    d = d.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if d < cutoff:
                offenders.append((e.get("title"), e.get("starts_at"), e.get("ends_at")))
        assert not offenders, f"past aggregator events present: {offenders[:5]}"


# --- Regression: crew bank flow works on Race Week Bellingham ---
class TestCrewBankRaceWeek:
    @classmethod
    def setup_class(cls):
        events = requests.get(f"{API}/events", timeout=30).json()
        rw = _find_race_week(events)
        cls.race_id = rw["id"] if rw else None

    def test_free_user_cannot_join(self):
        if not FREE_TOKEN or not self.race_id:
            pytest.skip("no free token or no race id")
        payload = {"positions": ["Foredeck"], "experience": "5 yrs",
                   "notes": "test", "contact_via": "in-app"}
        r = requests.post(f"{API}/events/{self.race_id}/crew",
                          headers=_h(FREE_TOKEN), json=payload, timeout=30)
        assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"

    def test_premium_can_join_list_and_leave(self):
        if not PREMIUM_TOKEN or not self.race_id:
            pytest.skip("no premium token or no race id")
        payload = {"positions": ["Foredeck", "Trimmer"], "experience": "10 yrs",
                   "notes": "TEST_ crew bank entry", "contact_via": "in-app"}
        r = requests.post(f"{API}/events/{self.race_id}/crew",
                          headers=_h(PREMIUM_TOKEN), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["event_id"] == self.race_id
        assert "Foredeck" in entry["positions"]

        # GET crew list
        r2 = requests.get(f"{API}/events/{self.race_id}/crew",
                          headers=_h(PREMIUM_TOKEN), timeout=30)
        assert r2.status_code == 200
        data = r2.json()
        assert data["count"] >= 1
        assert data.get("mine") is not None
        assert data["can_join"] is True

        # DELETE
        r3 = requests.delete(f"{API}/events/{self.race_id}/crew",
                             headers=_h(PREMIUM_TOKEN), timeout=30)
        assert r3.status_code == 200
        assert r3.json().get("ok") is True

        # Confirm gone
        r4 = requests.get(f"{API}/events/{self.race_id}/crew",
                          headers=_h(PREMIUM_TOKEN), timeout=30)
        assert r4.json().get("mine") is None
