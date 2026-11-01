"""Zoho Campaigns integration — newsletter subscribe/unsubscribe sync.

Uses the OAuth 2.0 self-client refresh-token flow. Configure via env vars:
  ZOHO_ACCOUNTS_URL, ZOHO_CAMPAIGNS_API_ROOT
  ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
  ZOHO_CAMPAIGNS_LIST_KEY, ZOHO_CAMPAIGNS_TOPIC_ID (optional)
  ZOHO_UNSUBSCRIBE_ON_OPT_OUT (true|false)

If ZOHO_CAMPAIGNS_LIST_KEY is empty, calls are logged and skipped (no-op) so the
app remains functional until the admin provides the list key.
"""
from __future__ import annotations
import os
import json
import time
import logging
from typing import Optional, Dict, Any, List
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger("smn.zoho")


class ZohoConfig:
    def __init__(self) -> None:
        self.accounts_url = os.environ.get("ZOHO_ACCOUNTS_URL", "").rstrip("/")
        self.api_root = os.environ.get("ZOHO_CAMPAIGNS_API_ROOT", "https://campaigns.zoho.com/api/v1.1").rstrip("/")
        self.client_id = os.environ.get("ZOHO_CLIENT_ID", "")
        self.client_secret = os.environ.get("ZOHO_CLIENT_SECRET", "")
        self.refresh_token = os.environ.get("ZOHO_REFRESH_TOKEN", "")
        self.list_key = os.environ.get("ZOHO_CAMPAIGNS_LIST_KEY", "")
        self.topic_id = os.environ.get("ZOHO_CAMPAIGNS_TOPIC_ID", "")
        self.unsubscribe_on_opt_out = os.environ.get("ZOHO_UNSUBSCRIBE_ON_OPT_OUT", "true").lower() == "true"
        self.subscription_field = os.environ.get("ZOHO_SUBSCRIPTION_FIELD", "Subscription Level")
        self.market_field = os.environ.get("ZOHO_CAMPAIGNS_MARKET_FIELD", "Market")

    @property
    def ready_for_auth(self) -> bool:
        return bool(self.accounts_url and self.client_id and self.client_secret and self.refresh_token)

    @property
    def ready_for_list_ops(self) -> bool:
        return self.ready_for_auth and bool(self.list_key)


class ZohoTokenManager:
    def __init__(self, cfg: ZohoConfig) -> None:
        self.cfg = cfg
        self._access_token: Optional[str] = None
        self._expires_at: float = 0.0

    async def token(self) -> Optional[str]:
        if not self.cfg.ready_for_auth:
            return None
        if self._access_token and time.time() < self._expires_at - 60:
            return self._access_token
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                r = await c.post(
                    f"{self.cfg.accounts_url}/oauth/v2/token",
                    data={
                        "grant_type": "refresh_token",
                        "client_id": self.cfg.client_id,
                        "client_secret": self.cfg.client_secret,
                        "refresh_token": self.cfg.refresh_token,
                    },
                )
            if r.status_code != 200:
                logger.error("Zoho token refresh failed: %s %s", r.status_code, r.text)
                return None
            data = r.json()
            self._access_token = data.get("access_token")
            self._expires_at = time.time() + int(data.get("expires_in", 3600))
            return self._access_token
        except Exception:
            logger.exception("Zoho token refresh crashed")
            return None


class ZohoCampaigns:
    def __init__(self) -> None:
        self.cfg = ZohoConfig()
        self.tokens = ZohoTokenManager(self.cfg)

    async def _headers(self) -> Optional[Dict[str, str]]:
        tok = await self.tokens.token()
        if not tok:
            return None
        return {
            "Authorization": f"Zoho-oauthtoken {tok}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

    def _contact_info(self, email: str, first_name: str = "", last_name: str = "",
                      subscription: str = "", extra: Optional[Dict[str, str]] = None) -> str:
        info = {"Contact Email": email}
        if first_name:
            info["First Name"] = first_name
        if last_name:
            info["Last Name"] = last_name
        if subscription:
            info[self.cfg.subscription_field] = subscription
        for k, v in (extra or {}).items():
            if v:
                info[k] = v
        # Return raw JSON; httpx form-encoding will URL-encode this once.
        return json.dumps(info)

    async def subscribe(self, email: str, first_name: str = "", last_name: str = "",
                        source: str = "SailMoreNow", subscription: str = "",
                        extra: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        if not await _campaigns_allowed():
            logger.info("[zoho] Campaigns kill switch OFF - skipping subscribe")
            return {"status": "skipped", "reason": "campaigns_disabled"}
        if not self.cfg.ready_for_list_ops:
            logger.info("[zoho] skip subscribe (no list key): %s", email)
            return {"status": "skipped", "reason": "no_list_key"}
        headers = await self._headers()
        if not headers:
            return {"status": "error", "reason": "no_token"}

        async def _post(info_extra: Optional[Dict[str, str]]):
            params: Dict[str, str] = {
                "listkey": self.cfg.list_key,
                "resfmt": "JSON",
                "contactinfo": self._contact_info(email, first_name, last_name, subscription, info_extra),
                "source": source,
            }
            if self.cfg.topic_id:
                params["topic_id"] = self.cfg.topic_id
            async with httpx.AsyncClient(timeout=15.0) as c:
                return await c.post(f"{self.cfg.api_root}/json/listsubscribe", headers=headers, data=params)

        try:
            r = await _post(extra)
            body = _safe_json(r)
            logger.info("[zoho] subscribe %s -> %s %s", email, r.status_code, body)
            # If a custom extra field (e.g. Market) makes the call fail, retry a
            # plain subscribe so the opt-in is never lost. We cannot distinguish
            # an unknown-field error from other failures over the wire, so any
            # non-200 with an extra present triggers the plain retry.
            if r.status_code != 200 and extra:
                logger.info("[zoho] subscribe-with-extra failed for %s (%s); retrying plain", email, r.status_code)
                r2 = await _post(None)
                body2 = _safe_json(r2)
                logger.info("[zoho] plain subscribe %s -> %s %s", email, r2.status_code, body2)
                return {"status": "ok" if r2.status_code == 200 else "error", "http": r2.status_code,
                        "body": body2, "extra_field_dropped": True}
            return {"status": "ok" if r.status_code == 200 else "error", "http": r.status_code, "body": body}
        except Exception as e:
            logger.exception("[zoho] subscribe crashed for %s", email)
            return {"status": "error", "reason": str(e)}

    async def unsubscribe(self, email: str, first_name: str = "", last_name: str = "") -> Dict[str, Any]:
        if not await _campaigns_allowed():
            logger.info("[zoho] Campaigns kill switch OFF - skipping unsubscribe")
            return {"status": "skipped", "reason": "campaigns_disabled"}
        if not self.cfg.ready_for_list_ops:
            logger.info("[zoho] skip unsubscribe (no list key): %s", email)
            return {"status": "skipped", "reason": "no_list_key"}
        headers = await self._headers()
        if not headers:
            return {"status": "error", "reason": "no_token"}
        params: Dict[str, str] = {
            "listkey": self.cfg.list_key,
            "resfmt": "JSON",
            "contactinfo": self._contact_info(email, first_name, last_name),
        }
        if self.cfg.topic_id:
            params["topic_id"] = self.cfg.topic_id
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                r = await c.post(f"{self.cfg.api_root}/json/listunsubscribe", headers=headers, data=params)
            body = _safe_json(r)
            logger.info("[zoho] unsubscribe %s -> %s %s", email, r.status_code, body)
            return {"status": "ok" if r.status_code == 200 else "error", "http": r.status_code, "body": body}
        except Exception as e:
            logger.exception("[zoho] unsubscribe crashed for %s", email)
            return {"status": "error", "reason": str(e)}

    async def sync(self, email: str, opt_in: bool, first_name: str = "", last_name: str = "",
                   subscription: str = "", extra: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        first, *rest = (first_name or "").strip().split(" ", 1) if first_name else ("", "")
        # If we only received a single "name" field split it into first/last
        if not last_name and first_name and " " in first_name:
            parts = first_name.split(" ", 1)
            first, last_name = parts[0], parts[1]
        else:
            first = first_name
        if opt_in:
            return await self.subscribe(email, first, last_name, subscription=subscription, extra=extra)
        if self.cfg.unsubscribe_on_opt_out:
            return await self.unsubscribe(email, first, last_name)
        return {"status": "skipped", "reason": "opt_out_no_unsubscribe"}

    async def list_mailing_lists(self) -> Dict[str, Any]:
        """Admin helper: fetch mailing lists so we can discover the list_key."""
        if not self.cfg.ready_for_auth:
            return {"status": "error", "reason": "no_auth"}
        headers = await self._headers()
        if not headers:
            return {"status": "error", "reason": "no_token"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                r = await c.get(
                    f"{self.cfg.api_root}/getmailinglists",
                    headers=headers,
                    params={"resfmt": "JSON", "sort": "asc", "range": "50", "fromindex": "1"},
                )
            return {"status": "ok" if r.status_code == 200 else "error", "http": r.status_code, "body": _safe_json(r)}
        except Exception as e:
            return {"status": "error", "reason": str(e)}


def _safe_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:
        return r.text


async def _campaigns_allowed() -> bool:
    """True only when the DB-backed Campaigns kill switch is ON (default OFF).
    Every outbound Campaigns call funnels through here, so turning the switch
    off instantly stops all Zoho Campaigns mail (confirmations, marketing)."""
    try:
        from deps import db
        from zoho_secrets import campaigns_enabled
        return await campaigns_enabled(db)
    except Exception:
        logger.exception("[zoho] campaigns kill-switch check failed; defaulting to OFF")
        return False


zoho = ZohoCampaigns()
