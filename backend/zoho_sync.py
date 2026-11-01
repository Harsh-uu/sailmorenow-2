"""Zoho CRM sync: user->Contact mapping, the durable outbox, the drain worker,
nightly reconcile and the one-time backfill. Campaigns (zoho.py) is untouched.

Design notes:
- Sign-up NEVER blocks on Zoho: enqueue() is a single cheap Mongo insert. The
  worker (process_outbox) does the network I/O out of band, with retries.
- Coalescing: the worker reads the LIVE user doc at send time and marks every
  pending row for that user as sent in one go, so repeated edits collapse to one
  up-to-date push (Subscription_History is kept on the user doc so no event is lost).
- With ZOHO_CRM_ENABLED=false nothing is sent; rows stay `pending` (not lost).
"""
from __future__ import annotations
import os
import re
import uuid
import random
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple

from zoho_crm import crm, ZohoCRMError

logger = logging.getLogger("smn.zoho_sync")

MAX_ATTEMPTS = 6
HISTORY_MAX_CHARS = 30000


# ---------- datetime / value normalization for the Zoho write API ----------
def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        try:
            return datetime.fromisoformat(s[:10])  # date-only fallback
        except ValueError:
            return None


def _zoho_datetime(value: Any) -> Optional[str]:
    """Zoho CRM datetime fields need ISO 8601 with a timezone offset and NO
    microseconds (e.g. 2026-10-21T13:54:01+00:00). Naive values are treated as
    UTC. Returns None for empty/unparseable input."""
    dt = _parse_dt(value)
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.replace(microsecond=0).isoformat()


def _zoho_date(value: Any) -> Optional[str]:
    """Zoho date fields need yyyy-MM-dd."""
    dt = _parse_dt(value)
    if dt is not None:
        return dt.date().isoformat()
    s = str(value or "")[:10]
    return s if len(s) == 10 else None

# Jenn is aligning the Zoho Market picklist to the app's exact market names, so
# the mapping is now 1:1 (send the exact app value). The worker validates the
# value against the LIVE picklist and falls back to "Other" if it is not there
# yet (never fails). App_Primary_Market always carries the exact text too.
ACCOUNT_TYPE_TO_CONTACT_TYPE = {
    "sailor": "Sailor/Crew", "boat_owner": "Boat Owner", "boat_pro": "Boat Pro", "partner": "Organization",
}
ACCOUNT_TYPE_TO_APP_TYPE = {
    "sailor": "Sailor", "boat_owner": "Boat Owner", "boat_pro": "Boat Pro", "partner": "Organization",
}
PLAN_TIER_TO_PLAN = {"basic": "Basic", "featured": "Featured", "premium": "Premium"}
# Months -> Billing_Cycle picklist label. 3 was added for the sailor/owner
# quarterly plan; the worker only sends a label that exists in the live
# picklist (else it is dropped and logged), so an unconfigured value never fails.
MONTHS_TO_BILLING = {1: "Monthly", 3: "Quarterly (3-Month)", 6: "Seasonal (6-Month)", 12: "Annual"}


# ---------- exclusion guard ----------
# Durable, admin-managed exclusion list (handles) stored in app_meta, loaded into
# this cache by refresh_exclusions() before each drain/backfill so it survives
# restarts and does not depend on .env.
_DYN_EXCLUDE: set = set()

# Emails at these domains are never real deliverable accounts -> hard exclude.
TEST_EMAIL_DOMAINS = {"example.com", "example.org", "example.net", "ex.com",
                      "emergent.sh", "test.com", "test.net", "localhost"}
_TEST_HANDLE_RE = re.compile(r"(test|qa|dummy|sample|demo|asdf|xxx|placeholder)", re.I)
_FREE_MAIL = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com"}


async def refresh_exclusions(db) -> None:
    """Load the durable handle exclusion list from app_meta into the cache."""
    global _DYN_EXCLUDE
    doc = await db.app_meta.find_one({"key": "zoho_exclude"}, {"_id": 0, "handles": 1})
    _DYN_EXCLUDE = {h.strip().lower() for h in (doc or {}).get("handles", []) if h.strip()}


async def add_exclude_handle(db, handle: str, remove: bool = False) -> List[str]:
    """Add/remove a handle in the durable app_meta exclusion list (admin action)."""
    h = (handle or "").strip().lower()
    doc = await db.app_meta.find_one({"key": "zoho_exclude"}, {"_id": 0, "handles": 1})
    handles = {x.strip().lower() for x in (doc or {}).get("handles", []) if x.strip()}
    if remove:
        handles.discard(h)
    elif h:
        handles.add(h)
    out = sorted(handles)
    await db.app_meta.update_one({"key": "zoho_exclude"},
                                 {"$set": {"key": "zoho_exclude", "handles": out}}, upsert=True)
    await refresh_exclusions(db)
    return out


def _exclude_handles() -> set:
    env = os.environ.get("ZOHO_CRM_EXCLUDE_HANDLES", "")
    base = {"demohost"}
    return base | _DYN_EXCLUDE | {h.strip().lower() for h in env.split(",") if h.strip()}

# Seed/managed accounts Jenn maintains by hand (never sync). Matched on name/handle.
_SEED_NAME_MARKERS = ["psss", "puget sound sailing", "wtyc", "wash n go", "willamette"]


def _email_domain(email: str) -> str:
    return email.split("@")[-1] if "@" in email else ""


def is_syncable_user(u: Dict[str, Any]) -> Tuple[bool, str]:
    """Return (syncable, reason_if_not). A skipped account is never sent to Zoho.
    Hard exclusions only - anything merely 'suspicious' is left syncable and is
    surfaced to Jenn in the dry-run review list instead (never silently dropped)."""
    email = (u.get("email") or "").lower()
    uid = u.get("user_id") or ""
    handle = (u.get("handle") or "").lower()
    name = (u.get("name") or "").lower()
    org = (u.get("org_name") or "").lower()
    if not email:
        return False, "no_email"
    if email.endswith("@sailmorenow.dev"):
        return False, "sailmorenow.dev test email"
    domain = _email_domain(email)
    if domain in TEST_EMAIL_DOMAINS or domain.endswith((".test", ".invalid", ".local", ".example")):
        return False, f"test email domain ({domain})"
    if uid.startswith("tmp_") or uid.startswith("seed_"):
        return False, "temp/seed id"
    if "demo" in uid or "demo" in handle or handle.startswith("demo-"):
        return False, "demo account"
    if handle in _exclude_handles():
        return False, "excluded handle"
    # Plus-addressed email AND a test-looking handle -> treat as a test duplicate.
    # (Plus-addressing alone is legitimate, so we never drop it on its own.)
    local = email.split("@")[0]
    if "+" in local and _TEST_HANDLE_RE.search(handle):
        return False, "plus-addressed test handle"
    if any(m in name or m in org or m in handle for m in _SEED_NAME_MARKERS):
        return False, "managed seed org (PSSS/WTYC/Wash N Go)"
    return True, ""


def looks_like_test(u: Dict[str, Any]) -> Optional[str]:
    """ADVISORY only (never excludes). Returns a short reason when an otherwise
    syncable account looks test-like, for the dry-run review list Jenn approves."""
    email = (u.get("email") or "").lower()
    handle = (u.get("handle") or "").lower()
    name = (u.get("name") or "").lower()
    domain = _email_domain(email)
    reasons = []
    if "+" in email.split("@")[0]:
        reasons.append("plus-addressed")
    if _TEST_HANDLE_RE.search(handle) or _TEST_HANDLE_RE.search(name):
        reasons.append("test keyword")
    if len(handle) <= 3:
        reasons.append("very short handle")
    if domain in _FREE_MAIL and (len(handle) <= 4 or _TEST_HANDLE_RE.search(handle)):
        reasons.append("free mail + short/test handle")
    return ", ".join(reasons) or None


# ---------- subscription history (kept app-side so nothing is ever lost) ----------
async def record_sub_event(db, user_id: str, line: str) -> None:
    """Append one Subscription_History line to the user doc, trimming the oldest
    lines so the joined text stays under the Zoho field limit."""
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "zoho_sub_history": 1})
    hist: List[str] = list((u or {}).get("zoho_sub_history") or [])
    hist.append(line)
    while len("\n".join(hist)) > HISTORY_MAX_CHARS and len(hist) > 1:
        hist.pop(0)
    await db.users.update_one({"user_id": user_id}, {"$set": {"zoho_sub_history": hist}})


def sub_history_line(user: Dict[str, Any], action: str, note: str = "") -> str:
    tier = (user.get("subscription_tier") or "free")
    plan = PLAN_TIER_TO_PLAN.get(tier, tier.replace("_", " ").title())
    acct = ACCOUNT_TYPE_TO_APP_TYPE.get(user.get("account_type") or "", "")
    months = user.get("zoho_plan_term_months")
    ends = (user.get("subscription_expires") or "")[:10] or "n/a"
    today = datetime.now(timezone.utc).date().isoformat()
    mo = f"{months} months" if months else "lifetime" if tier in ("community_partner", "founding_partner") else "n/a"
    suffix = f" | {note}" if note else ""
    return f"{today} | {acct} {plan} | {mo} | {action} | ends {ends}{suffix}"


def sub_history_queued_line(user: Dict[str, Any], queued: Dict[str, Any],
                            starts_on: str, note: str = "") -> str:
    """A 'Queued' Subscription_History line. Unlike sub_history_line it describes
    the QUEUED plan (its tier + term) and uses 'starts DATE' instead of 'ends
    DATE', since a queued plan has not started yet. starts_on is YYYY-MM-DD."""
    aud = queued.get("audience")
    eff_tier = "premium" if aud in ("sailor", "boat_owner") else (queued.get("tier") or "")
    plan = PLAN_TIER_TO_PLAN.get(eff_tier, (eff_tier or "").replace("_", " ").title())
    acct = ACCOUNT_TYPE_TO_APP_TYPE.get(user.get("account_type") or "", "")
    months = queued.get("months")
    mo = f"{months} months" if months else "n/a"
    today = datetime.now(timezone.utc).date().isoformat()
    suffix = f" | {note}" if note else ""
    return f"{today} | {acct} {plan} | {mo} | Queued | starts {(starts_on or '')[:10] or 'n/a'}{suffix}"


# ---------- mapping user -> Zoho Contact fields ----------
def _signup_source() -> str:
    return os.environ.get("ZOHO_CRM_SIGNUP_SOURCE", "Alpha Tester")


def build_contact_fields(user: Dict[str, Any], *, signup_source: Optional[str] = None,
                         listing_status: Optional[str] = None) -> Dict[str, Any]:
    """Map an app user doc to Zoho Contacts fields. Picklist values are validated
    against live metadata by the worker before send (crm.valid_picklist)."""
    tier = user.get("subscription_tier") or "free"
    acct = user.get("account_type") or ""
    name = (user.get("name") or "").strip()
    first = (user.get("first_name") or (name.split(" ", 1)[0] if name else "")).strip()
    last = (user.get("last_name") or (name.split(" ", 1)[1] if " " in name else "")).strip()
    if not last:
        last = (user.get("handle") or first or "Member").strip()  # Last_Name is required in Zoho

    is_org = acct == "partner"
    org_status = None
    sub_status = "Free"
    sub_plan = None
    founding = False
    expires = user.get("subscription_expires")
    now_iso = datetime.now(timezone.utc).isoformat()
    if is_org and tier in ("community_partner", "founding_partner"):
        org_status = "Founding Partner" if tier == "founding_partner" else "Community Partner"
        founding = tier == "founding_partner"
        # Granted partners are NOT a trial and NOT a Stripe payment. Their status
        # lives in Org_Status + Founding_Member; Subscription_Status is left EMPTY
        # (Free would be dishonest for a comped partner). Per ZOHO-CRM-8 (2b).
        sub_status = None
    elif tier in PLAN_TIER_TO_PLAN:
        sub_plan = PLAN_TIER_TO_PLAN[tier]
        # Any completed Stripe checkout (test or live) is Paid while active; an
        # expired paid plan is Cancelled. Per ZOHO-CRM-8 (2a, 2d).
        sub_status = "Paid" if (expires and expires > now_iso) else "Cancelled"
    else:
        sub_status = "Free"

    months = user.get("zoho_plan_term_months")
    billing = MONTHS_TO_BILLING.get(months) if months else None

    markets = user.get("markets") or []
    fields: Dict[str, Any] = {
        "App_User_ID": user.get("user_id"),
        "First_Name": first or None,
        "Last_Name": last,
        "Email": (user.get("email") or "").lower() or None,
        "Account_Name": user.get("org_name") or user.get("company_name") or None,
        "App_Handle": user.get("handle"),
        "App_Account_Type": ACCOUNT_TYPE_TO_APP_TYPE.get(acct),
        "Contact_Types": [ACCOUNT_TYPE_TO_CONTACT_TYPE[acct]] if acct in ACCOUNT_TYPE_TO_CONTACT_TYPE else None,
        "Market": user.get("primary_market"),  # exact app name; validated/fallback to Other by worker
        # App_Primary_Market retired per ZOHO-CRM-2 (Market is the single market
        # field now). Kept here commented so it is trivial to re-enable:
        # "App_Primary_Market": user.get("primary_market"),
        "App_Markets_Followed": ", ".join(markets) if markets else None,
        "Subscription_Status": sub_status,
        "Subscription_Plan": sub_plan,
        "Org_Status": org_status,
        "Founding_Member": founding,
        "Plan_Term_Months": months,
        "Billing_Cycle": billing,
        "Subscription_Start_Date": _zoho_date(user.get("subscription_started_at") or user.get("zoho_sub_start")),
        "Subscription_End_Date": _zoho_date(expires),
        "Subscription_History": "\n".join(user.get("zoho_sub_history") or []) or None,
        "App_Signup_Date": _zoho_datetime(user.get("created_at")),
        "App_Last_Active": _zoho_datetime(user.get("last_active_at")),
        "Signup_Source": signup_source or _signup_source(),
        "Auth_Method": "Email and Password" if user.get("password_hash") else "Google",
        "Email_Verified": not bool(user.get("password_hash")),  # Google verified; email sign-up has no verify yet
        "Email_Opt_Out": not bool(user.get("newsletter_opt_in", True)),
        "ID_Verification": "Verified" if user.get("identity_verified") else "Not Started",
        "Listing_Status": listing_status or ("Published" if (acct in ("boat_pro", "partner")) else "None"),
        "App_Account_Status": "Suspended" if user.get("banned") else ("Deleted" if user.get("member_status") == "deleted" else "Active"),
        "Test_Account": False,
    }
    return {k: v for k, v in fields.items() if v is not None}


# picklist fields to validate against live metadata before send
_PICKLIST_FIELDS = ["Market", "Subscription_Status", "Subscription_Plan", "Billing_Cycle",
                    "App_Account_Type", "Org_Status", "Signup_Source", "ID_Verification",
                    "Listing_Status", "App_Account_Status", "Contact_Types"]


def _validate_picklists(fields: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Map every picklist value to the exact Zoho value to SEND (match on the
    live display_value or actual_value, send the actual_value). Values with no
    live match are dropped (Market falls back to Other). Returns (clean, dropped).
    If metadata is not loaded, map_picklist passes values through unchanged."""
    dropped: List[str] = []
    out = dict(fields)
    for f in _PICKLIST_FIELDS:
        if f not in out:
            continue
        val = out[f]
        if isinstance(val, list):  # multi-select (e.g. Contact_Types)
            kept = []
            for v in val:
                m = crm.map_picklist(f, v)
                if m is not None:
                    kept.append(m)
                else:
                    dropped.append(f"{f}={v}")
            if kept:
                out[f] = kept
            else:
                out.pop(f)
        elif f == "Market":
            # Market never fails: map on display/actual; if the app value is not
            # a live option, fall back to Other (mapped to its actual) and log.
            m = crm.map_picklist("Market", val)
            if m is None:
                dropped.append(f"Market={val}->Other")
                other = crm.map_picklist("Market", "Other")
                if other is not None:
                    out["Market"] = other
                else:
                    out.pop("Market")
            else:
                out["Market"] = m
        else:
            m = crm.map_picklist(f, val)
            if m is None:
                dropped.append(f"{f}={val}")
                out.pop(f)
            else:
                out[f] = m
    return out, dropped


def _coerce_types(fields: Dict[str, Any], dropped: List[str]) -> Dict[str, Any]:
    """Coerce every field to the LIVE Zoho data_type (booleans, integers, floats,
    datetimes, dates, text length) so we never hit INVALID_DATA one field at a
    time. Fields absent from metadata, or when metadata is not loaded, pass
    through unchanged. Picklists were already mapped by _validate_picklists."""
    meta = crm._fieldmeta
    if not meta:
        return fields
    out: Dict[str, Any] = {}
    for k, v in fields.items():
        m = meta.get(k)
        if not m:
            out[k] = v
            continue
        dt = (m.get("data_type") or "").lower()
        length = m.get("length")
        try:
            if dt == "boolean":
                out[k] = bool(v)
            elif dt in ("integer", "bigint"):
                out[k] = int(v)
            elif dt in ("double", "currency", "decimal", "percent"):
                out[k] = float(v)
            elif dt == "datetime":
                nv = _zoho_datetime(v)
                if nv is None:
                    dropped.append(f"{k}:bad_datetime")
                    continue
                out[k] = nv
            elif dt == "date":
                nv = _zoho_date(v)
                if nv is None:
                    dropped.append(f"{k}:bad_date")
                    continue
                out[k] = nv
            elif dt == "multiselectpicklist":
                out[k] = v if isinstance(v, list) else [v]
            else:  # text-like (text, textarea, email, phone, website, picklist)
                s = v if isinstance(v, str) else str(v)
                if length and len(s) > int(length):
                    s = s[: int(length)]
                    dropped.append(f"{k}:truncated")
                out[k] = s
        except (TypeError, ValueError):
            dropped.append(f"{k}:bad_{dt}")
    return out
# ---------- the upsert flow ----------
async def sync_user_to_crm(user: Dict[str, Any], *, signup_source: Optional[str] = None) -> Dict[str, Any]:
    """App-User-ID first, email second, Lead convert third. Raises ZohoCRMError on
    a retriable failure. Picklists are validated against live metadata."""
    if crm._picklists is None:
        try:
            await crm.load_picklists()
        except ZohoCRMError:
            pass  # best-effort; _validate_picklists passes through if unknown
    fields = build_contact_fields(user, signup_source=signup_source)
    fields, dropped = _validate_picklists(fields)
    fields = _coerce_types(fields, dropped)
    if dropped:
        logger.info("[zoho_crm] dropped/mapped/coerced values %s for user %s", dropped, user.get("user_id"))
    app_uid = user.get("user_id")
    email = (user.get("email") or "").lower()

    existing = await crm.find_contact_by_app_user_id(app_uid)
    note = None
    if not existing and email:
        existing = await crm.find_contact_by_email(email)  # adopt an existing Contact
        if existing:
            note = "adopted_by_email"
    if not existing and email:
        lead = await crm.find_lead_by_email(email)
        if lead:
            conv = await crm.convert_lead(lead.get("id"))
            cid = conv.get("contact_id", {}).get("id") if isinstance(conv.get("contact_id"), dict) else conv.get("contact_id")
            if cid:
                await crm.update_contact(cid, fields)
                return {"status": "converted_lead", "contact_id": cid,
                        "account_id": conv.get("account_id"), "dropped": dropped}

    if existing:
        await crm.update_contact(existing.get("id"), {**fields, "id": existing.get("id")})
        return {"status": note or "updated", "contact_id": existing.get("id"), "dropped": dropped}
    cid = await crm.create_contact(fields)
    return {"status": "created", "contact_id": cid, "dropped": dropped}


# ---------- outbox ----------
def _parse_error_detail(err: Optional[str]) -> Optional[Dict[str, Any]]:
    """Pull {code, api_name, message} out of a stored error string for the admin
    UI. Never contains a token (Zoho field errors are about data, not auth)."""
    if not err:
        return None
    import json as _j
    i = err.find("{")
    if i >= 0:
        try:
            d = _j.loads(err[i:])
            return {"code": d.get("code"), "api_name": d.get("api_name"),
                    "message": d.get("message"), "stage": err[:i].rstrip(":")}
        except Exception:
            pass
    return {"code": None, "api_name": None, "message": err[:200], "stage": None}


async def _sync_with_retry(user: Dict[str, Any], attempts: int = 3) -> Dict[str, Any]:
    """Retry only TRANSIENT CRM errors (network, 5xx, 429) with exponential
    backoff + jitter, honoring a Retry-After when Zoho sends one. INVALID_DATA
    and other 4xx raise immediately (retrying would not help)."""
    delay = 1.0
    for i in range(attempts):
        try:
            return await sync_user_to_crm(user)
        except ZohoCRMError as e:
            msg = str(e)
            transient = msg.startswith("network:") or msg.startswith("retriable:")
            if not transient or i == attempts - 1:
                raise
            wait = delay
            if msg.startswith("retriable:429:"):
                ra = msg.split("retriable:429:", 1)[1]
                try:
                    wait = max(wait, float(ra))
                except ValueError:
                    pass
            await asyncio.sleep(wait + random.uniform(0, 0.5))
            delay *= 2


async def _set_progress(db, key: str, **fields) -> None:
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.app_meta.update_one({"key": key}, {"$set": {"key": key, **fields}}, upsert=True)


async def enqueue(db, event: str, user_id: str) -> None:
    """Cheap, synchronous, non-throwing: record one pending outbox row. Never
    raises into the caller (a failed enqueue must not break a sign-up)."""
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.zoho_outbox.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id, "event": event,
            "status": "pending", "attempts": 0, "last_error": None,
            "created_at": now, "updated_at": now,
        })
    except Exception:
        logger.exception("zoho enqueue failed for %s/%s", user_id, event)


async def process_outbox(db, limit: int = 50, *, progress_key: Optional[str] = None,
                         throttle: float = 0.0) -> Dict[str, Any]:
    """Drain pending (and retry-eligible failed) rows. Runs TWO independent
    targets per user: Zoho CRM (gated by ZOHO_CRM_ENABLED) and Zoho Campaigns
    (gated by its own list-key readiness). Coalesces per user: one send per user.
    A row is marked `sent` only when every ACTIVE target succeeded; if CRM is
    disabled the row stays `pending` (nothing lost) even after Campaigns runs."""
    from zoho import zoho as campaigns
    from zoho_secrets import sync_enabled, get_refresh_token, campaigns_enabled
    await refresh_exclusions(db)
    crm_active = await sync_enabled(db)
    if crm_active:
        crm.set_refresh_token(await get_refresh_token(db) or "")
    # Campaigns runs from the outbox ONLY when its own kill switch is ON (default
    # OFF). When OFF the worker makes no Campaigns call and does not stamp the
    # user's campaigns opt-in state, so the intent is held (not lost) for later.
    camp_active = campaigns.cfg.ready_for_list_ops and await campaigns_enabled(db)
    if not crm_active and not camp_active:
        return {"skipped": "inactive"}
    pending = await db.zoho_outbox.find(
        {"status": {"$in": ["pending", "failed"]}, "attempts": {"$lt": MAX_ATTEMPTS}},
        {"_id": 0, "user_id": 1}).limit(5000).to_list(5000)
    user_ids: List[str] = []
    for r in pending:
        if r["user_id"] not in user_ids:
            user_ids.append(r["user_id"])
        if len(user_ids) >= limit:
            break
    sent = failed = skipped = held = 0
    total = len(user_ids)
    if progress_key:
        await _set_progress(db, progress_key, total=total, sent=0, failed=0, skipped=0, remaining=total)
    processed = 0
    for uid in user_ids:
        user = await db.users.find_one({"user_id": uid}, {"_id": 0})
        now = datetime.now(timezone.utc).isoformat()
        if not user:
            # Hard-deleted in the app: never hard-delete the Zoho Contact; set
            # App_Account_Status=Deleted and KEEP the record. Picklists are loaded
            # lazily so the mapped value is used.
            marked = False
            if crm_active:
                try:
                    if crm._picklists is None:
                        await crm.load_picklists()
                    marked = bool(await crm.mark_account_deleted(uid))
                except ZohoCRMError:
                    marked = False
            await db.zoho_outbox.update_many(
                {"user_id": uid, "status": {"$in": ["pending", "failed"]}},
                {"$set": {"status": "sent" if marked else "skipped",
                          "last_error": "marked Deleted in Zoho (kept)" if marked else "user_gone",
                          "updated_at": now}})
            if marked:
                sent += 1
            processed += 1
            if progress_key:
                await _set_progress(db, progress_key, sent=sent, failed=failed, skipped=skipped, remaining=total - processed)
            continue
        ok, reason = is_syncable_user(user)
        if not ok:
            skipped += 1
            processed += 1
            await db.zoho_outbox.update_many({"user_id": uid, "status": {"$in": ["pending", "failed"]}},
                                             {"$set": {"status": "skipped", "last_error": reason, "updated_at": now}})
            if progress_key:
                await _set_progress(db, progress_key, sent=sent, failed=failed, skipped=skipped, remaining=total - processed)
            continue
        err = None
        crm_ok = not crm_active  # if CRM disabled, it is "not done" -> keep pending below
        crm_done = False
        if crm_active:
            try:
                res = await _sync_with_retry(user)
                crm_ok = crm_done = True
                if res.get("account_id"):
                    logger.warning("[zoho_crm] lead convert created an Account %s for %s", res["account_id"], uid)
            except ZohoCRMError as e:
                err = f"crm:{e}"
        # Campaigns (independent of the CRM switch): subscribe when opted-in,
        # unsubscribe when opted-out. Only when the list key is configured.
        # Dedupe is state-change aware on BOTH opt-in AND primary market, so a
        # market change re-syncs (for newsletter segmentation) but an unchanged
        # user is never re-subscribed.
        camp_ok = True
        camp_held = False
        if camp_active:
            cur_optin = bool(user.get("newsletter_opt_in", True))
            cur_market = (user.get("primary_market") or "") if cur_optin else ""
            want = (cur_optin, cur_market)
            have = (user.get("zoho_campaigns_optin"), user.get("zoho_campaigns_market") or "")
            if want == have:
                camp_ok = True  # already in the desired list state; don't re-spam Campaigns
            else:
                try:
                    extra = None
                    if cur_optin and cur_market:
                        extra = {campaigns.cfg.market_field: cur_market}
                    cr = await campaigns.sync(email=(user.get("email") or ""),
                                              opt_in=cur_optin,
                                              first_name=user.get("name", ""),
                                              subscription=user.get("subscription_tier", "free"),
                                              extra=extra)
                    camp_ok = cr.get("status") in ("ok", "skipped")
                    if cr.get("extra_field_dropped"):
                        logger.info("[zoho] Campaigns market field '%s' not accepted; subscribed plain for %s",
                                    campaigns.cfg.market_field, uid)
                    if camp_ok:
                        await db.users.update_one(
                            {"user_id": uid},
                            {"$set": {"zoho_campaigns_optin": cur_optin,
                                      "zoho_campaigns_market": cur_market or None}})
                    else:
                        err = (err + "; " if err else "") + f"campaigns:{cr.get('status')}:{cr.get('http')}:{str(cr.get('body'))[:150]}"
                except Exception as e:  # noqa: BLE001
                    camp_ok = False
                    err = (err + "; " if err else "") + f"campaigns:{type(e).__name__}:{str(e) or 'no_detail'}"
        elif campaigns.cfg.ready_for_list_ops:
            # Campaigns list is configured but the kill switch is OFF. If this
            # user has a pending opt-in change (drift), HOLD it: make NO call and
            # keep the outbox row pending so it can fire later IF an admin turns
            # Campaigns on. Do not stamp the user's campaigns state (intent kept).
            cur_optin = bool(user.get("newsletter_opt_in", True))
            cur_market = (user.get("primary_market") or "") if cur_optin else ""
            want = (cur_optin, cur_market)
            have = (user.get("zoho_campaigns_optin"), user.get("zoho_campaigns_market") or "")
            if want != have:
                camp_held = True
        # Terminal: a HELD Campaigns item keeps the row pending (never sent) so
        # nothing fires now and the intent is not lost. Otherwise success only
        # when CRM is done AND campaigns succeeded.
        if camp_held:
            held += 1
            await db.zoho_outbox.update_many(
                {"user_id": uid, "status": {"$in": ["pending", "failed"]}},
                {"$set": {"last_error": "campaigns_held_kill_switch", "updated_at": now}})
        elif crm_active and crm_done and camp_ok:
            sent += 1
            await db.zoho_outbox.update_many(
                {"user_id": uid, "status": {"$in": ["pending", "failed"]}},
                {"$set": {"status": "sent", "last_error": None, "sent_at": now, "updated_at": now}})
        elif not crm_active and camp_ok:
            # Campaigns done, CRM waiting on the switch -> stay pending, note it.
            await db.zoho_outbox.update_many(
                {"user_id": uid, "status": {"$in": ["pending", "failed"]}},
                {"$set": {"last_error": "crm_disabled_campaigns_done", "updated_at": now}})
        else:
            failed += 1
            await db.zoho_outbox.update_many(
                {"user_id": uid, "status": {"$in": ["pending", "failed"]}},
                {"$inc": {"attempts": 1},
                 "$set": {"status": "failed", "last_error": (err or "unknown")[:400],
                          "error_detail": _parse_error_detail(err), "updated_at": now}})
        processed += 1
        if progress_key:
            await _set_progress(db, progress_key, sent=sent, failed=failed, skipped=skipped, remaining=total - processed)
        if crm_active and throttle:
            await asyncio.sleep(throttle + random.uniform(0, 0.2))
    return {"users": len(user_ids), "sent": sent, "failed": failed, "skipped": skipped,
            "held": held, "crm_active": crm_active, "campaigns_active": camp_active}


async def outbox_counts(db) -> Dict[str, int]:
    out = {}
    for st in ["pending", "sent", "failed", "skipped"]:
        out[st] = await db.zoho_outbox.count_documents({"status": st})
    return out


async def recent_failures(db, limit: int = 20) -> List[Dict[str, Any]]:
    """One row PER USER (the sync is coalesced per user, so multiple event rows
    for the same user are not shown twice). Includes the structured error_detail
    for the admin expand view. Never contains a token."""
    rows = await db.zoho_outbox.find(
        {"status": "failed"},
        {"_id": 0, "user_id": 1, "event": 1, "attempts": 1, "last_error": 1,
         "error_detail": 1, "updated_at": 1}).sort("updated_at", -1).to_list(500)
    seen: set = set()
    out: List[Dict[str, Any]] = []
    for r in rows:
        if r["user_id"] in seen:
            continue
        seen.add(r["user_id"])
        if not r.get("error_detail"):
            r["error_detail"] = _parse_error_detail(r.get("last_error"))
        out.append(r)
        if len(out) >= limit:
            break
    return out


async def reconcile(db, progress: bool = False) -> Dict[str, Any]:
    """Re-process failed + pending rows (startup catch-up / nightly). Resets failed
    rows under the attempt cap back to pending first."""
    await db.zoho_outbox.update_many({"status": "failed", "attempts": {"$lt": MAX_ATTEMPTS}},
                                     {"$set": {"status": "pending"}})
    res = await process_outbox(db, limit=5000,
                               progress_key="zoho_crm_job" if progress else None,
                               throttle=_THROTTLE if progress else 0.0)
    counts = await outbox_counts(db)
    return {"processed": res, "counts": counts}


_THROTTLE = 0.3  # seconds between users during backfill/reconcile jobs


async def requeue_failed(db) -> int:
    """Hard requeue: reset ALL failed rows to pending with attempts=0 (so rows
    that exceeded MAX_ATTEMPTS are retried too) and clear the stored error."""
    res = await db.zoho_outbox.update_many(
        {"status": "failed"},
        {"$set": {"status": "pending", "attempts": 0, "last_error": None, "error_detail": None}})
    return res.modified_count


# ---------- background job (so backfill/reconcile never run in one long HTTP call) ----------
async def job_status(db) -> Dict[str, Any]:
    doc = await db.app_meta.find_one({"key": "zoho_crm_job"}, {"_id": 0})
    return doc or {"status": "idle"}


async def start_job(db, kind: str) -> bool:
    """Start a background backfill/reconcile. Returns False if one is running."""
    doc = await db.app_meta.find_one({"key": "zoho_crm_job"}, {"_id": 0, "status": 1})
    if doc and doc.get("status") == "running":
        return False
    now = datetime.now(timezone.utc).isoformat()
    await db.app_meta.update_one(
        {"key": "zoho_crm_job"},
        {"$set": {"key": "zoho_crm_job", "kind": kind, "status": "running", "total": 0,
                  "sent": 0, "failed": 0, "skipped": 0, "remaining": 0, "message": None,
                  "started_at": now, "finished_at": None, "updated_at": now}}, upsert=True)
    asyncio.create_task(_run_job(db, kind))
    return True


async def _run_job(db, kind: str) -> None:
    try:
        if kind == "backfill":
            await backfill(db, dry_run=False, progress=True)
        else:
            await reconcile(db, progress=True)
        await _set_progress(db, "zoho_crm_job", status="done",
                            finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as e:  # noqa: BLE001
        logger.exception("[zoho_crm] background %s job failed", kind)
        await _set_progress(db, "zoho_crm_job", status="error", message=type(e).__name__,
                            finished_at=datetime.now(timezone.utc).isoformat())


# ---------- backfill ----------
async def market_preview() -> Dict[str, Any]:
    """Preview table of app market -> exact value that will be sent to Zoho's
    Market field, computed from the LIVE picklist. Safe to call with CRM gated
    off (it only needs read creds). When metadata cannot be loaded it returns
    live=False and no mapping, so the admin page can say "connect to preview"."""
    from constants import PNW_MARKETS
    live = False
    try:
        if crm.cfg.ready:
            await crm.load_picklists()
            live = bool(crm._picklists) and "Market" in (crm._picklists or {})
    except Exception:
        logger.info("[zoho_crm] market_preview could not load picklists")
    rows: List[Dict[str, Any]] = []
    for m in PNW_MARKETS:
        if live:
            sent = crm.map_picklist("Market", m)
            rows.append({"app": m, "sends": sent if sent is not None else "Other (fallback)"})
        else:
            rows.append({"app": m, "sends": None})
    return {"live": live, "rows": rows}


async def backfill(db, dry_run: bool = True, progress: bool = False) -> Dict[str, Any]:
    """Partition all users into eligible vs excluded. Dry run returns counts +
    HANDLES only (never emails). A live run enqueues every eligible user with
    Signup_Source=Alpha Tester and drains the outbox (idempotent upsert)."""
    from zoho_secrets import get_refresh_token, sync_enabled
    crm.set_refresh_token(await get_refresh_token(db) or "")
    await refresh_exclusions(db)
    eligible: List[str] = []
    excluded: List[Dict[str, str]] = []
    suspects: List[Dict[str, str]] = []
    async for u in db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "handle": 1,
                                      "account_type": 1, "name": 1, "org_name": 1}):
        ok, reason = is_syncable_user(u)
        if ok:
            eligible.append(u.get("handle") or u.get("user_id"))
            flag = looks_like_test(u)
            if flag:
                suspects.append({"handle": u.get("handle") or u.get("user_id"), "reason": flag})
        else:
            excluded.append({"handle": u.get("handle") or u.get("user_id"), "reason": reason})
    result = {"dry_run": dry_run, "eligible_count": len(eligible), "excluded_count": len(excluded),
              "eligible_handles": eligible, "excluded": excluded, "test_suspects": suspects}
    result["market_map"] = await market_preview()
    if dry_run:
        await db.app_meta.update_one({"key": "zoho_backfill_dryrun"},
                                     {"$set": {"key": "zoho_backfill_dryrun",
                                               "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        return result
    if not await sync_enabled(db):
        result["note"] = "CRM sync is OFF; nothing sent. Turn it on from the admin Zoho screen."
        return result
    async for u in db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "handle": 1,
                                      "account_type": 1, "name": 1, "org_name": 1}):
        ok, _ = is_syncable_user(u)
        if ok:
            await enqueue(db, "backfill", u["user_id"])
    drain = await process_outbox(db, limit=5000,
                                 progress_key="zoho_crm_job" if progress else None,
                                 throttle=_THROTTLE if progress else 0.0)
    result["drain"] = drain
    return result
