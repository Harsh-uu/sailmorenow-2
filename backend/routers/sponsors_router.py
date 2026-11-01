"""Community Sponsors — rotating banners shown below the Events calendar.

Public endpoint returns active sponsors (ordered). Admins manage sponsors
(image, link, active toggle) from the Admin area. Not labeled as ads.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException

from deps import db, require_admin
from audit import log_admin_action

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "name": doc.get("name", ""),
        "image_url": doc.get("image_url", ""),
        "link_url": doc.get("link_url", ""),
        "active": bool(doc.get("active", True)),
        "order": doc.get("order", 0),
    }


@router.get("/sponsors")
async def list_sponsors():
    docs = await db.sponsors.find({"active": {"$ne": False}}, {"_id": 0}).to_list(100)
    docs.sort(key=lambda d: (d.get("order", 0), d.get("created_at", "")))
    return [_public(d) for d in docs]


@router.get("/admin/sponsors")
async def admin_list_sponsors(admin=Depends(require_admin)):
    docs = await db.sponsors.find({}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda d: (d.get("order", 0), d.get("created_at", "")))
    return docs


@router.post("/admin/sponsors")
async def admin_create_sponsor(body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    image_url = (body.get("image_url") or "").strip()
    link_url = (body.get("link_url") or "").strip()
    if not image_url or not link_url:
        raise HTTPException(status_code=400, detail="Image and link are required")
    last = await db.sponsors.find({}).sort("order", -1).to_list(1)
    order = (last[0].get("order", 0) + 1) if last else 0
    doc = {
        "id": str(uuid.uuid4()),
        "name": (body.get("name") or "").strip()[:120],
        "image_url": image_url,
        "link_url": link_url,
        "active": bool(body.get("active", True)),
        "order": order,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.sponsors.insert_one(doc)
    await log_admin_action(admin, "create", "sponsor", doc["id"], summary=doc["name"][:120])
    doc.pop("_id", None)
    return doc


@router.patch("/admin/sponsors/{sid}")
async def admin_update_sponsor(sid: str, body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    doc = await db.sponsors.find_one({"id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sponsor not found")
    allowed = {"name", "image_url", "link_url", "active", "order"}
    changes = {k: v for k, v in body.items() if k in allowed and v is not None}
    if not changes:
        return doc
    changes["updated_at"] = _now()
    await db.sponsors.update_one({"id": sid}, {"$set": changes})
    await log_admin_action(admin, "edit", "sponsor", sid, summary=f"{doc.get('name','')[:90]} — {', '.join(sorted(changes))}")
    return await db.sponsors.find_one({"id": sid}, {"_id": 0})


@router.delete("/admin/sponsors/{sid}")
async def admin_delete_sponsor(sid: str, admin=Depends(require_admin)):
    doc = await db.sponsors.find_one({"id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Sponsor not found")
    await db.sponsors.delete_one({"id": sid})
    await log_admin_action(admin, "delete", "sponsor", sid, summary=doc.get("name", "")[:120])
    return {"ok": True}
