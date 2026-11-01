"""EVENTS-FIX-1 PART 2: one-time dedup DRY RUN. Writes nothing.

Finds duplicate groups across ALL aggregator sources (same source + same normalized
title + same start day, and same stable URL/UID where known), picks the survivor
(prefer the copy carrying Jenn's hand edits: category_manual / admin_edited / locks),
and reports what would be tombstoned and how fields would merge. Also lists tombstoned
twins and whether they could reappear.
"""
import asyncio, os, re, sys
from collections import defaultdict
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
from aggregator import _hash_key


def norm(t):
    t = (t or "").strip().lower()
    t = re.sub(r"^\[\s*draft\s*\]\s*", "", t)
    return re.sub(r"\s+", " ", t)


def hand_score(d):
    # higher = more likely the survivor
    s = 0
    if d.get("category_manual"): s += 4
    if d.get("admin_edited"): s += 2
    s += len(d.get("admin_locked_fields") or [])
    if d.get("image_url"): s += 1
    if (d.get("description") or "").strip() and "Imported from" not in (d.get("description") or ""): s += 1
    return s


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    evs = await db.events.find({"source": "aggregator"}, {"_id": 0}).to_list(5000)

    groups = defaultdict(list)
    for e in evs:
        key = (e.get("source_key"), norm(e.get("title")), (e.get("starts_at") or "")[:10])
        groups[key].append(e)

    dups = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"aggregator events: {len(evs)} | duplicate GROUPS (same source+title+start day): {len(dups)}\n")

    for (sk, title, day), docs in dups.items():
        docs = sorted(docs, key=hand_score, reverse=True)
        survivor = docs[0]
        print(f"GROUP [{sk}] {title!r} @ {day}  ({len(docs)} copies)")
        for i, d in enumerate(docs):
            role = "SURVIVES" if i == 0 else "tombstone"
            print(f"   {role}: id={d.get('id')} score={hand_score(d)} cat={d.get('category')} manual={d.get('category_manual')} "
                  f"locked={sorted(d.get('admin_locked_fields') or [])}")
            print(f"            reg={bool(d.get('registration_url'))} img={bool(d.get('image_url'))} "
                  f"desc={'custom' if d.get('description') and 'Imported from' not in d.get('description') else 'generic'}")
        # what the survivor would gain from losers (only where survivor is missing it, never over a lock)
        gains = []
        locked = set(survivor.get("admin_locked_fields") or [])
        for f in ("registration_url", "description", "image_url", "ends_at", "location"):
            if f in locked:
                continue
            if not (survivor.get(f) or "").strip() if isinstance(survivor.get(f), str) else not survivor.get(f):
                for loser in docs[1:]:
                    if loser.get(f):
                        gains.append(f"{f} <- {loser.get('id')[-6:]}")
                        break
        print(f"   survivor fills missing (no lock overwritten): {gains or 'nothing'}")
        print()

    # Tombstones (previously hand-deleted) and reappearance risk.
    ts = await db.event_tombstones.find({}, {"_id": 0}).to_list(200)
    print(f"TOMBSTONES on file: {len(ts)}")
    live_titles = {(e.get("source_key"), norm(e.get("title"))) for e in evs}
    for t in ts:
        sk = t.get("source_key"); nt = norm(t.get("title"))
        could = (sk, nt) in live_titles
        print(f"   [{sk}] {t.get('title')!r} id={t.get('id')} "
              f"| a live event shares this title now? {could}  "
              f"(risk: a feed title/time drift makes a NEW date-key the old tombstone misses)")

asyncio.run(main())
