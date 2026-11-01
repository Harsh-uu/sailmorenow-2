"""IP ban list: admin-managed, cached in memory, enforced by middleware on every /api request."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Set

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from starlette.responses import JSONResponse

from deps import db, require_admin, client_ip

router = APIRouter()
_BANNED: Set[str] = set()
_LOADED = False


async def load_bans() -> None:
    global _LOADED
    _BANNED.clear()
    async for b in db.ip_bans.find({}, {"_id": 0, "ip": 1}):
        _BANNED.add(b["ip"])
    _LOADED = True


async def ban_middleware(request: Request, call_next):
    if not _LOADED:
        await load_bans()
    if _BANNED and request.url.path.startswith("/api") and not request.url.path.startswith("/api/admin/ip-bans"):
        ip = client_ip(request)
        if ip in _BANNED:
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)


class BanBody(BaseModel):
    ip: str
    reason: Optional[str] = None


@router.get("/admin/ip-bans")
async def list_bans(admin=Depends(require_admin)) -> List[Dict[str, Any]]:
    return await db.ip_bans.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/admin/ip-bans")
async def add_ban(body: BanBody, request: Request, admin=Depends(require_admin)):
    ip = body.ip.strip()
    if not ip or len(ip) > 64 or " " in ip:
        raise HTTPException(status_code=400, detail="Invalid IP")
    if ip == client_ip(request):
        raise HTTPException(status_code=400, detail="Refusing to ban your own IP")
    doc = {"id": str(uuid.uuid4()), "ip": ip, "reason": (body.reason or "")[:200],
           "banned_by": admin.get("email"), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.ip_bans.update_one({"ip": ip}, {"$setOnInsert": doc}, upsert=True)
    _BANNED.add(ip)
    return await db.ip_bans.find_one({"ip": ip}, {"_id": 0})


@router.delete("/admin/ip-bans/{ip}")
async def remove_ban(ip: str, admin=Depends(require_admin)):
    res = await db.ip_bans.delete_one({"ip": ip})
    _BANNED.discard(ip)
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Not banned")
    return {"ok": True, "ip": ip}
