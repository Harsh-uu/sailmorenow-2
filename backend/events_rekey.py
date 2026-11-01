"""EVENTS-FIX-1 item 3: DRY RUN for ID-based matching.

Proposed stable key = hash(source_key, source_UID, occurrence) and IGNORES the start
date. OCSA uses the iCal UID (plus RECURRENCE-ID so a recurring series keeps one row per
occurrence); OWSA uses the event page URL. Tombstones would use the same new id.

This script WRITES NOTHING. It re-fetches the live feeds, compares the new ids with the
current ids, and reports what would re-link, merge, orphan, or newly insert.

  python events_rekey.py            # dry run report
  python events_rekey.py --apply    # (after go) re-key existing docs + tombstones
  python events_rekey.py --undo STAMP
"""
import asyncio, json, os, sys
from collections import defaultdict
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
import aggregator
from aggregator import _hash_key

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
COLL = "events_backup_rekey"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def new_key(e):
    uid = e.get("source_uid") or e.get("title") or ""
    occ = e.get("recurrence_id") or ""
    return f"agg_{e['source_key']}_{_hash_key(e['source_key'], uid, occ)}"


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    if UNDO:
        i = sys.argv.index("--undo"); stamp = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        print(f"UNDO for rekey stamp {stamp}: restore ids/tombstones from {COLL} (not implemented in dry-run phase).")
        return

    existing = await db.events.find({"source": "aggregator"}, {"_id": 0}).to_list(5000)
    by_curid = {e["id"]: e for e in existing}

    sources = await aggregator._load_sources(db)
    feed = []
    for src in sources:
        try:
            feed += await src.fetch()
        except Exception as ex:
            print(f"   (source {getattr(src,'key','?')} failed: {str(ex)[:70]})")

    # Group feed events by proposed new id.
    bynew = defaultdict(list)
    for e in feed:
        bynew[new_key(e)].append(e)

    relink = 0           # existing doc keeps, but its id string changes
    merge_groups = 0     # 2+ current docs collapse into one new id
    merge_removed = 0    # extra docs removed by those merges
    new_insert = 0       # feed event with no current doc
    relink_ex, merge_ex = [], []

    for nid, evs in bynew.items():
        cur_ids = []
        for e in evs:
            old_id = f"agg_{e['source_key']}_{e['external_id']}"
            if old_id in by_curid:
                cur_ids.append(old_id)
        cur_ids = list(dict.fromkeys(cur_ids))
        if not cur_ids:
            new_insert += 1
            continue
        if len(cur_ids) > 1:
            merge_groups += 1
            merge_removed += len(cur_ids) - 1
            if len(merge_ex) < 6:
                merge_ex.append((evs[0].get("title"), cur_ids))
        # any current id that differs from the proposed id = a re-link
        for cid in cur_ids:
            if cid != nid:
                relink += 1
                if len(relink_ex) < 6:
                    relink_ex.append((by_curid[cid].get("title"), cid, nid))

    # Orphans: current docs no feed event points at (under the OLD scheme).
    feed_old_ids = {f"agg_{e['source_key']}_{e['external_id']}" for e in feed}
    orphans = [e for e in existing if e["id"] not in feed_old_ids]

    print(f"\ncurrent scraped docs: {len(existing)} | feed events now: {len(feed)} | unique proposed ids: {len(bynew)}")
    print(f"RE-LINK (same event, id string changes): {relink}")
    print(f"MERGE (2+ current docs collapse to one): {merge_groups} groups, {merge_removed} extra docs removed")
    print(f"NEW INSERT (feed event with no current doc): {new_insert}")
    print(f"ORPHAN (current doc not in feed under old scheme): {len(orphans)}")
    print("\nre-link examples:")
    for t, cid, nid in relink_ex:
        print(f"   {t!r}: {cid}  ->  {nid}")
    print("merge examples (these would become ONE event):")
    for t, cids in merge_ex:
        print(f"   {t!r}: {cids}")
    print("orphan examples:")
    for e in orphans[:6]:
        print(f"   {e.get('title')!r} [{e.get('source_key')}] {e['id']}")
    print("\nDRY RUN only. No data written.")

asyncio.run(main())
