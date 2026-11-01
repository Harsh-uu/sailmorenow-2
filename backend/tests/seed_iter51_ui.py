"""Mint admin + partner session tokens for iter51 (events category) testing."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[
    os.environ.get("DB_NAME") or env["DB_NAME"]]

ADMIN_EMAIL = (env.get("ADMIN_EMAILS") or "").split(",")[0].strip()


def mint(user_id, token):
    db.user_sessions.delete_many({"session_token": token})
    db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=2),
        "created_at": datetime.now(timezone.utc),
    })


admin = db.users.find_one({"email": ADMIN_EMAIL})
if not admin:
    admin = {
        "user_id": "test_iter51_admin",
        "email": ADMIN_EMAIL,
        "name": "Jenn Admin",
        "picture": "https://via.placeholder.com/150",
        "account_type": "sailor",
        "primary_market": "Greater Seattle",
        "markets": ["Greater Seattle"],
        "onboarding_complete": True,
        "subscription_tier": "free",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.users.insert_one(dict(admin))
mint(admin["user_id"], "test_iter51_admin_token")

partner = db.users.find_one({"email": "partner.psss@sailmorenow.dev"})
assert partner, "seeded partner.psss missing"
mint(partner["user_id"], "test_iter51_partner_token")

print("ADMIN_EMAIL", ADMIN_EMAIL)
print("ADMIN_USER", admin["user_id"])
print("ADMIN_TOKEN test_iter51_admin_token")
print("PARTNER_USER", partner["user_id"])
print("PARTNER_TOKEN test_iter51_partner_token")
print("events_total", db.events.count_documents({}))
print("events_no_category", db.events.count_documents({"category": {"$exists": False}}))
print("forum_threads", db.discussions.count_documents({"kind": "forum"}))
for c in ["racing", "cruising", "education", "volunteering", "other"]:
    print("cat", c, db.events.count_documents({"category": c}))
