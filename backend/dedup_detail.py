"""READ-ONLY deep detail for dedup pairs + tombstone collision analysis. Writes nothing."""
import asyncio, os, sys, hashlib
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient


def hkey(*parts):
    return hashlib.sha1("||".join(p or "" for p in parts).encode("utf-8")).hexdigest()[:16]


def new_id(sk, source_uid, title, recurrence_id):
    uid = source_uid or title or ""
    occ = recurrence_id or ""
    return f"agg_{sk}_{hkey(sk, uid, occ)}"


PAIR_IDS = [
    "agg_owsa_d4d93f00ca05c70c", "agg_owsa_c6159083abd5de5b",      # Nauti Drinks
    "agg_owsa_d40c9c0d152c71b7", "agg_owsa_d97881ca61a1536b",      # Holiday Party
    "agg_owsa_5bb2d3cf03d5d8d3", "agg_owsa_3abdcd31a5120378",      # Game & Art Night
]


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    print("== FULL detail of the 6 pair docs ==")
    for pid in PAIR_IDS:
        e = await db.events.find_one({"id": pid}, {"_id": 0})
        if not e:
            print(f"- {pid}: NOT FOUND"); continue
        print(f"\n- id={pid}")
        for k in ("title", "starts_at", "ends_at", "category", "category_manual", "admin_edited",
                  "admin_locked_fields", "source_uid", "registration_url", "image_url", "location",
                  "is_volunteer", "created_at"):
            print(f"    {k} = {e.get(k)!r}")
        d = e.get("description") or ""
        print(f"    description[:120] = {d[:120]!r}  (custom={'Imported from' not in d})")
        print(f"    -> new_id = {new_id(e['source_key'], e.get('source_uid'), e.get('title'), e.get('recurrence_id'))}")

    print("\n\n== LIVE aggregator docs: new_id map + merge/collision detection ==")
    live = await db.events.find({"source": "aggregator"}, {"_id": 0}).to_list(5000)
    from collections import defaultdict
    newmap = defaultdict(list)
    for e in live:
        nid = new_id(e["source_key"], e.get("source_uid"), e.get("title"), e.get("recurrence_id"))
        newmap[nid].append(e)
    merges = {k: v for k, v in newmap.items() if len(v) > 1}
    print(f"live docs: {len(live)} | unique new ids: {len(newmap)} | new-id groups with 2+ docs (MERGE): {len(merges)}")
    for nid, docs in merges.items():
        print(f"  MERGE new_id={nid}")
        for d in docs:
            print(f"     cur={d['id']} title={d.get('title')!r} src_uid={d.get('source_uid')} start={d.get('starts_at')}")

    print("\n== TOMBSTONE re-key + collision with LIVE new ids ==")
    live_newids = set(newmap.keys())
    ts = await db.event_tombstones.find({}, {"_id": 0}).to_list(500)
    for t in ts:
        tnid = new_id(t.get("source_key"), t.get("source_uid"), t.get("title"), t.get("recurrence_id"))
        collide = tnid in live_newids
        who = [d["id"] for d in newmap.get(tnid, [])] if collide else []
        print(f"- ts id={t.get('id')} title={t.get('title')!r} src_uid={t.get('source_uid')}")
        print(f"    -> tombstone new_id={tnid}  COLLIDES WITH LIVE? {collide} {who}")

asyncio.run(main())
