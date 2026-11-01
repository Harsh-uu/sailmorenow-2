"""Seed data for iteration 37 UI tests.

Creates:
  * TEST_iter37_new  — onboarding_complete=False (for the Onboarding handle test)
  * TEST_iter37_sndr — sender with handle, 1 unread DM to receiver
  * TEST_iter37_rcvr — receiver with handle
Prints tokens for the Playwright run.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from deps import db  # noqa: E402

MARKET = "Greater Seattle"


async def mk(suffix, complete=True, handle=None):
    uid = f"TEST_iter37ui_{suffix}_{uuid.uuid4().hex[:6]}"
    token = f"TEST_iter37ui_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    doc = {"user_id": uid, "email": f"{uid}@sailmorenow.dev", "name": f"TEST Iter37 {suffix}",
           "picture": "", "avatar": "⛵", "account_type": "sailor",
           "primary_market": MARKET, "markets": [MARKET],
           "onboarding_complete": complete, "subscription_tier": "free",
           "newsletter_opt_in": False, "created_at": now.isoformat()}
    if handle:
        doc["handle"] = handle
    await db.users.insert_one(doc)
    await db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                      "expires_at": now.replace(year=now.year + 1),
                                      "created_at": now})
    return uid, token


async def main():
    await cleanup()
    new_id, new_tok = await mk("new", complete=False)
    s_id, s_tok = await mk("sndr", handle=f"i37s{uuid.uuid4().hex[:5]}")
    r_id, r_tok = await mk("rcvr", handle=f"i37r{uuid.uuid4().hex[:5]}")
    tid = "-".join(sorted([s_id, r_id]))
    now = datetime.now(timezone.utc).isoformat()
    mid = str(uuid.uuid4())
    await db.dm_messages.insert_one({
        "id": mid, "thread_id": tid, "from_id": s_id, "from_name": "TEST Iter37 sndr",
        "to_id": r_id, "body": "TEST_iter37 unread inbound", "created_at": now, "read_at": None})
    await db.dm_threads.update_one({"thread_id": tid}, {"$set": {
        "thread_id": tid, "participants": [s_id, r_id], "updated_at": now,
        "last_message": "TEST_iter37 unread inbound"}}, upsert=True)
    print(f"NEW_TOKEN={new_tok}")
    print(f"NEW_ID={new_id}")
    print(f"SENDER_TOKEN={s_tok}")
    print(f"SENDER_ID={s_id}")
    print(f"RECEIVER_TOKEN={r_tok}")
    print(f"RECEIVER_ID={r_id}")
    print(f"THREAD_ID={tid}")
    print(f"MESSAGE_ID={mid}")


async def cleanup():
    ids = [u["user_id"] async for u in db.users.find({"user_id": {"$regex": "^TEST_iter37ui_"}}, {"user_id": 1})]
    if ids:
        await db.users.delete_many({"user_id": {"$in": ids}})
        await db.user_sessions.delete_many({"user_id": {"$in": ids}})
        await db.dm_messages.delete_many({"from_id": {"$in": ids}})
        await db.dm_threads.delete_many({"participants": {"$in": ids}})
    print(f"cleaned {len(ids)} old TEST_iter37ui users")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "clean":
        asyncio.run(cleanup())
    else:
        asyncio.run(main())
