"""Seed sessions + fixtures for iter45 UI runs. Prints tokens/ids as JSON."""
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[
    os.environ.get("DB_NAME") or env["DB_NAME"]]

PREFIX = "TEST_iter45_"


def mint(uid):
    tok = f"test_iter45_{uuid.uuid4().hex[:12]}"
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc)})
    return tok


def seed():
    out = {}
    # admin
    admin_uid = PREFIX + "admin"
    db.users.update_one({"user_id": admin_uid}, {"$set": {
        "user_id": admin_uid, "email": "test.iter45.ui.admin@sailmorenow.dev",
        "name": "TEST Admin45 UI", "platform_role": "admin",
        "account_type": "sailor", "onboarding_complete": True}}, upsert=True)
    out["admin_token"] = mint(admin_uid)

    # onboarding sailor (incomplete)
    ob_uid = PREFIX + "onboard"
    db.users.update_one({"user_id": ob_uid}, {"$set": {
        "user_id": ob_uid, "email": "test.iter45.onboard@sailmorenow.dev",
        "name": "Testy Sailor45", "account_type": "sailor",
        "onboarding_complete": False}}, upsert=True)
    out["onboard_token"] = mint(ob_uid)

    # boat pro (existing seeded pro)
    pro = db.users.find_one({"email": "pro.marina@sailmorenow.dev"})
    out["pro_token"] = mint(pro["user_id"])
    out["pro_user_id"] = pro["user_id"]
    out["pro_photos_original"] = (db.boat_pros.find_one({"user_id": pro["user_id"]}) or {}).get("photos", [])

    # contact message with an undelivered reply
    mid = str(uuid.uuid4())
    rid_bad = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.contact_messages.insert_one({
        "id": mid, "name": "TEST_Iter45 UI", "email": "test.iter45.ui@example.com",
        "message": "TEST_ iter45 UI badge + template picker fixture",
        "ip": "127.0.0.1", "created_at": now, "status": "replied",
        "last_reply_at": now,
        "replies": [
            {"id": str(uuid.uuid4()), "body": "TEST_ delivered reply", "at": now,
             "by": admin_uid, "by_name": "TEST Admin45 UI", "delivered": True},
            {"id": rid_bad, "body": "TEST_ undelivered reply", "at": now,
             "by": admin_uid, "by_name": "TEST Admin45 UI", "delivered": False},
        ]})
    out["msg_id"] = mid
    out["undelivered_reply_id"] = rid_bad
    print(json.dumps(out))


def cleanup():
    db.user_sessions.delete_many({"session_token": {"$regex": "^test_iter45_"}})
    db.users.delete_many({"user_id": {"$regex": f"^{PREFIX}"}})
    db.contact_messages.delete_many({"name": {"$regex": "^TEST_Iter45"}})
    print("cleaned")


if __name__ == "__main__":
    cleanup() if len(sys.argv) > 1 and sys.argv[1] == "clean" else seed()
