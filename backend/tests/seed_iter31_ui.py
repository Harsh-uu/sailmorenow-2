"""Seed sessions + saved-searches for the iter31 UI test run.

Prints ADMIN_TOKEN / USER_TOKEN. Run with --cleanup to remove everything.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
client = MongoClient(env["MONGO_URL"])
db = client[env["DB_NAME"].strip('"')]
TAG = "iter31_ui"

if "--cleanup" in sys.argv:
    db.users.delete_many({"test_tag": TAG})
    db.user_sessions.delete_many({"test_tag": TAG})
    print("cleaned")
    raise SystemExit(0)

db.users.delete_many({"test_tag": TAG})
db.user_sessions.delete_many({"test_tag": TAG})


def mk(name, *, admin=False, saved=None):
    uid = f"{TAG}-{name}-{uuid.uuid4().hex[:6]}"
    token = f"test_session_{uid}"
    doc = {
        "user_id": uid, "email": f"{uid}@sailmorenow.dev", "name": f"TEST {name}",
        "picture": "https://via.placeholder.com/150", "account_type": "sailor",
        "primary_market": "Greater Seattle", "markets": ["Greater Seattle"],
        "onboarding_complete": True, "subscription_tier": "free",
        "newsletter_opt_in": True, "created_at": datetime.now(timezone.utc).isoformat(),
        "test_tag": TAG,
    }
    if admin:
        doc["platform_role"] = "admin"
    if saved:
        doc["saved_searches"] = [{"id": str(uuid.uuid4()), "q": q,
                                  "created_at": datetime.now(timezone.utc).isoformat()}
                                 for q in saved]
    db.users.insert_one(doc)
    db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                 "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                                 "created_at": datetime.now(timezone.utc), "test_tag": TAG})
    return uid, token


admin_id, admin_token = mk("admin", admin=True)
user_id, user_token = mk("user")
for i in range(2):
    mk(f"pinner{i}", saved=["spinnaker tuning"])
print("ADMIN_TOKEN=" + admin_token)
print("USER_TOKEN=" + user_token)
print("ADMIN_ID=" + admin_id)
print("USER_ID=" + user_id)
