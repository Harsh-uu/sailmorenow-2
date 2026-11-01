"""Mint a boat_pro session token for iter48 UI testing."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[
    os.environ.get("DB_NAME") or env["DB_NAME"]]

u = db.users.find_one({"email": "pro.marina@sailmorenow.dev"})
assert u, "seeded pro.marina missing"
tok = "test_iter48_ui_token"
db.user_sessions.delete_many({"session_token": tok})
db.user_sessions.insert_one({
    "user_id": u["user_id"], "session_token": tok,
    "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    "created_at": datetime.now(timezone.utc),
})
pro = db.boat_pros.find_one({"user_id": u["user_id"]}) or {}
print("TOKEN", tok)
print("USER", u["user_id"])
print("PHOTOS", len(pro.get("photos") or []))
