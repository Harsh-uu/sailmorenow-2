"""Seed users + content for iteration 25 (Phase K) UI testing.

Prints JSON with tokens/ids. All data prefixed TEST_iter25ui_.
Run:  python /app/backend/tests/seed_iter25_ui.py
Clean: CLEANUP=1 python /app/backend/tests/seed_iter25_ui.py
"""
import json
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone

import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL")
        or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
DB = "test_database"
RUN = "TEST_iter25ui_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def mint(name, role="member", newsletter=False):
    uid = RUN + uuid.uuid4().hex[:8]
    tok = "TEST_sess25ui_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:{str(newsletter).lower()},
      platform_role:'{role}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return {"user_id": uid, "token": tok, "name": name}


def cleanup():
    mongo(f"""
    db.users.deleteMany({{user_id:/^{RUN}/}});
    db.user_sessions.deleteMany({{user_id:/^{RUN}/}});
    db.posts.deleteMany({{author_id:/^{RUN}/}});
    db.comments.deleteMany({{author_id:/^{RUN}/}});
    db.discussions.deleteMany({{author_id:/^{RUN}/}});
    db.reports.deleteMany({{$or:[{{reporter_id:/^{RUN}/}},{{id:/^{RUN}/}}]}});
    db.notifications.deleteMany({{user_id:/^{RUN}/}});
    db.events.deleteMany({{id:/^{RUN}/}});
    """)


def main():
    cleanup()
    admin = mint("TEST Admin25 UI", role="admin")
    author = mint("TEST Author25 UI")
    alex = mint("Alexqa Mentiontarget UI")

    p = requests.post(f"{BASE}/posts", headers=h(author["token"]), json={
        "type": "crew_wanted", "title": "TEST_iter25ui sailing crew wanted",
        "body": "TEST_iter25ui looking to sail this weekend", "market": MARKET}).json()
    d = requests.post(f"{BASE}/discussions", headers=h(author["token"]), json={
        "kind": "forum", "title": "TEST_iter25ui sailing tips thread",
        "body": "TEST_iter25ui sail trim discussion", "market": MARKET}).json()
    eid = RUN + uuid.uuid4().hex[:8]
    mongo(f"""db.events.insertOne({{id:'{eid}', title:'TEST_iter25ui sailing regatta',
      description:'TEST_iter25ui sail race', location:'TEST_iter25ui Marina',
      market:'{MARKET}', starts_at:'{(datetime.now(timezone.utc)+timedelta(days=6)).isoformat()}',
      created_at:new Date().toISOString(), source:'manual'}});""")

    # reports across weeks + statuses so the insights chart has multiple bars
    now = datetime.now(timezone.utc)
    for wk, n, st in [(0, 4, "open"), (1, 2, "resolved"), (3, 3, "dismissed"), (5, 1, "open")]:
        for i in range(n):
            created = (now - timedelta(days=wk * 7 + 1)).isoformat()
            mongo(f"""db.reports.insertOne({{id:'{RUN}rep_{wk}_{i}',
              reporter_id:'{admin["user_id"]}', target_type:'post', target_id:'{p["id"]}',
              reason:'TEST_iter25ui spam wk{wk}', status:'{st}',
              created_at:'{created}'}});""")

    print(json.dumps({"admin": admin, "author": author, "alex": alex,
                      "post_id": p.get("id"), "discussion_id": d.get("id"),
                      "event_id": eid}, indent=2))


if __name__ == "__main__":
    if os.environ.get("CLEANUP"):
        cleanup()
        print("cleaned")
    else:
        main()
