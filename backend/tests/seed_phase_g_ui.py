"""Seed users + content for Phase G frontend (UI) testing.

Creates:
  - admin user (platform_role=admin) w/ session token
  - regular user w/ primary_market + 2 fresh crew_bank_standalone rows + 1 fresh event
  - user with primary_market=null (for /digest 400 path)
  - user whose picture is a DEAD url + a feed post (Avatar onError fallback)
  - user whose picture is an EMOJI + a feed post

Prints JSON with tokens. Re-runnable: wipes TEST_userGUI_* first.
"""
import json
import subprocess
import uuid
from datetime import datetime, timezone, timedelta

DB = "test_database"
PREFIX = "TEST_userGUI_"
MARKET = "Greater Seattle"
GUI_MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('{DB}');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def wipe():
    mongo(f"""
    var ids = db.users.find({{user_id:{{$regex:'^{PREFIX}'}}}},{{user_id:1}}).toArray().map(u=>u.user_id);
    var pids = db.posts.find({{author_id:{{$in:ids}}}},{{id:1}}).toArray().map(p=>p.id);
    db.comments.deleteMany({{post_id:{{$in:pids}}}});
    db.posts.deleteMany({{author_id:{{$in:ids}}}});
    db.crew_bank_standalone.deleteMany({{user_id:{{$in:ids}}}});
    db.events.deleteMany({{id:{{$regex:'^{PREFIX}'}}}});
    db.user_sessions.deleteMany({{user_id:{{$in:ids}}}});
    db.users.deleteMany({{user_id:{{$in:ids}}}});
    """)


def mint(name, picture, market=MARKET, admin=False, newsletter=True, tier="premium"):
    uid = PREFIX + uuid.uuid4().hex[:10]
    tok = "TEST_sessGUI_" + uuid.uuid4().hex
    mkt = "null" if market is None else f"'{market}'"
    mkts = "[]" if market is None else f"['{market}']"
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'{picture}', account_type:'sailor', primary_market:{mkt}, markets:{mkts},
      onboarding_complete:true, policies_agreed:true, subscription_tier:'{tier}',
      newsletter_opt_in:{'true' if newsletter else 'false'},
      platform_role:'{'admin' if admin else 'member'}', created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def make_post(uid, name, avatar, title):
    pid = PREFIX + "post_" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    mongo(f"""db.posts.insertOne({{id:'{pid}', type:'sailing_opportunity',
      title:'{title}', body:'Phase G avatar containment check.',
      market:'{MARKET}', author_id:'{uid}', author_name:'{name}',
      author_avatar:'{avatar}', allow_comments:true, expired:false,
      created_at:'{now.isoformat()}',
      expires_at:'{(now + timedelta(days=20)).isoformat()}'}});""")
    return pid


def main():
    wipe()
    out = {}

    admin_id, admin_tok = mint("TEST_userGUI Admin", "https://via.placeholder.com/150",
                               admin=True)
    out["admin"] = {"user_id": admin_id, "token": admin_tok}

    user_id, user_tok = mint("TEST_userGUI Digest", "https://via.placeholder.com/150")
    out["digest_user"] = {"user_id": user_id, "token": user_tok}

    nm_id, nm_tok = mint("TEST_userGUI NoMarket", "https://via.placeholder.com/150",
                         market=None)
    out["no_market_user"] = {"user_id": nm_id, "token": nm_tok}

    dead_id, dead_tok = mint("TEST_userGUI DeadPic", "https://via.placeholder.com/999.png")
    out["dead_avatar_user"] = {"user_id": dead_id, "token": dead_tok}
    out["dead_avatar_post"] = make_post(dead_id, "TEST_userGUI DeadPic",
                                        "https://via.placeholder.com/999.png",
                                        "TEST_userGUI dead avatar post")

    emo_id, emo_tok = mint("TEST_userGUI Emoji", "🐙")
    out["emoji_avatar_user"] = {"user_id": emo_id, "token": emo_tok}
    out["emoji_avatar_post"] = make_post(emo_id, "TEST_userGUI Emoji", "🐙",
                                         "TEST_userGUI emoji avatar post")

    # crew rows for the digest user's market
    now = datetime.now(timezone.utc)
    crew_ids = []
    for i in range(2):
        cid = PREFIX + "cb_" + uuid.uuid4().hex[:8]
        mongo(f"""db.crew_bank_standalone.insertOne({{id:'{cid}',
          user_id:'{user_id if i == 0 else dead_id}',
          user_name:'TEST_userGUI Crew{i}', user_avatar:'⛵',
          markets:['{GUI_MARKET}'], positions:['Foredeck','Trim'], status:'seeking',
          expires_at:null, created_at:'{(now - timedelta(days=i + 1)).isoformat()}'}});""")
        crew_ids.append(user_id if i == 0 else dead_id)
    out["crew_user_ids"] = crew_ids

    eid = PREFIX + "ev_" + uuid.uuid4().hex[:8]
    mongo(f"""db.events.insertOne({{id:'{eid}', source:'community',
      title:'TEST_userGUI Digest Regatta', description:'Phase G seed event',
      market:'{GUI_MARKET}', starts_at:'{(now + timedelta(days=4)).isoformat()}',
      location:'Shilshole', approved:true, organizer_id:'{admin_id}',
      organizer_name:'TEST_userGUI Admin', organizer_email:'{admin_id}@sailmorenow.dev',
      created_at:'{now.isoformat()}'}});""")
    out["event_id"] = eid

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
