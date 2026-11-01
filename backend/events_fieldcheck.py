"""EVENTS-FIX-2 item 4: DRY RUN. Writes nothing.
List hand-edited scraped events whose stored start/end differs from what the current
feed emits, and any events with end before start.
"""
import asyncio, os, sys
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
import aggregator


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    evs = await db.events.find({"source": "aggregator"}, {"_id": 0}).to_list(5000)

    # Build feed snapshot by current external_id.
    sources = await aggregator._load_sources(db)
    feed = {}
    for src in sources:
        try:
            for e in await src.fetch():
                feed[f"agg_{src.key}_{e['external_id']}"] = e
        except Exception as ex:
            print(f"  (source {getattr(src,'key','?')} failed: {str(ex)[:60]})")

    print("=== hand-edited scraped events vs current feed (start/end differs) ===")
    any_diff = False
    for ev in evs:
        if not ev.get("admin_edited"):
            continue
        fe = feed.get(ev["id"])
        if not fe:
            print(f"- {ev.get('title')!r} [{ev.get('source_key')}] id={ev['id']}")
            print(f"    stored start={ev.get('starts_at')} end={ev.get('ends_at')} | NOT in current feed (orphan / key drifted)")
            any_diff = True
            continue
        ds = ev.get("starts_at") != fe.get("starts_at")
        de = ev.get("ends_at") != fe.get("ends_at")
        if ds or de:
            any_diff = True
            print(f"- {ev.get('title')!r} [{ev.get('source_key')}]")
            print(f"    stored: start={ev.get('starts_at')} end={ev.get('ends_at')}")
            print(f"    feed  : start={fe.get('starts_at')} end={fe.get('ends_at')}")
            print(f"    locked: {sorted(ev.get('admin_locked_fields') or [])}")
    if not any_diff:
        print("  none")

    print("\n=== events with END before START (all sources) ===")
    bad = [e for e in evs if e.get("ends_at") and e.get("starts_at") and e["ends_at"] < e["starts_at"]]
    for e in bad:
        print(f"- {e.get('title')!r} [{e.get('source_key')}] start={e.get('starts_at')} end={e.get('ends_at')}")
    # also non-aggregator events
    others = await db.events.find({"source": {"$ne": "aggregator"}, "ends_at": {"$ne": None}}, {"_id": 0, "title": 1, "starts_at": 1, "ends_at": 1, "source": 1}).to_list(5000)
    ob = [e for e in others if e.get("ends_at") and e.get("starts_at") and e["ends_at"] < e["starts_at"]]
    for e in ob:
        print(f"- {e.get('title')!r} [{e.get('source')}] start={e.get('starts_at')} end={e.get('ends_at')}")
    if not bad and not ob:
        print("  none")

    print("\nNote: hand-entered (non-feed) events have no 'edited via single-box screen' marker stored, so that cannot be told apart from the data.")

asyncio.run(main())
