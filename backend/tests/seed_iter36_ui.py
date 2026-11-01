"""Seed sessions + report history for iteration 36 UI testing."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from deps import db  # noqa: E402

ADMIN_EMAIL = (os.environ.get("ADMIN_EMAILS", "").split(",")[0] or "").strip()


async def mint(user_id, email, name, handle, extra=None):
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user_id, "email": email, "name": name, "handle": handle,
        "account_type": "sailor", "primary_market": "Greater Seattle",
        "markets": ["Greater Seattle"], "onboarding_complete": True,
        "subscription_tier": "free", "created_at": now.isoformat(),
    }
    doc.update(extra or {})
    await db.users.update_one({"user_id": user_id}, {"$set": doc}, upsert=True)
    token = f"test_session_iter36_{user_id}"
    await db.user_sessions.update_one(
        {"session_token": token},
        {"$set": {"user_id": user_id, "session_token": token,
                  "expires_at": (now + timedelta(days=7)).isoformat(),
                  "created_at": now.isoformat()}},
        upsert=True)
    return token


async def main():
    admin_token = await mint("TEST_iter36_admin", ADMIN_EMAIL, "TEST Admin", "test36admin")
    member_token = await mint("TEST_iter36_member", "test36member@sailmorenow.dev",
                              "TEST Member Iter36", "test36member")
    target_token = await mint("TEST_iter36_target", "test36target@sailmorenow.dev",
                              "TEST Target Iter36", "test36target",
                              {"bio": "Iter36 QA target profile."})

    # Report history: 2 in prior window (weeks -3/-4), 6 in recent 2 weeks -> climbing
    now = datetime.now(timezone.utc)
    await db.reports.delete_many({"id": {"$regex": "^TEST_iter36_"}})
    offsets = [2, 4, 6, 9, 11, 13, 18, 24]
    for i, days in enumerate(offsets):
        await db.reports.insert_one({
            "id": f"TEST_iter36_rep_{i}", "reporter_id": "TEST_iter36_member",
            "target_type": "post", "target_id": f"TEST_iter36_post_{i % 2}",
            "reason": "spam", "details": "QA seed", "status": "open",
            "created_at": (now - timedelta(days=days)).isoformat(),
        })

    print("ADMIN_TOKEN=" + admin_token)
    print("MEMBER_TOKEN=" + member_token)
    print("TARGET_HANDLE=test36target")
    print("reports_seeded=" + str(len(offsets)))


asyncio.run(main())
