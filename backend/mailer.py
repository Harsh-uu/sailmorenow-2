"""Transactional email - primary path is Jenn's own Resend account
(RESEND_API_KEY), with the Emergent managed Resend proxy as a fallback so mail is
never dropped. Sender display name comes from EMAIL_FROM_NAME. Sending fails
soft: log and return, don't crash.
"""
from __future__ import annotations
import os
import asyncio
import logging
import httpx
from typing import Optional, List, Dict, Any

logger = logging.getLogger("smn.mailer")

# Primary send path: Jenn's OWN Resend account (key in env RESEND_API_KEY).
# Fallback path: Emergent's managed Resend proxy (EMERGENT_EMAIL_KEY) so mail is
# never dropped if the key is missing/invalid or Resend is unavailable.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"  # managed proxy (fallback)
RESEND_API_URL = "https://api.resend.com/emails"
# Verified sending domain in Jenn's Resend dashboard. From/Reply-To are fixed to
# the brand values but can be overridden by env if ever needed.
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "notifications@notifications.sailmorenow.com")
RESEND_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Sail More Now")

# Brand colours. ORANGE_BRIGHT is a slightly brighter, more saturated orange so
# the eyebrow text and buttons stay legible after Gmail/Apple Mail dark-mode
# colour shifts. NAVY_BTN_TEXT keeps button labels readable either way.
NAVY = "#1F3F5B"
TEAL = "#55B3AD"
ORANGE_BRIGHT = "#FF9E2C"
NAVY_BTN_TEXT = "#10233A"
# Build stamp, bumped each email release so Jenn can confirm she is looking at
# the latest version in a real inbox.
EMAIL_BUILD = "EMAILLOGO2-2026.06"

# Standard footer / brand details used on every email.
SUPPORT_EMAIL = "customersupport@sailmorenow.com"
BUSINESS_ADDRESS = "Sail More Now, 5441 S Macadam Ave, Ste N, Portland, OR 97239"
# External legal policies (Termly) - same single source of truth as the web footer.
TERMS_URL = "https://app.termly.io/policy-viewer/policy.html?policyUUID=owsa-events-preview--7evdsk8f"
PRIVACY_URL = "https://app.termly.io/policy-viewer/policy.html?policyUUID=owsa-events-preview--7evdsk8f"


def _cfg():
    key = os.environ.get("EMERGENT_EMAIL_KEY")
    from_name = os.environ.get("EMAIL_FROM_NAME", "Sail More Now")
    return key, from_name


async def _record_event(kind: str, recipient_email: str, subject: str, reason: str,
                        level: int = logging.ERROR) -> None:
    """Log and persist a send event (failure or fallback) so an admin can see it.
    Backend logs carry the marker (EMAIL SEND FAILED / EMAIL FALLBACK); the
    email_failures collection keeps a row per event. NO message body/HTML is ever
    stored (subjects are metadata only). Rows auto-expire after 90 days."""
    logger.log(level, "%s to=%s subject=%r reason=%s", kind, recipient_email, subject, reason)
    try:
        import uuid as _uuid
        from deps import db as _db
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        now = _dt.now(_tz.utc)
        await _db.email_failures.insert_one({
            "id": _uuid.uuid4().hex,
            "kind": kind, "to": recipient_email, "subject": subject,
            "reason": str(reason)[:500], "at": now.isoformat(),
            "resolved": False,
            "expire_at": now + _td(days=90),  # BSON date drives the TTL index
        })
    except Exception:
        logger.exception("could not record email event")


async def _record_failure(recipient_email: str, subject: str, reason: str) -> None:
    await _record_event("EMAIL SEND FAILED", recipient_email, subject, reason)


async def log_email_sent(recipient_email: str, subject: str, note: str = "sent") -> None:
    """Record a successful transactional send so it appears in the admin email log
    (/admin/email). No body/HTML is ever stored - subject + note are metadata only."""
    try:
        import uuid as _uuid
        from deps import db as _db
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        now = _dt.now(_tz.utc)
        await _db.email_failures.insert_one({
            "id": _uuid.uuid4().hex,
            "kind": "EMAIL SENT", "to": recipient_email, "subject": subject,
            "reason": str(note)[:300], "at": now.isoformat(),
            "resolved": True,
            "expire_at": now + _td(days=90),
        })
    except Exception:
        logger.exception("could not record email sent event")



async def _send_via_resend(key: str, recipient_email: str, subject: str, html: str,
                           reply_to: str, from_email: str,
                           extra_headers: Optional[Dict[str, str]]) -> dict:
    """Send through Jenn's Resend account with retry + backoff. Returns an
    outcome dict: ok | invalid_key | retryable | error. Never raises."""
    body: Dict[str, Any] = {
        "from": f"{RESEND_FROM_NAME} <{from_email}>",
        "to": [recipient_email],
        "subject": subject,
        "html": html,
        "reply_to": reply_to,
    }
    if extra_headers:
        body["headers"] = extra_headers
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": "SailMoreNow-Mailer/1.0",  # required for raw Resend HTTP calls
    }
    delays = [1, 2, 4, 0]  # backoff between up to 4 attempts
    last = "no attempt"
    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=20.0) as c:
                r = await c.post(RESEND_API_URL, headers=headers, json=body)
        except Exception as e:
            last = f"exception: {e}"
            await asyncio.sleep(delays[attempt])
            continue
        if r.status_code < 300:
            data = r.json() if r.content else {}
            return {"outcome": "ok", "id": data.get("id")}
        if r.status_code in (401, 403):
            return {"outcome": "invalid_key", "reason": f"http_{r.status_code}: {r.text[:200]}"}
        if r.status_code == 429 or r.status_code >= 500:
            last = f"http_{r.status_code}: {r.text[:160]}"
            try:
                wait = float(r.headers.get("retry-after") or delays[attempt])
            except (TypeError, ValueError):
                wait = delays[attempt]
            logger.warning("[mailer] resend %s, retrying in %ss (attempt %s)", r.status_code, wait, attempt + 1)
            await asyncio.sleep(min(wait, 10))
            continue
        # Other 4xx (e.g. 422 validation) - not retryable.
        return {"outcome": "error", "reason": f"http_{r.status_code}: {r.text[:200]}"}
    return {"outcome": "retryable", "reason": f"exhausted retries: {last}"}


async def send_email(
    recipient_email: str,
    subject: str,
    html_content: str,
    reply_to: Optional[str] = None,
    from_email: Optional[str] = None,
    unsubscribe_url: Optional[str] = None,
) -> dict:
    """Send a single transactional email. Never raises - always returns a dict.
    Primary path is Jenn's Resend account; on any non-ok result (missing/invalid
    key, rate limit exhausted, server error) it falls back to the managed proxy
    so mail is never dropped, and records an EMAIL FALLBACK event. A shared logo
    header + legal footer are applied to every email. Reply-To defaults to
    customersupport@."""
    emergent_key, from_name = _cfg()
    resend_key = os.environ.get("RESEND_API_KEY")
    html_content = _apply_branding(html_content, unsubscribe_url)
    reply = reply_to or SUPPORT_EMAIL
    resend_from = from_email or RESEND_FROM_EMAIL
    extra_headers = None
    if unsubscribe_url:
        extra_headers = {
            "List-Unsubscribe": f"<{unsubscribe_url}>, <mailto:{SUPPORT_EMAIL}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }

    # ---- Primary: Jenn's Resend account ----
    if resend_key:
        res = await _send_via_resend(resend_key, recipient_email, subject, html_content,
                                     reply, resend_from, extra_headers)
        if res["outcome"] == "ok":
            logger.info("[mailer] sent via resend to=%s subject=%r id=%s",
                        recipient_email, subject, res.get("id"))
            return {"status": "ok", "id": res.get("id"), "provider": "resend"}
        # Not ok: fall back to the managed proxy instead of dropping mail.
        await _record_event(
            "EMAIL FALLBACK", recipient_email, subject,
            f"resend {res['outcome']}: {res.get('reason')}; falling back to managed proxy",
            level=logging.WARNING)
        if not emergent_key:
            await _record_failure(recipient_email, subject,
                                  f"resend {res['outcome']} and no proxy key available")
            return {"status": "error", "reason": res.get("reason"), "provider": "resend"}
    elif not emergent_key:
        logger.warning("[mailer] skip send (no RESEND_API_KEY and no EMERGENT_EMAIL_KEY): %s", recipient_email)
        return {"status": "skipped", "reason": "no_key"}

    # ---- Fallback / legacy: managed Resend proxy ----
    payload: Dict[str, Any] = {
        "to": [recipient_email],
        "subject": subject,
        "html": html_content,
        "from_name": from_name,
    }
    proxy_from = from_email or os.environ.get("EMAIL_FROM_ADDRESS")
    if proxy_from:
        payload["from_email"] = proxy_from
    payload["contact_email"] = reply
    if extra_headers:
        payload["headers"] = extra_headers
    provider = "proxy_fallback" if resend_key else "proxy"
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": emergent_key},
                json=payload,
            )
        if r.status_code >= 400:
            logger.warning("[mailer] send failed %s to=%s body=%s", r.status_code, recipient_email, r.text[:200])
            await _record_failure(recipient_email, subject, f"http_{r.status_code}: {r.text[:200]}")
            return {"status": "error", "http": r.status_code, "provider": provider}
        try:
            data = r.json()
        except Exception:
            data = {}
        logger.info("[mailer] sent via %s to=%s subject=%r id=%s", provider, recipient_email, subject, data.get("id"))
        return {"status": "ok", "id": data.get("id"), "provider": provider}
    except Exception as e:
        logger.exception("[mailer] send crashed")
        await _record_failure(recipient_email, subject, f"exception: {e}")
        return {"status": "error", "reason": str(e), "provider": provider}


def _logo_header_html() -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;">'
        '<tr><td align="center" style="padding:24px 12px 2px;">'
        f'<img src="{email_logo_url()}" width="72" height="72" alt="Sail More Now" '
        'style="display:block; width:72px; height:72px;" />'
        '</td></tr></table>'
    )


def _standard_footer_html(unsubscribe_url: Optional[str] = None) -> str:
    unsub = ""
    if unsubscribe_url:
        unsub = (f'<div style="margin-top:8px;"><a href="{unsubscribe_url}" '
                 'style="color:#94a3b8; text-decoration:underline;">Unsubscribe</a> from these emails.</div>')
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;">'
        '<tr><td align="center" style="padding:14px 20px 28px;">'
        '<div style="font-size:11px; line-height:1.7; color:#94a3b8; max-width:560px;">'
        f'{BUSINESS_ADDRESS}<br/>'
        f'Questions? <a href="mailto:{SUPPORT_EMAIL}" style="color:#2A7871; text-decoration:none;">{SUPPORT_EMAIL}</a><br/>'
        f'<a href="{PRIVACY_URL}" style="color:#94a3b8; text-decoration:underline;">Privacy</a> &middot; '
        f'<a href="{TERMS_URL}" style="color:#94a3b8; text-decoration:underline;">Terms</a>'
        f'{unsub}'
        f'<div style="margin-top:8px; font-size:9px; color:#cbd5e1;">{EMAIL_BUILD}</div>'
        '</div></td></tr></table>'
    )


# Dark-mode hardening injected into every email's <head>. Declaring that the
# email supports both schemes stops Apple Mail/Outlook from force-inverting our
# navy/orange; the media query keeps the navy banner navy where honoured.
_DARK_META = (
    '<meta name="color-scheme" content="light dark">'
    '<meta name="supported-color-schemes" content="light dark">'
)
_DARK_STYLE = (
    '<style>:root{color-scheme:light dark;supported-color-schemes:light dark;}'
    f'@media (prefers-color-scheme:dark){{td[bgcolor="{NAVY}"]{{background-color:{NAVY}!important;}}}}'
    '</style>'
)


def _harden_dark_mode(html: str) -> str:
    """Make navy banners and orange accents survive Gmail/Apple Mail dark mode:
    brighten the orange, give buttons navy text, add explicit bgcolor to navy
    cells, and inject color-scheme meta + a dark-mode <style> into the head."""
    import re
    # Buttons/CTAs: brand TEAL background with NAVY label (never orange). Covers
    # every inline spelling in use (background / background-color; white or navy
    # text). Navy (#1F3F5B) on teal measures ~4.4:1 - passes AA for bold button
    # text; white on teal is only ~2.5:1, so navy text is used.
    html = re.sub(
        r'background(?:-color)?:\s*#F2A03B;\s*color:\s*#(?:ffffff|fff|10233A|1F3F5B)',
        f'background:{TEAL}; background-color:{TEAL}; color:{NAVY}',
        html, flags=re.I)
    # Remaining orange (eyebrows, badges, accents only) -> brighter orange for dark mode.
    html = html.replace("#F2A03B", ORANGE_BRIGHT).replace("#f2a03b", ORANGE_BRIGHT)
    # Explicit bgcolor on navy banner cells that don't already have one.
    html = re.sub(r'<td(?![^>]*bgcolor)([^>]*?background(?:-color)?:\s*#1F3F5B)',
                  r'<td bgcolor="#1F3F5B"\1', html, flags=re.I)
    # Normalise any existing color-scheme metas to light dark.
    html = re.sub(r'(name="color-scheme"\s+content=")[^"]*(")', r'\1light dark\2', html, flags=re.I)
    html = re.sub(r'(name="supported-color-schemes"\s+content=")[^"]*(")', r'\1light dark\2', html, flags=re.I)
    # Inject meta + style into the head (create one if the template has none).
    if re.search(r'</head>', html, flags=re.I):
        add = _DARK_STYLE if 'name="color-scheme"' in html else (_DARK_META + _DARK_STYLE)
        html = re.sub(r'</head>', add + '</head>', html, count=1, flags=re.I)
    elif re.search(r'<html[^>]*>', html, flags=re.I):
        html = re.sub(r'(<html[^>]*>)', r'\1<head>' + _DARK_META + _DARK_STYLE + '</head>',
                      html, count=1, flags=re.I)
    else:
        html = '<head>' + _DARK_META + _DARK_STYLE + '</head>' + html
    return html


def _apply_branding(html: str, unsubscribe_url: Optional[str] = None) -> str:
    """Add the shared logo header (unless the email already shows the logo) and
    the standard legal footer to every email. Handles templates with or without
    a <body> tag."""
    import re
    footer = _standard_footer_html(unsubscribe_url)
    logo = email_logo_url()
    # The header banner is a navy (#1F3F5B) cell with a letter-spacing:2px eyebrow
    # and header padding (22/24px). Footers use 18px, so they are never matched.
    header_re = re.compile(
        r'(<td[^>]*background(?:-color)?:\s*#1F3F5B[^>]*padding:\s*2[^>]*>)'
        r'((?:(?!</td>).)*?letter-spacing:\s*2px(?:(?!</td>).)*?)</td>',
        re.I | re.S)
    # Templates that already carry a finished navy header (logo right-aligned in
    # the banner) mark themselves with SMN_HEADER_DONE so we don't re-inject.
    if "SMN_HEADER_DONE" not in html and header_re.search(html):
        # Move the logo off any standalone top white strip into the navy banner.
        html = re.sub(
            r'<tr>\s*<td[^>]*background(?:-color)?:\s*#ffffff[^>]*>\s*'
            r'(?:<a[^>]*>\s*)?<img[^>]*alt="Sail More Now"[^>]*>\s*(?:</a>\s*)?</td>\s*</tr>',
            '', html, flags=re.I | re.S)
        logo_cell = (
            '<td valign="middle" width="72" align="right" '
            'style="vertical-align:middle; width:72px; text-align:right; padding-left:14px;">'
            f'<img src="{logo}" width="56" height="56" alt="Sail More Now" '
            'style="display:block; width:56px; height:56px; margin-left:auto;" /></td>')

        def _inject(m):
            inner = m.group(2)
            if "<img" in inner.lower():
                return m.group(0)
            two = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
                   '<tr><td valign="middle" style="vertical-align:middle;">'
                   f'{inner}</td>{logo_cell}</tr></table>')
            return f'{m.group(1)}{two}</td>'

        html = header_re.sub(_inject, html, count=1)
    if "</body>" in html.lower():
        idx = html.lower().rfind("</body>")
        return _harden_dark_mode(html[:idx] + footer + html[idx:])
    return _harden_dark_mode(
        f'<!DOCTYPE html><html><body style="margin:0; padding:0; background:#f7fafc; '
        f"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;\">"
        f'{html}{footer}</body></html>')


def admin_alert_email_html(*, title: str, lines: List[str], action_url: str,
                           action_label: str = "Open in admin") -> str:
    """Compact admin alert with a deep link to the exact item."""
    body = "".join(
        f'<p style="margin:0 0 10px 0; font-size:14px; line-height:1.55; color:#0f172a;">{l}</p>'
        for l in lines
    )
    return f"""<!DOCTYPE html><html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:4px 12px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
      <tr><td style="background:#1F3F5B; color:#ffffff; padding:22px 26px;">
        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Sail More Now &middot; Admin</div>
        <div style="font-size:20px; font-weight:800; margin-top:6px;">{title}</div>
      </td></tr>
      <tr><td style="padding:22px 26px;">
        {body}
        <a href="{action_url}" style="display:inline-block; margin-top:8px; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">{action_label}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def contact_message_email_html(*, name: str, email: str, subject: str, message: str,
                               action_url: str, source_label: str = "Contact form") -> str:
    """One branded email for a contact / support submission: sender, subject,
    full message text and an Open-in-admin button. Reply-To is set by the caller
    to the sender, so a reply goes straight back to the member."""
    import html as _html
    name_s = _html.escape(name or "Someone")
    email_s = _html.escape(email or "")
    subj_s = _html.escape(subject or source_label)
    safe_msg = _html.escape(message or "").replace("\n", "<br>")
    return f"""<!DOCTYPE html><html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:4px 12px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
      <tr><td style="background:#1F3F5B; color:#ffffff; padding:22px 26px;">
        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Sail More Now &middot; {source_label}</div>
        <div style="font-size:20px; font-weight:800; margin-top:6px;">{subj_s}</div>
      </td></tr>
      <tr><td style="padding:22px 26px;">
        <p style="margin:0 0 4px 0; font-size:14px; color:#475569;">From <b style="color:#0f172a;">{name_s}</b> &lt;<a href="mailto:{email_s}" style="color:#2A7871; text-decoration:none;">{email_s}</a>&gt;</p>
        <p style="margin:0 0 14px 0; font-size:12px; color:#94a3b8;">Reply to this email to answer {name_s} directly.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8fb; border-radius:10px;"><tr><td style="padding:14px 16px; font-size:14px; line-height:1.6; color:#0f172a;">{safe_msg}</td></tr></table>
        <a href="{action_url}" style="display:inline-block; margin-top:18px; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">Open in admin</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _billing_shell(*, eyebrow: str, title: str, body_html: str, cta_label: str = "", cta_url: str = "") -> str:
    btn = ""
    if cta_label and cta_url:
        btn = (f'<a href="{cta_url}" style="display:inline-block; margin-top:18px; background:#F2A03B; '
               f'color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; '
               f'border-radius:999px; font-size:14px;">{cta_label}</a>')
    return f"""<!DOCTYPE html><html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:4px 12px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
      <tr><td style="background:#1F3F5B; color:#ffffff; padding:22px 26px;">
        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Sail More Now &middot; {eyebrow}</div>
        <div style="font-size:20px; font-weight:800; margin-top:6px;">{title}</div>
      </td></tr>
      <tr><td style="padding:22px 26px; font-size:15px; line-height:1.65; color:#1f2937;">
        {body_html}{btn}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def billing_welcome_email_html(*, name: Optional[str], tier_label: str, renews_at: str) -> str:
    return _billing_shell(
        eyebrow="Membership", title=f"Welcome to {tier_label}!",
        body_html=(f"<p style='margin:0 0 12px 0;'>Hi {name or 'there'},</p>"
                   f"<p style='margin:0 0 12px 0;'>Your {tier_label} plan is active. "
                   f"It renews automatically on {renews_at}. You can manage or cancel anytime "
                   f"from Your plan.</p>"),
        cta_label="View your plan", cta_url=f"{app_public_url()}/my-plan")


def billing_payment_failed_email_html(*, name: Optional[str], tier_label: str, update_url: Optional[str]) -> str:
    return _billing_shell(
        eyebrow="Action needed", title="We couldn't take your payment",
        body_html=(f"<p style='margin:0 0 12px 0;'>Hi {name or 'there'},</p>"
                   f"<p style='margin:0 0 12px 0;'>We couldn't take your last payment, so your "
                   f"{tier_label} plan is at risk. Update your card to keep it. We'll keep trying "
                   f"for a few days, and your access stays on in the meantime.</p>"),
        cta_label="Update your card", cta_url=update_url or f"{app_public_url()}/my-plan")


def billing_trial_ending_email_html(*, name: Optional[str], tier_label: str, charge_date: str,
                                    price: str, is_promo: bool = False) -> str:
    period = "free period" if is_promo else "free trial"
    return _billing_shell(
        eyebrow="Free period" if is_promo else "Free trial",
        title=f"Your {period} ends soon",
        body_html=(f"<p style='margin:0 0 12px 0;'>Hi {name or 'there'},</p>"
                   f"<p style='margin:0 0 12px 0;'>Your Sail More Now {period} ends on {charge_date}. "
                   f"You'll be charged {price} for {tier_label} unless you choose a longer "
                   f"plan or cancel.</p>"
                   f"<p style='margin:0 0 12px 0;'>Want to save? On Your plan you can pick a 3, 6 or "
                   f"12-month plan (Boat Pro: 6 or 12 months) that starts on {charge_date}, with a "
                   f"built-in discount. The monthly plan is the default if you do nothing. Cancel "
                   f"before {charge_date} to avoid being charged.</p>"),
        cta_label="Choose your plan length", cta_url=f"{app_public_url()}/my-plan")


def crew_join_email_html(*, organizer_name: str, event_title: str, event_starts_at: str,
                         crew_name: str, positions: list, experience: Optional[str],
                         notes: Optional[str], can_email: bool, event_url: str) -> str:
    """Build a tidy HTML email announcing a new crew signup. Inline CSS only."""
    positions_html = " · ".join(positions) if positions else "Not specified"
    contact_line = ("They opted to share their email with organizers - reply to this message and we'll relay it."
                    if can_email else
                    "They opted to keep contact in-app only. Open Sail More Now to DM them.")
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Sail More Now &middot; Crew Bank</div>
          <div style="font-size:22px; font-weight:800; margin-top:6px;">New crew signup for your race</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 12px 0; font-size:15px;">Hi {organizer_name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.55;">
            <strong>{crew_name}</strong> just joined the crew pool for
            <strong>{event_title}</strong> ({fmt_event_pt(event_starts_at)}).
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8fb; border-radius:10px; padding:14px 16px; margin-bottom:16px;">
            <tr><td style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#55B3AD; font-weight:700;">Positions</td></tr>
            <tr><td style="font-size:14px; color:#0f172a; padding-top:4px;">{positions_html}</td></tr>
            {f'<tr><td style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#55B3AD; font-weight:700; padding-top:12px;">Experience</td></tr><tr><td style="font-size:14px; padding-top:4px;">{experience}</td></tr>' if experience else ''}
            {f'<tr><td style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#55B3AD; font-weight:700; padding-top:12px;">Note</td></tr><tr><td style="font-size:14px; padding-top:4px; font-style:italic; color:#475569;">&ldquo;{notes}&rdquo;</td></tr>' if notes else ''}
          </table>
          <p style="margin:0 0 16px 0; font-size:14px; color:#475569;">{contact_line}</p>
          <a href="{event_url}" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">View event on Sail More Now</a>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because you organized this event on Sail More Now.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()

def event_blast_email_html(*, organizer_name: str, event_title: str, event_starts_at: str,
                           subject: str, message: str, event_url: str) -> str:
    """Organizer → attendees announcement (check-in details, weather call, etc.)."""
    safe = (message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
    return f"""
<!DOCTYPE html><html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
      <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Sail More Now &middot; Event update</div>
        <div style="font-size:22px; font-weight:800; margin-top:6px;">{subject}</div>
        <div style="font-size:13px; color:#cbd5e1; margin-top:4px;">{event_title} &middot; {fmt_event_pt(event_starts_at)}</div>
      </td></tr>
      <tr><td style="padding:24px 28px;">
        <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">{safe}</p>
        <p style="margin:0 0 16px 0; font-size:13px; color:#64748b;">- {organizer_name or 'The organizer'}</p>
        <a href="{event_url}" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">View event</a>
      </td></tr>
      <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
        You're getting this because you RSVP'd or joined the Crew Bank for this event on Sail More Now.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>""".strip()




def review_reminder_email_html(*, recipient_name: str, other_name: str,
                               relationship: str, days_left: int,
                               reviews_url: str) -> str:
    """Day 3 / day 6 nudge email for a pending mutual review. No ratings or
    comment text is ever included."""
    rel = "Boat Pro review" if relationship == "customer_pro" else "review"
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Sail More Now &middot; Mutual review</div>
          <div style="font-size:22px; font-weight:800; margin-top:6px;">Review {other_name} before it reveals</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 12px 0; font-size:15px;">Hi {recipient_name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.55;">
            You have about <strong>{days_left} days</strong> left to review <strong>{other_name}</strong>
            on your {rel}. It stays private until you review them back or the 7-day window ends,
            whichever comes first.
          </p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.55; color:#475569;">
            It takes about 30 seconds. Five one-tap ratings and an optional note.
          </p>
          <a href="{reviews_url}" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">Review them now</a>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because a mutual review is pending on Sail More Now.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


def dispute_notice_email_html(*, recipient_name: str, body: str, heading: str = "About a review",
                              app_url: str = "", details_path: str = "/reviews?tab=disputes",
                              coc_url: Optional[str] = None) -> str:
    """Generic review-dispute email (filed + decided). Uses the approved body
    text verbatim. No review text and no filer details are ever included."""
    coc = ""
    if coc_url:
        coc = (f"<p style=\"margin:16px 0 0 0; font-size:12px; color:#94a3b8;\">"
               f"Reviews follow our <a href=\"{coc_url}\" style=\"color:#2A7871;\">Code of Conduct</a>.</p>")
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Sail More Now &middot; Review</div>
          <div style="font-size:22px; font-weight:800; margin-top:6px;">{heading}</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 12px 0; font-size:15px;">Hi {recipient_name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.55;">{body}</p>
          <a href="{app_url}{details_path}" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">See the details</a>
          {coc}
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because of a review on Sail More Now.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


def dispute_decision_email_html(*, recipient_name: str, outcome: str,
                                removed_reason: Optional[str] = None, app_url: str = "",
                                details_path: str = "/my-disputes", coc_url: Optional[str] = None) -> str:
    """Neutral decision email for a review dispute. No review text is included."""
    extra = ""
    if removed_reason:
        extra = (f"<p style=\"margin:0 0 16px 0; font-size:15px; line-height:1.55; color:#475569;\">"
                 f"Reason: {removed_reason}</p>")
    coc = ""
    if coc_url:
        coc = (f"<p style=\"margin:16px 0 0 0; font-size:12px; color:#94a3b8;\">"
               f"Reviews follow our <a href=\"{coc_url}\" style=\"color:#2A7871;\">Code of Conduct</a>.</p>")
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Sail More Now &middot; Review dispute</div>
          <div style="font-size:22px; font-weight:800; margin-top:6px;">A decision was made</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 12px 0; font-size:15px;">Hi {recipient_name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.55;">
            We finished looking at a review you're involved in. <strong>{outcome}.</strong>
          </p>
          {extra}
          <a href="{app_url}{details_path}" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">See the details</a>
          {coc}
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because of a review dispute on Sail More Now.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()




def mention_email_html(*, mentioner_name: str, snippet: str, app_url: str) -> str:
    """Email fallback when a mentioned member has no push subscription."""
    snippet_clean = (snippet or "").replace("<", "&lt;")[:400]
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:22px 26px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">You were mentioned</div>
          <div style="font-size:20px; font-weight:800; margin-top:6px;">{mentioner_name} tagged you on Sail More Now</div>
        </td></tr>
        <tr><td style="padding:22px 26px;">
          <p style="margin:0 0 12px 0; font-size:14px; color:#475569;">"{snippet_clean}"</p>
          <a href="{app_url}/feed" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">Open the thread</a>
          <p style="margin:20px 0 0 0; font-size:12px; color:#94a3b8;">You're getting this because browser push isn't enabled on your account. Turn it on in Profile → Push preferences to get instant alerts instead.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()



def category_review_email_html(flagged: List[Dict[str, Any]]) -> str:
    """Admin alert: scraped events whose category couldn't be auto-detected."""
    rows = ""
    for e in flagged[:25]:
        rows += (
            f"<tr><td style='padding:10px 0; border-bottom:1px solid #f1f5f9;'>"
            f"<div style='font-size:13px; font-weight:600; color:#1F3F5B;'>{(e.get('title') or '').replace('<', '&lt;')[:120]}</div>"
            f"<div style='font-size:11px; color:#64748b; margin-top:2px;'>{fmt_event_pt(e.get('starts_at'))} · {e.get('market') or ''}"
            f"{' · via ' + e['source_label'] if e.get('source_label') else ''} · guessed: <b>{e.get('category') or 'other'}</b></div></td></tr>"
        )
    more = f"<p style='font-size:12px; color:#64748b;'>…and {len(flagged) - 25} more.</p>" if len(flagged) > 25 else ""
    return f"""
<!DOCTYPE html><html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
      <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Sail More Now &middot; Events</div>
        <div style="font-size:22px; font-weight:800; margin-top:6px;">{len(flagged)} event{'s' if len(flagged) != 1 else ''} need a category</div>
      </td></tr>
      <tr><td style="padding:24px 28px;">
        <p style="margin:0 0 8px 0; font-size:15px;">The feed sync imported events we couldn't confidently categorize. Set them so they show up under the right filter.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">{rows}</table>{more}
        <a href="{app_public_url()}/admin/events" style="display:inline-block; margin-top:20px; background:#F2A03B; color:#fff; text-decoration:none; font-weight:700; padding:12px 20px; border-radius:999px;">Review in admin</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""



def import_contact_digest_email_html(*, events: List[Dict[str, Any]], app_url: str) -> str:
    """Weekly admin digest of imported events still missing organizer / RSVP contact."""
    rows = "".join(
        f"<tr><td style='padding:6px 10px;border-bottom:1px solid #eee'>{(e.get('title') or 'Untitled').replace('<','&lt;')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;color:#64748b'>{fmt_event_pt(e.get('starts_at'))}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;color:#64748b'>{(e.get('market') or '')}</td></tr>"
        for e in events[:50]
    )
    n = len(events)
    return (
        f"<div style='font-family:system-ui,sans-serif;max-width:640px'>"
        f"<h2 style='color:#1F3F5B'>{n} imported event{'s' if n != 1 else ''} need an organizer or RSVP contact</h2>"
        f"<p style='color:#475569'>Add contact details so members can RSVP - fix them fast with "
        f"<b>Select missing contact</b> on the Admin Events page.</p>"
        f"<table style='border-collapse:collapse;width:100%;font-size:14px'>"
        f"<tr><th style='text-align:left;padding:6px 10px;color:#94a3b8;font-size:11px;text-transform:uppercase'>Event</th>"
        f"<th style='text-align:left;padding:6px 10px;color:#94a3b8;font-size:11px;text-transform:uppercase'>Date</th>"
        f"<th style='text-align:left;padding:6px 10px;color:#94a3b8;font-size:11px;text-transform:uppercase'>Market</th></tr>{rows}</table>"
        f"<p style='margin-top:18px'><a href='{app_url}/admin/events' style='background:#F2A03B;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700'>Fix imported events</a></p>"
        f"</div>"
    )



def report_digest_email_html(*, new_count: int, resolved_count: int, dismissed_count: int,
                             open_total: int, oldest_open: Optional[Dict[str, Any]],
                             recent_open: List[Dict[str, Any]], app_url: str) -> str:
    """Monday admin summary email of last week's report queue activity."""
    oldest_line = ""
    if oldest_open:
        oldest_line = (
            f"<div style='margin-top:12px; font-size:13px; color:#b91c1c;'>"
            f"Oldest still-open report is from {(oldest_open.get('created_at') or '')[:10]} - "
            f"<i>{(oldest_open.get('reason') or '').replace('<', '&lt;')[:120]}</i></div>"
        )
    rows_html = ""
    for r in recent_open[:5]:
        rows_html += (
            f"<tr><td style='padding:10px 0; border-bottom:1px solid #f1f5f9;'>"
            f"<div style='font-size:13px; font-weight:600; color:#1F3F5B;'>"
            f"{(r.get('target_type') or '').title()} · {(r.get('reason') or '').replace('<', '&lt;')[:120]}</div>"
            f"<div style='font-size:11px; color:#64748b; margin-top:2px;'>"
            f"reported by {r.get('reporter_name') or 'a member'} on {(r.get('created_at') or '')[:10]}</div>"
            f"</td></tr>"
        )
    if not rows_html:
        rows_html = ("<tr><td style='padding:10px 0; font-size:13px; color:#94a3b8;'>"
                     "No open reports right now.</td></tr>")
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Sail More Now &middot; Moderation</div>
          <div style="font-size:22px; font-weight:800; margin-top:6px;">Reports queue - weekly digest</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 8px 0; font-size:15px;">Hi moderator - here's the last week's activity in the reports queue.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px; margin-bottom:16px;">
            <tr>
              <td style="width:33%; padding:14px; background:#fee2e2; border-radius:12px; text-align:center;">
                <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#991b1b; font-weight:700;">New</div>
                <div style="font-size:28px; font-weight:800; color:#991b1b; margin-top:4px;">{new_count}</div>
              </td>
              <td style="width:4px;"></td>
              <td style="width:33%; padding:14px; background:#dcfce7; border-radius:12px; text-align:center;">
                <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#166534; font-weight:700;">Resolved</div>
                <div style="font-size:28px; font-weight:800; color:#166534; margin-top:4px;">{resolved_count}</div>
              </td>
              <td style="width:4px;"></td>
              <td style="width:33%; padding:14px; background:#f1f5f9; border-radius:12px; text-align:center;">
                <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#475569; font-weight:700;">Dismissed</div>
                <div style="font-size:28px; font-weight:800; color:#475569; margin-top:4px;">{dismissed_count}</div>
              </td>
            </tr>
          </table>
          <div style="font-size:13px; color:#475569;">
            <b>{open_total}</b> report{('' if open_total == 1 else 's')} still open in the queue.
          </div>
          {oldest_line}
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#F2A03B; font-weight:700; margin-top:20px;">Latest open reports</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            {rows_html}
          </table>
          <div style="margin-top:24px;">
            <a href="{app_url}/admin/reports" style="display:inline-block; background:#55B3AD; color:#1F3F5B; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">Open reports queue</a>
          </div>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because your account is a Sail More Now moderator. This digest sends every Monday morning.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def community_partner_welcome_email_html(*, org_name: str, founding: bool, app_url: str) -> str:
    """Welcome email sent the moment an admin activates a Community Partner.
    `founding` renders the gold Founding Partner call-out (first 5 partners)."""
    badge = (
        '<div style="display:inline-block; background:#F2A03B; color:#ffffff; font-size:11px; '
        'font-weight:800; letter-spacing:1.5px; text-transform:uppercase; padding:6px 14px; '
        'border-radius:999px;">★ Founding Partner</div>'
        if founding else
        '<div style="display:inline-block; background:#55B3AD; color:#ffffff; font-size:11px; '
        'font-weight:800; letter-spacing:1.5px; text-transform:uppercase; padding:6px 14px; '
        'border-radius:999px;">Community Partner</div>'
    )
    founding_line = (
        '<p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#0f172a;">'
        'You&rsquo;re one of our <strong>first five Founding Partners</strong> - you&rsquo;ll carry a '
        'distinct gold badge across your listing, events and posts as a thank-you for helping us launch.</p>'
        if founding else ""
    )
    perks = [
        "Direct messaging with owners, sailors &amp; pros",
        "An enhanced organization profile",
        "Unlimited calendar event posts",
        "Post &amp; respond across forums and feeds",
        "Build a following of potential members",
    ]
    perk_rows = "".join(
        f'<tr><td style="padding:7px 0; font-size:14px; color:#0f172a;">'
        f'<span style="color:#55B3AD; font-weight:800;">✓</span>&nbsp;&nbsp;{p}</td></tr>'
        for p in perks
    )
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td align="center" style="background:#ffffff; padding:18px 28px 14px 28px; text-align:center;">
          <img src="{email_logo_url()}" width="100" height="100" alt="Sail More Now" style="display:inline-block; width:100px; height:100px;" />
        </td></tr>
        <tr><td style="background:#1F3F5B; padding:24px 28px 22px 28px; text-align:center;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Welcome aboard</div>
          <div style="font-size:23px; font-weight:800; color:#ffffff; margin-top:6px;">You&rsquo;re a Community Partner</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <div style="text-align:center; margin-bottom:18px;">{badge}</div>
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.6;">Hi {org_name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
            Your <strong>Community Partner</strong> tier is now active on Sail More Now. Thank you for helping
            new sailors find their place on the water - here&rsquo;s everything that&rsquo;s now unlocked for your organization:
          </p>
          {founding_line}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8fb; border-radius:12px; padding:8px 16px; margin:4px 0 20px 0;">
            {perk_rows}
          </table>
          <div style="text-align:center;">
            <a href="{app_url}/dashboard" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:13px 26px; border-radius:999px; font-size:14px;">Open your dashboard</a>
          </div>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You&rsquo;re getting this because an admin activated your Community Partner tier on Sail More Now.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


def _welcome_salutation(account_type: Optional[str], first_name: Optional[str],
                        company_name: Optional[str], org_name: Optional[str],
                        display_name: Optional[str] = None) -> str:
    """Pick the greeting name by role: person's first name for Sailor/Boat Owner,
    business/organization name for Boat Pro/Organization."""
    at = (account_type or "").lower()
    fn = (first_name or "").strip()
    co = (company_name or "").strip()
    org = (org_name or "").strip()
    dn = (display_name or "").strip()
    if at == "boat_pro":
        return co or dn or fn or "there"
    if at in ("partner", "organization", "community_partner", "club", "org"):
        return org or dn or co or fn or "there"
    # sailor, boat_owner, crew, and any default
    return fn or dn or "there"


def welcome_member_email_html(*, account_type: Optional[str] = None,
                              first_name: Optional[str] = None,
                              company_name: Optional[str] = None,
                              org_name: Optional[str] = None,
                              display_name: Optional[str] = None,
                              app_url: str = "https://app.sailmorenow.com") -> str:
    """Role-specific welcome email. Loads one of four authored HTML templates by
    account_type and substitutes placeholders (all HTML-escaped). Store buttons are
    dropped cleanly when their env URL is empty (both empty -> the whole row goes)."""
    import os as _os, re as _re, html as _html
    at = (account_type or "").lower()
    if at == "boat_pro":
        tpl = "welcome-boat-pro.html"
    elif at in ("partner", "organization", "community_partner", "club", "org"):
        tpl = "welcome-club-org.html"
    elif at == "boat_owner":
        tpl = "welcome-boat-owner.html"
    else:
        tpl = "welcome-sailor.html"
    path = _os.path.join(_os.path.dirname(__file__), "email_templates", tpl)
    with open(path, encoding="utf-8") as fh:
        html = fh.read()

    name = _welcome_salutation(account_type, first_name, company_name, org_name, display_name)
    org = (org_name or "").strip() or (display_name or "").strip() or (company_name or "").strip() or (first_name or "").strip() or "your organization"
    base = app_public_url()
    esc = lambda v: _html.escape(v or "", quote=True)

    store = _os.environ.get("APP_STORE_URL", "").strip()
    play = _os.environ.get("GOOGLE_PLAY_URL", "").strip()

    def strip_between(h, a, b):
        return _re.sub(_re.escape(a) + r".*?" + _re.escape(b), "", h, flags=_re.S)

    if not store and not play:
        html = strip_between(html, "<!--STORE_ROW_START-->", "<!--STORE_ROW_END-->")
    else:
        if not store:
            html = strip_between(html, "<!--APP_BTN_START-->", "<!--APP_BTN_END-->")
        if not play:
            html = strip_between(html, "<!--PLAY_BTN_START-->", "<!--PLAY_BTN_END-->")

    html = html.replace("{{first_name}}", esc(name))
    html = html.replace("{{org_name}}", esc(org))
    html = html.replace("{{LOGO_URL}}", esc(email_logo_url()))
    html = html.replace("{{FAQ_URL}}", esc(f"{base}/faq"))
    html = html.replace("{{APP_STORE_URL}}", esc(store))
    html = html.replace("{{GOOGLE_PLAY_URL}}", esc(play))

    # remove any leftover sentinel comments
    html = _re.sub(r"<!--(?:STORE_ROW|APP_BTN|PLAY_BTN)_(?:START|END)-->", "", html)
    return html

def locked_message_email_html(*, recipient_name: str, sender_name: str, app_url: str) -> str:
    """Sent to a free-tier member when a paid member messages them. The message
    is saved and unlocks the moment they upgrade. Throttled to once / 24h."""
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td align="center" style="background:#ffffff; padding:18px 28px 14px 28px; text-align:center;">
          <img src="{email_logo_url()}" width="100" height="100" alt="Sail More Now" style="display:inline-block; width:100px; height:100px;" />
        </td></tr>
        <tr><td style="background:#1F3F5B; padding:22px 28px 20px 28px; text-align:center;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">New message waiting</div>
          <div style="font-size:22px; font-weight:800; color:#ffffff; margin-top:6px;">You have a new message</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.6;">Hi {recipient_name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
            <b>{sender_name}</b> sent you a message on Sail More Now. It's saved and waiting -
            upgrade your membership to read it and reply.
          </p>
          <div style="text-align:center; margin:22px 0 6px 0;">
            <a href="{app_url}/pricing" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:13px 28px; border-radius:999px; font-size:14px;">Upgrade to read &amp; reply</a>
          </div>
          <p style="margin:12px 0 0 0; font-size:13px; color:#94a3b8; text-align:center;">Your message unlocks the moment you upgrade.</p>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because someone messaged you on Sail More Now.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


def winback_email_html(*, name: str, app_url: str) -> str:
    """Sent once when a member's paid subscription lapses - friendly nudge back
    with a one-tap resubscribe button."""
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td align="center" style="background:#ffffff; padding:18px 28px 14px 28px; text-align:center;">
          <img src="{email_logo_url()}" width="100" height="100" alt="Sail More Now" style="display:inline-block; width:100px; height:100px;" />
        </td></tr>
        <tr><td style="background:#1F3F5B; padding:22px 28px 20px 28px; text-align:center;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">We miss you on the water</div>
          <div style="font-size:22px; font-weight:800; color:#ffffff; margin-top:6px;">Your membership has lapsed</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.6;">Hi {name or 'there'},</p>
          <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
            Your Premium features are paused - direct messaging, posting &amp; reactions, reviews, and your
            Crew Bank listing are switched off for now. Pick up right where you left off any time.
          </p>
          <div style="text-align:center; margin:22px 0 6px 0;">
            <a href="{app_url}/pricing" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:13px 28px; border-radius:999px; font-size:14px;">Resubscribe in a tap</a>
          </div>
          <p style="margin:12px 0 0 0; font-size:13px; color:#94a3b8; text-align:center;">You can keep browsing for free - upgrade whenever you're ready.</p>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this because your Sail More Now subscription recently ended.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


def community_digest_email_html(*, recipient_name: str, markets: List[Dict[str, Any]],
                                app_url: str, saved: Optional[List[Dict[str, Any]]] = None,
                                reviews: Optional[Dict[str, Any]] = None) -> str:
    """Sunday-morning digest email covering one or more markets the user follows.

    `markets` is a list of `{market, new_crew, new_events, new_comments}` dicts.
    Empty markets are dropped by the caller. Header labels reflect either the
    single market or "your markets" when multiple are included.
    """
    market_names = [m["market"] for m in markets]
    header_label = market_names[0] if len(market_names) == 1 else "Your markets"

    sections_html = ""
    for m in markets:
        crew_rows = ""
        for c in (m.get("new_crew") or [])[:5]:
            positions = " · ".join((c.get("positions") or [])[:4]) or "Not specified"
            crew_rows += f"""
            <tr><td style='padding:10px 0; border-bottom:1px solid #f1f5f9;'>
              <div style='font-size:14px; font-weight:600; color:#1F3F5B;'>{c.get('user_name') or 'Sailor'}</div>
              <div style='font-size:12px; color:#64748b; margin-top:2px;'>{positions}</div>
            </td></tr>"""
        if not crew_rows:
            crew_rows = ("<tr><td style='padding:10px 0; font-size:13px; color:#94a3b8;'>"
                         "No new sailors listed this week.</td></tr>")

        event_rows = ""
        for e in (m.get("new_events") or [])[:5]:
            starts = fmt_event_pt(e.get("starts_at"))
            event_rows += f"""
            <tr><td style='padding:10px 0; border-bottom:1px solid #f1f5f9;'>
              <div style='font-size:14px; font-weight:600; color:#1F3F5B;'>{e.get('title')}</div>
              <div style='font-size:12px; color:#64748b; margin-top:2px;'>{starts} &middot; {e.get('location') or e.get('market') or ''}</div>
            </td></tr>"""
        if not event_rows:
            event_rows = ("<tr><td style='padding:10px 0; font-size:13px; color:#94a3b8;'>"
                          "No new events on the calendar this week.</td></tr>")

        sections_html += f"""
        <div style="margin-top:24px; padding-top:16px; border-top:2px solid #f1f5f9;">
          <div style="font-size:12px; font-weight:800; color:#1F3F5B; letter-spacing:1px; text-transform:uppercase;">{m['market']}</div>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#F2A03B; font-weight:700; margin-top:10px;">New sailors ready for a boat</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; margin-bottom:14px;">
            {crew_rows}
          </table>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#F2A03B; font-weight:700;">Fresh events this week</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; margin-bottom:14px;">
            {event_rows}
          </table>
          <div style="font-size:13px; color:#475569;">
            {m.get('new_comments', 0)} new comment{('' if m.get('new_comments', 0) == 1 else 's')} across the {m['market']} feed this week.
          </div>
        </div>"""

    footer_market_label = ", ".join(market_names) if market_names else "your area"
    # Reviews section - pending (awaiting this person's accept/reject) first, then
    # reviews about them that went live in the last 7 days. Omitted when empty.
    reviews_html = ""
    _rev = reviews or {}
    _pending = _rev.get("pending") or []
    _recent = _rev.get("recent_live") or []
    if _pending or _recent:
        def _rel_label(rel):
            return {"customer_pro": "Boat Pro review", "owner_crew": "Skipper / Crew review",
                    "organization": "Organization review"}.get(rel, "Review")
        pending_rows = ""
        for p in _pending[:8]:
            pending_rows += f"""
            <tr><td style='padding:10px 0; border-bottom:1px solid #f1f5f9;'>
              <div style='font-size:14px; font-weight:600; color:#1F3F5B;'>{(p.get('reviewer_name') or 'Someone')} left you a review</div>
              <div style='font-size:12px; color:#64748b; margin-top:2px;'>{_rel_label(p.get('relationship'))} · review back to reveal both now, or it reveals after 7 days.</div>
            </td></tr>"""
        pending_block = ""
        if pending_rows:
            pending_block = f"""
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#F2A03B; font-weight:700;">Waiting on you</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; margin-bottom:14px;">{pending_rows}</table>"""
        recent_rows = ""
        for r in _recent[:8]:
            ov = r.get("overall")
            stars = f" · {ov}/5" if isinstance(ov, (int, float)) else ""
            recent_rows += f"""
            <tr><td style='padding:10px 0; border-bottom:1px solid #f1f5f9;'>
              <div style='font-size:14px; font-weight:600; color:#1F3F5B;'>{(r.get('author_name') or 'A member')} reviewed you{stars}</div>
              <div style='font-size:12px; color:#64748b; margin-top:2px;'>{_rel_label(r.get('relationship'))} · now live</div>
            </td></tr>"""
        recent_block = ""
        if recent_rows:
            recent_block = f"""
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#F2A03B; font-weight:700;">Went live this week</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; margin-bottom:6px;">{recent_rows}</table>"""
        reviews_html = f"""
        <div style="margin-top:8px; margin-bottom:4px; padding-bottom:16px; border-bottom:2px solid #f1f5f9;">
          <div style="font-size:13px; font-weight:800; color:#1F3F5B; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Reviews</div>
          {pending_block}
          {recent_block}
          <div style="margin-top:12px;">
            <a href="{app_url}/reviews" style="display:inline-block; background:#55B3AD; color:#1F3F5B; text-decoration:none; font-weight:700; padding:10px 20px; border-radius:999px; font-size:13px;">Review &amp; respond</a>
          </div>
        </div>"""
    saved_html = ""
    if saved:
        saved_rows = ""
        for s in saved[:8]:
            _href = f"{app_url}{s.get('url') or '/community'}"
            saved_rows += f"""
            <tr><td style='padding:9px 0; border-bottom:1px solid #f1f5f9;'>
              <span style='font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#55B3AD;'>{s.get('label') or 'Saved'}</span>
              <div style='font-size:14px; font-weight:600; margin-top:2px;'><a href='{_href}' style='color:#1F3F5B; text-decoration:none;'>{s.get('title')}</a></div>
            </td></tr>"""
        saved_html = f"""
        <div style="margin-top:8px; margin-bottom:4px;">
          <div style="font-size:13px; font-weight:800; color:#1F3F5B; text-transform:uppercase; letter-spacing:1px;">Your saved items</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            {saved_rows}
          </table>
        </div>"""
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <tr><td style="background:#1F3F5B; color:#ffffff; padding:24px 28px;">
          <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#55B3AD; font-weight:700;">Sunday Digest &middot; {header_label}</div>
          <div style="font-size:22px; font-weight:800; margin-top:6px;">Your week on the water</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 4px 0; font-size:15px;">Hi {recipient_name or 'sailor'}, here's what happened this week{"" if not market_names else " across " + (market_names[0] if len(market_names)==1 else "the markets you follow")}.</p>
          {reviews_html}
          {sections_html}
          {saved_html}
          <div style="margin-top:24px;">
            <a href="{app_url}" style="display:inline-block; background:#F2A03B; color:#ffffff; text-decoration:none; font-weight:700; padding:12px 22px; border-radius:999px; font-size:14px;">Open Sail More Now</a>
          </div>
        </td></tr>
        <tr><td style="background:#f7fafc; color:#94a3b8; font-size:11px; padding:16px 28px; text-align:center;">
          You're getting this weekly digest because your Sail More Now profile has newsletter opt-in enabled for {footer_market_label}. Update preferences in your profile.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()



def app_public_url() -> str:
    """Single source of truth for the base URL used in email links (reset link,
    etc.). Driven by the APP_PUBLIC_URL env var; change it there when the real
    domain goes live. Not hardcoded to any one domain."""
    return (os.environ.get("APP_PUBLIC_URL") or "https://app.sailmorenow.com").rstrip("/")


def fmt_event_pt(iso, with_time: bool = True, time_not_listed=None) -> str:
    """Format an event timestamp in Pacific time (America/Los_Angeles, DST-aware)
    with a 'PT' label. Events with no listed time show the date only, no shift.
    `time_not_listed` is the authoritative stored flag; when absent we fall back
    to the legacy midnight-UTC sentinel."""
    if not iso:
        return ""
    s = str(iso)
    from datetime import date, datetime, timezone as _tz
    from date_utils import event_no_time
    if event_no_time(s, time_not_listed):
        try:
            d = date.fromisoformat(s[:10])
            return d.strftime("%a, %b ") + str(d.day) + d.strftime(", %Y") + " · Time not listed, see details"
        except Exception:
            return s[:10]
    try:
        from zoneinfo import ZoneInfo
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_tz.utc)
        pt = dt.astimezone(ZoneInfo("America/Los_Angeles"))
        tail = ", %Y, %-I:%M %p PT" if with_time else ", %Y"
        return pt.strftime("%a, %b ") + str(pt.day) + pt.strftime(tail)
    except Exception:
        return s[:10]


def email_logo_url() -> str:
    """Absolute https URL for the email logo, served from the app's own public
    assets (frontend/public/smn-email-logo.png) via APP_PUBLIC_URL. Override with
    EMAIL_LOGO_URL if ever needed. No longer depends on WordPress."""
    return (os.environ.get("EMAIL_LOGO_URL") or "").strip() or \
        f"{app_public_url()}/smn-email-logo.png"


def verification_email_html(*, name: str, verify_url: str, hours: int = 24) -> str:
    """Email-verification link. Link stays valid 7 days (longer than the 24h lock
    window) so a locked person can still finish. No forms or inputs (email G2)."""
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0; padding:0; background-color:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc; padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <!--SMN_HEADER_DONE-->
        <tr><td bgcolor="#1F3F5B" style="background-color:#1F3F5B; padding:22px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="vertical-align:middle;">
              <div style="font-size:22px; font-weight:800; color:#ffffff; margin:0;">Verify your email address</div>
            </td>
            <td valign="middle" width="56" align="right" style="vertical-align:middle; width:56px; text-align:right; padding-left:14px;">
              <img src="{email_logo_url()}" width="56" height="56" alt="Sail More Now" style="display:block; width:56px; height:56px; margin-left:auto;" />
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#ffffff; padding:22px 32px 28px 32px;">
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.65; color:#1f2937;">Hi {name or 'there'},</p>
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.65; color:#1f2937;">
            Thanks for joining Sail More Now. Please confirm this is your email so you keep full access to your account. Verify within {hours} hours to avoid any interruption.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 22px 0;"><tr><td align="center">
            <a href="{verify_url}" bgcolor="#55B3AD" style="display:inline-block; background:#55B3AD; background-color:#55B3AD; color:#1F3F5B; text-decoration:none; font-weight:800; padding:14px 30px; border-radius:999px; font-size:15px;">Verify my email</a>
          </td></tr></table>
          <p style="margin:0 0 14px 0; font-size:14px; line-height:1.6; color:#475569;">
            This link works for 7 days and can be opened on any device. If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="margin:0 0 18px 0; font-size:13px; line-height:1.5; color:#1F3F5B; word-break:break-all;">{verify_url}</p>
          <p style="margin:0; font-size:14px; line-height:1.6; color:#475569;">If you did not create this account, you can ignore this email.</p>
        </td></tr>
        <tr><td style="background-color:#1F3F5B; padding:18px 28px; text-align:center;">
          <div style="color:#cbd5e1; font-size:11px; line-height:1.5;">Sail More Now &middot; Pacific Northwest sailing community</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()



def password_reset_email_html(*, name: str, reset_url: str, app_url: str) -> str:
    """Reset-link email. Same navy/teal/orange palette and round logo as welcome."""
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0; padding:0; background-color:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc; padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <!--SMN_HEADER_DONE-->
        <tr><td bgcolor="#1F3F5B" style="background-color:#1F3F5B; padding:22px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="vertical-align:middle;">
              <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Password reset</div>
              <div style="font-size:22px; font-weight:800; color:#ffffff; margin-top:6px;">Reset your password</div>
            </td>
            <td valign="middle" width="56" align="right" style="vertical-align:middle; width:56px; text-align:right; padding-left:14px;">
              <img src="{email_logo_url()}" width="56" height="56" alt="Sail More Now" style="display:block; width:56px; height:56px; margin-left:auto;" />
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#ffffff; padding:22px 32px 28px 32px;">
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.65; color:#1f2937;">Hi {name or 'there'},</p>
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.65; color:#1f2937;">
            We got a request to reset the password on your Sail More Now account. Tap the button below to choose a new password.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 22px 0;"><tr><td align="center">
            <a href="{reset_url}" style="display:inline-block; background-color:#F2A03B; color:#10233A; text-decoration:none; font-weight:800; padding:14px 30px; border-radius:999px; font-size:15px;">Reset your password</a>
          </td></tr></table>
          <p style="margin:0 0 14px 0; font-size:14px; line-height:1.6; color:#475569;">
            This link works for 60 minutes and can be used once. If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="margin:0 0 18px 0; font-size:13px; line-height:1.5; color:#1F3F5B; word-break:break-all;">{reset_url}</p>
          <p style="margin:0; font-size:14px; line-height:1.6; color:#475569;">If you did not ask for this, you can ignore this email. Your password stays the same.</p>
        </td></tr>
        <tr><td style="background-color:#1F3F5B; padding:18px 28px; text-align:center;">
          <div style="color:#cbd5e1; font-size:11px; line-height:1.5;">Sail More Now &middot; Pacific Northwest sailing community</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


def password_reset_google_email_html(*, name: str, app_url: str) -> str:
    """Sent when a Google-only account requests a password reset: no token, just
    a nudge to sign in with Google."""
    login_url = f"{app_url}/login"
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0; padding:0; background-color:#f7fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc; padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(15,23,42,0.08);">
        <!--SMN_HEADER_DONE-->
        <tr><td bgcolor="#1F3F5B" style="background-color:#1F3F5B; padding:22px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="vertical-align:middle;">
              <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#F2A03B; font-weight:700;">Password reset</div>
              <div style="font-size:22px; font-weight:800; color:#ffffff; margin-top:6px;">Use Continue with Google</div>
            </td>
            <td valign="middle" width="56" align="right" style="vertical-align:middle; width:56px; text-align:right; padding-left:14px;">
              <img src="{email_logo_url()}" width="56" height="56" alt="Sail More Now" style="display:block; width:56px; height:56px; margin-left:auto;" />
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#ffffff; padding:22px 32px 28px 32px;">
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.65; color:#1f2937;">Hi {name or 'there'},</p>
          <p style="margin:0 0 14px 0; font-size:15px; line-height:1.65; color:#1f2937;">
            We got a request to reset the password on your Sail More Now account. Your account was created with Google sign-in, so it does not have a password to reset. Just tap Continue with Google to sign in.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 22px 0;"><tr><td align="center">
            <a href="{login_url}" style="display:inline-block; background-color:#F2A03B; color:#10233A; text-decoration:none; font-weight:800; padding:14px 30px; border-radius:999px; font-size:15px;">Go to sign in</a>
          </td></tr></table>
          <p style="margin:0; font-size:14px; line-height:1.6; color:#475569;">If you did not ask for this, you can ignore this email.</p>
        </td></tr>
        <tr><td style="background-color:#1F3F5B; padding:18px 28px; text-align:center;">
          <div style="color:#cbd5e1; font-size:11px; line-height:1.5;">Sail More Now &middot; Pacific Northwest sailing community</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


import hmac as _hmac
import hashlib as _hashlib


def _unsub_key() -> bytes:
    # Server-only stable secret (never exposed). Derived from an env value.
    return (os.environ.get("MONGO_URL") or os.environ.get("DB_NAME") or "smn-unsub").encode()


def make_unsub_token(user_id: str) -> str:
    return _hmac.new(_unsub_key(), user_id.encode(), _hashlib.sha256).hexdigest()[:32]


def verify_unsub_token(user_id: str, token: str) -> bool:
    return _hmac.compare_digest(make_unsub_token(user_id), (token or ""))


def unsubscribe_url_for(user_id: str) -> str:
    return f"{app_public_url()}/api/email/unsubscribe?u={user_id}&t={make_unsub_token(user_id)}"
