"""Iter 71 — Phase 4: Clubs directory, Founding Wall, Renewal reminder, Win-back scheduler."""
import os
import asyncio
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------- 1. Clubs directory ----------
class TestPartnersDirectory:
    def test_list_partners_all_orgs_with_badges(self, s):
        r = s.get(f"{API}/partners")
        assert r.status_code == 200
        data = r.json()
        assert "count" in data and "partners" in data
        assert data["count"] == len(data["partners"])
        assert data["count"] >= 1
        for p in data["partners"]:
            assert "user_id" in p
            assert "partner_badge" in p  # nullable field is present
            assert p.get("partner_badge") in ("founding", "partner", None)
        # Ordering: founding first, then partner, then null; ties by name
        rank = {"founding": 0, "partner": 1}
        seen_ranks = [rank.get(p.get("partner_badge"), 2) for p in data["partners"]]
        assert seen_ranks == sorted(seen_ranks), f"partners not properly ordered: {seen_ranks}"

    def test_list_partners_market_filter(self, s):
        r = s.get(f"{API}/partners", params={"market": "Greater Seattle"})
        assert r.status_code == 200
        for p in r.json()["partners"]:
            mk = [p.get("primary_market")] + (p.get("markets") or [])
            assert "Greater Seattle" in mk


# ---------- 2. Founding Wall ----------
class TestFoundingPartners:
    def test_founding_partners_only_active(self, s):
        r = s.get(f"{API}/founding-partners")
        assert r.status_code == 200
        data = r.json()
        assert "count" in data and "founders" in data
        assert data["count"] == len(data["founders"])
        # Ordering: global cohort (non-'seattle') before seattle
        cohorts = [(0 if (f.get("founding_cohort") != "seattle") else 1) for f in data["founders"]]
        assert cohorts == sorted(cohorts), f"cohort order violated: {cohorts}"
        # Every entry should have identity fields
        for f in data["founders"]:
            assert "handle" in f or "name" in f


# ---------- 3. Founding cohort caps (DB invariant) ----------
class TestFoundingCohortCap:
    def test_global_and_seattle_caps(self):
        """DB invariant: global cohort <= 5 and seattle cohort <= 5."""
        import subprocess
        script = '''
        const db = db.getSiblingDB("test_database");
        const g = db.users.countDocuments({founding_partner: true, founding_cohort: {$ne: "seattle"}});
        const sea = db.users.countDocuments({founding_cohort: "seattle"});
        print("GLOBAL=" + g + " SEATTLE=" + sea);
        '''
        r = subprocess.run(["mongosh", "--quiet", "--eval", script],
                           capture_output=True, text=True, timeout=15)
        out = r.stdout.strip()
        assert "GLOBAL=" in out, f"mongosh output missing counts: {out}"
        line = [ln for ln in out.splitlines() if ln.startswith("GLOBAL=")][0]
        parts = dict(kv.split("=") for kv in line.split())
        g = int(parts["GLOBAL"])
        sea = int(parts["SEATTLE"])
        assert g <= 5, f"Global founding cohort exceeded 5: {g}"
        assert sea <= 5, f"Seattle founding cohort exceeded 5: {sea}"


# ---------- 4. Renewal contact endpoint ----------
class TestRenewalContact:
    def test_contact_renewal_subject_accepted(self, s):
        r = s.post(f"{API}/contact", json={
            "name": "Test Partner",
            "email": "TEST_iter71_renewal@example.com",
            "subject": "Community Partner renewal",
            "message": "Test iter71 — please renew.",
        })
        # 200 ok, 429 if rate-limited by prior runs — both are acceptable
        assert r.status_code in (200, 429), f"unexpected status {r.status_code}: {r.text[:200]}"
        if r.status_code == 200:
            assert r.json().get("ok") is True


# ---------- 5. Scheduler nightly job direct invocation ----------
class TestSchedulerNightlyJob:
    def test_nightly_job_runs_and_writes_dedupe_fields(self):
        import sys
        sys.path.insert(0, "/app/backend")
        # Load backend .env so `deps` module import succeeds (needs MONGO_URL, DB_NAME).
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from motor.motor_asyncio import AsyncIOMotorClient
        import uuid

        MONGO_URL = os.environ["MONGO_URL"]
        DB_NAME = os.environ["DB_NAME"]

        async def _run():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]

            now = datetime.now(timezone.utc)
            past_exp = (now - timedelta(days=1)).isoformat()
            future_exp = (now + timedelta(days=15)).isoformat()

            # Seed: lapsed paid user needing win-back
            lapsed_uid = f"TEST_iter71_lapsed_{uuid.uuid4().hex[:8]}"
            await db.users.insert_one({
                "user_id": lapsed_uid,
                "email": f"TEST_iter71_lapsed_{uuid.uuid4().hex[:6]}@example.com",
                "name": "Test Lapsed",
                "subscription_tier": "premium",
                "subscription_expires": past_exp,
                "account_type": "sailor",
            })

            # Seed: community_partner within 30 days needing renewal_notified_for
            renew_uid = f"TEST_iter71_renew_{uuid.uuid4().hex[:8]}"
            await db.users.insert_one({
                "user_id": renew_uid,
                "email": f"TEST_iter71_renew_{uuid.uuid4().hex[:6]}@example.com",
                "name": "Test Renew Org",
                "subscription_tier": "community_partner",
                "subscription_expires": future_exp,
                "account_type": "partner",
            })

            try:
                from scheduler import _nightly_job
                # Should complete without raising
                await _nightly_job(db)

                # Assert win-back dedupe field set
                lapsed = await db.users.find_one({"user_id": lapsed_uid}, {"_id": 0})
                assert lapsed.get("winback_sent_for") == past_exp, \
                    f"winback_sent_for not written: {lapsed.get('winback_sent_for')} vs {past_exp}"
                # And that user got downgraded to free (2c happens after 2b)
                assert lapsed.get("subscription_tier") == "free", \
                    f"lapsed user not downgraded: {lapsed.get('subscription_tier')}"

                # Assert renewal dedupe field set for community_partner
                renew = await db.users.find_one({"user_id": renew_uid}, {"_id": 0})
                assert renew.get("renewal_notified_for") == future_exp, \
                    f"renewal_notified_for not set: {renew.get('renewal_notified_for')}"
                # And a notify() reminder was created
                notif = await db.notifications.find_one({"user_id": renew_uid, "kind": "partner_renewal"})
                assert notif is not None, "partner_renewal notification not created"

                # Idempotency: second run does not re-send (fields unchanged, no new notif)
                notif_count_before = await db.notifications.count_documents(
                    {"user_id": renew_uid, "kind": "partner_renewal"})
                await _nightly_job(db)
                notif_count_after = await db.notifications.count_documents(
                    {"user_id": renew_uid, "kind": "partner_renewal"})
                assert notif_count_after == notif_count_before, "renewal notif duplicated on rerun"
            finally:
                # Teardown seeded users + related notifications so global cohort
                # count invariant is not affected.
                await db.users.delete_many({"user_id": {"$in": [lapsed_uid, renew_uid]}})
                await db.notifications.delete_many({"user_id": {"$in": [lapsed_uid, renew_uid]}})
                client.close()

        asyncio.run(_run())
