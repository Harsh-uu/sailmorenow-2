"""Mint two UI test users + posts + an event for iteration 11 UI testing."""
import json
import subprocess
import uuid

import requests

BASE = "https://owsa-events-preview--7evdsk8f.preview.emergentagent.com/api"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
S = requests.Session()
S.headers.update({"Content-Type": "application/json", "User-Agent": UA})
MARKET = "Greater Seattle"


def mongo(js):
    r = subprocess.run(["mongosh", "--quiet", "--eval", f"use('test_database');{js}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def mint(name, account_type="sailor", tier="premium"):
    uid = "TEST_uiE_" + uuid.uuid4().hex[:8]
    tok = "TEST_sess_" + uuid.uuid4().hex
    mongo(f"""
    db.users.insertOne({{user_id:'{uid}', email:'{uid}@sailmorenow.dev', name:'{name}',
      picture:'', avatar:'⛵', account_type:'{account_type}', primary_market:'{MARKET}',
      markets:['{MARKET}'], onboarding_complete:true, subscription_tier:'{tier}',
      created_at:new Date()}});
    db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}',
      expires_at:new Date(Date.now()+7*24*3600*1000), created_at:new Date()}});
    """)
    return uid, tok


def post(tok, title, allow=True):
    r = S.post(f"{BASE}/posts", json={"type": "sailing_opportunity", "title": title,
                                      "body": "TEST_uiE body", "market": MARKET,
                                      "allow_comments": allow},
               headers={"Authorization": f"Bearer {tok}"})
    r.raise_for_status()
    return r.json()


a_uid, a_tok = mint("TEST_uiE Alpha")
b_uid, b_tok = mint("TEST_uiE Bravo")
p_open = post(a_tok, "TEST_uiE open comments", True)
p_closed = post(a_tok, "TEST_uiE closed comments", False)

# One event for the crew bank modal
ev_id = "TEST_uiE_evt_" + uuid.uuid4().hex[:8]
mongo(f"""
db.events.insertOne({{id:'{ev_id}', title:'TEST_uiE Regatta', market:'{MARKET}',
  description:'TEST_uiE event', source:'manual', category:'regatta',
  starts_at:new Date(Date.now()+7*24*3600*1000).toISOString(),
  ends_at:new Date(Date.now()+8*24*3600*1000).toISOString(),
  location:'Shilshole', url:'https://example.com', created_at:new Date()}});
""")

print(json.dumps({"a_uid": a_uid, "a_tok": a_tok, "b_uid": b_uid, "b_tok": b_tok,
                  "post_open": p_open["id"], "post_closed": p_closed["id"],
                  "event_id": ev_id}, indent=2))
