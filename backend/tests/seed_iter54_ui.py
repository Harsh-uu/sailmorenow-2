"""Mint test sessions for iter54 polish batch."""
import asyncio, os, sys
from datetime import datetime, timezone, timedelta
sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TOKENS = {
    "crew.alex@sailmorenow.dev": "test_iter54_member_token",
    "partner.psss@sailmorenow.dev": "test_iter54_partner_token",
    "jenn@sailmorenow.com": "test_iter54_admin_token",
}

async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    exp = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    for email, tok in TOKENS.items():
        u = await db.users.find_one({"email": email})
        if not u:
            # Create the admin user (jenn) if missing
            if email == "jenn@sailmorenow.com":
                u = {"user_id": "test-admin-jenn", "email": email,
                     "name": "Jenn Admin", "picture": None,
                     "account_type": "sailor", "primary_market": "Greater Seattle",
                     "markets": ["Greater Seattle"], "onboarding_complete": True,
                     "created_at": datetime.now(timezone.utc)}
                await db.users.insert_one(u)
            else:
                print(f"MISSING USER {email}"); continue
        await db.user_sessions.update_one(
            {"session_token": tok},
            {"$set": {"session_token": tok, "user_id": u["user_id"], "expires_at": exp,
                      "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        print(f"{email} -> {tok} (user_id={u['user_id']})")
    # Ensure forum has >=5 seeded threads
    import uuid
    forum_count = await db.discussions.count_documents({"kind": "forum", "status": "published"})
    print(f"forum threads published: {forum_count}")

asyncio.run(main())
