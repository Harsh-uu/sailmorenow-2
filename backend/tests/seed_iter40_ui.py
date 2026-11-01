"""iter40 seed: users A(sender)/B(recipient)/admin + thread w/ 2 unread inbound,
a claimed handle, and one TEST contact submission."""
import asyncio
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from deps import db  # noqa: E402

A = {"user_id": "test-iter40-a", "token": "test_sess_iter40_a", "name": "TEST Iter40 Alpha", "handle": "test40alpha"}
B = {"user_id": "test-iter40-b", "token": "test_sess_iter40_b", "name": "TEST Iter40 Beta", "handle": "test40beta"}
ADMIN = {"user_id": "test-iter40-admin", "token": "test_sess_iter40_admin", "name": "TEST Iter40 Admin", "handle": "test40admin"}


def tid(a, b):
    return "-".join(sorted([a, b]))


async def main():
    now = datetime.now(timezone.utc)
    for u in (A, B, ADMIN):
        doc = {
            "user_id": u["user_id"], "email": f"{u['user_id']}@sailmorenow.dev",
            "name": u["name"], "avatar": "\u26f5", "account_type": "sailor",
            "handle": u["handle"],
            "primary_market": "Greater Seattle", "markets": ["Greater Seattle"],
            "onboarding_complete": True, "subscription_tier": "free",
            "created_at": now.isoformat(),
        }
        if u is ADMIN:
            doc["platform_role"] = "admin"
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": doc}, upsert=True)
        await db.user_sessions.update_one({"session_token": u["token"]}, {"$set": {
            "user_id": u["user_id"], "session_token": u["token"],
            "expires_at": now.replace(year=now.year + 1), "created_at": now}}, upsert=True)

    # Thread A<->B: 2 unread inbound to B
    t = tid(A["user_id"], B["user_id"])
    await db.dm_messages.delete_many({"thread_id": t})
    for i in range(2):
        await db.dm_messages.insert_one({
            "id": str(uuid.uuid4()), "thread_id": t, "from_id": A["user_id"],
            "from_name": A["name"], "to_id": B["user_id"],
            "body": f"TEST_iter40 unread inbound {i}", "created_at": now.isoformat(),
            "read_at": None})
    await db.dm_threads.update_one({"thread_id": t}, {"$set": {
        "thread_id": t, "participants": [A["user_id"], B["user_id"]],
        "updated_at": now.isoformat(), "last_message": "TEST_iter40 unread inbound 1",
        "created_at": now.isoformat()}}, upsert=True)

    # Thread A<->ADMIN where A sent everything (A should see unread=0)
    t2 = tid(A["user_id"], ADMIN["user_id"])
    await db.dm_messages.delete_many({"thread_id": t2})
    await db.dm_messages.insert_one({
        "id": str(uuid.uuid4()), "thread_id": t2, "from_id": A["user_id"],
        "from_name": A["name"], "to_id": ADMIN["user_id"],
        "body": "TEST_iter40 outbound only", "created_at": now.isoformat(),
        "read_at": None})
    await db.dm_threads.update_one({"thread_id": t2}, {"$set": {
        "thread_id": t2, "participants": [A["user_id"], ADMIN["user_id"]],
        "updated_at": now.isoformat(), "last_message": "TEST_iter40 outbound only",
        "created_at": now.isoformat()}}, upsert=True)

    # One contact submission for the admin queue
    await db.contact_messages.delete_many({"name": {"$regex": "^TEST_iter40"}})
    for i in range(2):
        await db.contact_messages.insert_one({
            "id": f"test-iter40-contact-{i}", "name": f"TEST_iter40 Sender {i}",
            "email": f"test40contact{i}@example.com", "message": "TEST_iter40 hello",
            "ip": "9.9.9.9",
            "created_at": now.replace(microsecond=i).isoformat()})

    print("thread_b:", t)
    print("thread_a_only:", t2)


asyncio.get_event_loop().run_until_complete(main())
