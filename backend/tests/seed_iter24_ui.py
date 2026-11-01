"""Seed users + content for iteration 24 UI testing (flags, threads, admin pages).

Prints JSON with tokens and ids. Data is prefixed TEST_iter24ui_ for cleanup.
"""
import json
import os
import uuid
import subprocess

import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL")
        or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
DB = "test_database"
RUN = "TEST_iter24ui_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=90)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint(name, role="member"):
    uid = RUN + uuid.uuid4().hex[:8]
    tok = "TEST_sess24ui_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:false,
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
    db.reports.deleteMany({{reporter_id:/^{RUN}/}});
    """)


def h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def main():
    cleanup()
    viewer = mint("TEST Viewer 24")
    other = mint("TEST Author 24")
    admin = mint("TEST Admin 24", role="admin")

    p = requests.post(f"{BASE}/posts", headers=h(other["token"]), json={
        "type": "crew_wanted", "title": "TEST_iter24 crew for Sunday sail",
        "body": "TEST_iter24 post body", "market": MARKET}).json()
    post_id = p["id"]
    own = requests.post(f"{BASE}/posts", headers=h(viewer["token"]), json={
        "type": "crew_wanted", "title": "TEST_iter24 my own post",
        "body": "TEST_iter24 own body", "market": MARKET}).json()

    # 3-level comment thread authored by `other`
    c1 = requests.post(f"{BASE}/posts/{post_id}/comments", headers=h(other["token"]),
                       json={"body": "TEST_iter24 level-1 comment"}).json()
    c2 = requests.post(f"{BASE}/posts/{post_id}/comments", headers=h(other["token"]),
                       json={"body": "TEST_iter24 level-2 reply", "parent_id": c1["id"]}).json()
    c3 = requests.post(f"{BASE}/posts/{post_id}/comments", headers=h(other["token"]),
                       json={"body": "TEST_iter24 level-3 reply", "parent_id": c2["id"]}).json()

    d = requests.post(f"{BASE}/discussions", headers=h(other["token"]), json={
        "kind": "forum", "title": "TEST_iter24 forum topic",
        "body": "TEST_iter24 discussion body", "market": MARKET}).json()

    # one open report so the admin queue is non-empty
    rep = requests.post(f"{BASE}/reports", headers=h(viewer["token"]), json={
        "target_type": "comment", "target_id": c1["id"], "reason": "TEST_iter24 seeded"}).json()

    print(json.dumps({
        "viewer": viewer, "other": other, "admin": admin,
        "post_id": post_id, "own_post_id": own.get("id"),
        "c1": c1["id"], "c2": c2["id"], "c3": c3["id"],
        "discussion_id": d.get("id"), "report_id": rep.get("report", {}).get("id"),
    }, indent=2))


if __name__ == "__main__":
    if os.environ.get("CLEANUP"):
        cleanup()
        print("cleaned")
    else:
        main()
