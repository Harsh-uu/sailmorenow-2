"""READ-ONLY inspection for the dedup apply + PART 2 report. Writes nothing."""
import asyncio, os, re, sys
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient

TITLES = ["nauti drinks", "holiday party", "volunteer appreciation", "game & art night", "game and art night", "fireside"]


def norm(t):
    t = (t or "").strip().lower()
    t = re.sub(r"^\[\s*draft\s*\]\s*", "", t)
    return re.sub(r"\s+", " ", t)


def score(d):
    s = 0
    if d.get("category_manual"): s += 4
    if d.get("admin_edited"): s += 2
    s += len(d.get("admin_locked_fields") or [])
    if d.get("image_url"): s += 1
    return s


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    print("== counts ==")
    print("aggregator events:", await db.events.count_documents({"source": "aggregator"}))
    print("all events:", await db.events.count_documents({}))
    print("tombstones:", await db.event_tombstones.count_documents({}))

    print("\n== OWSA candidate docs (by title) ==")
    evs = await db.events.find({"source_key": "owsa"}, {"_id": 0}).to_list(2000)
    for e in evs:
        if any(t in norm(e.get("title")) for t in TITLES):
            print(f"- id={e.get('id')}")
            print(f"    title={e.get('title')!r} start={e.get('starts_at')} end={e.get('ends_at')}")
            print(f"    source_uid={e.get('source_uid')}")
            print(f"    admin_edited={e.get('admin_edited')} cat_manual={e.get('category_manual')} locked={sorted(e.get('admin_locked_fields') or [])} score={score(e)} img={bool(e.get('image_url'))}")

    print("\n== tombstones on file ==")
    for t in await db.event_tombstones.find({}, {"_id": 0}).to_list(500):
        print(f"- id={t.get('id')} title={t.get('title')!r} source_key={t.get('source_key')} source_uid={t.get('source_uid')}")

    print("\n== spot-check events (c) ==")
    for q in ["winter sailing", "tropical party", "board of directors"]:
        for e in await db.events.find({"title": {"$regex": q, "$options": "i"}}, {"_id": 0}).to_list(20):
            print(f"- {e.get('title')!r} id={e.get('id')} start={e.get('starts_at')} end={e.get('ends_at')} tnl={e.get('time_not_listed')} cat={e.get('category')} locked={sorted(e.get('admin_locked_fields') or [])}")

    print("\n== bodfix backup stamps ==")
    for b in await db.events_backup_bodfix.find({}, {"_id": 0, "backup_stamp": 1, "id": 1, "starts_at": 1, "ends_at": 1}).to_list(50):
        print(f"- stamp={b.get('backup_stamp')} id={b.get('id')} start={b.get('starts_at')} end={b.get('ends_at')}")

    print("\n== event_sources status ==")
    for s in await db.event_sources.find({}, {"_id": 0, "key": 1, "enabled": 1, "read_only": 1, "last_status": 1, "last_error": 1}).to_list(50):
        print(f"- {s.get('key')} enabled={s.get('enabled')} read_only={s.get('read_only')} last_status={s.get('last_status')} last_error={str(s.get('last_error'))[:60]}")

    print("\n== aggregator_runs (recent) ==")
    for r in await db.aggregator_runs.find({}, {"_id": 0, "trigger": 1, "started_at": 1, "inserted": 1, "updated": 1, "errors": 1}).sort("started_at", -1).to_list(10):
        print(f"- {r.get('started_at')} trigger={r.get('trigger')} ins={r.get('inserted')} upd={r.get('updated')} err={r.get('errors')}")

asyncio.run(main())
