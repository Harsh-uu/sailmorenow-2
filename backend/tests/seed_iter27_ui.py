"""Seed a UI session for iteration 27 frontend tests (admin user + a post)."""
import os
import uuid
from datetime import datetime, timezone, timedelta
from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[
    os.environ.get("DB_NAME") or env["DB_NAME"]]

now = datetime.now(timezone.utc)
uid = "TEST_iter27_ui_admin"
tok = "test_session_iter27_ui"

db.users.delete_many({"user_id": uid})
db.user_sessions.delete_many({"user_id": uid})
db.users.insert_one({
    "user_id": uid, "email": "TEST_iter27_ui@sailmorenow.dev",
    "name": "QA Admin27", "picture": "https://via.placeholder.com/64",
    "account_type": "sailor", "platform_role": "admin",
    "primary_market": "Greater Seattle", "markets": ["Greater Seattle"],
    "onboarding_complete": True, "subscription_tier": "free",
    "newsletter_opt_in": False, "saved_searches": [],
    "created_at": now.isoformat(),
})
db.user_sessions.insert_one({
    "user_id": uid, "session_token": tok,
    "expires_at": (now + timedelta(days=7)).isoformat(),
    "created_at": now.isoformat(),
})

# Mention target
db.users.delete_many({"user_id": "TEST_iter27_ui_alex"})
db.users.insert_one({
    "user_id": "TEST_iter27_ui_alex", "email": "TEST_iter27_alex@sailmorenow.dev",
    "name": "AlexqaUser", "picture": None, "account_type": "sailor",
    "primary_market": "Greater Seattle", "onboarding_complete": True,
    "created_at": now.isoformat(),
})

# Ensure a post exists in the Greater Seattle feed
pid = "TEST_iter27_post"
db.posts.delete_many({"id": pid})
db.posts.insert_one({
    "id": pid, "user_id": uid, "author_name": "QA Admin27",
    "title": "TEST iter27 mention post", "body": "Testing mention autocomplete.",
    "market": "Greater Seattle", "kind": "general", "post_type": "general",
    "created_at": now.isoformat(), "comment_count": 0,
})
print("SESSION_TOKEN", tok)
print("POST_ID", pid)
