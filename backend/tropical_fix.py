"""EVENTS-FIX-1 item 2: fix ONLY the OCSA Tropical Party record.
Set time_not_listed=False (it has a real 5 PM start) and lock that field so a scrape
cannot flip it back. Touches nothing else. Backup + --undo.

  python tropical_fix.py            # dry run (show what would change)
  python tropical_fix.py --apply    # back up + apply
  python tropical_fix.py --undo STAMP
"""
import asyncio, json, os, sys
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
COLL = "events_backup_tropfix"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    if UNDO:
        i = sys.argv.index("--undo"); stamp = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        b = await db[COLL].find_one({"backup_stamp": stamp}, {"_id": 0})
        if not b:
            print(f"UNDO: no backup for stamp {stamp}"); return
        await db.events.update_one({"id": b["id"]}, {"$set": {
            "time_not_listed": b.get("time_not_listed"),
            "admin_locked_fields": b.get("admin_locked_fields"),
        }})
        print(f"UNDO: restored {b['id']} time_not_listed + admin_locked_fields from {stamp}")
        return

    tp = await db.events.find_one({"source": "aggregator", "title": {"$regex": "Tropical Party", "$options": "i"}}, {"_id": 0})
    if not tp:
        print("Tropical Party not found"); return
    print(f"target: {tp['id']}  {tp.get('title')!r}")
    print(f"  starts_at={tp.get('starts_at')} ends_at={tp.get('ends_at')}")
    print(f"  before: time_not_listed={tp.get('time_not_listed')} locked={sorted(tp.get('admin_locked_fields') or [])}")
    locked = sorted(set(tp.get("admin_locked_fields") or []) | {"time_not_listed", "ends_at"})
    print(f"  after : time_not_listed=False locked={locked}")

    if APPLY:
        with open(f"/app/backend/tropfix_backup_{STAMP}.json", "w") as f:
            json.dump(tp, f, default=str)
        await db[COLL].delete_many({"backup_stamp": STAMP})
        await db[COLL].insert_one({**tp, "backup_stamp": STAMP})
        await db.events.update_one({"id": tp["id"]}, {"$set": {
            "time_not_listed": False, "admin_locked_fields": locked, "admin_edited": True,
        }})
        print(f"APPLIED. UNDO: python tropical_fix.py --undo {STAMP}")
    else:
        print("DRY RUN only. Re-run with --apply.")

asyncio.run(main())
