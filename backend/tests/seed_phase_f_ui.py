"""Seed a premium user + two posts (one with 2 comments, one with none) for UI testing."""
import os, uuid, json, subprocess
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL")
        or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

uid = "TEST_userFUI_" + uuid.uuid4().hex[:8]
tok = "TEST_sess_" + uuid.uuid4().hex
subprocess.run(["mongosh", "--quiet", "--eval", f"""use('test_database');
db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST_F UI Sailor',
  picture:'https://via.placeholder.com/150', account_type:'sailor', primary_market:'Greater Seattle',
  markets:['Greater Seattle'], onboarding_complete:true, subscription_tier:'premium',
  platform_role:'member', created_at:new Date()}});
db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
  expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
"""], check=True, capture_output=True, text=True)

s = requests.Session()
s.headers.update({"Content-Type": "application/json", "User-Agent": UA,
                  "Authorization": f"Bearer {tok}"})


def post(title):
    r = s.post(f"{BASE}/posts", json={"type": "sailing_opportunity", "title": title,
                                      "body": "TEST_F UI body", "market": "Greater Seattle",
                                      "allow_comments": True})
    r.raise_for_status()
    return r.json()["id"]


with_c = post("TEST_F UI post WITH comments")
without_c = post("TEST_F UI post WITHOUT comments")
for i in range(2):
    r = s.post(f"{BASE}/posts/{with_c}/comments", json={"body": f"TEST_F UI comment {i}"})
    r.raise_for_status()

feed = s.get(f"{BASE}/posts").json()
counts = {d["id"]: d.get("comment_count") for d in feed if d["id"] in (with_c, without_c)}
print(json.dumps({"user_id": uid, "token": tok, "post_with": with_c,
                  "post_without": without_c, "api_counts": counts}))
