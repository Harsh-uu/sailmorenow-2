"""Admin-only CRUD + test + run for the event source registry.

Every endpoint is admin-gated. Admin-supplied ICS addresses are fetched by the
server, so all fetches go through the SSRF-guarded helpers in event_sources.py.
"""
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_admin
from event_sources import (
    google_embed_to_ics, validate_ics_url, safe_fetch_ics,
)

logger = logging.getLogger("smn.event_sources_router")
router = APIRouter()

PUBLIC_FIELDS = {"_id": 0}


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return (s or "source")[:40]


@router.get("/admin/event-sources")
async def list_sources(admin=Depends(require_admin)):
    rows = await db.event_sources.find({}, PUBLIC_FIELDS).sort("created_at", 1).to_list(None)
    # events-imported count per source so the UI can block hard-delete.
    for r in rows:
        r["imported_count"] = await db.events.count_documents(
            {"source": "aggregator", "source_key": r.get("key")})
    return {"sources": rows}


class ConvertBody(BaseModel):
    url: str


@router.post("/admin/event-sources/convert")
async def convert_google_embed(body: ConvertBody, admin=Depends(require_admin)):
    """If the address is a Google Calendar embed/share link, return the public
    ICS address to show the admin for confirmation (never swapped silently)."""
    ics = google_embed_to_ics(body.url.strip())
    return {"converted": ics, "is_google_embed": ics is not None}


class TestBody(BaseModel):
    url: str


@router.post("/admin/event-sources/test")
async def test_source(body: TestBody, admin=Depends(require_admin)):
    """Fetch + expand recurrences for the next 12 months. Stores nothing."""
    url = body.url.strip()
    ok, reason = validate_ics_url(url)
    if not ok:
        raise HTTPException(status_code=400, detail=reason)
    try:
        text = await safe_fetch_ics(url)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"Could not read that calendar: {ex}")
    try:
        from icalendar import Calendar
        import recurring_ical_events
        cal = Calendar.from_ical(text)
        now = datetime.now(timezone.utc)
        comps = recurring_ical_events.of(cal).between(now - timedelta(days=1), now + timedelta(days=365))
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"That file is not a valid calendar: {ex}")
    rows: List[Dict[str, Any]] = []
    for c in comps:
        dt = c.get("DTSTART")
        if not dt:
            continue
        d = dt.dt
        if isinstance(d, datetime):
            dd = d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        else:
            dd = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        title = str(c.get("SUMMARY", "")).strip()
        if title:
            rows.append((dd, title))
    rows.sort(key=lambda x: x[0])
    return {
        "future_events": len(rows),
        "date_range": ([rows[0][0].date().isoformat(), rows[-1][0].date().isoformat()] if rows else None),
        "next_5": [{"date": d.date().isoformat(), "title": t} for d, t in rows[:5]],
    }


class CreateBody(BaseModel):
    name: str
    url: str
    default_market: Optional[str] = None
    organizer_name: Optional[str] = None
    source_label: Optional[str] = None


@router.post("/admin/event-sources")
async def create_source(body: CreateBody, admin=Depends(require_admin)):
    from constants import PNW_MARKETS
    name = (body.name or "").strip()
    url = (body.url or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    ok, reason = validate_ics_url(url)
    if not ok:
        raise HTTPException(status_code=400, detail=reason)
    if body.default_market and body.default_market not in PNW_MARKETS:
        raise HTTPException(status_code=400, detail="Invalid market.")
    key = _slug(name)
    # Ensure unique key
    if await db.event_sources.find_one({"key": key}):
        key = f"{key}-{uuid.uuid4().hex[:6]}"
    doc = {
        "key": key, "name": name, "type": "ics", "url": url,
        "default_market": body.default_market or None,
        "organizer_name": (body.organizer_name or "").strip() or None,
        "source_label": (body.source_label or "").strip() or name,
        "prefer_curl": False, "enabled": True, "read_only": False,
        "last_run_at": None, "last_status": None, "last_error": None,
        "last_fetched": 0, "last_inserted": 0, "last_updated": 0, "last_skipped": 0,
        "created_by": admin.get("email") or admin.get("user_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.event_sources.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "source": doc}


class UpdateBody(BaseModel):
    name: Optional[str] = None
    default_market: Optional[str] = None
    source_label: Optional[str] = None
    organizer_name: Optional[str] = None
    enabled: Optional[bool] = None


@router.patch("/admin/event-sources/{key}")
async def update_source(key: str, body: UpdateBody, admin=Depends(require_admin)):
    from constants import PNW_MARKETS
    row = await db.event_sources.find_one({"key": key})
    if not row:
        raise HTTPException(status_code=404, detail="Source not found.")
    update: Dict[str, Any] = {}
    if body.name is not None and body.name.strip():
        update["name"] = body.name.strip()
    if body.default_market is not None:
        if body.default_market and body.default_market not in PNW_MARKETS:
            raise HTTPException(status_code=400, detail="Invalid market.")
        update["default_market"] = body.default_market or None
    if body.source_label is not None:
        update["source_label"] = body.source_label.strip() or (update.get("name") or row.get("name"))
    if body.organizer_name is not None:
        update["organizer_name"] = body.organizer_name.strip() or None
    if body.enabled is not None:
        update["enabled"] = bool(body.enabled)
    if update:
        await db.event_sources.update_one({"key": key}, {"$set": update})
    doc = await db.event_sources.find_one({"key": key}, PUBLIC_FIELDS)
    return {"ok": True, "source": doc}


@router.delete("/admin/event-sources/{key}")
async def delete_source(key: str, admin=Depends(require_admin)):
    row = await db.event_sources.find_one({"key": key})
    if not row:
        raise HTTPException(status_code=404, detail="Source not found.")
    if row.get("read_only"):
        raise HTTPException(status_code=400, detail="This is a code-based scraper and cannot be deleted. Disable it instead.")
    imported = await db.events.count_documents({"source": "aggregator", "source_key": key})
    if imported > 0:
        raise HTTPException(status_code=400, detail="This source has imported events. Disable it instead of deleting (events are kept).")
    await db.event_sources.delete_one({"key": key})
    return {"ok": True, "deleted": key}


@router.post("/admin/event-sources/{key}/run")
async def run_source(key: str, admin=Depends(require_admin)):
    """Run now for a single source (bypasses the once-per-day guard)."""
    row = await db.event_sources.find_one({"key": key})
    if not row:
        raise HTTPException(status_code=404, detail="Source not found.")
    if not row.get("enabled"):
        raise HTTPException(status_code=400, detail="Enable this source before running it.")
    from aggregator import run_aggregator
    summary = await run_aggregator(db, trigger="manual", only_key=key)
    return summary
