"""EVENTS-FIX-3: one-time OWSA dedup + source_uid backfill. Backup + --undo.

  python dedup_apply.py            # dry run (writes nothing)
  python dedup_apply.py --apply    # back up, then apply
  python dedup_apply.py --undo STAMP

Apply does exactly this and nothing else:
  - backfill source_uid (the OWSA event page url) on 3 survivors + Fireside
  - delete 3 loser duplicate rows (NO tombstone)
  - delete the stale Fireside tombstone
  - create a partial unique index on (source_key, source_uid, recurrence_id)
No times, categories, locks or other fields are touched. No id is changed.
"""
import asyncio, json, os, sys
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
COLL = "events_backup_dedup"
INDEX_NAME = "agg_source_identity"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

# survivor id -> OWSA event page url it adopts as source_uid
SURVIVORS = {
    "agg_owsa_d4d93f00ca05c70c": "https://owsa.net/event/nauti-drinks-26",
    "agg_owsa_d40c9c0d152c71b7": "https://owsa.net/event/holiday-party-volunteer-appreciation-3",
    "agg_owsa_5bb2d3cf03d5d8d3": "https://owsa.net/event/art_and_game_night",
    "agg_owsa_23f690162135bc6d": "https://owsa.net/event/fireside-8",  # Fireside (4th orphan)
}
LOSERS = ["agg_owsa_c6159083abd5de5b", "agg_owsa_d97881ca61a1536b", "agg_owsa_3abdcd31a5120378"]
FIRESIDE_TOMBSTONE = "agg_owsa_0a1ea68f63354e0b"


async def create_index(db):
    await db.events.create_index(
        [("source_key", 1), ("source_uid", 1), ("recurrence_id", 1)],
        unique=True, name=INDEX_NAME,
        partialFilterExpression={"source": "aggregator", "source_uid": {"$type": "string"}},
    )


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    if UNDO:
        i = sys.argv.index("--undo"); stamp = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        back = await db[COLL].find_one({"backup_stamp": stamp}, {"_id": 0})
        if not back:
            print(f"UNDO: no backup for stamp {stamp}"); return
        # Drop the unique index first (restoring losers would otherwise violate it).
        try:
            await db.events.drop_index(INDEX_NAME)
        except Exception:
            pass
        # Restore each survivor's source_uid to its backed-up value (unset if absent).
        for sdoc in back["survivors"]:
            if "source_uid" in sdoc and sdoc["source_uid"] is not None:
                await db.events.update_one({"id": sdoc["id"]}, {"$set": {"source_uid": sdoc["source_uid"]}})
            else:
                await db.events.update_one({"id": sdoc["id"]}, {"$unset": {"source_uid": ""}})
        # Re-insert the removed losers.
        for ldoc in back["losers"]:
            await db.events.update_one({"id": ldoc["id"]}, {"$set": ldoc}, upsert=True)
        # Re-insert the Fireside tombstone.
        if back.get("fireside_tombstone"):
            ft = back["fireside_tombstone"]
            await db.event_tombstones.update_one({"id": ft["id"]}, {"$set": ft}, upsert=True)
        print(f"UNDO complete for stamp {stamp}: index dropped, {len(back['losers'])} losers restored, "
              f"survivors' source_uid reverted, Fireside tombstone restored.")
        return

    survivors = [await db.events.find_one({"id": sid}, {"_id": 0}) for sid in SURVIVORS]
    losers = [await db.events.find_one({"id": lid}, {"_id": 0}) for lid in LOSERS]
    ft = await db.event_tombstones.find_one({"id": FIRESIDE_TOMBSTONE}, {"_id": 0})
    missing = [sid for sid, s in zip(SURVIVORS, survivors) if not s] + [lid for lid, l in zip(LOSERS, losers) if not l]
    if missing:
        print("ABORT, these ids were not found (nothing written):", missing); return

    print("== PLAN ==")
    for s in survivors:
        url = SURVIVORS[s["id"]]
        print(f"  survivor {s['id']} {s['title']!r}: source_uid {s.get('source_uid')!r} -> {url!r} "
              f"(start/end/category/locks untouched)")
    for l in losers:
        print(f"  remove loser {l['id']} {l['title']!r}  (no tombstone)")
    print(f"  drop Fireside tombstone {FIRESIDE_TOMBSTONE} (present={bool(ft)})")
    print(f"  create unique index {INDEX_NAME} on (source_key, source_uid, recurrence_id) [aggregator, string source_uid]")

    if not APPLY:
        print("\nDRY RUN only. Re-run with --apply."); return

    # Backup everything needed to fully reverse.
    backup = {"backup_stamp": STAMP, "survivors": survivors, "losers": losers, "fireside_tombstone": ft}
    with open(f"/app/backend/dedup_backup_{STAMP}.json", "w") as f:
        json.dump(backup, f, default=str)
    await db[COLL].delete_many({"backup_stamp": STAMP})
    await db[COLL].insert_one({**backup, "_saved_at": datetime.now(timezone.utc).isoformat()})

    # 1) Backfill survivor source_uid (only field touched on survivors).
    for s in survivors:
        await db.events.update_one({"id": s["id"]}, {"$set": {"source_uid": SURVIVORS[s["id"]]}})
    # 2) Remove losers, no tombstone.
    rem = await db.events.delete_many({"id": {"$in": LOSERS}})
    # 3) Drop the stale Fireside tombstone.
    if ft:
        await db.event_tombstones.delete_one({"id": FIRESIDE_TOMBSTONE})
    # 4) Guard: no duplicate identity remains before the unique index is built.
    pipeline = [
        {"$match": {"source": "aggregator", "source_uid": {"$type": "string"}}},
        {"$group": {"_id": {"k": "$source_key", "u": "$source_uid", "r": "$recurrence_id"}, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    dups = await db.events.aggregate(pipeline).to_list(50)
    if dups:
        print("WARNING: duplicate identities still present, index NOT created:", dups)
    else:
        await create_index(db)
        print("unique index created.")
    print(f"\nAPPLIED. losers removed={rem.deleted_count}. "
          f"UNDO: python /app/backend/dedup_apply.py --undo {STAMP}")

asyncio.run(main())
