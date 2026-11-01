"""iter39 UI seed: two users (one with a dashed user_id) + a thread with unread inbound msgs."""
import asyncio
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from deps import db  # noqa: E402

A = {"user_id": "test-user-t1-a", "token": "test_sess_iter39_a", "name": "TEST Iter39 Alpha"}
B = {"user_id": "test-user-t1-b", "token": "test_sess_iter39_b", "name": "TEST Iter39 Beta"}


def tid(a, b):
    return "-".join(sorted([a, b]))


async def main():
    now = datetime.now(timezone.utc)
    for u in (A, B):
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {
            "user_id": u["user_id"], "email": f"{u['user_id']}@sailmorenow.dev",
            "name": u["name"], "avatar": "⛵", "account_type": "sailor",
            "primary_market": "Greater Seattle", "markets": ["Greater Seattle"],
            "onboarding_complete": True, "subscription_tier": "free",
            "created_at": now.isoformat()}}, upsert=True)
        await db.user_sessions.update_one({"session_token": u["token"]}, {"$set": {
            "user_id": u["user_id"], "session_token": u["token"],
            "expires_at": now.replace(year=now.year + 1), "created_at": now}}, upsert=True)
    t = tid(A["user_id"], B["user_id"])
    await db.dm_messages.delete_many({"thread_id": t})
    for i in range(2):
        await db.dm_messages.insert_one({
            "id": str(uuid.uuid4()), "thread_id": t, "from_id": A["user_id"],
            "from_name": A["name"], "to_id": B["user_id"],
            "body": f"TEST_iter39 unread inbound {i}", "created_at": now.isoformat(),
            "read_at": None})
    await db.dm_threads.update_one({"thread_id": t}, {"$set": {
        "thread_id": t, "participants": [A["user_id"], B["user_id"]],
        "updated_at": now.isoformat(), "last_message": "TEST_iter39 unread inbound 1",
        "created_at": now.isoformat()}}, upsert=True)
    print("thread:", t)
    print("A token:", A["token"], "B token:", B["token"])


asyncio.get_event_loop().run_until_complete(main())
