"""Background scheduler - weekly Sunday aggregator refresh (Sundays 03:00 PT)."""
from __future__ import annotations
import logging
from datetime import datetime, timezone, timedelta

from typing import Optional, Dict, Any, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

_PT = ZoneInfo("America/Los_Angeles")

from aggregator import run_aggregator, past_event_predicate

logger = logging.getLogger("smn.scheduler")

_scheduler: AsyncIOScheduler | None = None


async def _weekly_job(db):
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        purged = await db.events.delete_many(past_event_predicate(now_iso))
        result = await run_aggregator(db, trigger="scheduled")
        logger.info("[scheduler] daily sync: purged=%s, %s", purged.deleted_count, result)
        await notify_admins_category_review(db)
    except Exception:
        logger.exception("[scheduler] daily sync failed")


async def notify_admins_category_review(db) -> Dict[str, Any]:
    """Email admins about events flagged for category review that haven't been reported yet."""
    from deps import admin_emails  # noqa: F401 (kept for compatibility)
    from mailer import send_email, category_review_email_html
    from admin_notify import admin_notify_email
    flagged = await db.events.find(
        {"category_needs_review": True, "review_alert_sent_at": {"$in": [None, False]}},
        {"_id": 0, "id": 1, "title": 1, "market": 1, "starts_at": 1, "source_label": 1, "category": 1},
    ).sort("starts_at", 1).to_list(200)
    recipients = [admin_notify_email()]
    if not flagged or not recipients:
        return {"flagged": len(flagged), "sent": 0}
    html = category_review_email_html(flagged)
    sent = 0
    for email in recipients:
        res = await send_email(email, f"{len(flagged)} event{'s' if len(flagged) != 1 else ''} need a category: Sail More Now", html)
        if res.get("status") == "ok":
            sent += 1
    if sent:
        await db.events.update_many({"id": {"$in": [e["id"] for e in flagged]}},
                                    {"$set": {"review_alert_sent_at": datetime.now(timezone.utc).isoformat()}})
    logger.info("[scheduler] category review alert: flagged=%s sent=%s", len(flagged), sent)
    return {"flagged": len(flagged), "sent": sent}


async def _event_reminder_job(db):
    """Hourly: at each sailor's chosen reminder_hour (PT, default 7) send 'morning of'
    reminders for today's events and 'day before' for tomorrow's, per reminder_timing."""
    from notifications import notify
    from date_utils import normalize_iso, event_no_time
    now = datetime.now(_PT)
    current_hour = now.hour
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    sent = total_events = 0
    for offset, slot in ((0, "morning_of"), (1, "day_before")):
        start = day_start + timedelta(days=offset)
        end = start + timedelta(days=1)
        lo, hi = start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()
        day_key = start.strftime("%Y-%m-%d")
        events = await db.events.find({"$or": [
            {"starts_at": {"$gte": lo, "$lt": hi}},
            {"starts_at": f"{day_key}T00:00:00+00:00"},
        ]}, {"_id": 0}).to_list(200)
        total_events += len(events)
        for ev in events:
            regs = await db.event_registrations.find({"event_id": ev["id"]}, {"_id": 0, "user_id": 1}).to_list(500)
            crew = await db.crew_bank.find({"event_id": ev["id"]}, {"_id": 0, "user_id": 1}).to_list(500)
            user_ids = {r["user_id"] for r in regs + crew if r.get("user_id")}
            if not user_ids:
                continue
            users = await db.users.find({"user_id": {"$in": list(user_ids)}}, {"_id": 0, "user_id": 1, "reminder_timing": 1, "reminder_hour": 1}).to_list(500)
            when = "Time not listed" if event_no_time(ev) else \
                datetime.fromisoformat(normalize_iso(ev["starts_at"])).astimezone(_PT).strftime("%-I:%M %p") + " PT"
            where = ev.get("location") or ev.get("market") or ""
            for usr in users:
                timing = usr.get("reminder_timing") or "morning_of"
                if timing != "both" and timing != slot:
                    continue
                if (usr.get("reminder_hour") if usr.get("reminder_hour") is not None else 7) != current_hour:
                    continue
                uid = usr["user_id"]
                if await db.notifications.find_one({"user_id": uid, "kind": "event_reminder", "meta.event_id": ev["id"], "meta.slot": slot}):
                    continue
                title = f"Today: {ev['title']}" if slot == "morning_of" else f"Tomorrow: {ev['title']}"
                await notify(user_id=uid, kind="event_reminder", title=title,
                             body=f"{when}{' · ' + where if where else ''}. Fair winds!",
                             link=f"/events?event={ev['id']}", meta={"event_id": ev["id"], "slot": slot})
                sent += 1
    logger.info("[scheduler] event reminders: events=%s sent=%s", total_events, sent)
    return {"events": total_events, "sent": sent}


async def _volunteer_reminder_job(db):
    """Daily: message everyone who RSVP'd as a VOLUNTEER ahead of their event.
    Each event's `volunteer_reminder_lead_days` (default 1, max 7) decides how
    many days before it fires. In-app notification + email, deduped per
    volunteer/event via a 'volunteer_reminder' notification record."""
    from notifications import notify
    from date_utils import normalize_iso, event_no_time
    from mailer import send_email
    now = datetime.now(_PT)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    lo = (day_start + timedelta(days=1)).astimezone(timezone.utc).isoformat()
    hi = (day_start + timedelta(days=9)).astimezone(timezone.utc).isoformat()
    events = await db.events.find({"starts_at": {"$gte": lo, "$lt": hi}}, {"_id": 0}).to_list(500)
    sent = 0
    for ev in events:
        raw = ev.get("starts_at") or ""
        all_day = event_no_time(ev)
        try:
            ev_date = (datetime.fromisoformat(raw).date() if all_day
                       else datetime.fromisoformat(normalize_iso(raw)).astimezone(_PT).date())
        except Exception:
            continue
        days_until = (ev_date - day_start.date()).days
        lead = max(1, min(int(ev.get("volunteer_reminder_lead_days") or 1), 7))
        if days_until != lead:
            continue
        regs = await db.event_registrations.find(
            {"event_id": ev["id"], "kind": "volunteer"}, {"_id": 0, "user_id": 1}).to_list(500)
        uids = [r["user_id"] for r in regs if r.get("user_id")]
        if not uids:
            continue
        when = "time not listed" if all_day else datetime.fromisoformat(normalize_iso(raw)).astimezone(_PT).strftime("%-I:%M %p") + " PT"
        where = ev.get("location") or ev.get("market") or ""
        lead_phrase = "tomorrow" if lead == 1 else f"in {lead} days"
        users = await db.users.find({"user_id": {"$in": uids}},
                                    {"_id": 0, "user_id": 1, "email": 1}).to_list(500)
        emap = {usr["user_id"]: usr.get("email") for usr in users}
        for uid in uids:
            if await db.notifications.find_one({"user_id": uid, "kind": "volunteer_reminder",
                                                "meta.event_id": ev["id"]}):
                continue
            body = f"You signed up to volunteer {lead_phrase} for '{ev['title']}' - {when}{' · ' + where if where else ''}. Thank you!"
            await notify(user_id=uid, kind="volunteer_reminder",
                         title=f"Volunteer reminder: {ev['title']}", body=body,
                         link=f"/events?event={ev['id']}", meta={"event_id": ev["id"]})
            email = emap.get(uid)
            if email:
                try:
                    html = (f"<p>Hi!</p><p>Just a reminder that you signed up to <b>volunteer</b> for "
                            f"<b>{ev['title']}</b> {lead_phrase} - {when}{(' at ' + where) if where else ''}.</p>"
                            f"<p>We can't wait to see you there. Fair winds!</p>")
                    await send_email(recipient_email=email, subject=f"Volunteer reminder: {ev['title']}", html_content=html)
                except Exception:
                    logger.exception("volunteer reminder email failed for %s", uid)
            sent += 1
    logger.info("[scheduler] volunteer reminders: events=%s sent=%s", len(events), sent)
    return {"events": len(events), "sent": sent}


async def _review_nudge_job(db):
    """Daily: a few days after a member marks a pro as Hired, gently nudge them
    to leave a review — unless they already did. Deduped per hire."""
    from notifications import notify
    now = datetime.now(timezone.utc)
    lo = (now - timedelta(days=5)).isoformat()
    hi = (now - timedelta(days=3)).isoformat()
    hires = await db.hires.find({"created_at": {"$gte": lo, "$lt": hi}}, {"_id": 0}).to_list(1000)
    sent = 0
    for h in hires:
        uid, pro_id = h.get("user_id"), h.get("pro_id")
        if not uid or not pro_id:
            continue
        if await db.reviews.find_one({"author_id": uid, "target_id": pro_id}, {"_id": 1}):
            continue
        if await db.mutual_reviews.find_one({"author_id": uid, "target_id": pro_id}, {"_id": 1}):
            continue
        if await db.notifications.find_one({"user_id": uid, "kind": "review_nudge", "meta.pro_id": pro_id}):
            continue
        # Respect the member's review-reminder preference: fully off, or snoozed.
        usr = await db.users.find_one(
            {"user_id": uid}, {"_id": 0, "push_preferences": 1, "review_nudge_snooze_until": 1,
                               "subscription_tier": 1, "subscription_expires": 1})
        # The review nudge goes to PAID users only (free can mark Hired but can't review).
        from deps import can_review
        if not can_review(usr):
            continue
        prefs = (usr or {}).get("push_preferences") or {}
        if prefs.get("review_nudge") is False:
            continue
        snooze = (usr or {}).get("review_nudge_snooze_until")
        if snooze and snooze > now.isoformat():
            continue
        pro = await db.boat_pros.find_one({"user_id": pro_id}, {"_id": 0, "company_name": 1})
        name = (pro or {}).get("company_name") or "the pro you hired"
        await notify(user_id=uid, kind="review_nudge",
                     title="How did it go?",
                     body=f"You recently hired {name}. Mind leaving a quick review to help other sailors?",
                     link=f"/directory/{pro_id}", meta={"pro_id": pro_id})
        sent += 1
    logger.info("[scheduler] review nudges: hires=%s sent=%s", len(hires), sent)
    return {"hires": len(hires), "sent": sent}



async def _nightly_job(db):
    """Post expiration reminders + subscription-expiring reminders + review auto-reveal."""
    from datetime import timedelta as _td
    from notifications import notify
    now = datetime.now(timezone.utc)
    two_days = (now + _td(days=2)).isoformat()
    seven_days = (now + _td(days=7)).isoformat()
    try:
        # 1) Notify authors whose posts expire in ~2 days (once)
        cursor = db.posts.find({
            "expired": {"$ne": True},
            "extension_prompted_at": {"$in": [None, False]},
            "expires_at": {"$lte": two_days, "$gt": now.isoformat()},
        }, {"_id": 0, "id": 1, "author_id": 1, "title": 1, "expires_at": 1})
        prompted = 0
        async for p in cursor:
            if p.get("author_id"):
                await notify(user_id=p["author_id"], kind="post_expiring",
                             title=f"'{p.get('title')}' expires in 2 days",
                             body="Tap to extend or let it expire.",
                             link="/feed", meta={"post_id": p["id"]})
                await db.posts.update_one({"id": p["id"]},
                                          {"$set": {"extension_prompted_at": now.isoformat()}})
                prompted += 1
        # 2) Mark past-due posts as expired
        expired = await db.posts.update_many(
            {"expired": {"$ne": True}, "expires_at": {"$lte": now.isoformat()}},
            {"$set": {"expired": True}}
        )
        # 2a) Purge For Sale listings sold more than 30 days ago (kept visible to
        # the seller for repost during that window, then deleted for good).
        sold_cutoff = (now - _td(days=30)).isoformat()
        sold_purged = await db.posts.delete_many(
            {"type": "for_sale", "sold": True, "sold_at": {"$lte": sold_cutoff}}
        )
        # 2b) Win-back email for members whose paid sub just lapsed (once per lapse).
        from mailer import winback_email_html
        winback = 0
        async for lu in db.users.find(
            {"subscription_tier": {"$ne": "free"},
             "subscription_expires": {"$ne": None, "$lt": now.isoformat()},
             "banned": {"$ne": True},
             "$or": [{"queued_plans": {"$exists": False}}, {"queued_plans": {"$size": 0}}]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1,
             "subscription_expires": 1, "winback_sent_for": 1}):
            exp = lu.get("subscription_expires")
            if lu.get("email") and lu.get("winback_sent_for") != exp:
                try:
                    from mailer import send_email, app_public_url
                    await send_email(recipient_email=lu["email"],
                                     subject="Your Sail More Now membership lapsed. Come back?",
                                     html_content=winback_email_html(name=lu.get("name") or "",
                                                                     app_url=app_public_url()))
                except Exception:
                    logger.exception("[scheduler] winback email failed")
                await db.users.update_one({"user_id": lu["user_id"]},
                                          {"$set": {"winback_sent_for": exp}})
                winback += 1
        # 2c) Lapsed paid subscriptions: PROMOTE a queued plan (RULE 1) or drop
        # to free. Skip banned users (their queue is held until unban). Each
        # promote/lapse is atomic + idempotent and writes its own Zoho event.
        from deps import promote_or_lapse
        lapsing = await db.users.find(
            {"subscription_tier": {"$ne": "free"},
             "subscription_expires": {"$ne": None, "$lt": now.isoformat()},
             "banned": {"$ne": True}},
            {"_id": 0, "user_id": 1, "subscription_tier": 1, "subscription_expires": 1,
             "subscription_started_at": 1, "queued_plans": 1}).to_list(5000)
        promoted = 0
        downgraded = 0
        for lu in lapsing:
            had_queue = bool(lu.get("queued_plans"))
            try:
                await promote_or_lapse(lu)
                if had_queue:
                    promoted += 1
                else:
                    downgraded += 1
            except Exception:
                logger.exception("[scheduler] promote/lapse failed for %s", lu.get("user_id"))
        logger.info("[scheduler] subscriptions: promoted=%s lapsed=%s", promoted, downgraded)
        # 2d) Renewal reminder for Community Partners within 30 days of expiry.
        thirty = (now + _td(days=30)).isoformat()
        renewals = 0
        async for ru in db.users.find(
            {"subscription_tier": "community_partner",
             "subscription_expires": {"$gt": now.isoformat(), "$lte": thirty}},
            {"_id": 0, "user_id": 1, "subscription_expires": 1, "renewal_notified_for": 1}):
            exp = ru.get("subscription_expires")
            if ru.get("renewal_notified_for") != exp:
                await notify(user_id=ru["user_id"], kind="partner_renewal",
                             title="Your Community Partner term is ending soon",
                             body="Renew to keep your listing, events and messaging active.",
                             link="/dashboard")
                await db.users.update_one({"user_id": ru["user_id"]},
                                          {"$set": {"renewal_notified_for": exp}})
                renewals += 1
        # 3) Notify users whose subscription expires within 7 days
        cursor2 = db.users.find({
            "subscription_tier": {"$ne": "free"},
            "subscription_expires": {"$lte": seven_days, "$gt": now.isoformat()},
        }, {"_id": 0, "user_id": 1, "subscription_expires": 1, "subscription_expiring_notified_at": 1})
        subs = 0
        async for user in cursor2:
            # de-dupe: only send once per 6-day window
            last = user.get("subscription_expiring_notified_at")
            if last and last > (now - _td(days=6)).isoformat():
                continue
            await notify(user_id=user["user_id"], kind="subscription_expiring",
                         title="Your Sail More Now subscription ends soon",
                         body=f"Ends {user['subscription_expires'][:10]}. Renew any time from Pricing.",
                         link="/pricing", meta={})
            await db.users.update_one({"user_id": user["user_id"]},
                                      {"$set": {"subscription_expiring_notified_at": now.isoformat()}})
            subs += 1
        # 4) Auto-reveal mutual review sessions past the 7-day window (>=1 submission)
        auto_revealed = 0
        rev_cursor = db.review_sessions.find({
            "status": "pending",
            "reveal_at": {"$lte": now.isoformat()},
        }, {"_id": 0})
        from routers.reviews_router import _maybe_auto_reveal as _mr
        async for s in rev_cursor:
            after = await _mr(s)
            if after.get("revealed"):
                auto_revealed += 1
        # 5) Reminder emails for pending mutual reviews: day 3 and day 6 (each
        # tracked with its own flag). Skipped once revealed/withdrawn/held.
        from mailer import send_email, review_reminder_email_html
        reminders = 0
        origin = "https://app.sailmorenow.com"
        for mark, after_days in (("reminder_d3_sent_at", 3), ("reminder_d6_sent_at", 6)):
            cutoff = (now - _td(days=after_days)).isoformat()
            remind_cursor = db.review_sessions.find({
                "status": "pending", "held": {"$ne": True},
                mark: {"$in": [None, False]},
                "created_at": {"$lte": cutoff},
            }, {"_id": 0})
            async for s in remind_cursor:
                try:
                    claim = await db.review_sessions.update_one(
                        {"id": s["id"], mark: {"$in": [None, False]}},
                        {"$set": {mark: now.isoformat()}},
                    )
                    if claim.modified_count != 1:
                        continue  # another worker already claimed it
                    pending = [p for p in s.get("participants", []) if not p.get("submitted")]
                    if not pending:
                        continue
                    try:
                        reveal_dt = datetime.fromisoformat((s.get("reveal_at") or "").replace("Z", "+00:00"))
                        days_left = max(0, int((reveal_dt - now).total_seconds() // 86400))
                    except Exception:
                        days_left = max(0, 7 - after_days)
                    ids = [p["user_id"] for p in s.get("participants", [])]
                    users = await db.users.find({"user_id": {"$in": ids}},
                                                {"_id": 0, "user_id": 1, "email": 1, "name": 1}).to_list(None)
                    umap = {u["user_id"]: u for u in users}
                    for p in pending:
                        me = umap.get(p["user_id"], {})
                        other_p = next((x for x in s["participants"] if x["user_id"] != p["user_id"]), {})
                        other = umap.get(other_p.get("user_id"), {})
                        if not me.get("email"):
                            continue
                        html = review_reminder_email_html(
                            recipient_name=me.get("name") or "",
                            other_name=other.get("name") or "your counterparty",
                            relationship=s.get("relationship") or "customer_pro",
                            days_left=days_left,
                            reviews_url=f"{origin}/reviews",
                        )
                        await send_email(
                            recipient_email=me["email"],
                            subject=f"{days_left} days left to review {other.get('name') or 'your counterparty'}",
                            html_content=html,
                        )
                        reminders += 1
                except Exception:
                    logger.exception("[scheduler] review reminder failed for session %s", s.get("id"))
        logger.info("[scheduler] nightly: prompted=%s expired=%s sold_purged=%s sub_reminders=%s review_auto_revealed=%s review_reminders=%s",
                    prompted, expired.modified_count, sold_purged.deleted_count, subs, auto_revealed, reminders)
    except Exception:
        logger.exception("[scheduler] nightly job failed")


async def _zoho_nightly(db):
    """Nightly Zoho work: enqueue App_Last_Active for users active in the last
    ~25h (so the field tracks activity without a per-poll sync), then reconcile
    the outbox (re-send failed/pending) and log drift."""
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    try:
        since = (now - _td(hours=25)).isoformat()
        from zoho_sync import enqueue as _zq, reconcile
        n = 0
        async for u in db.users.find({"last_active_at": {"$gte": since}}, {"_id": 0, "user_id": 1}):
            await _zq(db, "last_active", u["user_id"])
            n += 1
        res = await reconcile(db)
        logger.info("[scheduler] zoho nightly: last_active_enqueued=%s reconcile=%s", n, res)
        return {"last_active": n, "reconcile": res}
    except Exception:
        logger.exception("[scheduler] zoho nightly failed")
        return {"error": True}


async def drain_zoho_outbox(db):
    """Frequent outbox drain so new sign-ups reach Zoho within a couple of minutes."""
    try:
        from zoho_sync import process_outbox
        return await process_outbox(db, limit=100)
    except Exception:
        logger.exception("[scheduler] zoho drain failed")
        return {"error": True}


async def compute_digest_payload(db, market: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Return the market-scoped digest payload {new_crew, new_events, new_comments}.
    Exposed as a module-level helper so the /api/digest/preview endpoint can
    reuse the exact same aggregation the Sunday scheduler runs."""
    from datetime import timedelta as _td
    now = now or datetime.now(timezone.utc)
    week_ago = (now - _td(days=7)).isoformat()
    new_crew = await db.crew_bank_standalone.find(
        {"markets": market, "status": "seeking",
         "created_at": {"$gte": week_ago},
         "$or": [{"expires_at": None}, {"expires_at": {"$gt": now.isoformat()}}]},
        {"_id": 0, "user_name": 1, "user_avatar": 1, "positions": 1, "user_id": 1}
    ).sort("created_at", -1).limit(10).to_list(10)
    new_events = await db.events.find(
        {"market": market,
         "$or": [{"created_at": {"$gte": week_ago}},
                 {"starts_at": {"$gte": now.isoformat(),
                                "$lte": (now + _td(days=7)).isoformat()}}]},
        {"_id": 0, "id": 1, "title": 1, "starts_at": 1,
         "location": 1, "market": 1, "image_url": 1}
    ).sort("starts_at", 1).limit(10).to_list(10)
    market_post_ids = await db.posts.distinct("id", {"market": market})
    comment_count = 0
    if market_post_ids:
        comment_count = await db.comments.count_documents({
            "post_id": {"$in": market_post_ids},
            "created_at": {"$gte": week_ago},
        })
    return {"new_crew": new_crew, "new_events": new_events, "new_comments": comment_count}


async def compute_user_saved(db, user_id: str, limit: int = 8) -> List[Dict[str, Any]]:
    """The member's most recently bookmarked posts/discussions (title + type)
    for their digest. Per-user, so it is not market-cached."""
    out: List[Dict[str, Any]] = []
    saved = await db.saved_items.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    for s in saved:
        coll = db.posts if s.get("target_type") == "post" else db.discussions
        doc = await coll.find_one({"id": s.get("target_id")},
                                  {"_id": 0, "id": 1, "title": 1, "type": 1, "kind": 1})
        if doc:
            label = (doc.get("kind") or doc.get("type") or "post").replace("_", " ")
            if s.get("target_type") == "discussion":
                url = f"/community-hub/{doc['id']}"
            elif doc.get("type") == "for_sale":
                url = "/community?tab=marketplace"
            else:
                url = "/community"
            out.append({"id": doc["id"], "title": doc.get("title") or "Untitled", "label": label.title(), "url": url})
    return out


async def compute_reviews_digest(db, user_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Per-user Reviews digest payload: {pending, recent_live}.

      • pending    — two-way review_sessions still awaiting THIS user's accept/
                     reject (user is the reviewee). Only the person who must
                     respond ever sees these; never shown to anyone else.
      • recent_live — reviews ABOUT this user that went LIVE in the last 7 days:
                     accepted / auto-revealed two-way reviews, plus (for orgs)
                     one-way org reviews created in the last 7 days.

    Rejected / hidden reviews are never included."""
    now = now or datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    # --- Pending: this user is the reviewee on a still-pending session ---
    pending: List[Dict[str, Any]] = []
    async for s in db.review_sessions.find(
        {"status": "pending",
         "participants": {"$elemMatch": {"user_id": user_id, "is_reviewer": False}}},
        {"_id": 0, "id": 1, "participants": 1, "relationship": 1, "reveal_at": 1},
    ).sort("created_at", -1):
        reviewer = next((p for p in s.get("participants", []) if p.get("is_reviewer")), None)
        if not reviewer:
            continue
        ru = await db.users.find_one({"user_id": reviewer["user_id"]}, {"_id": 0, "name": 1})
        pending.append({"reviewer_name": (ru or {}).get("name") or "Someone",
                        "relationship": s.get("relationship"),
                        "reveal_at": s.get("reveal_at")})
    # --- Recent live: two-way reviews about this user revealed in last 7 days ---
    recent_live: List[Dict[str, Any]] = []
    live_sessions = await db.review_sessions.find(
        {"status": {"$in": ["accepted", "auto_revealed"]},
         "revealed_at": {"$gte": week_ago},
         "participants.user_id": user_id},
        {"_id": 0, "id": 1, "relationship": 1},
    ).to_list(200)
    sid_rel = {s["id"]: s.get("relationship") for s in live_sessions}
    if sid_rel:
        async for r in db.mutual_reviews.find(
            {"target_id": user_id, "session_id": {"$in": list(sid_rel.keys())}},
            {"_id": 0, "author_id": 1, "session_id": 1, "ratings": 1},
        ):
            au = await db.users.find_one({"user_id": r["author_id"]}, {"_id": 0, "name": 1})
            recent_live.append({"author_name": (au or {}).get("name") or "A member",
                                "relationship": sid_rel.get(r["session_id"]),
                                "overall": (r.get("ratings") or {}).get("overall")})
    # --- One-way org reviews about this user, created in last 7 days ---
    async for r in db.reviews.find(
        {"target_id": user_id, "created_at": {"$gte": week_ago}},
        {"_id": 0, "author_name": 1, "rating": 1},
    ).sort("created_at", -1):
        recent_live.append({"author_name": r.get("author_name") or "A member",
                            "relationship": "organization",
                            "overall": r.get("rating")})
    return {"pending": pending, "recent_live": recent_live}


async def _sunday_digest_job(db):
    """Sunday-morning multi-market digest of new crew / events / comments to
    users with newsletter_opt_in=true. One email per opted-in user, covering
    every market they follow (`user.markets`) plus a fallback to primary_market.
    Idempotent per user per week via digest_sent_at."""
    from datetime import timedelta as _td
    from mailer import send_email, community_digest_email_html
    now = datetime.now(timezone.utc)
    since_cutoff = (now - _td(days=6)).isoformat()
    origin = "https://app.sailmorenow.com"
    sent = 0
    try:
        users = db.users.find({
            "newsletter_opt_in": True,
            "email": {"$ne": None},
            "$or": [{"digest_sent_at": None}, {"digest_sent_at": {"$lt": since_cutoff}}],
        }, {"_id": 0, "user_id": 1, "name": 1, "email": 1,
            "primary_market": 1, "markets": 1})
        market_cache: Dict[str, Dict[str, Any]] = {}
        async for user in users:
            user_markets: List[str] = list(user.get("markets") or [])
            if not user_markets and user.get("primary_market"):
                user_markets = [user["primary_market"]]
            # Dedup while preserving order, primary first if present
            seen = set()
            ordered: List[str] = []
            for m in ([user.get("primary_market")] + user_markets):
                if m and m not in seen:
                    seen.add(m)
                    ordered.append(m)
            if not ordered:
                continue
            populated: List[Dict[str, Any]] = []
            for market in ordered:
                if market not in market_cache:
                    market_cache[market] = await compute_digest_payload(db, market, now)
                payload = market_cache[market]
                if payload["new_crew"] or payload["new_events"] or payload["new_comments"]:
                    populated.append({"market": market, **payload})
            reviews = await compute_reviews_digest(db, user["user_id"], now)
            has_reviews = bool(reviews["pending"] or reviews["recent_live"])
            if not populated and not has_reviews:
                continue
            saved = await compute_user_saved(db, user["user_id"])
            header = populated[0]["market"] if len(populated) == 1 else "your markets"
            html = community_digest_email_html(
                recipient_name=user.get("name") or "",
                markets=populated,
                saved=saved,
                reviews=reviews,
                app_url=origin,
            )
            claim = await db.users.update_one(
                {"user_id": user["user_id"],
                 "$or": [{"digest_sent_at": None}, {"digest_sent_at": {"$lt": since_cutoff}}]},
                {"$set": {"digest_sent_at": now.isoformat()},
                 "$push": {"digest_send_history": {"$each": [now.isoformat()], "$slice": -12}}},
            )
            if claim.modified_count != 1:
                continue
            subject = (f"Your Sail More Now Sunday digest: {header}"
                       if len(populated) == 1
                       else f"Your Sail More Now Sunday digest: {len(populated)} markets")
            from mailer import unsubscribe_url_for
            await send_email(
                recipient_email=user["email"],
                subject=subject,
                html_content=html,
                unsubscribe_url=unsubscribe_url_for(user["user_id"]),
            )
            sent += 1
        logger.info("[scheduler] sunday_digest: sent=%s markets=%s", sent, len(market_cache))
    except Exception:
        logger.exception("[scheduler] sunday_digest failed")


async def _monday_admin_report_digest_job(db):
    """Monday-morning admin summary of last week's reports queue. Emails every
    user with platform_role='admin' OR whose email is in ADMIN_EMAILS.
    Idempotent within a rolling 5-day window via `admin_report_digest_sent_at`."""
    from datetime import timedelta as _td
    from mailer import send_email, report_digest_email_html
    now = datetime.now(timezone.utc)
    since_iso = (now - _td(days=7)).isoformat()
    cutoff_iso = (now - _td(days=5)).isoformat()
    try:
        new_reports = await db.reports.count_documents({"created_at": {"$gte": since_iso}})
        resolved = await db.reports.count_documents({"resolved_at": {"$gte": since_iso}, "status": "resolved"})
        dismissed = await db.reports.count_documents({"resolved_at": {"$gte": since_iso}, "status": "dismissed"})
        open_total = await db.reports.count_documents({"status": "open"})
        oldest_open = await db.reports.find_one(
            {"status": "open"}, {"_id": 0, "created_at": 1, "reason": 1},
            sort=[("created_at", 1)],
        )
        recent_open = await db.reports.find(
            {"status": "open"}, {"_id": 0}
        ).sort("created_at", -1).limit(5).to_list(5)
        origin = "https://app.sailmorenow.com"
        html = report_digest_email_html(
            new_count=new_reports, resolved_count=resolved, dismissed_count=dismissed,
            open_total=open_total, oldest_open=oldest_open, recent_open=recent_open,
            app_url=origin,
        )
        # Single-channel admin digest: one recipient (ADMIN_NOTIFY_EMAIL),
        # claimed once per week via admin_email_digests to avoid duplicate sends.
        from admin_notify import admin_notify_email
        from pymongo.errors import DuplicateKeyError
        recipient = admin_notify_email()
        claim_key = "report_digest_notify"
        send_ok = False
        fresh = await db.admin_email_digests.find_one(
            {"key": claim_key, "sent_at": {"$gte": cutoff_iso}}, {"_id": 1})
        if not fresh:
            stale = await db.admin_email_digests.update_one(
                {"key": claim_key, "sent_at": {"$lt": cutoff_iso}},
                {"$set": {"sent_at": now.isoformat()}})
            if stale.modified_count == 1:
                send_ok = True
            elif stale.matched_count == 0:
                try:
                    await db.admin_email_digests.insert_one({"key": claim_key, "sent_at": now.isoformat()})
                    send_ok = True
                except DuplicateKeyError:
                    send_ok = False
        if send_ok:
            await send_email(
                recipient_email=recipient,
                subject=f"Sail More Now: {new_reports} new report{'s' if new_reports != 1 else ''} this week",
                html_content=html,
            )
        logger.info("[scheduler] admin_report_digest: recipient=%s new=%s open=%s",
                    recipient, new_reports, open_total)
    except Exception:
        logger.exception("[scheduler] admin_report_digest failed")


async def _import_contact_digest_job(db):
    """Weekly admin digest of imported (aggregator) events still missing an
    organizer or RSVP contact email, so cleanup never piles up."""
    from mailer import send_email, import_contact_digest_email_html, app_public_url
    from admin_notify import admin_notify_email
    try:
        events = await db.events.find(
            {"source": "aggregator",
             "$or": [{"organizer_name": {"$in": [None, ""]}}, {"organizer_email": {"$in": [None, ""]}}]},
            {"_id": 0, "title": 1, "starts_at": 1, "market": 1},
        ).sort("starts_at", 1).to_list(200)
        if not events:
            logger.info("[scheduler] import_contact_digest: nothing missing")
            return 0
        html = import_contact_digest_email_html(events=events, app_url=app_public_url())
        recipient = admin_notify_email()
        await send_email(
            recipient_email=recipient,
            subject=f"Sail More Now: {len(events)} imported event{'s' if len(events) != 1 else ''} need a contact",
            html_content=html,
        )
        logger.info("[scheduler] import_contact_digest: events=%s recipient=%s", len(events), recipient)
        return len(events)
    except Exception:
        logger.exception("[scheduler] import_contact_digest failed")
        return 0


async def _contact_reply_retry_job(db):
    """Retry any /api/admin/contact reply that was persisted with
    delivered=false (Resend returned error or was skipped). Runs every 3 h.
    Per-reply retry_count is capped at 5 to avoid pounding a persistently
    dead recipient.

    Concurrency guard: we CAS on `last_retry_at` — the filter requires the
    reply to be untouched inside a 1-minute lease window, and the same
    update sets last_retry_at=now. MongoDB serialises the two writes at
    the document level, so an overlapping run sees the freshly-set value
    and its filter fails (modified_count == 0), preventing double sends.
    """
    from mailer import send_email
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    lease_cutoff = (now - _td(minutes=1)).isoformat()
    retried = 0
    delivered_now = 0
    exhausted = 0
    try:
        cursor = db.contact_messages.find(
            {"replies": {"$elemMatch": {"delivered": False}}},
            {"_id": 0},
        )
        async for msg in cursor:
            for r in msg.get("replies", []):
                if r.get("delivered"):
                    continue
                if int(r.get("retry_count", 0)) >= 5:
                    exhausted += 1
                    continue
                claim = await db.contact_messages.update_one(
                    {"id": msg["id"], "replies": {"$elemMatch": {
                        "id": r["id"],
                        "delivered": False,
                        "$or": [
                            {"last_retry_at": {"$exists": False}},
                            {"last_retry_at": None},
                            {"last_retry_at": {"$lt": lease_cutoff}},
                        ],
                    }}},
                    {"$inc": {"replies.$.retry_count": 1},
                     "$set": {"replies.$.last_retry_at": now_iso}},
                )
                if claim.modified_count != 1:
                    continue  # already claimed by another worker
                retried += 1
                html = (
                    f"<div style='font-family:system-ui,sans-serif; color:#0f172a;'>"
                    f"<p>Hi {(msg.get('name') or 'there').replace('<', '&lt;')},</p>"
                    f"<div style='white-space:pre-wrap;'>{(r.get('body') or '').replace('<', '&lt;')}</div>"
                    f"<p style='margin-top:20px; color:#64748b; font-size:12px;'>- The Sail More Now team · info@sailmorenow.com</p>"
                    f"</div>"
                )
                try:
                    res = await send_email(
                        recipient_email=msg["email"],
                        subject="Re: your note to Sail More Now",
                        html_content=html,
                        reply_to="info@sailmorenow.com",
                    )
                except Exception:
                    logger.exception("[retry] send crashed for reply %s", r.get("id"))
                    continue
                if isinstance(res, dict) and res.get("status") == "ok":
                    await db.contact_messages.update_one(
                        {"id": msg["id"], "replies.id": r["id"]},
                        {"$set": {"replies.$.delivered": True,
                                  "replies.$.delivered_at": now_iso}},
                    )
                    delivered_now += 1
        if exhausted:
            logger.warning("[scheduler] contact_reply_retry: %s reply(ies) exhausted at retry_count=5", exhausted)
        logger.info("[scheduler] contact_reply_retry: retried=%s delivered=%s exhausted=%s",
                    retried, delivered_now, exhausted)
    except Exception:
        logger.exception("[scheduler] contact_reply_retry failed")


async def _trial_ending_job(db):
    """Email a reminder ~3 days before a trial's first charge. Idempotent via
    trial_reminder_sent. Test emails policy is enforced by the caller/env."""
    from datetime import datetime, timezone, timedelta
    from mailer import send_email, billing_trial_ending_email_html
    from constants import SUBSCRIPTION_PACKAGES, package_total, tier_label
    now = datetime.now(timezone.utc)
    lo = (now + timedelta(days=2)).isoformat()
    hi = (now + timedelta(days=4)).isoformat()
    cursor = db.users.find(
        {"subscription_status": "trialing", "trial_reminder_sent": {"$ne": True},
         "trial_end": {"$gte": lo, "$lte": hi}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "subscription_tier": 1,
         "subscription_package_id": 1, "trial_end": 1})
    async for u in cursor:
        pkg = SUBSCRIPTION_PACKAGES.get(u.get("subscription_package_id") or "")
        price = f"${pkg['monthly']:.2f} per month" if pkg else ""
        tier_disp = tier_label(u.get("subscription_tier"))
        if pkg and pkg.get("audience") == "boat_pro":
            tier_disp = f"Boat Pro {tier_disp}"
        try:
            await send_email(
                recipient_email=u["email"],
                subject="Your Sail More Now free trial ends in 3 days",
                html_content=billing_trial_ending_email_html(
                    name=u.get("name"), tier_label=tier_disp,
                    charge_date=(u.get("trial_end") or "")[:10], price=price))
            await db.users.update_one({"user_id": u["user_id"]},
                                      {"$set": {"trial_reminder_sent": True}})
        except Exception:
            logger.exception("trial-ending reminder failed for %s", u.get("user_id"))



async def _promo_ending_job(db):
    """Email a reminder ~3 days before a PROMO-code subscriber's first real
    charge. Idempotent via promo_reminder_sent. Separate from the trial job."""
    from datetime import datetime, timezone, timedelta
    from mailer import send_email, billing_trial_ending_email_html
    from constants import SUBSCRIPTION_PACKAGES, package_total, tier_label
    now = datetime.now(timezone.utc)
    lo = (now + timedelta(days=2)).isoformat()
    hi = (now + timedelta(days=4)).isoformat()
    cursor = db.users.find(
        {"is_promo": True, "subscription_provider": "stripe",
         "promo_reminder_sent": {"$ne": True},
         "subscription_free_until": {"$gte": lo, "$lte": hi}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "subscription_tier": 1,
         "subscription_package_id": 1, "subscription_free_until": 1, "subscription_term_choice": 1})
    async for u in cursor:
        pkg = SUBSCRIPTION_PACKAGES.get(u.get("subscription_package_id") or "")
        tc = u.get("subscription_term_choice")
        if tc:
            price = f"${tc['price']:.2f} for {tc['months']} months"
        else:
            price = f"${pkg['monthly']:.2f} per month" if pkg else ""
        tier_disp = tier_label(u.get("subscription_tier"))
        if pkg and pkg.get("audience") == "boat_pro":
            tier_disp = f"Boat Pro {tier_disp}"
        try:
            await send_email(
                recipient_email=u["email"],
                subject="Your Sail More Now free period ends in 3 days",
                html_content=billing_trial_ending_email_html(
                    name=u.get("name"), tier_label=tier_disp,
                    charge_date=(u.get("subscription_free_until") or "")[:10], price=price, is_promo=True))
            await db.users.update_one({"user_id": u["user_id"]},
                                      {"$set": {"promo_reminder_sent": True}})
        except Exception:
            logger.exception("promo-ending reminder failed for %s", u.get("user_id"))


async def _comp_expiry_job(db):
    """Daily: expire comp grants whose end date has passed -> member drops to
    free, grant marked expired. Open-ended grants (end_at null) are untouched."""
    from datetime import datetime, timezone
    from billing import revoke_comp
    now_iso = datetime.now(timezone.utc).isoformat()
    n = 0
    async for g in db.comp_grants.find(
        {"status": "active", "end_at": {"$ne": None, "$lte": now_iso}}, {"_id": 0, "id": 1, "user_id": 1}):
        await revoke_comp(g["user_id"], grant_id=g["id"], reason="expired")
        n += 1
    if n:
        logger.info("[scheduler] comp expiry: expired=%s", n)
    return {"expired": n}


def start_scheduler(db) -> AsyncIOScheduler:
    """Start the async scheduler. Events aggregator sync runs weekly on Sundays at 03:00 America/Los_Angeles."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler
    sched = AsyncIOScheduler(timezone=_PT)
    sched.add_job(
        _weekly_job,
        trigger=CronTrigger(day_of_week="sun", hour=3, minute=0, timezone=_PT),
        args=[db],
        id="events_daily_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _nightly_job,
        trigger=CronTrigger(hour=2, minute=15, timezone=_PT),
        args=[db],
        id="expiring_nightly",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    from apscheduler.triggers.interval import IntervalTrigger
    sched.add_job(
        drain_zoho_outbox,
        trigger=IntervalTrigger(minutes=2, timezone=_PT),
        args=[db], id="zoho_outbox_drain", replace_existing=True,
        misfire_grace_time=120, max_instances=1, coalesce=True,
    )
    sched.add_job(
        _zoho_nightly,
        trigger=CronTrigger(hour=2, minute=45, timezone=_PT),
        args=[db], id="zoho_nightly", replace_existing=True, misfire_grace_time=3600,
    )
    sched.add_job(
        _sunday_digest_job,
        trigger=CronTrigger(day_of_week="sun", hour=8, minute=0, timezone=_PT),
        args=[db],
        id="sunday_digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _monday_admin_report_digest_job,
        trigger=CronTrigger(day_of_week="mon", hour=8, minute=30, timezone=_PT),
        args=[db],
        id="monday_admin_report_digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _contact_reply_retry_job,
        trigger=CronTrigger(hour="*/3", minute=17, timezone=_PT),
        args=[db],
        id="contact_reply_retry",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    sched.add_job(
        _event_reminder_job,
        trigger=CronTrigger(minute=0, timezone=_PT),
        args=[db],
        id="event_reminders",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _import_contact_digest_job,
        trigger=CronTrigger(day_of_week="mon", hour=9, minute=0, timezone=_PT),
        args=[db],
        id="import_contact_digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _volunteer_reminder_job,
        trigger=CronTrigger(hour=9, minute=0, timezone=_PT),
        args=[db],
        id="volunteer_reminders",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _review_nudge_job,
        trigger=CronTrigger(hour=10, minute=0, timezone=_PT),
        args=[db],
        id="review_nudges",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _trial_ending_job,
        trigger=CronTrigger(hour=9, minute=30, timezone=_PT),
        args=[db],
        id="trial_ending_reminders",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.add_job(
        _promo_ending_job,
        trigger=CronTrigger(hour=9, minute=40, timezone=_PT),
        args=[db], id="promo_ending_reminders", replace_existing=True, misfire_grace_time=3600,
    )
    sched.add_job(
        _comp_expiry_job,
        trigger=CronTrigger(hour=2, minute=5, timezone=_PT),
        args=[db], id="comp_expiry", replace_existing=True, misfire_grace_time=3600,
    )
    sched.start()
    _scheduler = sched
    logger.info("[scheduler] started; next run: %s", sched.get_job("events_daily_sync").next_run_time)
    return sched


def next_run() -> Optional[Dict[str, Any]]:
    if not _scheduler:
        return None
    out: Dict[str, Any] = {}
    for jid in (
        "events_daily_sync", "expiring_nightly", "sunday_digest",
        "monday_admin_report_digest", "contact_reply_retry", "event_reminders",
        "volunteer_reminders", "review_nudges",
    ):
        job = _scheduler.get_job(jid)
        if job and job.next_run_time:
            out[jid] = job.next_run_time.isoformat()
    return out or None
