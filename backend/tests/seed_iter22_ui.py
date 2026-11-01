"""Seed UI fixtures for iteration 22: viewer user (admin), commenter user, 2 posts, 1 event."""
import json
import subprocess
import uuid

DB = "test_database"
PREFIX = "TEST_ui22_"
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint(is_admin=False):
    uid = PREFIX + uuid.uuid4().hex[:8]
    tok = "TEST_uisess22_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'TEST UI22 {'Admin' if is_admin else 'User'}',
      picture:'https://via.placeholder.com/150', account_type:'sailor',
      primary_market:'{MARKET}', markets:['{MARKET}'], onboarding_complete:true,
      subscription_tier:'premium', newsletter_opt_in:false,
      platform_role:'{'admin' if is_admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def main():
    viewer, viewer_tok = mint(is_admin=True)
    commenter, commenter_tok = mint()
    p1, p2 = str(uuid.uuid4()), str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    mongo(f"""
    db.posts.insertOne({{id:'{p1}', type:'discussion', title:'TEST_ui22 post ONE',
      body:'live counter card one', market:'{MARKET}', author_id:'{viewer}',
      author_name:'TEST UI22 Admin', allow_comments:true, comment_count:0,
      created_at:new Date().toISOString(), expires_at:new Date(Date.now()+30*24*3600*1000).toISOString(),
      status:'active'}});
    db.posts.insertOne({{id:'{p2}', type:'discussion', title:'TEST_ui22 post TWO',
      body:'live counter card two', market:'{MARKET}', author_id:'{viewer}',
      author_name:'TEST UI22 Admin', allow_comments:true, comment_count:0,
      created_at:new Date(Date.now()-1000).toISOString(), expires_at:new Date(Date.now()+30*24*3600*1000).toISOString(),
      status:'active'}});
    db.events.insertOne({{id:'{event_id}', title:'TEST_ui22 event', description:'seed',
      market:'{MARKET}', starts_at:new Date(Date.now()+10*24*3600*1000).toISOString(),
      location:'Shilshole', email_recipients:[], created_at:new Date().toISOString(),
      created_by:'{viewer}', source:'community'}});
    """)
    print(json.dumps({"viewer": viewer, "viewer_token": viewer_tok,
                      "commenter": commenter, "commenter_token": commenter_tok,
                      "post1": p1, "post2": p2, "event_id": event_id}))


if __name__ == "__main__":
    main()
