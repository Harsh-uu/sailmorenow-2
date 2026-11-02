"""Lightweight up/down reactions for posts, discussions (forum/blog) and comments.

One reaction per (user, target). value = 1 (like) or -1 (dislike); sending the
same value again toggles it off. Counts are visible to everyone.
"""
from __future__ import annotations
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel

from deps import db, current_user_from_token, require_interaction, require_participation

router = APIRouter()

VALID_TARGETS = {"post", "discussion", "comment"}


class ReactionBody(BaseModel):
    target_type: str
    target_id: str
    value: int  # 1, -1, or 0 to clear


async def _counts(target_type: str, target_id: str, user_id: Optional[str]):
    up = await db.reactions.count_documents({"target_type": target_type, "target_id": target_id, "value": 1})
    down = await db.reactions.count_documents({"target_type": target_type, "target_id": target_id, "value": -1})
    mine = 0
    if user_id:
        r = await db.reactions.find_one({"target_type": target_type, "target_id": target_id, "user_id": user_id}, {"_id": 0, "value": 1})
        mine = (r or {}).get("value", 0)
    return {"up": up, "down": down, "mine": mine}


class BatchBody(BaseModel):
    items: list  # [{target_type, target_id}]


@router.post("/reactions/batch")
async def batch_reactions(body: BatchBody,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    uid = u["user_id"] if u else None
    # Normalise + dedupe requested targets.
    wanted = []
    seen = set()
    for it in (body.items or [])[:100]:
        tt, tid = (it or {}).get("target_type"), (it or {}).get("target_id")
        if tt in VALID_TARGETS and tid and (tt, tid) not in seen:
            seen.add((tt, tid))
            wanted.append({"target_type": tt, "target_id": tid})
    result = {f"{w['target_type']}:{w['target_id']}": {"up": 0, "down": 0, "mine": 0} for w in wanted}
    if not wanted:
        return result
    ids = [w["target_id"] for w in wanted]
    pipeline = [
        {"$match": {"target_id": {"$in": ids}}},
        {"$group": {"_id": {"tt": "$target_type", "tid": "$target_id", "v": "$value"}, "n": {"$sum": 1}}},
    ]
    async for row in db.reactions.aggregate(pipeline):
        k = f"{row['_id']['tt']}:{row['_id']['tid']}"
        if k in result:
            result[k]["up" if row["_id"]["v"] == 1 else "down"] = row["n"]
    if uid:
        async for r in db.reactions.find({"target_id": {"$in": ids}, "user_id": uid},
                                         {"_id": 0, "target_type": 1, "target_id": 1, "value": 1}):
            k = f"{r['target_type']}:{r['target_id']}"
            if k in result:
                result[k]["mine"] = r.get("value", 0)
    return result


@router.get("/reactions/{target_type}/{target_id}")
async def get_reactions(target_type: str, target_id: str,
                        session_token: Optional[str] = Cookie(default=None),
                        authorization: Optional[str] = Header(default=None)):
    if target_type not in VALID_TARGETS:
        raise HTTPException(status_code=400, detail="Invalid target_type")
    u = await current_user_from_token(session_token, authorization)
    return await _counts(target_type, target_id, u["user_id"] if u else None)


@router.post("/reactions")
async def set_reaction(body: ReactionBody,
                       session_token: Optional[str] = Cookie(default=None),
                       authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    require_participation(u)
    if body.target_type not in VALID_TARGETS or body.value not in {1, -1, 0}:
        raise HTTPException(status_code=400, detail="Invalid reaction")
    key = {"target_type": body.target_type, "target_id": body.target_id, "user_id": u["user_id"]}
    existing = await db.reactions.find_one(key, {"_id": 0, "value": 1})
    if body.value == 0 or (existing and existing.get("value") == body.value):
        await db.reactions.delete_one(key)
    else:
        await db.reactions.update_one(
            key,
            {"$set": {**key, "value": body.value, "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    return await _counts(body.target_type, body.target_id, u["user_id"])
