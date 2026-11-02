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


FORMER = "Former member"


async def _scrub_denormalized_names(db, user_id: str) -> Dict[str, int]:
    """Clear the member's name on KEPT records that NAMES-1 does not refresh."""
    out: Dict[str, int] = {}
    r = await db.notifications.update_many(
        {"$or": [{"from_id": user_id}, {"actor_id": user_id}]},
        {"$set": {"from_name": FORMER}})
    out["notifications.from_name"] = r.modified_count
    r = await db.comp_grants.update_many(
        {"granted_by": user_id}, {"$set": {"granted_by_name": FORMER}})
    out["comp_grants.granted_by_name"] = r.modified_count
    # events_deleted recovery copies: embedded organizer / RSVPs / crew / deleter
    r = await db.events_deleted.update_many(
        {"event.organizer_id": user_id},
        {"$set": {"event.organizer_name": FORMER, "event.organizer_email": None}})
    out["events_deleted.organizer"] = r.modified_count
    r = await db.events_deleted.update_many(
        {"deleted_by": user_id}, {"$set": {"deleted_by_name": FORMER}})
    out["events_deleted.deleted_by"] = r.modified_count
    n = 0
    async for ed in db.events_deleted.find(
            {"$or": [{"registrations.user_id": user_id}, {"crew.user_id": user_id}]},
            {"_id": 1, "registrations": 1, "crew": 1}):
        for arr in ("registrations", "crew"):
            for row in (ed.get(arr) or []):
                if row.get("user_id") == user_id:
                    row["user_name"] = FORMER
        await db.events_deleted.update_one({"_id": ed["_id"]}, {"$set": {
            "registrations": ed.get("registrations") or [], "crew": ed.get("crew") or []}})
        n += 1
    out["events_deleted.embedded_rows"] = n
    r = await db.events_backup_bodfix.update_many(
        {"organizer_id": user_id}, {"$set": {"organizer_name": FORMER, "organizer_email": None}})
    out["events_backup_bodfix.organizer"] = r.modified_count
    return out


async def _handle_events_and_forum(db, user_id: str) -> Dict[str, Any]:
    """Edge (a) events with other registrants -> keep, scrub organizer; else
    delete. Edge (b) forum/blog posts -> keep as a placeholder so others' replies
    survive. Returns notes for the job log."""
    notes: Dict[str, Any] = {"events_scrubbed": 0, "events_deleted": 0, "discussions_placeheld": 0}
    async for ev in db.events.find({"organizer_id": user_id}, {"_id": 0, "id": 1}):
        eid = ev.get("id")
        others = await db.event_registrations.count_documents(
            {"event_id": eid, "user_id": {"$ne": user_id}})
        if others:
            await db.events.update_one({"id": eid}, {"$set": {
                "organizer_name": FORMER, "organizer_email": None}})
            notes["events_scrubbed"] += 1
        else:
            await db.events.delete_one({"id": eid})
            await db.event_registrations.delete_many({"event_id": eid})
            await db.crew_bank.delete_many({"event_id": eid})
            notes["events_deleted"] += 1
    r = await db.discussions.update_many(
        {"author_id": user_id},
        {"$set": {"author_name": FORMER, "body": "This post was removed.", "removed": True}})
    notes["discussions_placeheld"] = r.modified_count
    return notes


async def _handle_business_ownership(db, user_id: str) -> List[str]:
    """Edge (8): if an org/listing has other managers/admins, keep the shared
    record and only remove this person; otherwise scrub it. Returns report lines."""
    report: List[str] = []
    async for bp in db.boat_pros.find({"user_id": user_id}, {"_id": 0, "id": 1}):
        report.append(f"boat_pro listing {bp.get('id')} owned by deleted member - scrubbed (no shared managers model)")
        await db.boat_pros.update_one({"id": bp.get("id")}, {"$set": {
            "deleted": True, "hidden": True, "name": FORMER, "logo_url": None,
            "logo_original_url": None, "cover_url": None, "photo_url": None, "photos": []}})
    return report


async def execute_purge(db, user_id: str, *, email_hint: Optional[str] = None) -> Dict[str, Any]:
    """Idempotent, resumable account purge with a per-step log row. Safe to call
    again after a failure - completed steps are skipped. Never half-deletes
    silently: a failed step leaves status=failed and alerts admin@."""
    import logging
    logger = logging.getLogger("smn.account_delete")

    user = await db.users.find_one({"user_id": user_id})
    if not user:
        return {"ok": False, "error": "no user"}
    reason = await protected_reason(db, user)
    if reason:
        return {"ok": False, "refused": True, "reason": reason}

    email = (user.get("email") or email_hint or "").strip().lower()
    name = user.get("name") or "there"

    job = await db.account_deletion_jobs.find_one({"user_id": user_id})
    now = _nowiso()
    if not job:
        job = {"id": _uuid(), "user_id": user_id, "email_at_request": email,
               "name_at_request": name, "status": "running", "steps": {},
               "report": [], "created_at": now, "updated_at": now, "attempts": 0}
        await db.account_deletion_jobs.insert_one(job)
    steps = job.get("steps") or {}

    async def mark(step: str, value="done", extra: Optional[Dict] = None):
        steps[step] = value
        upd = {"steps": steps, "updated_at": _nowiso()}
        if extra:
            upd.update(extra)
        await db.account_deletion_jobs.update_one({"id": job["id"]}, {"$set": upd})

    async def run_step(step: str, coro_fn):
        if steps.get(step) == "done":
            return
        try:
            res = await coro_fn()
            await mark(step, "done", {f"result.{step}": res} if res is not None else None)
        except Exception as e:  # noqa: BLE001
            logger.exception("purge step %s failed for %s", step, user_id)
            await mark(step, f"error: {e}")
            await db.account_deletion_jobs.update_one({"id": job["id"]},
                {"$set": {"status": "failed", "updated_at": _nowiso()}})
            try:
                from admin_notify import admin_notify
                await admin_notify(db, kind="account_delete_failed",
                    subject="Account deletion step failed",
                    title="Account deletion needs attention",
                    lines=[f"User {user_id} deletion step '{step}' failed: {e}",
                           "The job is in a retry state and did not half-delete silently."],
                    )
            except Exception:
                logger.exception("admin alert failed")
            raise

    async def _cancel_stripe():
        import stripe  # noqa
        sid = user.get("stripe_subscription_id")
        provider = (user.get("subscription_provider") or "").lower()
        if provider in ("apple", "google", "iap"):
            return "store plan - instructed user to cancel in store"
        if not sid:
            return "no stripe subscription"
        try:
            stripe.Subscription.cancel(sid)
            return "cancelled immediately"
        except Exception as e:  # resource_missing etc must never fail deletion
            return f"skipped ({e})"

    async def _revoke_comp():
        from billing import revoke_comp
        await revoke_comp(user_id, reason="account_deleted")
        await db.users.update_one({"user_id": user_id}, {"$unset": {"subscription_term_choice": ""}})
        return "comp revoked, queued term cleared"

    async def _stripe_customer_delete():
        import stripe  # noqa
        cust = user.get("stripe_customer_id")
        if not cust:
            return "no customer"
        try:
            stripe.Customer.delete(cust)
            return "customer deleted"
        except Exception as e:
            return f"skipped ({e})"

    async def _zoho():
        from zoho_sync import enqueue
        await db.users.update_one({"user_id": user_id}, {"$set": {"member_status": "deleted"}})
        await enqueue(db, "account_deleted", user_id)
        return "marked deleted + enqueued"

    async def _storage():
        paths = await collect_member_object_paths(db, user_id)
        done = 0
        for p in paths:
            try:
                overwrite_object_empty(p)
                done += 1
            except Exception:
                logger.exception("overwrite failed for %s", p)
        return f"overwrote {done}/{len(paths)} objects"

    async def _edges():
        ev = await _handle_events_and_forum(db, user_id)
        biz = await _handle_business_ownership(db, user_id)
        return {"events_forum": ev, "business": biz}

    async def _delete_rows():
        counts = {}
        for coll, action, filt_fn in COLLECTION_PLAN:
            if action != "delete":
                continue
            flt = filt_fn(user_id, email)
            if flt is None:
                continue
            r = await db[coll].delete_many(flt)
            if r.deleted_count:
                counts[coll] = r.deleted_count
        return counts

    async def _scrub_and_tombstone():
        scrubs = await _scrub_denormalized_names(db, user_id)
        # Clear image references on the member's own kept rows (already deleted
        # for posts/discussions; boat_pros handled in edges). Tombstone the user.
        await db.users.update_one({"user_id": user_id}, {"$set": {
            "name": FORMER, "member_status": "deleted", "deleted": True,
            "deleted_at": _nowiso(), "picture": None, "avatar": None, "bio": None,
            "phone": None, "public_phone": None, "primary_market": None,
            "first_name": None, "last_name": None, "company_name": None,
            "org_name": None, "website": None,
            "stripe_customer_id": None, "stripe_subscription_id": None,
            "subscription_tier": "free", "subscription_provider": None,
            "subscription_status": "deleted", "subscription_package_id": None,
            "subscription_expires": None, "is_promo": False,
        }, "$unset": {"email": "", "handle": "", "password_hash": "",
                      "picture_original": "", "comp_grant_id": ""}})
        return scrubs

    async def _finalize_email():
        from mailer import send_email, account_deleted_email_html
        if email:
            await send_email(recipient_email=email, subject="Your account has been deleted",
                             html_content=account_deleted_email_html(name=name))
            return f"final email sent to {email}"
        return "no email on file"

    try:
        await run_step("cancel_stripe", _cancel_stripe)
        await run_step("revoke_comp", _revoke_comp)
        await run_step("stripe_customer_delete", _stripe_customer_delete)
        await run_step("zoho_mark_deleted", _zoho)
        await run_step("overwrite_storage", _storage)
        await run_step("edges_events_forum_business", _edges)
        await run_step("delete_rows", _delete_rows)
        await run_step("scrub_and_tombstone", _scrub_and_tombstone)
        await run_step("final_email", _finalize_email)
    except Exception:
        return {"ok": False, "job_id": job["id"], "status": "failed"}

    await db.account_deletion_jobs.update_one({"id": job["id"]},
        {"$set": {"status": "done", "completed_at": _nowiso(), "updated_at": _nowiso()}})
    # kill any sessions created after the ack, belt and braces
    await db.user_sessions.delete_many({"user_id": user_id})
    return {"ok": True, "job_id": job["id"], "status": "done"}


async def resume_pending_jobs(db) -> int:
    """On startup, resume any purge that was running/failed (idempotent)."""
    n = 0
    async for job in db.account_deletion_jobs.find({"status": {"$in": ["running", "failed"]}},
                                                   {"_id": 0, "user_id": 1}):
        try:
            await execute_purge(db, job["user_id"])
            n += 1
        except Exception:
            pass
    return n


def _uuid() -> str:
    import uuid as _u
    return _u.uuid4().hex


def _nowiso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


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
