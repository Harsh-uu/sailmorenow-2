"""Seed UI data for iteration 35 (Phase O) frontend tests.

Creates:
  * one signed-in test user (handle set) + session token
  * 3 users with saved_searches for 'spinnaker trim' spanning last 3 weeks
    so /api/searches/suggestions returns a non-empty trend
  * one community post in Greater Seattle mentioning spinnaker trim

Prints the session token for the Playwright run.
Cleanup: python seed_iter35_ui.py --clean
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

TAG = "TEST_iter35_ui"
MARKET = "Greater Seattle"
QUERY = "spinnaker trim"


def clean():
    ids = [d["user_id"] for d in db.users.find({"test_tag": TAG}, {"user_id": 1})]
    db.notifications.delete_many({"user_id": {"$in": ids}})
    db.comments.delete_many({"author_id": {"$in": ids}})
    db.posts.delete_many({"test_tag": TAG})
    db.user_sessions.delete_many({"test_tag": TAG})
    db.users.delete_many({"test_tag": TAG})
    print("cleaned")


def mk_user(name, handle, saved=None):
    uid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    doc = {
        "user_id": uid, "name": name, "handle": handle,
        "email": f"{uid}@sailmorenow.dev".lower(),
        "picture": "https://via.placeholder.com/150",
        "account_type": "sailor", "primary_market": MARKET, "markets": [MARKET],
        "onboarding_complete": True, "policies_agreed": True,
        "subscription_tier": "free", "newsletter_opt_in": True,
        "created_at": datetime.now(timezone.utc).isoformat(), "test_tag": TAG,
    }
    if saved:
        doc["saved_searches"] = saved
    db.users.insert_one(doc)
    return uid


def main():
    clean()
    now = datetime.now(timezone.utc)
    main_uid = mk_user("QA Phase O", f"qaphaseo{uuid.uuid4().hex[:4]}")
    token = f"TEST_sess_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "user_id": main_uid, "session_token": token, "test_tag": TAG,
        "expires_at": now + timedelta(days=7), "created_at": now,
    })
    for i, off in enumerate([1, 8, 16]):
        mk_user(f"Trend Seed {i}", f"trendseed{i}{uuid.uuid4().hex[:4]}", saved=[{
            "id": str(uuid.uuid4()), "q": QUERY,
            "created_at": (now - timedelta(days=off)).isoformat(),
        }])
    db.posts.insert_one({
        "id": str(uuid.uuid4()), "kind": "general",
        "title": "Spinnaker trim clinic Saturday",
        "body": "Working on spinnaker trim off Shilshole — join us.",
        "market": MARKET, "author_id": main_uid, "author_name": "QA Phase O",
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "test_tag": TAG,
    })
    handle = db.users.find_one({"user_id": main_uid})["handle"]
    print("SESSION_TOKEN=" + token)
    print("USER_ID=" + main_uid)
    print("HANDLE=" + handle)


if __name__ == "__main__":
    if "--clean" in sys.argv:
        clean()
    else:
        main()
