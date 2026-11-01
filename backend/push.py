"""Web Push (VAPID) subscription store + send helper.

Generate a P-256 EC keypair once, persist the private key as **b64url of the
raw 32-byte scalar** (the format `py_vapid.Vapid.from_string` accepts) so
pywebpush can actually deliver notifications. Legacy PKCS8-PEM entries are
auto-regenerated on load.
"""
from __future__ import annotations
import base64
import json
import logging
import os
from typing import Any, Dict

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

from deps import db

logger = logging.getLogger("smn.push")

_VAPID_CACHE: Dict[str, str] = {}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _mint_keypair() -> Dict[str, str]:
    pk = ec.generate_private_key(ec.SECP256R1(), default_backend())
    priv_int = pk.private_numbers().private_value
    raw_priv = priv_int.to_bytes(32, "big")
    pub_numbers = pk.public_key().public_numbers()
    raw_pub = b"\x04" + pub_numbers.x.to_bytes(32, "big") + pub_numbers.y.to_bytes(32, "big")
    return {"private_key": _b64url(raw_priv), "public_key": _b64url(raw_pub)}


async def _ensure_vapid_keys() -> Dict[str, str]:
    if _VAPID_CACHE:
        return _VAPID_CACHE
    doc = await db.settings.find_one({"key": "vapid"}, {"_id": 0})
    needs_regen = False
    if doc:
        priv = doc.get("private_key") or doc.get("private_pem") or ""
        if "BEGIN" in priv or not doc.get("private_key"):
            needs_regen = True
        else:
            try:
                Vapid.from_string(priv)
            except Exception:
                needs_regen = True
    if not doc or needs_regen:
        kp = _mint_keypair()
        Vapid.from_string(kp["private_key"])  # fail fast if malformed
        subject = os.environ.get("VAPID_SUBJECT", "mailto:hello@sailmorenow.com")
        doc = {"key": "vapid", "public_key": kp["public_key"],
               "private_key": kp["private_key"], "subject": subject}
        await db.settings.update_one({"key": "vapid"},
                                     {"$set": doc, "$unset": {"private_pem": ""}},
                                     upsert=True)
        logger.info("[push] %s VAPID keypair", "regenerated (legacy)" if needs_regen else "generated fresh")
    _VAPID_CACHE.update({k: doc[k] for k in ("public_key", "private_key", "subject")})
    return _VAPID_CACHE


async def get_public_key() -> str:
    return (await _ensure_vapid_keys())["public_key"]


async def send_push_to_user(user_id: str, payload: Dict[str, Any]) -> int:
    subs = await db.push_subscriptions.find({"user_id": user_id}, {"_id": 0}).to_list(None)
    if not subs:
        return 0
    vapid = await _ensure_vapid_keys()
    sent = 0
    for sub in subs:
        try:
            webpush(
                subscription_info=sub["subscription"],
                data=json.dumps(payload),
                vapid_private_key=vapid["private_key"],
                vapid_claims={"sub": vapid["subject"]},
            )
            sent += 1
        except WebPushException as e:
            code = getattr(e.response, "status_code", None) if hasattr(e, "response") else None
            if code in (404, 410):
                await db.push_subscriptions.delete_one({"endpoint": sub.get("endpoint")})
                logger.info("[push] pruned expired subscription %s", (sub.get("endpoint") or "")[:40])
            else:
                logger.warning("[push] delivery failed: %s", e)
        except Exception:
            logger.exception("[push] unexpected error")
    return sent
