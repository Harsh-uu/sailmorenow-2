"""Iteration 14 retest.

Covers:
  GET /api/events                                 -> read-time past filter + shape (registrations/crew_count)
  server startup                                  -> purge of stale past aggregator events
  PATCH /api/admin/events/{id}/email-recipients    -> lowercase + within-array dedupe + validation
  _maybe_email_organizer                          -> per-recipient try/except (all recipients attempted)

xdist-safe via RUN_PREFIX; teardown removes TEST_user14_* artifacts.
"""
import os
import sys
import uuid
import json
import asyncio
import subprocess
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

DB = "test_database"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw")
RUN_PREFIX = "TEST_user14_" + WORKER + "_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=90)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def mint_user(tier="premium", name="TEST_User14", is_admin=False):
    uid = RUN_PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      account_type:'sailor', primary_market:'{MARKET}', markets:['{MARKET}'],
      onboarding_complete:true, subscription_tier:'{tier}',
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def make_event(source="aggregator", starts_in_days=5, ends_in_days=None,
               recipients=None, organizer_email=None, title="TEST_14 Event"):
    eid = RUN_PREFIX + "ev_" + uuid.uuid4().hex[:8]
    starts = (datetime.now(timezone.utc) + timedelta(days=starts_in_days)).isoformat()
    ends = "null" if ends_in_days is None else \
        "'" + (datetime.now(timezone.utc) + timedelta(days=ends_in_days)).isoformat() + "'"
    rec = "null" if recipients is None else "[" + ",".join(f"'{r}'" for r in recipients) + "]"
    oe = "null" if not organizer_email else f"'{organizer_email}'"
    mongo(f"""
    db.events.insertOne({{id:'{eid}', source:'{source}', title:'{title}',
      description:'TEST_14 desc', market:'{MARKET}', starts_at:'{starts}',
      ends_at:{ends}, location:'Shilshole', approved:true, organizer_id:null,
      organizer_name:'TEST_14 Org', organizer_email:{oe}, email_recipients:{rec},
      created_at:new Date().toISOString()}});
    """)
    return eid


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "User-Agent": UA})
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mongo(f"""
    var ids = db.users.find({{user_id:{{$regex:'^{RUN_PREFIX}'}}}},{{user_id:1}}).toArray().map(u=>u.user_id);
    db.event_registrations.deleteMany({{event_id:{{$regex:'^{RUN_PREFIX}'}}}});
    db.crew_bank.deleteMany({{event_id:{{$regex:'^{RUN_PREFIX}'}}}});
    db.crew_bank.deleteMany({{user_id:{{$in:ids}}}});
    db.notifications.deleteMany({{user_id:{{$in:ids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^{RUN_PREFIX}'}}}});
    """)


def _parse(dt):
    d = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# ---------- 1. GET /api/events read-time past filter ----------
class TestPastFilter:
    def test_no_past_events_in_response(self, client):
        r = client.get(f"{BASE}/events")
        assert r.status_code == 200, r.text
        events = r.json()
        assert isinstance(events, list) and len(events) > 0, "expected some future events"
        now = datetime.now(timezone.utc)
        offenders = []
        for e in events:
            end = e.get("ends_at") or e.get("starts_at")
            if not end:
                continue
            try:
                if _parse(end) < now:
                    offenders.append((e.get("source"), e.get("title"), e.get("starts_at"), e.get("ends_at")))
            except Exception:
                continue
        assert not offenders, f"{len(offenders)} past events served: {offenders[:5]}"

    def test_seeded_past_event_hidden_future_visible(self, client):
        past = make_event(starts_in_days=-30, ends_in_days=-20, title="TEST_14 PastEvent")
        past_start_only = make_event(starts_in_days=-10, ends_in_days=None, title="TEST_14 PastStartOnly")
        inprogress = make_event(starts_in_days=-2, ends_in_days=3, title="TEST_14 InProgress")
        future = make_event(starts_in_days=6, ends_in_days=7, title="TEST_14 Future")
        ids = {e["id"] for e in client.get(f"{BASE}/events").json()}
        assert past not in ids, "fully past event still served"
        assert past_start_only not in ids, "past start-only event still served"
        assert inprogress in ids, "in-progress multi-day event wrongly filtered"
        assert future in ids, "future event missing"

    def test_mongo_has_no_past_in_result_window(self, client):
        """Cross-check with mongo: 0 non-past-filtered docs among returned ids."""
        events = client.get(f"{BASE}/events").json()
        ids = [e["id"] for e in events]
        now_iso = datetime.now(timezone.utc).isoformat()
        out = mongo(
            "print(db.events.countDocuments({id:{$in:" + json.dumps(ids) + "},"
            "$expr:{$lt:[{$ifNull:['$ends_at','$starts_at']},'" + now_iso + "']}}));"
        )
        assert out.strip() == "0", f"mongo reports {out} past docs among served events"

    def test_response_shape_registrations_and_crew_count(self, client):
        eid = make_event(starts_in_days=8, ends_in_days=9, title="TEST_14 ShapeEvent")
        # 2 attendee + 1 volunteer registrations
        for kind, n in (("attendee", 2), ("volunteer", 1)):
            for _ in range(n):
                mongo(f"""db.event_registrations.insertOne({{id:'{uuid.uuid4().hex}',
                  event_id:'{eid}', user_id:'{RUN_PREFIX}{uuid.uuid4().hex[:6]}',
                  kind:'{kind}', created_at:new Date().toISOString()}});""")
        # 3 crew_bank entries with status != found (+1 'found' which must be excluded)
        for st in ("seeking", "seeking", "open", "found"):
            mongo(f"""db.crew_bank.insertOne({{id:'{uuid.uuid4().hex}', event_id:'{eid}',
              user_id:'{RUN_PREFIX}{uuid.uuid4().hex[:6]}', status:'{st}',
              positions:['Railmeat'], created_at:new Date().toISOString()}});""")
        ev = next((e for e in client.get(f"{BASE}/events").json() if e["id"] == eid), None)
        assert ev is not None, "shape event not served"
        assert ev["registrations"] == {"attendee": 2, "volunteer": 1}, ev["registrations"]
        assert ev["crew_count"] == 3, ev["crew_count"]

    def test_event_without_registrations_defaults(self, client):
        eid = make_event(starts_in_days=11, title="TEST_14 EmptyCounts")
        ev = next((e for e in client.get(f"{BASE}/events").json() if e["id"] == eid), None)
        assert ev is not None
        assert ev["registrations"] == {"attendee": 0, "volunteer": 0}
        assert ev["crew_count"] == 0

    def test_market_and_range_filters_still_work(self, client):
        events = client.get(f"{BASE}/events", params={"market": MARKET}).json()
        assert all(e["market"] == MARKET for e in events), "market filter leaked"
        frm = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        to = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat()
        ranged = client.get(f"{BASE}/events", params={"from": frm, "to": to}).json()
        assert all(frm <= e["starts_at"] <= to for e in ranged), "range filter leaked"

    @pytest.mark.xfail(strict=False, reason="KNOWN BUG (iter14): date-only ends_at for TODAY is "
                                            "lexicographically < now_iso, so same-day date-only "
                                            "events are hidden all day")
    def test_date_only_event_today_is_still_visible(self, client):
        eid = RUN_PREFIX + "ev_dateonly"
        today = datetime.now(timezone.utc).date().isoformat()
        mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
          title:'TEST_14 DateOnlyToday', market:'{MARKET}', starts_at:'{today}',
          ends_at:'{today}', approved:true, created_at:new Date().toISOString()}});""")
        ids = {e["id"] for e in client.get(f"{BASE}/events").json()}
        assert eid in ids, "event happening today (date-only format) was filtered out"

    def test_no_mongo_id_leak(self, client):
        events = client.get(f"{BASE}/events").json()
        assert all("_id" not in e for e in events)

    def test_sorted_by_starts_at(self, client):
        events = client.get(f"{BASE}/events").json()
        starts = [e["starts_at"] for e in events]
        assert starts == sorted(starts), "events not sorted ascending by starts_at"


# ---------- 2. Startup purge ----------
class TestStartupPurge:
    def test_no_past_aggregator_docs_in_db(self):
        now_iso = datetime.now(timezone.utc).isoformat()
        # exclude this run's own seeded past fixtures (created after startup)
        out = mongo("print(db.events.countDocuments({source:'aggregator',"
                    "id:{$not:/^TEST_user14_/},"
                    "$expr:{$lt:[{$ifNull:['$ends_at','$starts_at']},'" + now_iso + "']}}));")
        assert out.strip() == "0", f"{out} past aggregator docs remain in db.events"

    @pytest.mark.skipif(os.environ.get("SMN_ALLOW_RESTART") != "1",
                        reason="set SMN_ALLOW_RESTART=1 to restart backend")
    def test_restart_purges_seeded_past_aggregator_events(self, client):
        stale = [make_event(source="aggregator", starts_in_days=-40, ends_in_days=-35)
                 for _ in range(3)]
        keep = make_event(source="community", starts_in_days=-40, ends_in_days=-35)
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                       capture_output=True, text=True, timeout=120)
        for _ in range(40):
            try:
                if client.get(f"{BASE}/events", timeout=10).status_code == 200:
                    break
            except Exception:
                pass
            import time
            time.sleep(2)
        remaining = mongo("print(db.events.countDocuments({id:{$in:" + json.dumps(stale) + "}}));")
        assert remaining.strip() == "0", f"{remaining} stale aggregator events survived restart"
        kept = mongo(f"print(db.events.countDocuments({{id:'{keep}'}}));")
        assert kept.strip() == "1", "startup purge deleted a non-aggregator event"
        log = subprocess.run(
            "grep -h 'purged .* stale past aggregator events on startup' "
            "/var/log/supervisor/backend.*.log | tail -3",
            shell=True, capture_output=True, text=True).stdout
        assert "stale past aggregator events on startup" in log, log


# ---------- 3. PATCH email-recipients: lowercase + dedupe ----------
class TestRecipientsLowercaseDedupe:
    def test_mixed_case_and_dupes(self, client):
        eid = make_event()
        _, t = mint_user(is_admin=True, name="TEST_14 Admin")
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": ["Ops@Partner.org", "ops@partner.org",
                                                    "Captain@yc.com"]}, headers=auth(t))
        assert r.status_code == 200, r.text
        assert r.json()["email_recipients"] == ["ops@partner.org", "captain@yc.com"], r.json()
        stored = mongo(f"print(JSON.stringify(db.events.findOne({{id:'{eid}'}}).email_recipients));")
        assert json.loads(stored) == ["ops@partner.org", "captain@yc.com"], stored

    def test_whitespace_trim_plus_case_dupe(self, client):
        eid = make_event()
        _, t = mint_user(is_admin=True)
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": ["  A@B.com  ", "a@b.com", "c@d.org"]},
                         headers=auth(t))
        assert r.status_code == 200, r.text
        assert r.json()["email_recipients"] == ["a@b.com", "c@d.org"], r.json()

    @pytest.mark.parametrize("bad", ["no-at", " ", "x" * 250 + "@y.com"])
    def test_invalid_rejected(self, client, bad):
        eid = make_event()
        _, t = mint_user(is_admin=True)
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": [bad]}, headers=auth(t))
        assert r.status_code == 400, f"expected 400 for {bad!r}, got {r.status_code}: {r.text}"
        stored = mongo(f"print(JSON.stringify(db.events.findOne({{id:'{eid}'}}).email_recipients));")
        assert stored in ("null", ""), f"invalid payload mutated the doc: {stored}"

    def test_non_admin_forbidden(self, client):
        eid = make_event()
        _, t = mint_user(is_admin=False)
        r = client.patch(f"{BASE}/admin/events/{eid}/email-recipients",
                         json={"email_recipients": ["x@y.com"]}, headers=auth(t))
        assert r.status_code == 403, r.text

    def test_unknown_event_404(self, client):
        _, t = mint_user(is_admin=True)
        r = client.patch(f"{BASE}/admin/events/{RUN_PREFIX}nope/email-recipients",
                         json={"email_recipients": ["x@y.com"]}, headers=auth(t))
        assert r.status_code == 404, r.text


# ---------- 4. Per-recipient try/except in _maybe_email_organizer ----------
def _run_maybe_email(event_id, fail_on_first=True):
    """Invoke _maybe_email_organizer in-process with send_email raising on call #1."""
    if "/app/backend" not in sys.path:
        sys.path.insert(0, "/app/backend")
    for k, v in dotenv_values("/app/backend/.env").items():
        os.environ.setdefault(k, v)
    attempts = []
    for mod in ("scheduler", "notifications", "mailer", "deps",
                "routers.community_router", "routers.reviews_router", "aggregator"):
        sys.modules.pop(mod, None)

    async def run():
        import routers.community_router as cr
        from schemas import CrewBankJoin

        async def boom(**kwargs):
            attempts.append(kwargs["recipient_email"])
            if fail_on_first and len(attempts) == 1:
                raise RuntimeError("TEST_14 simulated SMTP failure")
            return {"status": "skipped"}

        cr.send_email = boom
        ev = await cr.db.events.find_one({"id": event_id}, {"_id": 0})
        assert ev is not None, "event fixture missing"
        await cr._maybe_email_organizer(
            ev, {"name": "TEST_14 Sailor", "email": "sailor@test.dev"},
            {"positions": ["Foredeck"]},
            CrewBankJoin(positions=["Foredeck"], experience="e", notes="n",
                         contact_via="in-app", post_to_feed=False),
        )

    asyncio.run(run())
    return attempts


class TestPerRecipientTryExcept:
    def test_all_recipients_attempted_after_first_raises(self):
        eid = make_event(organizer_email="organizer@club.org",
                         recipients=["ops@partner.org", "captain@yc.com"])
        attempts = _run_maybe_email(eid, fail_on_first=True)
        assert len(attempts) == 3, f"expected 3 send attempts, got {attempts}"
        assert attempts == ["organizer@club.org", "ops@partner.org", "captain@yc.com"], attempts

    def test_all_recipients_attempted_happy_path(self):
        eid = make_event(organizer_email="organizer2@club.org",
                         recipients=["ops2@partner.org"])
        attempts = _run_maybe_email(eid, fail_on_first=False)
        assert attempts == ["organizer2@club.org", "ops2@partner.org"], attempts
