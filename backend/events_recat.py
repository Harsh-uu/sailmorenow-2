"""EVENTS-FIX-1 item 5: recategorize scraped events with the new keyword/tag rules.
ONLY touches events where category_manual is not set (never overrides an admin/owner
edit). Backup + --undo. Prints a before/after sample of 10.

  python events_recat.py            # dry run: counts + sample, no writes
  python events_recat.py --apply    # back up + apply
  python events_recat.py --undo STAMP
"""
import asyncio, json, os, sys
from collections import Counter
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
from categorize import categorize

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
COLL = "events_backup_recat"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    if UNDO:
        i = sys.argv.index("--undo"); stamp = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        rows = await db[COLL].find({"backup_stamp": stamp}, {"_id": 0}).to_list(5000)
        if not rows:
            print(f"UNDO: no backup for stamp {stamp}"); return
        for r in rows:
            await db.events.update_one({"id": r["id"]}, {"$set": {
                "category": r.get("category"), "category_needs_review": r.get("category_needs_review")}})
        print(f"UNDO: restored category on {len(rows)} events from {stamp}")
        return

    evs = await db.events.find({"source": "aggregator", "category_manual": {"$ne": True}}, {"_id": 0}).to_list(5000)
    plan, trans = [], Counter()
    for e in evs:
        new_cat, review = categorize(e)
        if new_cat != e.get("category") or bool(review) != bool(e.get("category_needs_review")):
            plan.append((e, new_cat, review))
            trans[f"{e.get('category')} -> {new_cat}"] += 1

    print(f"scraped non-manual events: {len(evs)} | would change: {len(plan)}")
    print("transitions:")
    for k, v in trans.most_common():
        print(f"   {k}: {v}")
    print("\nBEFORE/AFTER (every change):")
    for e, nc, rv in plan:
        print(f"  - {(e.get('title') or '')[:52]!r} [{e.get('source_key')}]: {e.get('category')} -> {nc}{' (review)' if rv else ''}")

    if APPLY:
        touch = [e for (e, *_rest) in plan]
        with open(f"/app/backend/recat_backup_{STAMP}.json", "w") as f:
            json.dump([{k: d.get(k) for k in ("id", "category", "category_needs_review")} for d in touch], f, default=str)
        await db[COLL].delete_many({"backup_stamp": STAMP})
        if touch:
            await db[COLL].insert_many([{"id": d["id"], "category": d.get("category"),
                                         "category_needs_review": d.get("category_needs_review"),
                                         "backup_stamp": STAMP} for d in touch])
        for e, nc, rv in plan:
            await db.events.update_one({"id": e["id"]}, {"$set": {"category": nc, "category_needs_review": bool(rv)}})
        print(f"\nAPPLIED to {len(plan)} events. UNDO: python events_recat.py --undo {STAMP}")
    else:
        print("\nDRY RUN only. Re-run with --apply.")

asyncio.run(main())
