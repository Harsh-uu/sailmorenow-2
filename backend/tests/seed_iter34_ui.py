"""Seed data for iteration 34 UI tests. Prints session tokens as JSON."""
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
client = MongoClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])
db = client[os.environ.get("DB_NAME") or env["DB_NAME"]]

TAG = "TEST_iter34ui"
MARKET = "Greater Seattle"
NOW = datetime.now(timezone.utc)

# clean previous run
old = [d["user_id"] for d in db.users.find({"test_tag": TAG}, {"user_id": 1})]
db.user_sessions.delete_many({"test_tag": TAG})
db.users.delete_many({"test_tag": TAG})
db.posts.delete_many({"test_tag": TAG})


def mk_user(name, *, admin=False, saved=None):
    uid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    tok = f"TEST_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid, "email": f"{uid}@sailmorenow.dev".lower(), "name": name,
        "picture": "https://via.placeholder.com/150", "account_type": "sailor",
        "primary_market": MARKET, "markets": [MARKET],
        "onboarding_complete": True, "subscription_tier": "premium",
        "newsletter_opt_in": True, "created_at": NOW.isoformat(), "test_tag": TAG,
    }
    if admin:
        doc["platform_role"] = "admin"
    if saved:
        doc["saved_searches"] = [{"id": str(uuid.uuid4()), "q": q,
                                  "created_at": NOW.isoformat()} for q in saved]
    db.users.insert_one(doc)
    db.user_sessions.insert_one({"user_id": uid, "session_token": tok, "test_tag": TAG,
                                 "expires_at": NOW + timedelta(days=7), "created_at": NOW})
    return uid, tok


def mk_post(title, body):
    pid = str(uuid.uuid4())
    db.posts.insert_one({
        "id": pid, "type": "sailing_opportunity", "kind": "general", "title": title,
        "body": body, "market": MARKET, "author_id": "seed", "author_name": "TEST Seeder",
        "allow_comments": True,
        "created_at": NOW.isoformat(),
        "expires_at": (NOW + timedelta(days=30)).isoformat(),
        "test_tag": TAG,
    })
    return pid


admin_uid, admin_tok = mk_user("TEST Admin34UI", admin=True, saved=["spinnaker"])
plain_uid, plain_tok = mk_user("TEST Plain34UI", saved=["spinnaker"])
u3, _ = mk_user("TEST Third34UI", saved=["spinnaker", "moorage"])
u4, _ = mk_user("TEST Fourth34UI", saved=["moorage"])

mk_post("TEST34 Spinnaker practice", "We will run spinnaker sets on Saturday.")
mk_post("TEST34 Dock party", "Bring snacks. Nothing about kites here.")

print(json.dumps({"admin_token": admin_tok, "plain_token": plain_tok,
                  "admin_uid": admin_uid, "plain_uid": plain_uid}))
client.close()
