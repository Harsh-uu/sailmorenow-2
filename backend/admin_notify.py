"""Single-channel admin email alerts with a 10-minute burst guard.

All admin alerts (reports, auto-hidden content, review disputes, contact
messages, events needing attention) route to ONE address, ADMIN_NOTIFY_EMAIL
(default admin@sailmorenow.com). In-app notifications are unchanged. If more
than 5 alerts of the same kind arrive within 10 minutes, one summary email is
sent instead of many (the 6th sends the summary; later ones are suppressed).
"""
from __future__ import annotations
import os
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("smn.admin_notify")


def admin_notify_email() -> str:
    return (os.environ.get("ADMIN_NOTIFY_EMAIL") or "admin@sailmorenow.com").strip()


async def admin_notify(db, *, kind: str, subject: str, title: str, lines: list,
                       deep_link_path: str, action_label: str = "Open in admin") -> None:
    """Email one admin alert with a deep link to the exact item. Never raises."""
    from mailer import send_email, admin_alert_email_html, app_public_url
    try:
        now = datetime.now(timezone.utc)
        await db.admin_alert_log.insert_one({"kind": kind, "ts": now})
        since = now - timedelta(minutes=10)
        count = await db.admin_alert_log.count_documents({"kind": kind, "ts": {"$gte": since}})
        recipient = admin_notify_email()
        base = app_public_url()
        pretty = kind.replace("_", " ")
        if count <= 5:
            html = admin_alert_email_html(
                title=title, lines=lines,
                action_url=f"{base}{deep_link_path}", action_label=action_label)
            await send_email(recipient_email=recipient, subject=subject, html_content=html)
        elif count == 6:
            summary_path = deep_link_path.split("?")[0]
            html = admin_alert_email_html(
                title=f"Several {pretty} alerts",
                lines=[f"More than 5 {pretty} alerts arrived in the last 10 minutes. "
                       f"Open the admin area to review them together."],
                action_url=f"{base}{summary_path}", action_label="Review in admin")
            await send_email(recipient_email=recipient,
                             subject=f"Sail More Now: multiple {pretty} alerts", html_content=html)
        # count > 6 within the window: suppressed.
    except Exception:
        logger.exception("admin_notify failed kind=%s", kind)
