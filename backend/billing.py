"""Stripe subscription billing (BILLING-1). Webhooks are the single source of
truth for tier + expiry. Uses the raw `stripe` SDK against the claimable
sandbox (STRIPE_SECRET_KEY). Discounts are baked into catalog prices; resolve
prices by lookup_key, never hardcode ids."""
from __future__ import annotations
import os
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

import stripe
from dotenv import load_dotenv
load_dotenv()

from deps import db
from constants import SUBSCRIPTION_PACKAGES

logger = logging.getLogger("smn.billing")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")
# Pin a stable API version: the account default (2026 clover) changed coupon /
# promotion-code / discount params. We target the 2024-06-20 shapes everywhere.
stripe.api_version = os.environ.get("STRIPE_API_VERSION", "2024-06-20")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

TRIAL_ENABLED_DEFAULT = os.environ.get("TRIAL_ENABLED", "1") not in ("0", "false", "False", "")
TRIAL_DAYS_DEFAULT = int(os.environ.get("TRIAL_DAYS", "30") or 30)

_price_cache: Dict[str, str] = {}


def effective_tier(audience: str, tier: str) -> str:
    return "premium" if audience in ("sailor", "boat_owner") else tier


def mask_email(email: Optional[str]) -> str:
    """Mask an email for logs: 'doug@topmarktech.com' -> 'd***@topmarktech.com'."""
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    return (local[0] if local else "*") + "***@" + domain


def _as_id(v: Any) -> Optional[str]:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return v.get("id")
    return getattr(v, "id", None)


def subscription_id_from_invoice(invoice: Dict[str, Any]) -> Optional[str]:
    """Resolve a subscription id from an Invoice across Stripe API versions.

    Legacy (<= 2024): top-level `invoice.subscription`. From 2025-03-31.basil
    onward (basil / clover / endive) that field was removed in favour of
    `invoice.parent.subscription_details.subscription` (guard on
    `parent.type == "subscription_details"`), with a per-line equivalent at
    `line.parent.subscription_item_details.subscription`. As a last resort we look
    up the customer's most recent subscription. Returns None only when truly
    unresolvable - callers must log and return 2xx, never drop silently."""
    sid = _as_id(invoice.get("subscription"))
    if sid:
        return sid
    parent = invoice.get("parent") or {}
    if parent.get("type") == "subscription_details":
        sid = _as_id((parent.get("subscription_details") or {}).get("subscription"))
        if sid:
            return sid
    for line in ((invoice.get("lines") or {}).get("data") or []):
        lp = line.get("parent") or {}
        sid = _as_id((lp.get("subscription_item_details") or {}).get("subscription"))
        if sid:
            return sid
    cust = _as_id(invoice.get("customer"))
    if cust:
        try:
            subs = stripe.Subscription.list(customer=cust, status="all", limit=1).data
            if subs:
                logger.warning("invoice %s: subscription resolved via customer fallback",
                               invoice.get("id"))
                return subs[0].id
        except Exception:
            logger.exception("invoice %s: customer-fallback lookup failed", invoice.get("id"))
    return None


async def trial_settings() -> Dict[str, Any]:
    doc = await db.app_settings.find_one({"key": "billing"}) or {}
    return {
        "trial_enabled": doc.get("trial_enabled", TRIAL_ENABLED_DEFAULT),
        "trial_days": int(doc.get("trial_days", TRIAL_DAYS_DEFAULT)),
    }


def price_id_for(lookup_key: str) -> Optional[str]:
    if lookup_key in _price_cache:
        return _price_cache[lookup_key]
    data = stripe.Price.list(lookup_keys=[lookup_key], active=True, limit=1).data
    if not data:
        return None
    _price_cache[lookup_key] = data[0].id
    return data[0].id


def package_trial_allowed(package_id: str) -> bool:
    """Trial applies to EVERY monthly paid plan (member monthly and Boat Pro
    Basic/Featured/Premium monthly). Never on multi-month plans."""
    pkg = SUBSCRIPTION_PACKAGES.get(package_id)
    return bool(pkg and pkg["months"] == 1)


async def user_trial_eligible(user: Dict[str, Any], package_id: str) -> bool:
    """One trial per account ever; not on upgrades or anyone who has previously
    had a paid plan. Current plan must be free."""
    s = await trial_settings()
    if not s["trial_enabled"]:
        return False
    if not package_trial_allowed(package_id):
        return False
    if user.get("trial_used"):
        return False
    if user.get("had_paid_plan"):
        return False
    if (user.get("subscription_tier") or "free") != "free":
        return False  # upgrade / already paid
    return True


def _iso(ts: Optional[int]) -> Optional[str]:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _add_months_ts(ts: Optional[int], months: int) -> Optional[int]:
    if not ts:
        return None
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    m = d.month - 1 + months
    y = d.year + m // 12
    mo = m % 12 + 1
    import calendar
    day = min(d.day, calendar.monthrange(y, mo)[1])
    return int(d.replace(year=y, month=mo, day=day).timestamp())


def _discount_end(sub: Dict[str, Any]) -> Optional[str]:
    """Exact coupon end timestamp for a promo subscription, if present."""
    discs = sub.get("discounts") or []
    for d in discs:
        if isinstance(d, dict) and d.get("end"):
            return _iso(d["end"])
    d = sub.get("discount")
    if isinstance(d, dict) and d.get("end"):
        return _iso(d["end"])
    return None


PROMO_MONTHS = 3  # coupon: 100% off, repeating, 3 months


def _subscription_is_live_user(u: Dict[str, Any]) -> bool:
    return bool(u.get("stripe_subscription_id")) and (
        u.get("subscription_status") in ("active", "trialing", "past_due")) and (
        u.get("subscription_provider") == "stripe")


async def promo_eligible(user: Dict[str, Any], package_id: str) -> bool:
    """Signup-code eligibility: monthly plans only; never for anyone who already
    used a trial or has had a paid plan; current plan must be free."""
    pkg = SUBSCRIPTION_PACKAGES.get(package_id)
    if not pkg or pkg["months"] != 1:
        return False
    if user.get("trial_used") or user.get("had_paid_plan"):
        return False
    if (user.get("subscription_tier") or "free") != "free":
        return False
    return True


def find_promotion_code(code: str):
    """Look up an ACTIVE Stripe promotion code by its customer-facing code.
    Returns the PromotionCode object or None."""
    if not code:
        return None
    data = stripe.PromotionCode.list(code=code.strip(), active=True, limit=1).data
    return data[0] if data else None


# ---------------- Complimentary (comp) grants ----------------
COMP_TIERS = ["basic", "featured", "premium", "community_partner", "founding_partner"]


async def grant_comp(user_id: str, tier: str, reason: str, admin: Dict[str, Any],
                     end_at: Optional[str] = None) -> Dict[str, Any]:
    """Grant a complimentary tier (no Stripe sub, no card). Idempotent-ish:
    supersedes any prior active grant for the same user."""
    import uuid as _uuid
    now = datetime.now(timezone.utc).isoformat()
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "subscription_provider": 1})
    prior_provider = (u or {}).get("subscription_provider")
    await db.comp_grants.update_many(
        {"user_id": user_id, "status": "active"},
        {"$set": {"status": "superseded", "ended_reason": "regranted", "updated_at": now}})
    grant = {
        "id": str(_uuid.uuid4()), "user_id": user_id, "tier": tier,
        "reason": reason.strip(), "granted_by": admin.get("user_id"),
        "granted_by_name": admin.get("name") or admin.get("email"),
        "start_at": now, "end_at": end_at, "status": "active",
        "prior_provider": prior_provider, "created_at": now, "updated_at": now,
    }
    await db.comp_grants.insert_one(dict(grant))
    await db.users.update_one({"user_id": user_id}, {"$set": {
        "subscription_tier": tier, "subscription_provider": "comp",
        "subscription_status": "active", "subscription_expires": end_at,
        "subscription_cancel_at_period_end": False, "comp_grant_id": grant["id"],
    }, "$unset": {"subscription_scheduled": "", "subscription_free_until": "", "is_promo": ""}})
    grant.pop("_id", None)
    return grant


async def revoke_comp(user_id: str, grant_id: Optional[str] = None,
                      reason: str = "revoked") -> bool:
    now = datetime.now(timezone.utc).isoformat()
    q = {"user_id": user_id, "status": "active"}
    if grant_id:
        q["id"] = grant_id
    res = await db.comp_grants.update_many(q, {"$set": {
        "status": "revoked" if reason == "revoked" else "expired",
        "ended_reason": reason, "ended_at": now, "updated_at": now}})
    await db.users.update_one(
        {"user_id": user_id, "subscription_provider": "comp"},
        {"$set": {"subscription_tier": "free", "subscription_provider": None,
                  "subscription_status": None, "subscription_expires": None},
         "$unset": {"comp_grant_id": ""}})
    return res.modified_count > 0


async def apply_subscription_entitlement(sub: Dict[str, Any]) -> Optional[str]:
    """Write our entitlement from a live Stripe Subscription object. Returns the
    user_id updated, or None. This is the ONLY place a Stripe tier is granted."""
    uid = (sub.get("metadata") or {}).get("user_id")
    cust = sub.get("customer")
    if not uid and cust:
        existing = await db.users.find_one({"stripe_customer_id": cust}, {"_id": 0, "user_id": 1})
        uid = existing and existing.get("user_id")
    if not uid:
        logger.warning("subscription %s has no user_id/customer mapping", sub.get("id"))
        return None
    # Comp guard: a complimentary grant is never overridden by a (possibly late)
    # Stripe event. Comp accounts have no live sub, but a trailing
    # subscription.deleted could otherwise wipe their tier.
    guard = await db.users.find_one({"user_id": uid}, {"_id": 0, "subscription_provider": 1})
    if guard and guard.get("subscription_provider") == "comp":
        logger.info("entitlement: skip comp account %s", uid)
        return uid
    item = (sub.get("items", {}).get("data") or [{}])[0]
    price = item.get("price") or {}
    lookup = price.get("lookup_key")
    pkg = SUBSCRIPTION_PACKAGES.get(lookup or "")
    status = sub.get("status")
    entitled = status in ("active", "trialing", "past_due")
    # Newer Stripe API versions expose current_period_end per item, not on the
    # subscription; fall back to the item, then to trial_end for trials.
    period_ts = (sub.get("current_period_end") or item.get("current_period_end")
                 or sub.get("trial_end"))
    period_end = _iso(period_ts)

    meta = sub.get("metadata") or {}
    is_promo = meta.get("promo") == "1"
    free_until = None
    if is_promo and entitled:
        # Free-period end = coupon end. Prefer Stripe's exact discount end; fall
        # back to start + promo_months.
        free_until = _discount_end(sub) or _iso(_add_months_ts(
            sub.get("start_date") or sub.get("created"), int(meta.get("promo_months") or 3)))

    update: Dict[str, Any] = {
        "stripe_customer_id": cust,
        "stripe_subscription_id": sub.get("id"),
        "subscription_status": status,
        "subscription_cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
        "subscription_provider": "stripe",
        "subscription_package_id": lookup,
        "subscription_free_until": free_until,
        "is_promo": is_promo,
    }
    if entitled and pkg:
        update["subscription_tier"] = effective_tier(pkg["audience"], pkg["tier"])
        update["subscription_expires"] = period_end
        update["had_paid_plan"] = True
        if status == "trialing":
            update["trial_used"] = True
            update["trial_end"] = _iso(sub.get("trial_end"))
        else:
            update["trial_end"] = None
    elif status in ("canceled", "unpaid", "incomplete_expired"):
        update["subscription_tier"] = "free"
        update["subscription_expires"] = None
        update["subscription_free_until"] = None
        update["is_promo"] = False

    await db.users.update_one({"user_id": uid}, {"$set": update})
    logger.info("entitlement: user=%s status=%s tier=%s lookup=%s", uid, status,
                update.get("subscription_tier"), lookup)
    # Boat Pro: create the directory listing the moment the plan is entitled.
    # Both the webhook and the return-page reconcile funnel through here, so this
    # is the single place a Stripe activation yields a listing (the legacy
    # queued_plans path in deps.py handled this only for the old one-time model).
    if entitled and pkg and pkg.get("audience") == "boat_pro":
        try:
            from routers.payments_router import _ensure_boat_pro_listing
            await _ensure_boat_pro_listing(uid, update.get("subscription_tier"))
        except Exception:
            logger.exception("entitlement: boat pro listing ensure failed for %s", uid)
    # Zoho CRM event (Campaigns stays OFF).
    try:
        from zoho_sync import enqueue as _zq
        await _zq(db, "plan_purchase", uid)
    except Exception:
        logger.exception("zoho enqueue failed for %s", uid)
    return uid


async def get_or_create_customer(user: Dict[str, Any]) -> str:
    if user.get("stripe_customer_id"):
        return user["stripe_customer_id"]
    cust = stripe.Customer.create(
        email=user.get("email"), name=user.get("name"),
        metadata={"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]},
                              {"$set": {"stripe_customer_id": cust.id}})
    return cust.id
