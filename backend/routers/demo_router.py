"""Admin-only demo data controls (seed / reset / status)."""
from __future__ import annotations
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends

from deps import db, require_admin
from audit import log_admin_action
from demo_seed import seed_demo, reset_demo, demo_status

router = APIRouter()


@router.get("/admin/demo/status")
async def demo_status_route(admin=Depends(require_admin)):
    return await demo_status(db)


@router.post("/admin/demo/seed")
async def demo_seed_route(body: Dict[str, Any] = Body(default={}), admin=Depends(require_admin)):
    size = "small" if (body.get("size") == "small") else "full"
    result = await seed_demo(db, size=size)
    await log_admin_action(admin, "seed", "demo_data", "demo",
                           summary=f"Loaded {size} demo data: {result}")
    status = await demo_status(db)
    return {"ok": True, "seeded": result, "status": status}


@router.post("/admin/demo/reset")
async def demo_reset_route(admin=Depends(require_admin)):
    deleted = await reset_demo(db)
    await log_admin_action(admin, "reset", "demo_data", "demo",
                           summary=f"Reset to clean launch, removed: {deleted}")
    status = await demo_status(db)
    return {"ok": True, "deleted": deleted, "status": status}
