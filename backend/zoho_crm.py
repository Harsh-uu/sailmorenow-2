"""Zoho CRM (Contacts) integration for Sail More Now app users.

Separate from zoho.py (Zoho Campaigns newsletter sync, UNCHANGED). This module
only talks to the Zoho CRM REST API v3 (Contacts + Leads), using an OAuth 2.0
refresh-token flow. Everything is gated by ZOHO_CRM_ENABLED (default false); when
off, no network call is made and callers must still record outbox rows as pending
(see zoho_sync.py) so nothing is lost.

Env vars (names only; Jenn sets the values in backend/.env, never logged):
  ZOHO_CRM_ENABLED            true|false   (default false)
  ZOHO_CRM_API_DOMAIN         default https://www.zohoapis.com  (US data center)
  ZOHO_ACCOUNTS_URL           default https://accounts.zoho.com  (US; reused from the same Zoho app)
  ZOHO_CLIENT_ID              reused from the existing Zoho app (same self-client)
  ZOHO_CLIENT_SECRET          reused
  ZOHO_CRM_REFRESH_TOKEN      the CRM-scoped refresh token (distinct from the Campaigns one)

Required OAuth scopes for the self-client (report these to Jenn):
  ZohoCRM.modules.contacts.ALL   create/update/search Contacts
  ZohoCRM.modules.leads.ALL      search + convert Leads
  ZohoCRM.settings.fields.READ   read field metadata to validate picklists
  ZohoCRM.modules.accounts.CREATE (only if convert forces an Account; see convert_lead)
"""
from __future__ import annotations
import os
import time
import json as _jsonlib
import logging
from typing import Optional, Dict, Any, List

import httpx

logger = logging.getLogger("smn.zoho_crm")


def crm_enabled() -> bool:
    return os.environ.get("ZOHO_CRM_ENABLED", "false").lower() == "true"


class ZohoCRMConfig:
    def __init__(self) -> None:
        self.api_domain = os.environ.get("ZOHO_CRM_API_DOMAIN", "https://www.zohoapis.com").rstrip("/")
        self.accounts_url = (os.environ.get("ZOHO_ACCOUNTS_URL", "") or "https://accounts.zoho.com").rstrip("/")
        self.client_id = os.environ.get("ZOHO_CLIENT_ID", "")
        self.client_secret = os.environ.get("ZOHO_CLIENT_SECRET", "")
        self.refresh_token = os.environ.get("ZOHO_CRM_REFRESH_TOKEN", "")

    @property
    def ready(self) -> bool:
        return bool(self.accounts_url and self.client_id and self.client_secret and self.refresh_token)


class _TokenManager:
    def __init__(self, cfg: ZohoCRMConfig) -> None:
        self.cfg = cfg
        self._token: Optional[str] = None
        self._expires_at = 0.0

    async def token(self) -> Optional[str]:
        if not self.cfg.ready:
            return None
        if self._token and time.time() < self._expires_at - 60:
            return self._token
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                r = await c.post(f"{self.cfg.accounts_url}/oauth/v2/token", data={
                    "grant_type": "refresh_token",
                    "client_id": self.cfg.client_id,
                    "client_secret": self.cfg.client_secret,
                    "refresh_token": self.cfg.refresh_token,
                })
            if r.status_code != 200:
                logger.error("Zoho CRM token refresh failed: %s", r.status_code)
                return None
            data = r.json()
            self._token = data.get("access_token")
            self._expires_at = time.time() + int(data.get("expires_in", 3600))
            return self._token
        except Exception:
            logger.exception("Zoho CRM token refresh crashed")
            return None


class ZohoCRMError(Exception):
    """Raised on a retriable CRM failure (network, 401 after refresh, 429, 5xx)."""


class ZohoCRM:
    def __init__(self) -> None:
        self.cfg = ZohoCRMConfig()
        self.tokens = _TokenManager(self.cfg)
        self._picklists: Optional[Dict[str, List[tuple]]] = None
        self._fieldmeta: Optional[Dict[str, Any]] = None

    async def _headers(self) -> Dict[str, str]:
        tok = await self.tokens.token()
        if not tok:
            raise ZohoCRMError("no_token")
        return {"Authorization": f"Zoho-oauthtoken {tok}", "Content-Type": "application/json"}

    def set_refresh_token(self, tok: str) -> None:
        """Point the client at a specific refresh token (resolved from the
        encrypted DB store or env by the caller). Clears the cached access
        token when the refresh token changes so the next call re-auths."""
        tok = tok or ""
        if tok != self.cfg.refresh_token:
            self.cfg.refresh_token = tok
            self.tokens._token = None
            self.tokens._expires_at = 0.0

    async def _request(self, method: str, path: str, *, params=None, json=None) -> httpx.Response:
        url = f"{self.cfg.api_domain}{path}"
        headers = await self._headers()
        try:
            async with httpx.AsyncClient(timeout=20.0) as c:
                r = await c.request(method, url, headers=headers, params=params, json=json)
        except Exception as e:
            # httpx timeout/SSL exceptions often stringify empty; keep the TYPE.
            raise ZohoCRMError(f"network:{type(e).__name__}:{str(e) or 'no_detail'}")
        if r.status_code == 429:
            ra = r.headers.get("Retry-After") or r.headers.get("X-RATELIMIT-RESET") or ""
            raise ZohoCRMError(f"retriable:429:{ra}")
        if r.status_code >= 500:
            raise ZohoCRMError(f"retriable:{r.status_code}")
        return r

    # ---------- Field metadata / picklist validation ----------
    async def read_fields(self, module: str = "Contacts") -> Dict[str, Any]:
        """Return {api_name: {label, data_type, picklist:[{display, actual}]}} for a
        module. Requires ZohoCRM.settings.fields.READ. Both the display_value
        (what Jenn sees/relabels in Zoho) and actual_value (the stored value the
        write API expects) are kept so a relabel never breaks sync."""
        r = await self._request("GET", "/crm/v3/settings/fields", params={"module": module})
        if r.status_code != 200:
            raise ZohoCRMError(f"fields:{r.status_code}")
        out: Dict[str, Any] = {}
        for f in r.json().get("fields", []):
            api = f.get("api_name")
            pv = [{"display": p.get("display_value"), "actual": p.get("actual_value")}
                  for p in (f.get("pick_list_values") or [])]
            out[api] = {"label": f.get("field_label"), "data_type": f.get("data_type"),
                        "length": f.get("length"), "picklist": pv}
        return out

    async def load_picklists(self) -> Dict[str, List[tuple]]:
        meta = await self.read_fields("Contacts")
        self._fieldmeta = {k: {"data_type": v.get("data_type"), "length": v.get("length")}
                           for k, v in meta.items()}
        self._picklists = {
            k: [(d.get("display"), d.get("actual")) for d in v["picklist"]]
            for k, v in meta.items() if v.get("picklist")
        }
        return self._picklists

    def map_picklist(self, field: str, value: Optional[str]) -> Optional[str]:
        """Map an app value to the exact Zoho value to SEND for `field`.
        Matches the incoming value against a live entry's display_value OR
        actual_value (exact, case + spacing), then returns that entry's
        actual_value (what the write API expects; display is the fallback).
        Returns None when there is no live match (caller drops / falls back).
        If metadata is not loaded, passes the value through (best effort)."""
        if value in (None, ""):
            return None
        if self._picklists is None or field not in self._picklists:
            return value
        for disp, act in self._picklists[field]:
            if value == disp or value == act:
                return act if act is not None else disp
        return None

    # ---------- Lookups ----------
    async def find_contact_by_app_user_id(self, app_user_id: str) -> Optional[Dict[str, Any]]:
        r = await self._request("GET", "/crm/v3/Contacts/search",
                                params={"criteria": f"(App_User_ID:equals:{app_user_id})"})
        if r.status_code == 204:
            return None
        if r.status_code != 200:
            raise ZohoCRMError(f"contact_search:{r.status_code}")
        data = r.json().get("data") or []
        return data[0] if data else None

    async def find_contact_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        r = await self._request("GET", "/crm/v3/Contacts/search", params={"email": email})
        if r.status_code == 204:
            return None
        if r.status_code != 200:
            raise ZohoCRMError(f"contact_email_search:{r.status_code}")
        data = r.json().get("data") or []
        return data[0] if data else None

    async def find_lead_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        r = await self._request("GET", "/crm/v3/Leads/search", params={"email": email})
        if r.status_code == 204:
            return None
        if r.status_code != 200:
            raise ZohoCRMError(f"lead_search:{r.status_code}")
        data = r.json().get("data") or []
        return data[0] if data else None

    async def convert_lead(self, lead_id: str) -> Dict[str, Any]:
        """Convert a Lead to a Contact with NO Deal and WITHOUT overwriting Lead
        fields. Returns {"contact_id":..., "account_id":...|None}. If Zoho forces
        an Account (when the Lead has a Company), account_id is returned so we can
        report it."""
        body = {"data": [{"overwrite": False, "notify_lead_owner": False, "notify_new_entity_owner": False}]}
        r = await self._request("POST", f"/crm/v3/Leads/{lead_id}/actions/convert", json=body)
        if r.status_code not in (200, 202):
            raise ZohoCRMError(f"lead_convert:{r.status_code}")
        d = (r.json().get("data") or [{}])[0]
        return {"contact_id": d.get("Contacts"), "account_id": d.get("Accounts"), "deal_id": d.get("Deals")}

    async def create_contact(self, fields: Dict[str, Any]) -> str:
        r = await self._request("POST", "/crm/v3/Contacts", json={"data": [fields], "trigger": []})
        if r.status_code not in (200, 201):
            raise ZohoCRMError(f"contact_create:{r.status_code}:{_err(r)}")
        return (r.json().get("data") or [{}])[0].get("details", {}).get("id")

    async def update_contact(self, contact_id: str, fields: Dict[str, Any]) -> None:
        r = await self._request("PUT", f"/crm/v3/Contacts/{contact_id}", json={"data": [fields], "trigger": []})
        if r.status_code != 200:
            raise ZohoCRMError(f"contact_update:{r.status_code}:{_err(r)}")

    async def get_contact(self, contact_id: str, fields: str = "App_User_ID,Subscription_History,Description") -> Dict[str, Any]:
        r = await self._request("GET", f"/crm/v3/Contacts/{contact_id}", params={"fields": fields})
        if r.status_code != 200:
            return {}
        return (r.json().get("data") or [{}])[0]

    async def mark_account_deleted(self, app_user_id: str) -> Optional[str]:
        """Soft-delete: find the Contact by App_User_ID and set App_Account_Status
        to Deleted. The record is KEPT (never hard-deleted). Returns the contact id
        if one was found and updated, else None."""
        c = await self.find_contact_by_app_user_id(app_user_id)
        if not c:
            return None
        cid = c.get("id")
        val = self.map_picklist("App_Account_Status", "Deleted") or "Deleted"
        await self.update_contact(cid, {"App_Account_Status": val})
        return cid


def _err(r: httpx.Response) -> str:
    """Compact, structured Zoho error (code + field api_name + message) for the
    outbox. Zoho field errors never contain tokens or secrets."""
    try:
        j = r.json()
        d = (j.get("data") or [{}])[0] if isinstance(j, dict) else {}
        det = d.get("details") or {}
        code = d.get("code")
        if code or det or d.get("message"):
            return _jsonlib.dumps({"code": code, "api_name": det.get("api_name"),
                                   "message": d.get("message")})[:400]
        return str(j)[:400]
    except Exception:
        return r.text[:300]


crm = ZohoCRM()
