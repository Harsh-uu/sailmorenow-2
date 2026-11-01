"""EVENTS-FIX-3 verification. READ-ONLY, writes nothing.
Simulates the next scrape under the new {source_key, source_uid, recurrence_id}
matching and reports inserts/duplicates, plus the required spot checks."""
import asyncio, os, sys
from collections import defaultdict
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
import aggregator

TITLES_ONCE = ["Nauti Drinks", "Holiday Party + Volunteer Appreciation", "Game & Art Night"]


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    print("== counts ==")
    agg = await db.events.count_documents({"source": "aggregator"})
    allev = await db.events.count_documents({})
    print(f"aggregator events: {agg} | all events: {allev}")

    print("\n== each of the 3 titles appears once ==")
    for t in TITLES_ONCE:
        n = await db.events.count_documents({"source_key": "owsa", "title": t})
        print(f"  {t!r}: {n}")

    print("\n== live duplicate identities (source_key, source_uid, recurrence_id) ==")
    rows = await db.events.find({"source": "aggregator"}, {"_id": 0, "source_key": 1, "source_uid": 1, "recurrence_id": 1, "title": 1, "id": 1}).to_list(5000)
    groups = defaultdict(list)
    for r in rows:
        groups[(r.get("source_key"), r.get("source_uid"), r.get("recurrence_id"))].append(r)
    dups = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"  duplicate identity groups: {len(dups)}")
    for k, v in dups.items():
        print("   ", k, [x["id"] for x in v])
    missing_uid = [r["id"] for r in rows if not r.get("source_uid")]
    print(f"  aggregator docs missing source_uid: {len(missing_uid)} {missing_uid[:6]}")

    print("\n== spot checks (c) ==")
    async def show(q):
        for e in await db.events.find(q, {"_id": 0, "title": 1, "id": 1, "starts_at": 1, "ends_at": 1, "time_not_listed": 1, "category": 1, "admin_locked_fields": 1}).to_list(5):
            print(f"   {e.get('title')!r} id={e['id']} start={e.get('starts_at')} end={e.get('ends_at')} tnl={e.get('time_not_listed')} cat={e.get('category')} locked={sorted(e.get('admin_locked_fields') or [])}")
    await show({"id": "agg_ocsa-sailpdx_f51f0e1721ba37c7"})         # Winter Sailing Nov 1
    await show({"title": {"$regex": "tropical party", "$options": "i"}})
    await show({"id": "agg_owsa_88287618a8d8abe2"})                 # BoD Dec 9

    print("\n== Holiday Party volunteer RSVP still points at its event ==")
    reg = await db.event_registrations.find_one({"event_id": "agg_owsa_d40c9c0d152c71b7"}, {"_id": 0})
    ev = await db.events.find_one({"id": "agg_owsa_d40c9c0d152c71b7"}, {"_id": 0, "title": 1})
    print(f"  RSVP present={bool(reg)} kind={(reg or {}).get('kind')} | event exists={bool(ev)} title={(ev or {}).get('title')!r}")

    print("\n== read-only next-scrape simulation (new matching) ==")
    sources = await aggregator._load_sources(db)
    feed_total = ins = upd = skip_ts = book_online = 0
    for src in sources:
        try:
            evs = await src.fetch()
        except Exception as ex:
            print(f"   (source {getattr(src,'key','?')} failed: {str(ex)[:60]})"); continue
        for e in evs:
            feed_total += 1
            if (e.get("title") or "").strip().lower() == "book online":
                book_online += 1
            suid = e.get("source_uid"); rid = e.get("recurrence_id")
            legacy_id = f"agg_{src.key}_{e['external_id']}"
            ts_or = [{"id": legacy_id}]
            if suid:
                ts_or.append({"source_key": src.key, "source_uid": suid, "recurrence_id": rid})
            if await db.event_tombstones.find_one({"$or": ts_or}, {"_id": 1}):
                skip_ts += 1; continue
            match = {"source_key": src.key, "source_uid": suid, "recurrence_id": rid} if suid else {"id": legacy_id}
            if await db.events.find_one(match, {"_id": 1}):
                upd += 1
            else:
                ins += 1
    print(f"  feed events: {feed_total} | would INSERT: {ins} | would UPDATE in place: {upd} | tombstone-skipped: {skip_ts}")
    print(f"  'Book online' rows in feed: {book_online} (parser skips them, expect 0)")

    print("\n== 48 North still disabled ==")
    s = await db.event_sources.find_one({"key": "sarc-48north"}, {"_id": 0, "enabled": 1, "last_status": 1})
    print(f"  sarc-48north enabled={s.get('enabled')} last_status={s.get('last_status')}")

    print("\n== index present ==")
    idx = await db.events.index_information()
    print(f"  agg_source_identity present: {'agg_source_identity' in idx}")

asyncio.run(main())
