"""Seed UI test fixtures for iteration 21: two users (one admin), a post, an event."""
import json
import subprocess
import uuid

DB = "test_database"
PREFIX = "TEST_ui21_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint(is_admin=False):
    uid = PREFIX + uuid.uuid4().hex[:8]
    tok = "TEST_uisess21_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST UI21 {'Admin' if is_admin else 'User'}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:false,
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def main():
    uid, tok = mint()
    admin_uid, admin_tok = mint(is_admin=True)
    post_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    mongo(f"""
    db.posts.insertOne({{id:'{post_id}', type:'discussion', title:'TEST_ui21 live comment post',
      body:'watching the live comment counter', market:'{MARKET}', author_id:'{uid}',
      author_name:'TEST UI21 User', allow_comments:true, comment_count:0,
      created_at:new Date().toISOString(), expires_at:new Date(Date.now()+30*24*3600*1000).toISOString(),
      status:'active'}});
    db.events.insertOne({{id:'{event_id}', title:'TEST_ui21 event', description:'seed',
      market:'{MARKET}', starts_at:new Date(Date.now()+10*24*3600*1000).toISOString(),
      location:'Shilshole', email_recipients:[], created_at:new Date().toISOString(),
      created_by:'{admin_uid}', source:'community'}});
    """)
    print(json.dumps({"user_id": uid, "token": tok, "admin_id": admin_uid,
                      "admin_token": admin_tok, "post_id": post_id, "event_id": event_id}))


if __name__ == "__main__":
    main()
