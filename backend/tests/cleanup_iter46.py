"""Restore boat_pros.seed_marina photos + clean iter45/46 seed data."""
import os

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[
    os.environ.get("DB_NAME") or env["DB_NAME"]]

ORIGINAL = [
    "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=400",
    "https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=400",
]
db.boat_pros.update_one({"user_id": "seed_marina"}, {"$set": {"photos": ORIGINAL}})
db.user_sessions.delete_many({"session_token": {"$regex": "^test_iter4(5|6)_"}})
db.users.delete_many({"user_id": {"$regex": "^TEST_iter4(5|6)_"}})
db.contact_messages.delete_many({"name": {"$regex": "^TEST_Iter4(5|6)"}})
print("restored photos:", (db.boat_pros.find_one({"user_id": "seed_marina"}) or {}).get("photos"))
print("residual sessions:", db.user_sessions.count_documents({"session_token": {"$regex": "^test_iter4"}}))
