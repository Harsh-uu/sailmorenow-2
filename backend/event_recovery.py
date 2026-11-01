"""EVENTS-ADMIN-BULK-1: soft-delete + restore for admin event management.

Deleting an event keeps a full recovery copy in `events_deleted` (event doc plus
its RSVP registrations and crew sign-ups), writes a tombstone keyed by the stable
source identity (source_key, source_uid, recurrence_id) so the importer never
re-adds a removed feed event, and leaves the copy in place for recovery. There is
NO automatic permanent purge: a `recoverable_until` timestamp (30 days out) is
stored for display only, and nothing deletes the copy on a timer. Restore re-inserts
the event (and its signups) and removes the tombstone.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from deps import db
from audit import log_admin_action

RECOVERY_WINDOW_DAYS = 30


def _tombstone_or(ev: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Match a tombstone/event by the new source identity OR the legacy id."""
    ors: List[Dict[str, Any]] = [{"id": ev.get("id")}]
    if ev.get("source_uid"):
        ors.append({
            "source_key": ev.get("source_key"),
            "source_uid": ev.get("source_uid"),
            "recurrence_id": ev.get("recurrence_id"),
        })
    return ors


async def soft_delete_event(ev: Dict[str, Any], admin: Dict[str, Any]) -> None:
    """Snapshot the event + its signups into events_deleted, tombstone aggregator
    events, then remove the live event and its signups. Idempotent per event id."""
    event_id = ev["id"]
    now = datetime.now(timezone.utc)
    regs = await db.event_registrations.find({"event_id": event_id}, {"_id": 0}).to_list(2000)
    crew = await db.crew_bank.find({"event_id": event_id}, {"_id": 0}).to_list(2000)
    recovery = {
        "id": event_id,
        "event": ev,
        "registrations": regs,
        "crew": crew,
        "deleted_by": admin.get("user_id"),
        "deleted_by_name": admin.get("name"),
        "deleted_at": now.isoformat(),
        "recoverable_until": (now + timedelta(days=RECOVERY_WINDOW_DAYS)).isoformat(),
        "source": ev.get("source") or "community",
        "title": ev.get("title"),
        "starts_at": ev.get("starts_at"),
        "time_not_listed": ev.get("time_not_listed"),
        "market": ev.get("market"),
    }
    await db.events_deleted.replace_one({"id": event_id}, recovery, upsert=True)
    if ev.get("source") == "aggregator":
        await db.event_tombstones.update_one(
            {"id": event_id},
            {"$set": {
                "id": event_id, "source": "aggregator",
                "source_key": ev.get("source_key"), "external_id": ev.get("external_id"),
                "source_uid": ev.get("source_uid"), "recurrence_id": ev.get("recurrence_id"),
                "title": ev.get("title"),
                "removed_by": admin.get("user_id"),
                "removed_at": now.isoformat(),
            }},
            upsert=True,
        )
    await db.events.delete_one({"id": event_id})
    await db.event_registrations.delete_many({"event_id": event_id})
    await db.crew_bank.delete_many({"event_id": event_id})


async def restore_event(recovery: Dict[str, Any], admin: Dict[str, Any]) -> bool:
    """Re-insert a soft-deleted event (and its signups), drop its tombstone, and
    remove the recovery copy. Returns False if the recovery copy is incomplete."""
    ev = recovery.get("event")
    if not ev or not ev.get("id"):
        return False
    event_id = ev["id"]
    ev.pop("_id", None)
    # Re-insert the event only if it is not already live (avoid duplicate key).
    if not await db.events.find_one({"id": event_id}, {"_id": 1}):
        await db.events.insert_one(ev)
    for r in recovery.get("registrations") or []:
        r.pop("_id", None)
        await db.event_registrations.update_one(
            {"event_id": event_id, "user_id": r.get("user_id")}, {"$set": r}, upsert=True)
    for c in recovery.get("crew") or []:
        c.pop("_id", None)
        await db.crew_bank.update_one(
            {"event_id": event_id, "user_id": c.get("user_id")}, {"$set": c}, upsert=True)
    await db.event_tombstones.delete_many({"$or": _tombstone_or(ev)})
    await db.events_deleted.delete_one({"id": event_id})
    await log_admin_action(admin, "restore", "event", event_id,
                           summary=f"Restored '{(ev.get('title') or event_id)}'")
    return True
