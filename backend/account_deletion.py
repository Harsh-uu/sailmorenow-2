"""ACCOUNT-DELETE-1 Stage B - Phase 1 building blocks.

Non-destructive helpers only:
  * overwrite_object_empty(path): neutralise a stored object (object storage has
    NO delete API, so we overwrite the bytes to empty).
  * dry_run_inventory(db, user_id): counts-only report of what a purge WOULD do
    per collection and per storage object. Writes nothing. Refuses to run
    against protected accounts.

This module intentionally does NOT purge anything yet. The destructive worker is
a later, separately-approved phase.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests

import storage as S
from deps import admin_emails

# Hard-coded backstop so a misconfigured env can never expose these.
PROTECTED_EMAILS = {"jenn@sailmorenow.com"}
DEMO_EMAIL_SUFFIX = "@sailmorenow.demo"


# --------------------------------------------------------------------------- #
# Storage: overwrite-to-empty (no delete API exists)
# --------------------------------------------------------------------------- #
def overwrite_object_empty(path: str) -> Dict[str, Any]:
    """Overwrite a stored object with zero bytes. Returns a status dict with the
    byte length read back afterwards (0 means the original bytes are gone)."""
    S.put_object(path, b"", "application/octet-stream")
    try:
        data, _ = S.get_object(path)
        remaining = len(data or b"")
    except requests.HTTPError as e:
        # 404 would mean the object is gone entirely (not expected - no delete API)
        remaining = -1 if "404" in str(e) else None
    return {"path": path, "overwritten": True, "bytes_after": remaining}


def extract_storage_path(url: Optional[str]) -> Optional[str]:
    """Return the object-storage path for one of OUR objects, else None.
    Our references look like '/api/files/{app}/...'; external URLs are not ours
    and cannot be overwritten."""
    if not url or not isinstance(url, str):
        return None
    marker = "/api/files/"
    idx = url.find(marker)
    cand = url[idx + len(marker):] if idx != -1 else url
    cand = cand.split("?")[0].lstrip("/")
    return cand if cand.startswith(S.APP_NAME + "/") else None


async def collect_member_object_paths(db, user_id: str) -> List[str]:
    """Gather candidate storage paths referenced by the member's rows. Only our
    objects (sailmorenow/...) are returned; external image URLs are skipped."""
    paths: List[str] = []

    def add(*urls):
        for u in urls:
            p = extract_storage_path(u)
            if p:
                paths.append(p)

    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "picture": 1})
    if u:
        add(u.get("picture"))
    async for bp in db.boat_pros.find({"user_id": user_id},
            {"_id": 0, "logo_url": 1, "logo_original_url": 1, "cover_url": 1, "photo_url": 1, "photos": 1}):
        add(bp.get("logo_url"), bp.get("logo_original_url"), bp.get("cover_url"), bp.get("photo_url"))
        for ph in (bp.get("photos") or []):
            add(ph if isinstance(ph, str) else (ph or {}).get("url"))
    async for p in db.posts.find({"author_id": user_id},
            {"_id": 0, "image_url": 1, "image_urls": 1}):
        add(p.get("image_url"), *(p.get("image_urls") or []))
    async for d in db.discussions.find({"author_id": user_id},
            {"_id": 0, "image_url": 1, "image_urls": 1}):
        add(d.get("image_url"), *(d.get("image_urls") or []))
    # de-dupe, keep order
    seen = set()
    out = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


# --------------------------------------------------------------------------- #
# Protected-account guard
# --------------------------------------------------------------------------- #
async def protected_reason(db, user: Dict[str, Any]) -> Optional[str]:
    """Return a human reason if this account must never be deleted, else None."""
    email = (user.get("email") or "").strip().lower()
    if email in {e.lower() for e in PROTECTED_EMAILS}:
        return "hard-coded protected email"
    if email in {e.lower() for e in admin_emails()}:
        return "listed in ADMIN_EMAILS"
    if user.get("platform_role") == "admin":
        admins = await db.users.count_documents({"platform_role": "admin"})
        return "platform admin" + (" (last remaining admin)" if admins <= 1 else "")
    if user.get("is_demo") or email.endswith(DEMO_EMAIL_SUFFIX):
        return "demo / app-store reviewer login"
    return None


# --------------------------------------------------------------------------- #
# Dry-run inventory (counts only - writes nothing)
# --------------------------------------------------------------------------- #
# action: "delete" (row removed), "scrub" (row kept, PII cleared),
#         "keep" (row kept for finance/safety/audit, opaque id only)
def _by_uid(f):
    return f
COLLECTION_PLAN = [
    # collection, action, build filter from (uid, email)
    ("users", "scrub", lambda uid, em: {"user_id": uid}),
    ("posts", "delete", lambda uid, em: {"author_id": uid}),
    ("comments", "delete", lambda uid, em: {"author_id": uid}),
    ("reactions", "delete", lambda uid, em: {"user_id": uid}),
    ("discussions", "scrub", lambda uid, em: {"author_id": uid}),
    ("reviews", "delete", lambda uid, em: {"$or": [{"author_id": uid}, {"target_id": uid}]}),
    ("mutual_reviews", "delete", lambda uid, em: {"$or": [{"author_id": uid}, {"target_id": uid}]}),
    ("review_sessions", "delete", lambda uid, em: {"$or": [{"author_id": uid}, {"participants": uid}]}),
    ("crew_bank", "delete", lambda uid, em: {"user_id": uid}),
    ("crew_bank_standalone", "delete", lambda uid, em: {"user_id": uid}),
    ("event_registrations", "delete", lambda uid, em: {"user_id": uid}),
    ("events", "scrub", lambda uid, em: {"organizer_id": uid}),
    ("events_deleted", "scrub", lambda uid, em: {"$or": [
        {"event.organizer_id": uid}, {"registrations.user_id": uid}, {"crew.user_id": uid}]}),
    ("follows", "delete", lambda uid, em: {"$or": [{"user_id": uid}, {"following_id": uid}, {"follower_id": uid}]}),
    ("follow_blocks", "delete", lambda uid, em: {"$or": [{"user_id": uid}, {"blocked_id": uid}]}),
    ("follow_dismissals", "delete", lambda uid, em: {"user_id": uid}),
    ("saved_items", "delete", lambda uid, em: {"user_id": uid}),
    ("saved_searches", "delete", lambda uid, em: {"user_id": uid}),
    ("listing_views", "delete", lambda uid, em: {"$or": [{"user_id": uid}, {"from_id": uid}]}),
    ("notifications", "delete", lambda uid, em: {"user_id": uid}),
    ("push_subscriptions", "delete", lambda uid, em: {"user_id": uid}),
    ("dm_messages", "delete", lambda uid, em: {"from_id": uid}),
    ("dm_threads", "scrub", lambda uid, em: {"participants": uid}),
    ("comp_grants", "delete", lambda uid, em: {"user_id": uid}),
    ("promo_attempts", "delete", lambda uid, em: {"user_id": uid}),
    ("signup_events", "delete", lambda uid, em: {"user_id": uid}),
    ("referrals", "delete", lambda uid, em: {"user_id": uid}),
    ("hires", "delete", lambda uid, em: {"$or": [{"user_id": uid}, {"pro_id": uid}]}),
    ("market_requests", "delete", lambda uid, em: {"user_id": uid}),
    ("identity_sessions", "delete", lambda uid, em: {"user_id": uid}),
    ("user_sessions", "delete", lambda uid, em: {"user_id": uid}),
    ("password_resets", "delete", lambda uid, em: {"user_id": uid}),
    ("boat_pros", "scrub", lambda uid, em: {"user_id": uid}),
    ("zoho_outbox", "delete", lambda uid, em: {"user_id": uid}),
    # email-keyed transient logs
    ("email_verifications", "delete", lambda uid, em: {"email": em} if em else None),
    ("verify_sends", "delete", lambda uid, em: {"email": em} if em else None),
    ("email_failures", "delete", lambda uid, em: {"email": em} if em else None),
    ("password_reset_requests", "delete", lambda uid, em: {"email": em} if em else None),
    ("login_attempts", "delete", lambda uid, em: {"email": em} if em else None),
    ("contact_messages", "delete", lambda uid, em: {"$or": [{"user_id": uid}] + ([{"email": em}] if em else [])}),
    # kept for finance / safety / audit (opaque id only)
    ("payment_transactions", "keep", lambda uid, em: {"user_id": uid}),
    ("reports", "keep", lambda uid, em: {"$or": [{"reporter_id": uid}, {"target_id": uid}]}),
    ("review_disputes", "keep", lambda uid, em: {"user_id": uid}),
    ("admin_actions", "keep", lambda uid, em: {"$or": [{"user_id": uid}, {"target_id": uid}]}),
]


async def dry_run_inventory(db, user_id: str) -> Dict[str, Any]:
    """Counts-only. Writes nothing. Refuses on protected accounts."""
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        return {"ok": False, "error": f"no user {user_id}"}
    reason = await protected_reason(db, user)
    if reason:
        return {"ok": False, "refused": True, "reason": reason,
                "message": f"Refusing: this is a protected account ({reason}). No inventory run."}

    email = (user.get("email") or "").strip().lower()
    rows = []
    totals = {"delete": 0, "scrub": 0, "keep": 0}
    for coll, action, filt_fn in COLLECTION_PLAN:
        flt = filt_fn(user_id, email)
        if flt is None:
            continue
        n = await db[coll].count_documents(flt)
        if n:
            rows.append({"collection": coll, "action": action, "count": n})
            totals[action] += n
    paths = await collect_member_object_paths(db, user_id)
    return {"ok": True, "user_id": user_id, "rows": rows, "totals": totals,
            "object_paths": paths, "object_count": len(paths)}


def render_table(report: Dict[str, Any]) -> str:
    if not report.get("ok"):
        return report.get("message") or report.get("error") or "n/a"
    lines = [f"{'COLLECTION':26s} {'ACTION':8s} {'COUNT':>6s}", "-" * 44]
    for r in sorted(report["rows"], key=lambda x: (x["action"], x["collection"])):
        lines.append(f"{r['collection']:26s} {r['action']:8s} {r['count']:>6d}")
    t = report["totals"]
    lines.append("-" * 44)
    lines.append(f"TOTALS  delete={t['delete']}  scrub(PII cleared)={t['scrub']}  keep={t['keep']}")
    lines.append(f"storage objects to overwrite-to-empty: {report['object_count']}")
    for p in report["object_paths"]:
        lines.append(f"  OBJECT  {p}")
    return "\n".join(lines)
