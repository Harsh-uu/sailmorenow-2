"""EVENTS-FIX-2 item 3: fix ONLY the Board of Directors Meeting (Dec) OWSA record.
Set its start back to Dec 9, 6:30 PM PT (2026-12-10T02:30:00+00:00), keep the end.
Nothing else touched. Backup + --undo.

  python bod_fix.py            # dry run
  python bod_fix.py --apply    # back up + apply
  python bod_fix.py --undo STAMP
"""
import asyncio, json, os, sys
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
COLL = "events_backup_bodfix"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
EVENT_ID = "agg_owsa_88287618a8d8abe2"
CORRECT_START = "2026-12-10T02:30:00+00:00"  # Dec 9 6:30 PM PT


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    if UNDO:
        i = sys.argv.index("--undo"); stamp = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        b = await db[COLL].find_one({"backup_stamp": stamp}, {"_id": 0})
        if not b:
            print(f"UNDO: no backup for stamp {stamp}"); return
        await db.events.update_one({"id": b["id"]}, {"$set": {"starts_at": b.get("starts_at")}})
        print(f"UNDO: restored starts_at={b.get('starts_at')} on {b['id']}")
        return

    ev = await db.events.find_one({"id": EVENT_ID}, {"_id": 0})
    if not ev:
        print("BoD Dec record not found by id; aborting (touch nothing else)."); return
    print(f"target {EVENT_ID} {ev.get('title')!r}")
    print(f"  before: starts={ev.get('starts_at')} ends={ev.get('ends_at')}")
    print(f"  after : starts={CORRECT_START} ends={ev.get('ends_at')} (unchanged)")
    if APPLY:
        with open(f"/app/backend/bodfix_backup_{STAMP}.json", "w") as f:
            json.dump(ev, f, default=str)
        await db[COLL].delete_many({"backup_stamp": STAMP})
        await db[COLL].insert_one({**ev, "backup_stamp": STAMP})
        await db.events.update_one({"id": EVENT_ID}, {"$set": {"starts_at": CORRECT_START}})
        print(f"APPLIED. UNDO: python bod_fix.py --undo {STAMP}")
    else:
        print("DRY RUN only. Re-run with --apply.")

asyncio.run(main())
