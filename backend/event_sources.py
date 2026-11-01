"""Admin-managed event source registry + SSRF-safe ICS fetching.

`event_sources` collection is the single source of truth for which calendars the
aggregator reads. The three original code-defined sources are seeded here so
nothing changes on first boot. ICS feeds are admin-editable; the OWSA scraper is
code-based and shown read-only.
"""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, parse_qs, quote

import httpx

logger = logging.getLogger("smn.event_sources")

ICS_USER_AGENT = (
    "SailMoreNow-EventAggregator/1.0 (+https://sailmorenow.com; calendar sync)"
)
MAX_ICS_BYTES = 5 * 1024 * 1024  # 5 MB
FETCH_TIMEOUT = 10  # seconds
MAX_REDIRECTS = 3
ALLOWED_PORTS = {80, 443}

# Seed definitions mirror the original hard-coded aggregator.SOURCES exactly.
DEFAULT_SOURCES: List[Dict[str, Any]] = [
    {
        "key": "sarc-48north",
        "name": "48° North SARC (Seattle Area Racing Calendar)",
        "type": "ics",
        "url": "https://48north.com/?post_type=tribe_events&ical=1&eventDisplay=list&tribe_events_cat=sailboat-races",
        "default_market": None,
        "organizer_name": None,
        "source_label": "48° North SARC (Seattle Area Racing Calendar)",
        "prefer_curl": True,
        "enabled": True,
        "read_only": False,
    },
    {
        "key": "ocsa-sailpdx",
        "name": "OCSA / Sail Portland Racing Calendar",
        "type": "ics",
        "url": "https://calendar.google.com/calendar/ical/admin%40ocsaracebook.org/public/basic.ics",
        "default_market": "Portland/Vancouver",
        "organizer_name": None,
        "source_label": "OCSA / Sail Portland Racing Calendar",
        "prefer_curl": False,
        "enabled": True,
        "read_only": False,
    },
    {
        "key": "owsa",
        "name": "Oregon Women's Sailing Association",
        "type": "scraper",
        "url": "https://owsa.net/events",
        "default_market": "Portland/Vancouver",
        "organizer_name": "Oregon Women's Sailing Association",
        "source_label": "Oregon Women's Sailing Association",
        "prefer_curl": False,
        "enabled": True,
        "read_only": True,  # code-based custom scraper
    },
]


async def seed_default_sources(db) -> int:
    """Idempotently insert the 3 original sources if missing. Returns count added."""
    added = 0
    for s in DEFAULT_SOURCES:
        existing = await db.event_sources.find_one({"key": s["key"]})
        if existing:
            continue
        doc = {
            **s,
            "last_run_at": None,
            "last_status": None,
            "last_error": None,
            "last_fetched": 0,
            "last_inserted": 0,
            "last_updated": 0,
            "last_skipped": 0,
            "created_by": "system (seed)",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.event_sources.insert_one(doc)
        added += 1
    return added


# ---------- Google Calendar embed/share -> public ICS ----------

_GCAL_ID_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+$|^[A-Za-z0-9._%+\-]+@group\.calendar\.google\.com$")


def google_embed_to_ics(url: str) -> Optional[str]:
    """If `url` is a Google Calendar embed/share link with a src=<calendar id>,
    return the public ICS address. Otherwise None. The caller MUST show the
    converted address and have the admin confirm it (we never swap silently)."""
    try:
        p = urlparse(url)
    except Exception:
        return None
    host = (p.netloc or "").lower()
    if "calendar.google.com" not in host:
        return None
    # already an ICS export
    if "/calendar/ical/" in p.path and p.path.endswith("basic.ics"):
        return None
    qs = parse_qs(p.query)
    src = (qs.get("src") or [None])[0]
    if not src:
        return None
    src = src.strip()
    if not _GCAL_ID_RE.match(src):
        return None
    cid = quote(src, safe="")
    return f"https://calendar.google.com/calendar/ical/{cid}/public/basic.ics"


# ---------- SSRF-safe URL validation + fetch ----------

def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        or ip.is_multicast or ip.is_unspecified
        or (ip.version == 6 and ip.ipv4_mapped is not None and _is_blocked_ip(str(ip.ipv4_mapped)))
    )


def validate_ics_url(url: str) -> Tuple[bool, str]:
    """Validate an admin-supplied ICS URL against SSRF. Returns (ok, reason)."""
    try:
        p = urlparse(url)
    except Exception:
        return False, "Invalid URL."
    if p.scheme != "https":
        return False, "Only https addresses are allowed."
    if not p.hostname:
        return False, "Missing host."
    port = p.port or 443
    if port not in ALLOWED_PORTS:
        return False, "Only standard ports (80/443) are allowed."
    host = p.hostname.lower()
    if host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
        return False, "That host is not allowed."
    # Resolve every A/AAAA record and reject if any is private/loopback/link-local.
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except Exception:
        return False, "Could not resolve that host."
    if not infos:
        return False, "Could not resolve that host."
    for info in infos:
        ip = info[4][0]
        if _is_blocked_ip(ip):
            return False, "That address resolves to a private or local network and is blocked."
    return True, ""


async def safe_fetch_ics(url: str) -> str:
    """Fetch an ICS body with SSRF guards: https only, blocked-IP checks on EVERY
    hop, <=3 manual redirects, 10s timeout, 5 MB cap, polite UA."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        ok, reason = validate_ics_url(current)
        if not ok:
            raise ValueError(reason)
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False) as c:
            headers = {"User-Agent": ICS_USER_AGENT, "Accept": "text/calendar,*/*;q=0.5"}
            async with c.stream("GET", current, headers=headers) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    loc = r.headers.get("location")
                    if not loc:
                        raise ValueError("Redirect without a location.")
                    current = httpx.URL(current).join(loc).__str__()
                    continue
                if r.status_code != 200:
                    raise ValueError(f"Source returned HTTP {r.status_code}.")
                total = 0
                chunks: List[bytes] = []
                async for chunk in r.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_ICS_BYTES:
                        raise ValueError("Calendar file is too large (over 5 MB).")
                    chunks.append(chunk)
                return b"".join(chunks).decode("utf-8", errors="replace")
    raise ValueError("Too many redirects.")
