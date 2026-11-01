"""Community events auto-aggregator.

Fetches events from external PNW sailing sources (iCal feeds + HTML scrapers),
normalizes them, dedupes by (source_id, event_key), and writes into the
`events` collection with source metadata. Idempotent: re-running upserts.

Sources are configured below in SOURCES. Each source implements .fetch()
returning a list of normalized dicts. Errors on a single source do not affect
other sources.
"""
from __future__ import annotations
import asyncio
import hashlib
import logging
import re
import shutil
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

import httpx
from bs4 import BeautifulSoup
from icalendar import Calendar
from categorize import categorize

def _strip_html(text: str, max_len: int = 800) -> str:
    """Turn imported HTML descriptions into clean plain text.

    Aggregated sources (SYSCO, OWSA, SailPDX) sometimes embed anchor / <br>
    markup inside iCal DESCRIPTION fields. Render as text with reasonable
    whitespace and truncate.
    """
    if not text:
        return ""
    try:
        soup = BeautifulSoup(text, "html.parser")
        # Replace <br> with newlines before extracting text
        for br in soup.find_all(["br"]):
            br.replace_with("\n")
        # Anchors → "label (href)" so URLs survive
        for a in soup.find_all("a"):
            href = a.get("href") or ""
            label = a.get_text(" ", strip=True)
            if href and label and label.lower() != href.lower():
                a.replace_with(f"{label} ({href})")
            elif href:
                a.replace_with(href)
            else:
                a.replace_with(label)
        cleaned = soup.get_text("\n")
    except Exception:
        cleaned = text
    # Normalize whitespace
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip() + "…"
    return cleaned


def upcoming_event_predicate(now_iso: str,
                              starts_field: str = "starts_at",
                              ends_field: str = "ends_at") -> Dict[str, Any]:
    """Match events whose ends_at (or starts_at fallback) is >= now.
    Used by GET /api/events, GET /api/admin/events, and GET /api/crew-bank/open
    so all three views stay in lockstep. `starts_field`/`ends_field` let callers
    reuse the predicate on collections that denormalize the event dates under
    different keys (e.g. crew_bank stores `event_starts_at`)."""
    return {"$expr": {"$gte": [{"$ifNull": [f"${ends_field}", f"${starts_field}"]}, now_iso]}}


def past_event_predicate(now_iso: str) -> Dict[str, Any]:
    """Mongo filter for aggregator events whose end (or start, if no end) is in the past.

    Shared by server.admin_events_aggregate and scheduler._weekly_job so the two
    entry points cannot drift.
    """
    return {
        "source": "aggregator",
        "$expr": {"$lt": [{"$ifNull": ["$ends_at", "$starts_at"]}, now_iso]},
    }


logger = logging.getLogger("smn.aggregator")

_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://sailmorenow.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Upgrade-Insecure-Requests": "1",
}


_CURL = shutil.which("curl")


async def _fetch_text(url: str, prefer_curl: bool = False, timeout: int = 30) -> str:
    """Fetch a URL as text. Some hosts (e.g. Cloudflare-protected 48north.com)
    fingerprint TLS and block Python clients but allow curl's default TLS profile.
    prefer_curl=True shells out to curl first with fallback to httpx.
    """
    async def _try_curl() -> Optional[str]:
        if not _CURL:
            return None
        try:
            proc = await asyncio.create_subprocess_exec(
                _CURL, "-sSL", "--max-time", str(timeout), url,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            out, err = await proc.communicate()
            if proc.returncode == 0 and out:
                return out.decode("utf-8", errors="replace")
            logger.warning("curl fetch failed rc=%s err=%s", proc.returncode, err[:200])
        except Exception:
            logger.exception("curl fetch crashed")
        return None

    async def _try_httpx() -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as c:
                r = await c.get(url, headers=_BROWSER_HEADERS)
                if r.status_code == 200:
                    return r.text
                logger.warning("httpx got %s for %s", r.status_code, url)
        except Exception:
            logger.exception("httpx fetch crashed")
        return None

    tries = (_try_curl, _try_httpx) if prefer_curl else (_try_httpx, _try_curl)
    for fn in tries:
        text = await fn()
        if text:
            return text
    raise RuntimeError(f"All fetch strategies failed for {url}")

MARKETS = [
    "Portland/Vancouver", "Hood River", "Eugene", "Olympia", "Tacoma",
    "Greater Seattle", "Kirkland", "Everett", "Anacortes/San Juan Islands", "Bellingham",
]


def _hash_key(*parts: str) -> str:
    return hashlib.sha1("||".join(p or "" for p in parts).encode("utf-8")).hexdigest()[:16]


def _to_iso(dt) -> Optional[str]:
    """Return canonical UTC ISO-8601 (via `date_utils.normalize_iso`)."""
    from date_utils import normalize_iso
    return normalize_iso(dt)


def _market_from_text(*texts: str) -> str:
    """Best-effort geo-tag from location/title/description text."""
    blob = " ".join(t or "" for t in texts).lower()
    rules = [
        ("Portland/Vancouver", ["portland", "vancouver, wa", "columbia river", "pdx", "ocsa", "sysco", "pyc"]),
        ("Hood River", ["hood river", "gorge", "cgra"]),
        ("Eugene", ["eugene", "fern ridge"]),
        ("Olympia", ["olympia", "budd inlet", "oyc"]),
        ("Tacoma", ["tacoma", "commencement bay", "tyc", "day island"]),
        ("Kirkland", ["kirkland", "lake washington"]),
        ("Everett", ["everett", "port gardner"]),
        ("Anacortes/San Juan Islands", ["anacortes", "san juan", "roche harbor", "friday harbor", "sucia", "orcas"]),
        ("Bellingham", ["bellingham", "chuckanut", "byc"]),
        ("Greater Seattle", ["seattle", "shilshole", "puget sound", "elliott bay", "corinthian", "cyc", "syc"]),
    ]
    for market, kw in rules:
        if any(k in blob for k in kw):
            return market
    return "Greater Seattle"  # default fallback


# ---------- Sources ----------

# Imported events whose title signals a volunteer / race-committee duty are
# auto-flagged is_volunteer=True so members can sign up in-app and the signup
# routes to the linked club/org (when one is matched).
_VOLUNTEER_TITLE_RE = re.compile(
    r"\b(volunteer|work\s*party|race\s*committee|rc\s*duty|rc\s*boat|on\s*the\s*rc|committee\s*boat|signal\s*boat)\b",
    re.IGNORECASE,
)


def _is_volunteer_title(title: str) -> bool:
    return bool(_VOLUNTEER_TITLE_RE.search(title or ""))


def _is_volunteer_text(*texts: str) -> bool:
    """Volunteer-flag when the title OR description mentions volunteering."""
    return any(bool(_VOLUNTEER_TITLE_RE.search(t or "")) for t in texts)


class Source:
    key: str = ""
    label: str = ""
    default_market: Optional[str] = None
    # Optional @handle of an existing Club/Org account to link imported events to.
    org_handle: Optional[str] = None

    async def fetch(self) -> List[Dict[str, Any]]:
        raise NotImplementedError


# How far ahead to expand recurring series (RRULE). Covers a full season of
# weekly races plus winter series that roll into the next year.
EXPAND_MONTHS = 12


class ICalSource(Source):
    def __init__(self, key: str, label: str, url: str, default_market: Optional[str] = None,
                 prefer_curl: bool = False, org_handle: Optional[str] = None,
                 safe_fetch: bool = False, organizer_name: Optional[str] = None,
                 source_label: Optional[str] = None):
        self.key = key
        self.label = label
        self.url = url
        self.default_market = default_market
        self.prefer_curl = prefer_curl
        self.org_handle = org_handle
        # admin-added feeds use the SSRF-guarded httpx fetch; trusted built-ins
        # that sit behind Cloudflare (48north) keep the curl path.
        self.safe_fetch = safe_fetch
        self.organizer_name = organizer_name
        self.source_label = source_label or label
        self.skipped = 0

    async def fetch(self) -> List[Dict[str, Any]]:
        self.skipped = 0
        if self.safe_fetch:
            from event_sources import safe_fetch_ics
            text = await safe_fetch_ics(self.url)
        else:
            text = await _fetch_text(self.url, prefer_curl=self.prefer_curl)
        cal = Calendar.from_ical(text)
        now = datetime.now(timezone.utc)
        win_start = now - timedelta(days=1)
        win_end = now + timedelta(days=30 * EXPAND_MONTHS)
        # Expand RRULE/EXDATE/RECURRENCE-ID into concrete occurrences within the
        # window using recurring_ical_events (maintained; built on icalendar).
        # Without this a weekly series whose first DTSTART is in the past is
        # dropped entirely even though it recurs into the future.
        import recurring_ical_events
        try:
            comps = recurring_ical_events.of(cal).between(win_start, win_end)
        except Exception:
            logger.exception("recurrence expansion failed for %s; falling back to raw VEVENTs", self.key)
            comps = list(cal.walk("VEVENT"))
        # Skip clearly non-sailing internal admin items when they slip into the feed
        _junk_re = re.compile(r"(squarespace|check.?in|rb website|status meeting|website\b|admin\b|zoom meeting)", re.I)
        events: List[Dict[str, Any]] = []
        from datetime import date as _date, datetime as _dt
        from zoneinfo import ZoneInfo
        feed_tz = str(cal.get("X-WR-TIMEZONE") or "America/Los_Angeles")
        try:
            _ZINFO = ZoneInfo(feed_tz)
        except Exception:
            _ZINFO = ZoneInfo("America/Los_Angeles")
        # VEVENTs whose master DTSTART is date-only (VALUE=DATE) stay date-only after expansion.
        date_only_uids = set()
        for _ve in cal.walk("VEVENT"):
            _ds = _ve.get("DTSTART")
            if _ds is not None and isinstance(_ds.dt, _date) and not isinstance(_ds.dt, _dt):
                date_only_uids.add(str(_ve.get("UID", "")))
        for comp in comps:
            title = str(comp.get("SUMMARY", "")).strip()
            if not title:
                self.skipped += 1
                continue
            if _junk_re.search(title):
                self.skipped += 1
                continue
            dtstart = comp.get("DTSTART")
            dtend = comp.get("DTEND")
            ds_dt = dtstart.dt if dtstart else None
            de_dt = dtend.dt if dtend else None
            uid = str(comp.get("UID", ""))
            is_do = (isinstance(ds_dt, _date) and not isinstance(ds_dt, _dt)) or (uid in date_only_uids)
            if is_do:
                # Date-only source event: import the DATE with NO time. Never invent a clock time.
                d0 = (ds_dt.astimezone(_ZINFO).date() if isinstance(ds_dt, _dt) and ds_dt.tzinfo
                      else ds_dt.date() if isinstance(ds_dt, _dt) else ds_dt)
                starts_at = _to_iso(d0)  # midnight-UTC sentinel = "no time"
                ends_at = None
                if de_dt is not None:
                    d1 = (de_dt.astimezone(_ZINFO).date() if isinstance(de_dt, _dt) and de_dt.tzinfo
                          else de_dt.date() if isinstance(de_dt, _dt) else de_dt)
                    d1 = d1 - timedelta(days=1)  # ICS DTEND date is exclusive
                    if d1 > d0:
                        ends_at = _to_iso(d1)  # multi-day range
            else:
                # Timed: TZID/UTC(Z) aware -> UTC; floating (naive) -> read as the feed timezone (Pacific).
                if isinstance(ds_dt, _dt) and ds_dt.tzinfo is None:
                    ds_dt = ds_dt.replace(tzinfo=_ZINFO)
                if isinstance(de_dt, _dt) and de_dt.tzinfo is None:
                    de_dt = de_dt.replace(tzinfo=_ZINFO)
                starts_at = _to_iso(ds_dt)
                ends_at = _to_iso(de_dt)
            if not starts_at:
                self.skipped += 1
                continue
            # Occurrences are already inside [win_start, win_end]; past-only
            # single events were excluded by the expansion window.
            location = str(comp.get("LOCATION", "")).strip() or None
            desc = _strip_html(str(comp.get("DESCRIPTION", "")).strip(), max_len=800)
            url_ = str(comp.get("URL", "")).strip() or None
            uid = str(comp.get("UID", ""))
            market = self.default_market or _market_from_text(location or "", title, desc)
            events.append({
                "source": "aggregator",
                "source_key": self.key,
                "source_label": self.source_label,
                "external_id": _hash_key(self.key, uid or title, starts_at),
                "source_uid": uid or None,
                "recurrence_id": (str(comp.get("RECURRENCE-ID").dt) if comp.get("RECURRENCE-ID") else None),
                "title": title,
                "description": (desc or f"Imported from {self.source_label}."),
                "market": market,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "time_not_listed": bool(is_do),
                "location": location,
                "is_volunteer": False,
                "is_paid": False,
                "price": None,
                "registration_url": url_,
                "image_url": None,
                "organizer_id": None,
                "organizer_name": self.organizer_name or self.label,
                "approved": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        return events


class OWSAHTMLSource(Source):
    """Scrape https://owsa.net/events — Sailing Club Manager platform.
    HTML pattern:  '<a href="/event/..">Title</a>\\n{Weekday D Month HH:MM-HH:MM}\\n{Type}'
    """
    key = "owsa"
    label = "Oregon Women's Sailing Association"
    default_market = "Portland/Vancouver"

    _DATE_RE = re.compile(
        r"(?P<wd>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(?P<d>\d{1,2})\s+"
        r"(?P<m>January|February|March|April|May|June|July|August|September|October|November|December),?\s*"
        r"(?P<h1>\d{1,2}):(?P<mn1>\d{2})(?:-(?P<h2>\d{1,2}):(?P<mn2>\d{2}))?"
    )

    _MONTHS = {m: i for i, m in enumerate(
        ["January","February","March","April","May","June","July","August","September","October","November","December"], start=1)}

    async def fetch(self) -> List[Dict[str, Any]]:
        text = await _fetch_text("https://owsa.net/events", prefer_curl=False)
        soup = BeautifulSoup(text, "html.parser")
        events: List[Dict[str, Any]] = []
        year_guess = datetime.now(timezone.utc).year
        # Determine current year from headings like "July 2026"
        for h in soup.find_all(["h2", "h3", "a"]):
            m = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})", h.get_text(" ", strip=True))
            if m:
                year_guess = int(m.group(2))
                break
        # Iterate all event anchors: /event/...
        for a in soup.select('a[href^="/event/"]'):
            title = a.get_text(" ", strip=True)
            if not title or len(title) < 3:
                continue
            # EVENTS-FIX-1: a "Book online" anchor is a registration link, not an event.
            # Skip it here; its URL is attached as registration_url to the real event below.
            if title.strip().lower() == "book online":
                continue
            # The date text usually sits in the same block; walk siblings
            container_text = ""
            container = None
            parent = a
            for _ in range(3):
                parent = parent.parent
                if parent is None:
                    break
                container = parent
                container_text = parent.get_text(" ", strip=True)
                if self._DATE_RE.search(container_text):
                    break
            m = self._DATE_RE.search(container_text)
            if not m:
                continue
            day = int(m.group("d"))
            month = self._MONTHS[m.group("m")]
            year = year_guess
            # If month < current month and calendar is showing later months, assume next year (rare)
            from zoneinfo import ZoneInfo
            starts = datetime(year, month, day, int(m.group("h1")), int(m.group("mn1")), tzinfo=ZoneInfo("America/Los_Angeles"))  # PT wall-clock, DST-aware
            ends = None
            if m.group("h2"):
                ends = starts.replace(hour=int(m.group("h2")), minute=int(m.group("mn2")))
            # Skip past events
            if starts < datetime.now(timezone.utc) - timedelta(days=1):
                continue
            title_lower = title.lower()
            is_volunteer = any(k in title_lower for k in ["volunteer", "work party"])
            href = a.get("href", "")
            # Stable per-event id = the event page URL (never the title or date).
            reg_url = f"https://owsa.net{href}" if href.startswith("/") else href
            source_uid = reg_url
            # Prefer an explicit "Book online" link in the same row as the registration URL.
            source_tag = ""
            if container is not None:
                for sib in container.select("a"):
                    if sib.get_text(" ", strip=True).strip().lower() == "book online":
                        bh = sib.get("href", "")
                        if bh:
                            reg_url = f"https://owsa.net{bh}" if bh.startswith("/") else bh
                        break
                # The row's event-type tag is the text after the time range (e.g. "Social").
                tail = container_text[m.end():].strip(" -·|,")
                source_tag = tail.split("\n")[0].strip()[:40]
            events.append({
                "source": "aggregator",
                "source_key": self.key,
                "source_label": self.label,
                "external_id": _hash_key(self.key, title, _to_iso(starts)),
                "source_uid": source_uid,
                "source_tag": source_tag or None,
                "title": title,
                "description": f"Imported from {self.label}. Visit source for details and registration.",
                "market": self.default_market,
                "starts_at": _to_iso(starts),
                "ends_at": _to_iso(ends) if ends else None,
                "location": "Portland, OR",
                "is_volunteer": is_volunteer,
                "is_paid": False,
                "price": None,
                "registration_url": reg_url,
                "image_url": None,
                "organizer_id": None,
                "organizer_name": self.label,
                "approved": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        # Dedupe by external_id within the source
        seen = set(); out = []
        for e in events:
            if e["external_id"] in seen: continue
            seen.add(e["external_id"]); out.append(e)
        return out


# ---------- Registry ----------

# Code-based scrapers keyed by source key. These stay in code (shown read-only
# in the admin panel) because they parse bespoke HTML, not a standard feed.
SCRAPER_CLASSES = {"owsa": OWSAHTMLSource}


async def _load_sources(db) -> List[Source]:
    """Build the live source list from the admin-managed `event_sources` table.
    ICS rows become ICalSource; scraper rows map to a code class by key."""
    from event_sources import seed_default_sources
    await seed_default_sources(db)
    sources: List[Source] = []
    async for row in db.event_sources.find({"enabled": True}):
        stype = row.get("type")
        key = row.get("key")
        if stype == "ics":
            # Built-in 48north needs curl (Cloudflare); others use the SSRF-safe
            # httpx fetch. A row is "built-in curl" only if it was seeded so.
            prefer_curl = bool(row.get("prefer_curl"))
            sources.append(ICalSource(
                key=key,
                label=row.get("name") or key,
                url=row.get("url"),
                default_market=row.get("default_market"),
                prefer_curl=prefer_curl,
                safe_fetch=not prefer_curl,
                organizer_name=row.get("organizer_name"),
                source_label=row.get("source_label") or row.get("name") or key,
            ))
        elif stype == "scraper":
            cls = SCRAPER_CLASSES.get(key)
            if cls:
                sources.append(cls())
    return sources


async def run_aggregator(db, trigger: str = "manual", only_key: Optional[str] = None) -> Dict[str, Any]:
    """Fetch enabled sources from the DB registry and upsert into `events`.
    `trigger` is one of scheduled|startup_catchup|manual|test. `only_key` runs a
    single source ("Run now"). Records per-source stats back onto event_sources
    and appends a run log to `aggregator_runs`."""
    started_at = datetime.now(timezone.utc).isoformat()
    summary: Dict[str, Any] = {"sources": [], "inserted": 0, "updated": 0, "errors": 0, "trigger": trigger}
    sources = await _load_sources(db)
    if only_key:
        sources = [s for s in sources if s.key == only_key]
    for src in sources:
        entry: Dict[str, Any] = {"key": src.key, "label": getattr(src, "source_label", None) or src.label}
        skipped = 0
        try:
            events = await src.fetch()
            skipped = getattr(src, "skipped", 0)
            org_doc = None
            handle = getattr(src, "org_handle", None)
            if handle:
                org_doc = await db.users.find_one(
                    {"handle": handle.lstrip("@").lower()}, {"_id": 0, "user_id": 1, "name": 1})
            if not org_doc:
                org_doc = await db.users.find_one(
                    {"account_type": "partner",
                     "name": {"$regex": f"^{re.escape(src.label)}$", "$options": "i"}},
                    {"_id": 0, "user_id": 1, "name": 1})
            ins = upd = 0
            for e in events:
                # EVENTS-FIX-3: match an existing row by its STABLE source identity
                # (never by date). OWSA source_uid = event page url; OCSA source_uid
                # = iCal UID plus recurrence_id. Update that row in place and keep its
                # id; insert only when nothing matches. Never re-key an existing id.
                suid = e.get("source_uid")
                rid = e.get("recurrence_id")
                legacy_id = f"agg_{src.key}_{e['external_id']}"
                # EVENTS-FIX-2: an importer never stores a backwards range; drop the end.
                if e.get("ends_at") and e.get("starts_at") and e["ends_at"] < e["starts_at"]:
                    e["ends_at"] = None
                # A deleted aggregated event is tombstoned; never re-import it. The
                # tombstone is matched by the same source identity, plus the legacy
                # id for tombstones written before EVENTS-FIX-3.
                ts_or = [{"id": legacy_id}]
                if suid:
                    ts_or.append({"source_key": src.key, "source_uid": suid, "recurrence_id": rid})
                if await db.event_tombstones.find_one({"$or": ts_or}, {"_id": 1}):
                    skipped += 1
                    continue
                if suid:
                    match = {"source_key": src.key, "source_uid": suid, "recurrence_id": rid}
                else:
                    match = {"id": legacy_id}  # legacy fallback: no stored source key
                if org_doc:
                    e["organizer_id"] = org_doc["user_id"]
                    e["organizer_name"] = org_doc.get("name") or e.get("organizer_name")
                if not e.get("is_volunteer") and _is_volunteer_text(e.get("title", ""), e.get("description", "")):
                    e["is_volunteer"] = True
                created_at = e.pop("created_at", datetime.now(timezone.utc).isoformat())
                e.pop("category", None)
                cat, review = categorize(e)
                existing = await db.events.find_one(match, {"_id": 0, "id": 1, "admin_locked_fields": 1})
                # Admin edits win: fields an admin changed are locked and must NOT
                # be overwritten by the next import (untouched fields still refresh).
                locked = set((existing or {}).get("admin_locked_fields") or [])
                if existing:
                    eid = existing["id"]  # keep the existing id; update in place
                    e["id"] = eid
                    set_doc = {k: v for k, v in e.items() if k not in locked and k != "id"}
                    await db.events.update_one({"id": eid}, {"$set": set_doc})
                    await db.events.update_one(
                        {"id": eid, "category_manual": {"$ne": True}},
                        {"$set": {"category": cat, "category_needs_review": review}},
                    )
                    upd += 1
                else:
                    e["id"] = legacy_id
                    set_doc = {k: v for k, v in e.items() if k not in locked}
                    res = await db.events.update_one(
                        {"id": legacy_id},
                        {"$set": set_doc, "$setOnInsert": {"created_at": created_at}},
                        upsert=True,
                    )
                    await db.events.update_one(
                        {"id": legacy_id, "category_manual": {"$ne": True}},
                        {"$set": {"category": cat, "category_needs_review": review}},
                    )
                    if res.upserted_id:
                        ins += 1
                    else:
                        upd += 1
            entry.update({"status": "ok", "fetched": len(events), "inserted": ins,
                          "updated": upd, "skipped": skipped})
            summary["inserted"] += ins
            summary["updated"] += upd
        except Exception as ex:
            logger.exception("aggregator source %s failed", src.key)
            entry.update({"status": "error", "error": str(ex), "fetched": 0,
                          "inserted": 0, "updated": 0, "skipped": skipped})
            summary["errors"] += 1
        summary["sources"].append(entry)
        # Write per-source stats back onto the registry row for the admin table.
        try:
            await db.event_sources.update_one({"key": src.key}, {"$set": {
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "last_status": entry.get("status"),
                "last_error": entry.get("error"),
                "last_fetched": entry.get("fetched", 0),
                "last_inserted": entry.get("inserted", 0),
                "last_updated": entry.get("updated", 0),
                "last_skipped": entry.get("skipped", 0),
            }})
        except Exception:
            logger.exception("failed to persist per-source stats for %s", src.key)
    summary["run_at"] = datetime.now(timezone.utc).isoformat()
    summary["started_at"] = started_at
    try:
        await db.app_meta.update_one(
            {"key": "aggregator_last_run"},
            {"$set": {"key": "aggregator_last_run", "run_at": summary["run_at"], "summary": summary}},
            upsert=True,
        )
        await db.aggregator_runs.insert_one({
            "trigger": trigger, "only_key": only_key,
            "started_at": started_at, "ended_at": summary["run_at"],
            "inserted": summary["inserted"], "updated": summary["updated"],
            "errors": summary["errors"], "sources": summary["sources"],
        })
    except Exception:
        logger.exception("failed to persist aggregator last-run meta")
    return summary
