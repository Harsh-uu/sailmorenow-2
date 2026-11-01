"""Public, read-only plan feature matrix (PLAN-HOME-A/B).

GET /api/plans/matrix returns the single source of truth for every plan benefit
so Pricing (web + mobile), My plan and the locked-feature prompts all render from
one payload. No login required so logged-out marketing pages can use it too.

GET /api/admin/promised (admin only) lists the benefits that are promised but
fulfilled manually by Jenn, so she can see what she owes.
"""
from typing import Optional
from fastapi import APIRouter, Cookie, Header

from plan_features import build_matrix
from deps import require_admin

router = APIRouter()


@router.get("/plans/matrix")
async def plans_matrix():
    return build_matrix()


@router.get("/admin/promised")
async def admin_promised(session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Flat list of promised-but-manual benefits (the honor-roll / newsletter
    items Jenn fulfills by hand), grouped by account type and level."""
    await require_admin(session_token=session_token, authorization=authorization)
    matrix = build_matrix()
    items = []
    for at in matrix["account_types"]:
        for f in at["features"]:
            if not f.get("promised"):
                continue
            for lvl in at["levels"]:
                val = f["values"].get(lvl["key"])
                if val and val is not False and val != "n/a":
                    items.append({
                        "account_type": at["label"],
                        "level": lvl["label"],
                        "benefit": f["label"],
                        "detail": f.get("short") or f.get("meaning"),
                        "value": val,
                    })
    return {"count": len(items), "items": items}
