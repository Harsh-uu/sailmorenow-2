"""Lightweight geocoding via OpenStreetMap Nominatim (free, no API key).

Respects Nominatim usage policy: descriptive User-Agent + max ~1 request/sec.
Used to turn an event's location text into lat/lng so the map shows exact pins.
"""
from __future__ import annotations
import asyncio
import logging
import httpx

logger = logging.getLogger("geocode")

NOMINATIM = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "SailMoreNow/1.0 (events map geocoder)"}

# Rough centers so a query biased to the Pacific Northwest resolves sensibly.
_MARKET_HINT = {
    "Greater Seattle": "Seattle, Washington, USA",
    "Portland/Vancouver": "Portland, Oregon, USA",
    "South Sound": "Olympia, Washington, USA",
    "North Sound": "Bellingham, Washington, USA",
    "San Juans": "Friday Harbor, Washington, USA",
}


async def geocode(location: str | None, market: str | None = None) -> tuple[float, float] | None:
    """Return (lat, lng) for a location string, or None. Best-effort."""
    q = (location or "").strip()
    if not q:
        return None
    hint = _MARKET_HINT.get(market or "", "Pacific Northwest, USA")
    query = q if any(x in q for x in ("WA", "OR", "USA", ",")) else f"{q}, {hint}"
    try:
        async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
            r = await client.get(NOMINATIM, params={"q": query, "format": "json", "limit": 1})
            r.raise_for_status()
            data = r.json()
            if data:
                return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        logger.warning("geocode failed for %r", query)
    return None


async def geocode_event(db, event_id: str) -> None:
    """Geocode one event by id and persist lat/lng. Fire-and-forget safe."""
    ev = await db.events.find_one({"id": event_id}, {"_id": 0, "location": 1, "market": 1})
    if not ev:
        return
    coords = await geocode(ev.get("location"), ev.get("market"))
    if coords:
        await db.events.update_one({"id": event_id}, {"$set": {"lat": coords[0], "lng": coords[1]}})


async def backfill(db) -> None:
    """One-shot: geocode events missing coordinates (rate-limited)."""
    cursor = db.events.find(
        {"$or": [{"lat": None}, {"lat": {"$exists": False}}], "location": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "location": 1, "market": 1},
    )
    events = await cursor.to_list(500)
    if not events:
        return
    logger.info("geocode backfill: %d events", len(events))
    for ev in events:
        coords = await geocode(ev.get("location"), ev.get("market"))
        if coords:
            await db.events.update_one({"id": ev["id"]}, {"$set": {"lat": coords[0], "lng": coords[1]}})
            logger.info("geocoded %s -> %.4f,%.4f", ev.get("id"), coords[0], coords[1])
        await asyncio.sleep(1.1)  # Nominatim: max ~1 req/sec
