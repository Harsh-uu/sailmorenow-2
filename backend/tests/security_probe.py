"""Live authz probe: anonymous / member / other member / admin against the real API. Prints red cells."""
import os, sys, uuid, asyncio, json
import requests
from datetime import datetime, timezone, timedelta
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

ENV = dotenv_values("/app/backend/.env")
BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
TOK = {"jane": "probe_jane", "alex": "probe_alex", "admin": "probe_admin"}


async def mint():
    db = AsyncIOMotorClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]
    exp = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    ids = {}
    for who, email in [("jane", "captain.jane@sailmorenow.dev"), ("alex", "crew.alex@sailmorenow.dev"), ("admin", "jenn@sailmorenow.com")]:
        u = await db.users.find_one({"email": email}, {"user_id": 1})
        if not u:
            uid = "probe_" + uuid.uuid4().hex[:6]
            await db.users.insert_one({"user_id": uid, "email": email, "name": who, "account_type": "sailor", "onboarding_complete": True, "created_at": exp})
            u = {"user_id": uid}
        ids[who] = u["user_id"]
        await db.user_sessions.update_one({"session_token": TOK[who]}, {"$set": {"session_token": TOK[who], "user_id": u["user_id"], "expires_at": exp}}, upsert=True)
    return ids

IDS = asyncio.run(mint())
S = {who: requests.Session() for who in TOK}
for who, s in S.items():
    s.headers["Authorization"] = f"Bearer {TOK[who]}"
S["anon"] = requests.Session()
red = []


def check(label, resp, allowed):
    ok = resp.status_code in allowed
    print(("  OK " if ok else "  RED"), f"{resp.status_code:3}", label)
    if not ok:
        red.append((label, resp.status_code, resp.text[:160]))
    return resp

# --- setup fixtures as jane
ev = check("jane creates event", S["jane"].post(f"{BASE}/events", json={"title": "Probe race", "description": "x", "market": "Greater Seattle", "starts_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(), "is_race": True, "lat": 47.68, "lng": -122.4}), {200}).json()
eid = ev["id"]
print("   lat stored:", ev.get("lat"), "organizer stamped:", ev.get("organizer_id") == IDS["jane"])
check("event rejects bad lat", S["jane"].post(f"{BASE}/events", json={"title": "Bad", "description": "x", "market": "Greater Seattle", "starts_at": "2027-01-01", "lat": 999}), {400, 422})
check("mass-assign organizer_id ignored", S["jane"].post(f"{BASE}/events", json={"title": "MA", "description": "x", "market": "Greater Seattle", "starts_at": "2027-02-01", "organizer_id": "hacker", "approved": False}), {200})
r = S["jane"].get(f"{BASE}/events").json()
ma = next((e for e in r if e["title"] == "MA"), None)
print("   MA organizer_id:", ma and ma.get("organizer_id") == IDS["jane"], "approved:", ma and ma.get("approved"))

check("alex joins crew", S["alex"].post(f"{BASE}/events/{eid}/crew", json={"positions": ["Trim"], "notes": "hi"}), {200, 400, 402, 403})
check("alex RSVP", S["alex"].post(f"{BASE}/events/{eid}/register", json={"kind": "attendee"}), {200, 400})

print("\n# Admin surface")
for path in ["/admin/events", "/admin/analytics", "/admin/contact", "/admin/reports", "/admin/scheduler/status", "/admin/analytics/hero", "/admin/digest/render?market=Tacoma", "/admin/events/sources", "/admin/zoho/status"]:
    check(f"anon GET {path}", S["anon"].get(f"{BASE}{path}"), {401, 403})
    check(f"member GET {path}", S["alex"].get(f"{BASE}{path}"), {403})
    check(f"admin GET {path}", S["admin"].get(f"{BASE}{path}"), {200})
for path in ["/admin/digest/send-now", "/admin/events/review-alert", "/admin/events/send-reminders", f"/admin/events/{eid}/recipients-bulk"]:
    check(f"member POST {path}", S["alex"].post(f"{BASE}{path}", json={"csv": "a@b.co"}), {403})
check("member PATCH category", S["alex"].patch(f"{BASE}/admin/events/{eid}/category", json={"category": "racing"}), {403})
check("member PATCH recipients", S["alex"].patch(f"{BASE}/admin/events/{eid}/email-recipients", json={"email_recipients": ["x@y.z"]}), {403})
check("member DELETE aggregate", S["alex"].delete(f"{BASE}/admin/events/aggregate"), {403})
check("member approve discussion", S["alex"].post(f"{BASE}/discussions/nope/approve"), {403, 404})
check("member GET pending discussions", S["alex"].get(f"{BASE}/discussions?status=pending"), {403})
check("member PATCH report", S["alex"].patch(f"{BASE}/admin/reports/x", json={"status": "resolved"}), {403})

print("\n# Object-level / IDOR")
regs = check("alex views registrations (not organizer)", S["alex"].get(f"{BASE}/events/{eid}/registrations"), {200, 403})
if regs.status_code == 200:
    body = regs.json(); print("   registrations payload keys:", list(body.keys()), "others exposed:", bool(body.get("registrations")))
crew = check("anon views crew list", S["anon"].get(f"{BASE}/events/{eid}/crew"), {200, 401})
if crew.status_code == 200:
    leak = [e for e in crew.json().get("entries", []) if e.get("user_email")]
    print("   anon sees crew emails:", bool(leak))
crew_j = S["jane"].get(f"{BASE}/events/{eid}/crew").json().get("entries", [])
print("   organizer sees crew emails:", any(e.get("user_email") for e in crew_j))
check("jane (not alex) changes alex's crew status", S["jane"].patch(f"{BASE}/events/{eid}/crew/status", json={"status": "found"}), {200, 403, 404})
check("jane unregisters alex? (only self)", S["jane"].delete(f"{BASE}/events/{eid}/register"), {200, 404})
still = S["admin"].get(f"{BASE}/events/{eid}/registrations").json()
print("   alex still registered after jane delete:", any(r.get("user_id") == IDS["alex"] for r in still.get("registrations", [])))
check("alex reads jane/alex DM thread w/o participation", S["jane"].get(f"{BASE}/messages/{IDS['alex']}-{IDS['admin']}"), {403, 404})
check("alex marks jane's notification read (scoped)", S["alex"].patch(f"{BASE}/notifications/anything/read"), {200})
check("alex review-session of others", S["alex"].get(f"{BASE}/review-sessions/nonexistent"), {403, 404})
check("anon boat-pros/mine", S["anon"].get(f"{BASE}/boat-pros/mine"), {401, 404})
check("anon PATCH photos", S["anon"].patch(f"{BASE}/boat-pros/photos", json={"photos": []}), {401})
check("anon push/test", S["anon"].post(f"{BASE}/push/test"), {401})
check("anon create discussion", S["anon"].post(f"{BASE}/discussions", json={"kind": "forum", "title": "x", "body": "y"}), {401})
check("member deletes others' discussion", S["alex"].delete(f"{BASE}/discussions/nope"), {403, 404})
check("member deletes comment", S["alex"].delete(f"{BASE}/comments/nope"), {403, 404})

print("\n# Privilege escalation via body")
check("account-type -> partner blocked", S["alex"].patch(f"{BASE}/auth/account-type", json={"account_type": "partner"}), {400})
r = S["alex"].patch(f"{BASE}/auth/onboarding", json={"account_type": "sailor", "primary_market": "Tacoma", "markets": [], "reasons": [], "avatar": "x", "username": "alexp", "bio": "", "newsletter_opt_in": False, "policies_agreed": True, "platform_role": "admin", "subscription_tier": "premium"})
me = S["alex"].get(f"{BASE}/auth/me").json()
print("   onboarding mass-assign platform_role:", (me.get("user") or me).get("platform_role"), "| alex admin?", S["alex"].get(f"{BASE}/admin/events").status_code)
pro = S["alex"].post(f"{BASE}/boat-pros", json={"company_name": "Probe Co", "category": "Rigging", "market": "Tacoma", "description": "d", "tier": "featured", "verified": True, "rating": 5})
if pro.status_code == 200:
    d = pro.json(); print("   boat-pro tier from body ignored:", d.get("tier"), "verified:", d.get("verified"), "rating:", d.get("rating"))

print("\n# Public data exposure")
u = S["anon"].get(f"{BASE}/u/alexp")
if u.status_code == 200:
    print("   /u/handle fields:", sorted(u.json().keys()))
bp = S["anon"].get(f"{BASE}/boat-pros?market=Tacoma").json()
if bp:
    print("   /boat-pros fields:", sorted(bp[0].keys()))
ev_pub = S["anon"].get(f"{BASE}/events").json()
print("   /events organizer_email exposed:", any(e.get("organizer_email") for e in ev_pub), "email_recipients exposed:", any(e.get("email_recipients") for e in ev_pub))
us = S["anon"].get(f"{BASE}/users/search?q=al"); check("anon users/search blocked", us, {401})
check("member users/search ok", S["alex"].get(f"{BASE}/users/search?q=al"), {200})
posts = S["anon"].get(f"{BASE}/posts").json()
print("   /posts author_email exposed:", any(p.get("author_email") for p in posts) if isinstance(posts, list) else posts)
sd = check("anon seed (no-op when populated)", S["anon"].post(f"{BASE}/seed"), {200})
print("   seed no-op:", sd.json().get("seeded") is False)
check("anon hero analytics (public sink)", S["anon"].post(f"{BASE}/analytics/hero", json={"event": "shown", "clip": "x", "session_id": "y"}), {200, 204})

# cleanup
async def _cleanup():
    await AsyncIOMotorClient(ENV["MONGO_URL"])[ENV["DB_NAME"]].events.delete_many({"title": {"$in": ["Probe race", "MA"]}})
asyncio.run(_cleanup())
print("\nRED CELLS:", json.dumps(red, indent=1) if red else "none")
