"""Secure, DB-backed store for the Zoho CRM refresh token + the sync switch.

The refresh token is encrypted at rest with Fernet (symmetric), the key coming
from ZOHO_SECRETS_KEY in the environment. The token value is NEVER returned by
any API, NEVER logged, and NEVER written to the outbox or PRD. Only booleans and
timestamps leave this module.

Precedence:
- refresh token: the encrypted DB value first, then ZOHO_CRM_REFRESH_TOKEN env.
- sync enabled:  the DB switch first (default OFF), then ZOHO_CRM_ENABLED env.
"""
from __future__ import annotations
import os
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("smn.zoho_secrets")

COLL = "zoho_secrets"
_DOC = "crm"


def _fernet() -> Optional[Fernet]:
    key = os.environ.get("ZOHO_SECRETS_KEY", "")
    if not key:
        logger.error("ZOHO_SECRETS_KEY is not set; cannot store CRM token securely")
        return None
    try:
        return Fernet(key.encode())
    except Exception:
        logger.error("ZOHO_SECRETS_KEY is not a valid Fernet key")
        return None


# ---------- refresh token (encrypted at rest) ----------
async def store_refresh_token(db, token: str) -> bool:
    f = _fernet()
    if not f or not token:
        return False
    enc = f.encrypt(token.encode()).decode()
    await db[COLL].update_one(
        {"key": _DOC},
        {"$set": {"key": _DOC, "refresh_token_enc": enc,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return True


async def get_refresh_token(db) -> Optional[str]:
    """Decrypted stored token first, else the env fallback. For internal use
    only; never return this value from an API."""
    f = _fernet()
    if f:
        doc = await db[COLL].find_one({"key": _DOC}, {"_id": 0, "refresh_token_enc": 1})
        enc = (doc or {}).get("refresh_token_enc")
        if enc:
            try:
                return f.decrypt(enc.encode()).decode()
            except InvalidToken:
                logger.error("stored CRM refresh token could not be decrypted (key mismatch)")
    return os.environ.get("ZOHO_CRM_REFRESH_TOKEN") or None


async def token_present(db) -> bool:
    doc = await db[COLL].find_one({"key": _DOC}, {"_id": 0, "refresh_token_enc": 1})
    if doc and doc.get("refresh_token_enc"):
        return True
    return bool(os.environ.get("ZOHO_CRM_REFRESH_TOKEN"))


async def token_source(db) -> Optional[str]:
    """Where the active token comes from: 'stored', 'env', or None. No value."""
    doc = await db[COLL].find_one({"key": _DOC}, {"_id": 0, "refresh_token_enc": 1})
    if doc and doc.get("refresh_token_enc"):
        return "stored"
    if os.environ.get("ZOHO_CRM_REFRESH_TOKEN"):
        return "env"
    return None


async def token_updated_at(db) -> Optional[str]:
    doc = await db[COLL].find_one({"key": _DOC}, {"_id": 0, "updated_at": 1})
    return (doc or {}).get("updated_at")


async def delete_refresh_token(db) -> None:
    await db[COLL].delete_one({"key": _DOC})


# ---------- sync switch (DB takes precedence over ZOHO_CRM_ENABLED) ----------
async def set_sync_enabled(db, on: bool) -> None:
    await db.app_meta.update_one(
        {"key": "zoho_crm_switch"},
        {"$set": {"key": "zoho_crm_switch", "enabled": bool(on),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def sync_enabled(db) -> bool:
    doc = await db.app_meta.find_one({"key": "zoho_crm_switch"}, {"_id": 0, "enabled": 1})
    if doc is not None and "enabled" in doc:
        return bool(doc["enabled"])
    return os.environ.get("ZOHO_CRM_ENABLED", "false").lower() == "true"


# ---------- Zoho Campaigns kill switch (DB-backed, DEFAULT OFF) --------------
# Separate from the CRM switch. OFF = the app makes NO Zoho Campaigns calls
# (subscribe / add-contact / opt-in / unsubscribe), so Zoho cannot send any
# confirmation or marketing email. CRM Contact sync (no email) is unaffected.
async def set_campaigns_enabled(db, on: bool) -> None:
    await db.app_meta.update_one(
        {"key": "zoho_campaigns_switch"},
        {"$set": {"key": "zoho_campaigns_switch", "enabled": bool(on),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def campaigns_enabled(db) -> bool:
    doc = await db.app_meta.find_one({"key": "zoho_campaigns_switch"}, {"_id": 0, "enabled": 1})
    if doc is not None and "enabled" in doc:
        return bool(doc["enabled"])
    return os.environ.get("ZOHO_CAMPAIGNS_ENABLED", "false").lower() == "true"


# ---------- connection test timestamp (gates turning sync ON + live backfill) ----------
async def record_conn_test(db, ok: bool) -> None:
    await db.app_meta.update_one(
        {"key": "zoho_crm_conn_test"},
        {"$set": {"key": "zoho_crm_conn_test", "ok": bool(ok),
                  "at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def last_conn_test(db) -> Optional[Dict[str, Any]]:
    return await db.app_meta.find_one({"key": "zoho_crm_conn_test"}, {"_id": 0, "ok": 1, "at": 1})


# ---------- grant-code exchange (server side; token never logged/returned) ----------
async def exchange_grant_code(code: str) -> Dict[str, Any]:
    """Exchange a Zoho Self Client grant code for a refresh token using the
    EXISTING client id/secret. Returns {"ok": bool, "refresh_token"?: str,
    "error"?: <code>}. The grant code, the token and the secret are NEVER logged.
    error codes: missing_client, network, invalid_code, invalid_client,
    no_refresh_token, http_<status>."""
    import httpx
    accounts = (os.environ.get("ZOHO_ACCOUNTS_URL") or "https://accounts.zoho.com").rstrip("/")
    cid = os.environ.get("ZOHO_CLIENT_ID", "")
    csec = os.environ.get("ZOHO_CLIENT_SECRET", "")
    if not (cid and csec):
        return {"ok": False, "error": "missing_client"}
    payload = {"grant_type": "authorization_code", "client_id": cid,
               "client_secret": csec, "code": code}
    redirect = os.environ.get("ZOHO_REDIRECT_URI", "")
    if redirect:
        payload["redirect_uri"] = redirect
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(f"{accounts}/oauth/v2/token", data=payload)
    except Exception:
        # Do NOT log the exception body; it could echo the posted code.
        logger.error("Zoho grant-code exchange network error")
        return {"ok": False, "error": "network"}
    try:
        data = r.json()
    except Exception:
        data = {}
    rt = data.get("refresh_token")
    if rt:
        logger.info("Zoho grant-code exchange succeeded (token stored, not logged)")
        return {"ok": True, "refresh_token": rt}
    err = str(data.get("error") or "").lower()
    if not err:
        err = "no_refresh_token" if r.status_code == 200 else f"http_{r.status_code}"
    logger.info("Zoho grant-code exchange failed: %s", err)  # error code only, no secret
    return {"ok": False, "error": err}
