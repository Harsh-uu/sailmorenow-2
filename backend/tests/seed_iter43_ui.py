"""Seed fixtures for iter43 / Phase S retest.

Creates:
  - admin user + session      (test-iter43-admin / test_sess_iter43_admin)
  - sailor (non-admin) user   (test-iter43-user  / test_sess_iter43_user)
  - boat_pro user + session   (test-iter43-pro   / test_sess_iter43_pro)
  - contact_messages row      (TEST_iter43 contact)
  - handle 'captainjane' on the seeded boat owner (for /@captainjane)
Idempotent: safe to re-run.
"""
import os
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = {**dotenv_values("/app/backend/.env"), **os.environ}
client = MongoClient(env["MONGO_URL"])
db = client[env["DB_NAME"]]

now = datetime.now(timezone.utc)
exp = now + timedelta(days=7)

USERS = [
    {"user_id": "test-iter43-admin", "email": "test.iter43.admin@sailmorenow.dev",
     "name": "Iter43 Admin", "account_type": "sailor", "platform_role": "admin"},
    {"user_id": "test-iter43-user", "email": "test.iter43.user@sailmorenow.dev",
     "name": "Iter43 User", "account_type": "sailor"},
    {"user_id": "test-iter43-pro", "email": "test.iter43.pro@sailmorenow.dev",
     "name": "Iter43 Pro", "account_type": "boat_pro", "subscription_tier": "premium"},
]
TOKENS = {
    "test-iter43-admin": "test_sess_iter43_admin",
    "test-iter43-user": "test_sess_iter43_user",
    "test-iter43-pro": "test_sess_iter43_pro",
}

for u in USERS:
    doc = {
        "picture": "https://via.placeholder.com/150",
        "primary_market": "Greater Seattle",
        "markets": ["Greater Seattle"],
        "onboarding_complete": True,
        "newsletter_opt_in": True,
        "created_at": now,
        **u,
    }
    doc.setdefault("subscription_tier", "free")
    db.users.update_one({"user_id": u["user_id"]}, {"$set": doc}, upsert=True)
    tok = TOKENS[u["user_id"]]
    db.user_sessions.update_one(
        {"session_token": tok},
        {"$set": {"user_id": u["user_id"], "session_token": tok,
                  "expires_at": exp, "created_at": now}},
        upsert=True,
    )

db.contact_messages.update_one(
    {"id": "test-iter43-contact"},
    {"$set": {"id": "test-iter43-contact", "name": "TEST_iter43 Sender",
              "email": "test.iter43.contact@sailmorenow.dev",
              "message": "TEST_iter43 contact submission for reply testing.",
              "status": "new", "created_at": now.isoformat()},
     "$setOnInsert": {"replies": []}},
    upsert=True,
)

# handle for /@captainjane route test
owner = db.users.find_one({"email": "captain.jane@sailmorenow.dev"})
if owner:
    db.users.update_one({"user_id": owner["user_id"]}, {"$set": {"handle": "captainjane"}})
    print("handle captainjane ->", owner["user_id"])
else:
    print("WARNING: captain.jane@sailmorenow.dev not found; run POST /api/seed")

print("seeded iter43 fixtures")
