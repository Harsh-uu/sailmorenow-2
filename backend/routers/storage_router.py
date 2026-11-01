"""Avatar upload + public file serving via Emergent object storage.

The uploaded avatar URL is stored on the user's `picture` field (a relative
`/api/files/...` path) so BOTH the web and mobile clients render the exact same
image through their own backend URL. Avatars are public profile images, so the
serve endpoint is unauthenticated.
"""
import asyncio
import logging
import uuid

from fastapi import APIRouter, Cookie, File, Header, HTTPException, UploadFile
from starlette.responses import Response

from deps import db, current_user_from_token
from storage import put_object, get_object, APP_NAME

logger = logging.getLogger("smn.storage")
router = APIRouter()

ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_BYTES = 15 * 1024 * 1024


@router.post("/auth/avatar")
async def upload_avatar(file: UploadFile = File(...),
                        session_token: str = Cookie(default=None),
                        authorization: str = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in ALLOWED:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG or WebP image")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 15MB or smaller")
    path = f"{APP_NAME}/avatars/{u['user_id']}/{uuid.uuid4().hex}.{ALLOWED[ct]}"
    try:
        result = await asyncio.to_thread(put_object, path, data, ct)
    except Exception:
        logger.exception("avatar upload failed")
        raise HTTPException(status_code=502, detail="Couldn't save your photo. Try again.")
    picture = f"/api/files/{result.get('path', path)}"
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"picture": picture}})
    return {"picture": picture}


@router.post("/admin/sponsors/upload-image")
async def upload_sponsor_image(file: UploadFile = File(...),
                               session_token: str = Cookie(default=None),
                               authorization: str = Header(default=None)):
    from deps import is_admin
    u = await current_user_from_token(session_token, authorization)
    if not u or not is_admin(u):
        raise HTTPException(status_code=403, detail="Admin only")
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in ALLOWED:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG or WebP image")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 15MB or smaller")
    path = f"{APP_NAME}/sponsors/{uuid.uuid4().hex}.{ALLOWED[ct]}"
    try:
        result = await asyncio.to_thread(put_object, path, data, ct)
    except Exception:
        logger.exception("sponsor image upload failed")
        raise HTTPException(status_code=502, detail="Couldn't save the image. Try again.")
    return {"image_url": f"/api/files/{result.get('path', path)}"}


@router.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        data, ct = await asyncio.to_thread(get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=data, media_type=ct,
                    headers={"Cache-Control": "public, max-age=86400"})
