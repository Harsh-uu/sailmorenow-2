"""Admin action audit log (who / what / when), auto-expiring after 30 days."""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from deps import db

logger = logging.getLogger("smn.audit")
_ttl_ready = False


async def ensure_ttl():
    global _ttl_ready
    if _ttl_ready:
        return
    try:
        await db.audit_logs.create_index("expire_at", expireAfterSeconds=0)
        await db.audit_logs.create_index([("created_at", -1)])
        _ttl_ready = True
    except Exception:
        logger.exception("audit ttl index setup failed")


async def log_admin_action(admin: Dict[str, Any], action: str, entity_type: str,
                           entity_id: str, summary: str = "",
                           meta: Optional[Dict[str, Any]] = None):
    """Record an admin edit/delete/ban. `expire_at` is a BSON date so the TTL
    index purges entries after 30 days."""
    await ensure_ttl()
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "admin_id": admin.get("user_id"),
        "admin_name": admin.get("name"),
        "admin_email": admin.get("email"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "summary": (summary or "")[:200],
        "meta": meta or {},
        "created_at": now.isoformat(),
        "expire_at": now + timedelta(days=30),
    }
    try:
        await db.audit_logs.insert_one(doc)
    except Exception:
        logger.exception("audit insert failed (%s %s %s)", action, entity_type, entity_id)
