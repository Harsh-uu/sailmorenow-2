"""PACIFIC-2 data repair for scraped (aggregator) events.

DRY RUN by default (no writes). Writes starts_at / ends_at / time_not_listed ONLY,
never title, description, image, location or any other field.

  python pacific2_repair.py            # dry run: report counts + before/after, no writes
  python pacific2_repair.py --apply    # back up, then apply the time-field repair
  python pacific2_repair.py --undo STAMP   # restore the three time fields from a backup

Jenn's rules for this run:
  - INCLUDE "Winter Sailing on Sundays (Nov 1)" even though its starts_at is admin-locked
    (time fields only; every other locked field is left untouched).
  - LEAVE "OCSA - Tropical Party" alone entirely (Jenn edits it herself; its description
    states a real 5 PM / 6 PM time).
  - Never touch tombstoned (deleted) events.
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import aggregator  # noqa: E402
from date_utils import event_no_time  # noqa: E402

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
BACKUP_COLL = "events_backup_pacific2"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
DUMP = f"/app/backend/pacific2_events_backup_{STAMP}.json"
TIME_FIELDS = ("starts_at", "ends_at", "time_not_listed")

# Events to leave completely alone (title match, case-insensitive, substring).
EXCLUDE_TITLES = ("tropical party",)


def excluded(ev) -> bool:
    t = (ev.get("title") or "").strip().lower()
    return any(x in t for x in EXCLUDE_TITLES)


async def do_undo(db, stamp):
    rows = await db[BACKUP_COLL].find({"backup_stamp": stamp}, {"_id": 0}).to_list(5000)
    if not rows:
        print(f"UNDO: no backup rows found for stamp {stamp} in {BACKUP_COLL}.")
        return
    n = 0
    for r in rows:
        set_doc = {"starts_at": r.get("starts_at"), "ends_at": r.get("ends_at")}
        update = {"$set": set_doc}
        if "time_not_listed" in r:
            set_doc["time_not_listed"] = r.get("time_not_listed")
        else:
            update["$unset"] = {"time_not_listed": ""}
        res = await db.events.update_one({"id": r["id"]}, update)
        n += 1 if res.modified_count or res.matched_count else 0
    print(f"UNDO: restored time fields on {n} events from backup stamp {stamp}.")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    if UNDO:
        i = sys.argv.index("--undo")
        stamp = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        await do_undo(db, stamp)
        return

    scraped = await db.events.find({"source": "aggregator"}, {"_id": 0}).to_list(2000)
    tombstoned = {t["id"] for t in await db.event_tombstones.find({}, {"_id": 0, "id": 1}).to_list(5000)}

    # Recompute with the FIXED parser.
    sources = await aggregator._load_sources(db)
    new_by_id, new_by_td = {}, {}
    for src in sources:
        try:
            for e in await src.fetch():
                new_by_id[e["external_id"]] = e
                new_by_td[((e.get("title") or "").strip().lower(), (e.get("starts_at") or "")[:10])] = e
        except Exception as ex:
            print(f"  (source {getattr(src, 'key', '?')} fetch failed: {str(ex)[:80]})")

    def match(ev):
        return new_by_id.get(ev.get("external_id")) or new_by_td.get(
            ((ev.get("title") or "").strip().lower(), (ev.get("starts_at") or "")[:10]))

    # Build the planned change set (time fields only).
    plan = []  # (ev, new_starts, new_ends, new_flag)
    skipped_excluded = skipped_tomb = no_match = 0
    date_only = timed = 0
    time_changed = flag_only = 0
    for ev in scraped:
        if ev.get("id") in tombstoned:
            skipped_tomb += 1
            continue
        if excluded(ev):
            skipped_excluded += 1
            continue
        new = match(ev)
        if not new:
            no_match += 1
            continue
        ns, ne = new.get("starts_at"), new.get("ends_at")
        nflag = event_no_time(ns, new.get("time_not_listed"))
        if nflag:
            date_only += 1
        else:
            timed += 1
        times_differ = ns != ev.get("starts_at") or ne != ev.get("ends_at")
        if times_differ or ev.get("time_not_listed") != nflag:
            plan.append((ev, ns, ne, nflag))
            if times_differ:
                time_changed += 1
            else:
                flag_only += 1

    print(f"\nSCRAPED TOTAL: {len(scraped)}")
    print(f"matched would-be date-only: {date_only} | timed: {timed}")
    print(f"WOULD CHANGE: {len(plan)} (real date/time corrections: {time_changed} | "
          f"flag-only backfill, no time change: {flag_only})")
    print(f"excluded (Tropical Party etc): {skipped_excluded} "
          f"| tombstoned skipped: {skipped_tomb} | no feed match: {no_match}\n")
    print("REAL DATE/TIME CORRECTIONS (up to 12; time fields only):")
    shown = 0
    for ev, ns, ne, nflag in plan:
        if ns == ev.get("starts_at") and ne == ev.get("ends_at"):
            continue
        print(f"  - {(ev.get('title') or '')[:46]}  [{ev.get('source_key')}]")
        print(f"      before: {ev.get('starts_at')} | {ev.get('ends_at')} | tnl={ev.get('time_not_listed')}")
        print(f"      after : {ns} | {ne} | tnl={nflag}")
        shown += 1
        if shown >= 12:
            break

    if APPLY:
        # Back up ONLY the events we are about to touch (JSON + stamped collection).
        touch = [ev for (ev, *_rest) in plan]
        with open(DUMP, "w") as f:
            json.dump(touch, f, default=str)
        await db[BACKUP_COLL].delete_many({"backup_stamp": STAMP})
        if touch:
            await db[BACKUP_COLL].insert_many([{**e, "backup_stamp": STAMP} for e in touch])
        print(f"\nBACKUP: {len(touch)} events -> {DUMP} and collection {BACKUP_COLL} (stamp {STAMP})")
        n = 0
        for ev, ns, ne, nflag in plan:
            await db.events.update_one(
                {"id": ev["id"]},
                {"$set": {"starts_at": ns, "ends_at": ne, "time_not_listed": nflag}},
            )
            n += 1
        print(f"APPLIED: updated {n} events (time fields only).")
        print(f"UNDO: python pacific2_repair.py --undo {STAMP}")
    else:
        print("\nDRY RUN only. No events changed. Re-run with --apply after Jenn says go.")


asyncio.run(main())
