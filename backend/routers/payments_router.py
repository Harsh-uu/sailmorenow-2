"""Stripe SUBSCRIPTION billing (BILLING-1). Webhooks are the single source of
truth for tier + expiry. Replaces the old one-time stacking/queue model."""
from __future__ import annotations
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import stripe
from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Depends
from fastapi.responses import JSONResponse

from deps import db, current_user_from_token, is_admin, require_admin, stripe_mode
from constants import SUBSCRIPTION_PACKAGES, package_total, tier_label, BOAT_PRO_TIER_RANK
import billing
from billing import (
    price_id_for, get_or_create_customer, user_trial_eligible, trial_settings,
    apply_subscription_entitlement, effective_tier, STRIPE_WEBHOOK_SECRET,
    promo_eligible, find_promotion_code, PROMO_MONTHS,
)

logger = logging.getLogger("smn.payments")
router = APIRouter()

AUDIENCE_FOR = {"sailor": "sailor", "boat_owner": "boat_owner", "boat_pro": "boat_pro"}

# A subscription that still entitles the user. While one of these is on file we
# must NEVER open a new Checkout (that would create a second Stripe sub); the
# user switches plans via /subscription/upgrade or /subscription/change instead.
_LIVE_STATUSES = {"active", "trialing", "past_due"}


def _subscription_is_live(u: dict) -> bool:
    return bool(u.get("stripe_subscription_id")) and (u.get("subscription_status") in _LIVE_STATUSES)


def _pkg_rank(pkg: dict) -> int:
    """Tier rank for the upgrade/downgrade decision. Boat Pro has three tiers;
    sailor/owner have a single paid tier, so any same-audience switch there is a
    term change (handled as a scheduled downgrade, never an immediate charge)."""
    if (pkg or {}).get("audience") == "boat_pro":
        return BOAT_PRO_TIER_RANK.get(pkg.get("tier"), 0)
    return 1


def _switch_kind(u: dict, target_pkg: dict) -> str:
    cur_pkg = SUBSCRIPTION_PACKAGES.get(u.get("subscription_package_id") or "") or {}
    return "upgrade" if _pkg_rank(target_pkg) > _pkg_rank(cur_pkg) else "downgrade"


def _assert_audience(u: dict, pkg: dict):
    allowed = AUDIENCE_FOR.get(u.get("account_type"))
    if allowed is None:
        raise HTTPException(status_code=403, detail="Your account type can't purchase a membership here. Please contact support.")
    if pkg["audience"] != allowed:
        raise HTTPException(status_code=403, detail=f"This plan is for {pkg['audience'].replace('_', ' ')} accounts and doesn't match your account type.")


async def _ensure_boat_pro_listing(user_id: str, tier: str):
    """Create a Boat Pro's directory listing when their plan goes active
    (no listing at signup). Idempotent upsert; only for boat_pro accounts."""
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "company_name": 1, "account_type": 1})
    if not u or u.get("account_type") != "boat_pro":
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.boat_pros.update_one(
        {"user_id": user_id},
        {"$set": {"tier": tier, "updated_at": now},
         "$setOnInsert": {"user_id": user_id, "company_name": (u.get("company_name") or "").strip() or None,
                          "created_at": now}},
        upsert=True)


@router.get("/payments/mode")
async def payments_mode():
    out = dict(stripe_mode())
    s = await trial_settings()
    out["trial_enabled"] = bool(s["trial_enabled"])
    out["trial_days"] = int(s["trial_days"])
    return out


@router.get("/payments/packages")
async def payments_packages(session_token: Optional[str] = Cookie(default=None),
                            authorization: Optional[str] = Header(default=None)):
    """Catalog for the pricing page. Includes per-package trial eligibility for
    the signed-in user so the UI can show the trial disclosure."""
    u = await current_user_from_token(session_token, authorization)
    out = []
    for pid, pkg in SUBSCRIPTION_PACKAGES.items():
        row = {"package_id": pid, "tier": pkg["tier"], "audience": pkg["audience"],
               "months": pkg["months"], "monthly": pkg["monthly"], "discount": pkg["discount"],
               "total": package_total(pkg)}
        row["trial_eligible"] = bool(u and await user_trial_eligible(u, pid))
        out.append(row)
    return out


async def _promo_rate_ok(user_id: str, ip: str) -> bool:
    """Max 8 promo-validate attempts per user and per IP within 10 minutes."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=10)).isoformat()
    await db.promo_attempts.delete_many({"at": {"$lt": (now - timedelta(hours=1)).isoformat()}})
    u_ct = await db.promo_attempts.count_documents({"user_id": user_id, "at": {"$gte": cutoff}})
    ip_ct = await db.promo_attempts.count_documents({"ip": ip, "at": {"$gte": cutoff}})
    await db.promo_attempts.insert_one({"user_id": user_id, "ip": ip, "at": now.isoformat()})
    return u_ct < 8 and ip_ct < 8


async def _validate_promo(u: dict, package_id: str, code: str, ip: str):
    """Shared validation for the validate endpoint and checkout. Returns the
    Stripe PromotionCode on success, or raises HTTPException with a plain reason."""
    pkg = SUBSCRIPTION_PACKAGES.get(package_id)
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package_id")
    _assert_audience(u, pkg)
    if not await _promo_rate_ok(u["user_id"], ip):
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a few minutes and try again.")
    if pkg["months"] != 1:
        raise HTTPException(status_code=400, detail="This code is valid only on monthly plans.")
    if u.get("trial_used") or u.get("had_paid_plan"):
        raise HTTPException(status_code=400, detail="You already used a free trial or promo.")
    if (u.get("subscription_tier") or "free") != "free":
        raise HTTPException(status_code=400, detail="You already have a plan.")
    pc = find_promotion_code(code)
    if not pc:
        raise HTTPException(status_code=400, detail="That code is not valid or has expired.")
    coupon = pc.get("coupon") or {}
    if not coupon.get("valid"):
        raise HTTPException(status_code=400, detail="That code has been used up or expired.")
    return pc, pkg


@router.post("/payments/promo/validate")
async def promo_validate(body: dict, request: Request,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ip = (request.client.host if request.client else "") or request.headers.get("x-forwarded-for", "")
    pc, pkg = await _validate_promo(u, body.get("package_id"), body.get("code") or "", ip)
    coupon = pc.get("coupon") or {}
    months = int(coupon.get("duration_in_months") or PROMO_MONTHS)
    first_charge = _iso_date(_now_plus_months(months))
    return {
        "valid": True,
        "free_months": months,
        "first_charge_date": first_charge,
        "price": package_total(pkg),
        "code": pc.get("code"),
    }


def _now_plus_months(months: int):
    d = datetime.now(timezone.utc)
    m = d.month - 1 + months
    y = d.year + m // 12
    mo = m % 12 + 1
    import calendar
    day = min(d.day, calendar.monthrange(y, mo)[1])
    return d.replace(year=y, month=mo, day=day)


def _iso_date(d) -> str:
    return d.date().isoformat()


@router.post("/payments/checkout")
async def create_checkout(body: dict, request: Request,
                          session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if u.get("banned"):
        raise HTTPException(status_code=403, detail="Account is suspended.")
    # Checkout is allowed during the 24h verification grace window, but blocked once
    # a long-unverified account is locked.
    from deps import require_not_locked
    require_not_locked(u)
    package_id = body.get("package_id")
    pkg = SUBSCRIPTION_PACKAGES.get(package_id)
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package_id")
    _assert_audience(u, pkg)
    # Hard guard: one Stripe subscription per account. An existing subscriber must
    # switch plans, not buy a second one.
    if _subscription_is_live(u):
        raise HTTPException(status_code=409, detail="You already have an active plan. Change or upgrade it from Your plan instead.")
    price_id = price_id_for(package_id)
    if not price_id:
        raise HTTPException(status_code=500, detail="Price not configured. Run setup_stripe.py.")
    customer_id = await get_or_create_customer(u)
    origin = (body.get("origin_url") or "").rstrip("/")
    promo_code = (body.get("promo_code") or "").strip()
    sub_data: Dict[str, Any] = {"metadata": {"user_id": u["user_id"], "package_id": package_id}}
    session_kwargs: Dict[str, Any] = {}
    trial = False
    if promo_code:
        # A signup code REPLACES the trial: no trial period, card required up
        # front, promotion code applied by us (never Stripe's checkout code box).
        ip = (request.client.host if request.client else "") or request.headers.get("x-forwarded-for", "")
        pc, _pkg = await _validate_promo(u, package_id, promo_code, ip)
        months = int((pc.get("coupon") or {}).get("duration_in_months") or PROMO_MONTHS)
        sub_data["metadata"]["promo"] = "1"
        sub_data["metadata"]["promo_months"] = str(months)
        session_kwargs["discounts"] = [{"promotion_code": pc["id"]}]
    else:
        trial = await user_trial_eligible(u, package_id)
        s = await trial_settings()
        if trial:
            sub_data["trial_period_days"] = s["trial_days"]
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        # Card only. Apple Pay, Google Pay and Link ride the card rail and still
        # appear automatically; this pins the set so a dashboard change cannot
        # enable a method (Klarna, Cash App Pay, bank debit) that fails on renewal.
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        subscription_data=sub_data,
        payment_method_collection="always",
        success_url=f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/payment/success?status=canceled",
        metadata={"user_id": u["user_id"], "package_id": package_id},
        **session_kwargs,
    )
    await db.payment_transactions.insert_one({
        "session_id": session.id, "user_id": u["user_id"], "email": u.get("email"),
        "package_id": package_id, "amount": package_total(pkg), "currency": "usd",
        "trial": trial, "promo": bool(promo_code), "status": "initiated", "payment_status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()})
    return {"url": session.url, "session_id": session.id, "trial": trial,
            "promo": bool(promo_code),
            "trial_days": (await trial_settings())["trial_days"] if trial else 0}


@router.get("/payments/subscription")
async def my_subscription(session_token: Optional[str] = Cookie(default=None),
                          authorization: Optional[str] = Header(default=None)):
    """Entitlement summary for the 'Your plan' screen. All dates come from our
    webhook-written fields; the client composes the approved wording."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    tier = u.get("subscription_tier") or "free"
    if tier == "free":
        return {"is_free": True, "tier": "free"}
    provider = u.get("subscription_provider")
    if provider == "comp":
        grant = await db.comp_grants.find_one({"id": u.get("comp_grant_id")}, {"_id": 0}) if u.get("comp_grant_id") else None
        return {
            "is_free": False, "comp": True, "tier": tier, "tier_label": tier_label(tier),
            "status": "active", "provider": "comp",
            "renews_at": None, "end_at": u.get("subscription_expires"),
            "reason": (grant or {}).get("reason"),
            "can_manage": False, "cancel_at_period_end": False,
        }
    pid = u.get("subscription_package_id") or ""
    pkg = SUBSCRIPTION_PACKAGES.get(pid) or {}
    months = pkg.get("months")
    scheduled = u.get("subscription_scheduled")  # {tier,label,at}
    term_choice = u.get("subscription_term_choice")  # {package_id,label,months,price,at}
    free_until = u.get("subscription_free_until")
    trial_end = u.get("trial_end")
    in_free_period = bool((u.get("subscription_status") == "trialing" and trial_end) or (u.get("is_promo") and free_until))
    return {
        "is_free": False,
        "comp": False,
        "tier": tier,
        "tier_label": tier_label(tier),
        "package_id": pid,
        "interval_months": months,
        "price": package_total(pkg) if pkg else None,
        "status": u.get("subscription_status") or "active",
        "provider": provider or "stripe",
        "renews_at": u.get("subscription_expires"),
        "cancel_at_period_end": bool(u.get("subscription_cancel_at_period_end")),
        "scheduled_change": scheduled,
        "is_promo": bool(u.get("is_promo")),
        "in_free_period": in_free_period,
        "free_until": (free_until or trial_end),
        "term_choice": term_choice,
        "can_manage": bool(u.get("stripe_customer_id")) and (provider == "stripe"),
    }


def _active_sub_id(u: dict) -> str:
    sid = u.get("stripe_subscription_id")
    if not sid:
        raise HTTPException(status_code=400, detail="No active Stripe subscription.")
    return sid


@router.post("/payments/subscription/preview")
async def preview_switch(body: dict, session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Preview a plan switch for the confirm step. Returns the amount charged
    today for an upgrade (prorated, always_invoice) or the date a downgrade takes
    effect (end of the paid period, no charge now). Reads Stripe; writes nothing."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    target = body.get("package_id")
    pkg = SUBSCRIPTION_PACKAGES.get(target)
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package_id")
    _assert_audience(u, pkg)
    if not _subscription_is_live(u):
        raise HTTPException(status_code=400, detail="No active plan to change.")
    if (u.get("subscription_package_id") or "") == target:
        raise HTTPException(status_code=400, detail="You are already on this plan.")
    kind = _switch_kind(u, pkg)
    sub_id = _active_sub_id(u)
    sub = stripe.Subscription.retrieve(sub_id)
    item = sub["items"]["data"][0]
    cpe = sub.get("current_period_end") or item.get("current_period_end")
    eff = datetime.fromtimestamp(cpe, tz=timezone.utc).date().isoformat() if cpe else None
    to_tier = effective_tier(pkg["audience"], pkg["tier"])
    out = {"kind": kind, "to_tier": to_tier, "to_label": tier_label(pkg["tier"]),
           "interval_months": pkg["months"], "effective_at": eff}
    if kind == "upgrade":
        price_id = price_id_for(target)
        preview = stripe.Invoice.create_preview(
            customer=u["stripe_customer_id"], subscription=sub_id,
            subscription_details={"items": [{"id": item["id"], "price": price_id}],
                                  "proration_behavior": "always_invoice"})
        out["amount_today"] = round((preview.get("amount_due") or 0) / 100.0, 2)
        out["currency"] = (preview.get("currency") or "usd").upper()
        out["effective_at"] = datetime.now(timezone.utc).date().isoformat()
    else:
        out["amount_today"] = 0.0
        out["currency"] = "USD"
    return out


@router.post("/payments/subscription/upgrade")
async def upgrade(body: dict, session_token: Optional[str] = Cookie(default=None),
                  authorization: Optional[str] = Header(default=None)):
    """Immediate upgrade with proration (always_invoice). Boat Pro only."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    target = body.get("package_id")
    pkg = SUBSCRIPTION_PACKAGES.get(target)
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package_id")
    _assert_audience(u, pkg)
    if not _subscription_is_live(u):
        raise HTTPException(status_code=400, detail="No active plan to upgrade.")
    if (u.get("subscription_package_id") or "") == target:
        raise HTTPException(status_code=400, detail="You are already on this plan.")
    price_id = price_id_for(target)
    sub_id = _active_sub_id(u)
    sub = stripe.Subscription.retrieve(sub_id)
    item_id = sub["items"]["data"][0]["id"]
    updated = stripe.Subscription.modify(
        sub_id, items=[{"id": item_id, "price": price_id}],
        proration_behavior="always_invoice",
        metadata={"user_id": u["user_id"], "package_id": target})
    await apply_subscription_entitlement(updated)
    await db.users.update_one({"user_id": u["user_id"]}, {"$unset": {"subscription_scheduled": ""}})
    return {"ok": True, "tier": effective_tier(pkg["audience"], pkg["tier"])}


@router.post("/payments/subscription/change")
async def change_plan(body: dict, session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """Downgrade / term change at the end of the period, no charge now, via a
    Subscription Schedule. Stored as a scheduled_change for the UI."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    target = body.get("package_id")
    pkg = SUBSCRIPTION_PACKAGES.get(target)
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package_id")
    _assert_audience(u, pkg)
    if not _subscription_is_live(u):
        raise HTTPException(status_code=400, detail="No active plan to change.")
    if (u.get("subscription_package_id") or "") == target:
        raise HTTPException(status_code=400, detail="You are already on this plan.")
    price_id = price_id_for(target)
    sub_id = _active_sub_id(u)
    sub = stripe.Subscription.retrieve(sub_id)
    sched_id = sub.get("schedule")
    if not sched_id:
        sched = stripe.SubscriptionSchedule.create(from_subscription=sub_id)
        sched_id = sched.id
    sched = stripe.SubscriptionSchedule.retrieve(sched_id)
    item = sub["items"]["data"][0]
    cur_price = item["price"]["id"]
    cps = sub.get("current_period_start") or item.get("current_period_start")
    cpe = sub.get("current_period_end") or item.get("current_period_end")
    stripe.SubscriptionSchedule.modify(
        sched_id,
        phases=[
            {"items": [{"price": cur_price, "quantity": 1}],
             "start_date": cps, "end_date": cpe},
            {"items": [{"price": price_id, "quantity": 1}],
             "metadata": {"user_id": u["user_id"], "package_id": target}},
        ],
        end_behavior="release",
        proration_behavior="none")
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"subscription_scheduled": {
        "tier": effective_tier(pkg["audience"], pkg["tier"]),
        "label": tier_label(pkg["tier"]), "package_id": target,
        "at": datetime.fromtimestamp(cpe, tz=timezone.utc).isoformat()}}})
    return {"ok": True, "scheduled_at": cpe}


@router.post("/payments/subscription/undo-change")
async def undo_change(session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sub = stripe.Subscription.retrieve(_active_sub_id(u))
    if sub.get("schedule"):
        stripe.SubscriptionSchedule.release(sub["schedule"])
    await db.users.update_one({"user_id": u["user_id"]}, {"$unset": {"subscription_scheduled": ""}})
    return {"ok": True}


@router.post("/payments/subscription/choose-term")
async def choose_term(body: dict, session_token: Optional[str] = Cookie(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """During a trial or promo free period, pick the plan LENGTH that starts on
    the first-charge date. No charge now; the term price is charged once when the
    free period ends. The 100%-off coupon can never touch the prepaid term
    because phase 1 is hard-bounded to the coupon end."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    target = body.get("package_id")
    pkg = SUBSCRIPTION_PACKAGES.get(target)
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package_id")
    _assert_audience(u, pkg)
    if not _subscription_is_live(u):
        raise HTTPException(status_code=400, detail="No active plan.")
    is_promo = bool(u.get("is_promo"))
    is_trial = u.get("subscription_status") == "trialing"
    if not (is_promo or is_trial):
        raise HTTPException(status_code=400, detail="You can only choose a plan length during your free period.")
    sub_id = _active_sub_id(u)
    sub = stripe.Subscription.retrieve(sub_id, expand=["discounts"])
    item = sub["items"]["data"][0]
    cur_price = item["price"]["id"]
    cps = sub.get("current_period_start") or item.get("current_period_start")
    # Free-period end: trial_end for a trial, coupon end for a promo.
    if is_promo:
        free_end = None
        for d in (sub.get("discounts") or []):
            if isinstance(d, dict) and d.get("end"):
                free_end = d["end"]; break
        if not free_end and u.get("subscription_free_until"):
            free_end = int(datetime.fromisoformat(u["subscription_free_until"]).timestamp())
    else:
        free_end = sub.get("current_period_end") or item.get("current_period_end") or sub.get("trial_end")
    if not free_end:
        raise HTTPException(status_code=400, detail="Could not determine your free-period end date.")
    target_price = price_id_for(target)
    # Release any existing schedule first so we can rebuild cleanly.
    if sub.get("schedule"):
        try:
            stripe.SubscriptionSchedule.release(sub["schedule"])
        except stripe.error.StripeError:
            pass
        sub = stripe.Subscription.retrieve(sub_id, expand=["discounts"])
    if pkg["months"] == 1:
        # Choosing monthly = the default. Revert any prior change and clear.
        if is_trial and not is_promo:
            stripe.Subscription.modify(sub_id, items=[{"id": item["id"], "price": cur_price}],
                                       proration_behavior="none")
        await db.users.update_one({"user_id": u["user_id"]}, {"$unset": {"subscription_term_choice": ""}})
        return {"ok": True, "reverted_to_monthly": True}
    if is_trial and not is_promo:
        # Trial: change the price in place while the trial is still running. No
        # schedule, no extra monthly charge. The term price is charged ONCE when
        # the trial ends (proration_behavior=none keeps it a clean single charge).
        monthly_pid = u.get("subscription_package_id") or ""
        stripe.Subscription.modify(
            sub_id, items=[{"id": item["id"], "price": target_price}],
            proration_behavior="none",
            metadata={"user_id": u["user_id"], "package_id": target, "term_monthly_pid": monthly_pid})
        at_iso = datetime.fromtimestamp(free_end, tz=timezone.utc).isoformat()
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"subscription_term_choice": {
            "package_id": target, "label": f"{pkg['months']} months", "months": pkg["months"],
            "price": package_total(pkg), "at": at_iso, "monthly_pid": monthly_pid}}})
        return {"ok": True, "effective_at": at_iso, "price": package_total(pkg), "months": pkg["months"]}
    phase1 = {"items": [{"price": cur_price, "quantity": 1}], "start_date": cps, "end_date": free_end}
    if is_promo:
        coupon_id = None
        for d in (sub.get("discounts") or []):
            if isinstance(d, dict) and (d.get("coupon") or {}).get("id"):
                coupon_id = d["coupon"]["id"]; break
        if coupon_id:
            phase1["discounts"] = [{"coupon": coupon_id}]
    sched = stripe.SubscriptionSchedule.create(from_subscription=sub_id)
    stripe.SubscriptionSchedule.modify(
        sched.id,
        phases=[phase1,
                {"items": [{"price": target_price, "quantity": 1}],
                 "metadata": {"user_id": u["user_id"], "package_id": target}}],
        end_behavior="release", proration_behavior="none")
    at_iso = datetime.fromtimestamp(free_end, tz=timezone.utc).isoformat()
    await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"subscription_term_choice": {
        "package_id": target, "label": f"{pkg['months']} months", "months": pkg["months"],
        "price": package_total(pkg), "at": at_iso}}})
    return {"ok": True, "effective_at": at_iso, "price": package_total(pkg), "months": pkg["months"]}


@router.post("/payments/subscription/undo-term")
async def undo_term(session_token: Optional[str] = Cookie(default=None),
                    authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sub = stripe.Subscription.retrieve(_active_sub_id(u))
    if sub.get("schedule"):
        try:
            stripe.SubscriptionSchedule.release(sub["schedule"])
        except stripe.error.StripeError:
            pass
    else:
        # Trial case: price was modified in place; revert to the monthly plan.
        tc = u.get("subscription_term_choice") or {}
        monthly_pid = tc.get("monthly_pid") or u.get("subscription_package_id")
        mp = price_id_for(monthly_pid) if monthly_pid else None
        if mp:
            stripe.Subscription.modify(sub["id"], items=[{"id": sub["items"]["data"][0]["id"], "price": mp}],
                                       proration_behavior="none",
                                       metadata={"user_id": u["user_id"], "package_id": monthly_pid})
    await db.users.update_one({"user_id": u["user_id"]}, {"$unset": {"subscription_term_choice": ""}})
    return {"ok": True}


@router.post("/payments/subscription/cancel")
async def cancel(session_token: Optional[str] = Cookie(default=None),
                 authorization: Optional[str] = Header(default=None)):
    """Cancel auto-renewal: keep the tier until period end, then free."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    updated = stripe.Subscription.modify(_active_sub_id(u), cancel_at_period_end=True)
    await apply_subscription_entitlement(updated)
    return {"ok": True, "cancel_at_period_end": True, "renews_at": u.get("subscription_expires")}


@router.post("/payments/subscription/resume")
async def resume(session_token: Optional[str] = Cookie(default=None),
                 authorization: Optional[str] = Header(default=None)):
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    updated = stripe.Subscription.modify(_active_sub_id(u), cancel_at_period_end=False)
    await apply_subscription_entitlement(updated)
    return {"ok": True, "cancel_at_period_end": False}


@router.post("/payments/portal")
async def portal(body: dict, session_token: Optional[str] = Cookie(default=None),
                 authorization: Optional[str] = Header(default=None)):
    """Stripe Customer Portal for card, invoices and cancellation."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not u.get("stripe_customer_id"):
        raise HTTPException(status_code=400, detail="No billing account yet.")
    origin = (body.get("origin_url") or "").rstrip("/")
    sess = stripe.billing_portal.Session.create(
        customer=u["stripe_customer_id"], return_url=f"{origin}/my-plan")
    return {"url": sess.url}


@router.get("/payments/status/{session_id}")
async def payment_status(session_id: str,
                         session_token: Optional[str] = Cookie(default=None),
                         authorization: Optional[str] = Header(default=None)):
    """Poll after checkout. Webhook is source of truth, but also reconcile here:
    if the session is complete, fetch the subscription and apply entitlement."""
    u = await current_user_from_token(session_token, authorization)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.get("user_id") != u["user_id"] and not is_admin(u):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        sess = stripe.checkout.Session.retrieve(session_id)
        if sess.get("subscription") and sess.get("status") == "complete":
            sub = stripe.Subscription.retrieve(sess["subscription"])
            await apply_subscription_entitlement(sub)
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"status": "completed", "payment_status": "paid"}})
    except stripe.error.StripeError:
        pass
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    return {"session_id": session_id, "status": tx.get("status"),
            "payment_status": tx.get("payment_status"), "trial": tx.get("trial", False)}


# --- Admin: trial toggle + comp grant (comp preserved from the old model) ---
@router.get("/admin/billing/trial")
async def admin_get_trial(admin=Depends(require_admin)):
    return await trial_settings()


@router.post("/admin/billing/trial")
async def admin_set_trial(body: dict, admin=Depends(require_admin)):
    old = await trial_settings()
    update = {"key": "billing"}
    if "trial_enabled" in body:
        update["trial_enabled"] = bool(body["trial_enabled"])
    if "trial_days" in body:
        update["trial_days"] = max(1, min(365, int(body["trial_days"])))
    await db.app_settings.update_one({"key": "billing"}, {"$set": update}, upsert=True)
    new = await trial_settings()
    try:
        from audit import log_admin_action
        await log_admin_action(
            admin, "edit", "billing_trial", "billing",
            summary=f"Trial {'on' if new['trial_enabled'] else 'off'}, {new['trial_days']} days",
            meta={"old": old, "new": new})
    except Exception:
        logger.exception("trial toggle audit failed")
    return new


# --- Webhook: the single source of truth ---
async def _handle_event(event: Dict[str, Any]):
    t = event["type"]
    obj = event["data"]["object"]
    if t.startswith("customer.subscription."):
        await apply_subscription_entitlement(obj)
        if t == "customer.subscription.updated" and obj.get("status") == "active":
            await _maybe_welcome(obj)
    elif t == "checkout.session.completed" and obj.get("subscription"):
        sub = stripe.Subscription.retrieve(obj["subscription"])
        await apply_subscription_entitlement(sub)
        await _maybe_welcome(sub)
    elif t == "invoice.payment_failed":
        await _on_payment_failed(obj)
    elif t == "invoice.paid":
        if obj.get("subscription"):
            sub = stripe.Subscription.retrieve(obj["subscription"])
            await apply_subscription_entitlement(sub)


async def _recipient(sub_or_cust) -> Optional[dict]:
    uid = (sub_or_cust.get("metadata") or {}).get("user_id")
    q = {"user_id": uid} if uid else {"stripe_customer_id": sub_or_cust.get("customer")}
    return await db.users.find_one(q, {"_id": 0, "email": 1, "name": 1, "subscription_tier": 1,
                                       "subscription_expires": 1, "welcome_sent": 1, "user_id": 1})


async def _maybe_welcome(sub):
    u = await _recipient(sub)
    if not u or u.get("welcome_sent"):
        return
    try:
        from mailer import send_email, billing_welcome_email_html
        await send_email(recipient_email=u["email"], subject="Welcome to Sail More Now",
                         html_content=billing_welcome_email_html(
                             name=u.get("name"), tier_label=tier_label(u.get("subscription_tier")),
                             renews_at=(u.get("subscription_expires") or "")[:10]))
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"welcome_sent": True}})
    except Exception:
        logger.exception("welcome email failed")


async def _on_payment_failed(invoice):
    if invoice.get("subscription"):
        sub = stripe.Subscription.retrieve(invoice["subscription"])
        await apply_subscription_entitlement(sub)
    u = await _recipient(invoice)
    if not u:
        return
    try:
        from mailer import send_email, billing_payment_failed_email_html
        await send_email(recipient_email=u["email"], subject="Your Sail More Now payment didn't go through",
                         html_content=billing_payment_failed_email_html(
                             name=u.get("name"), tier_label=tier_label(u.get("subscription_tier")),
                             update_url=invoice.get("hosted_invoice_url")))
    except Exception:
        logger.exception("payment-failed email failed")


@router.post("/stripe/webhook")
@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        logger.warning("stripe webhook signature/parse failed: %s", e)
        return JSONResponse({"received": False}, status_code=400)
    # Idempotency: record event id; skip if seen.
    try:
        res = await db.stripe_events.update_one(
            {"id": event["id"]},
            {"$setOnInsert": {"id": event["id"], "type": event["type"],
                              "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        if res.matched_count:
            return {"received": True, "duplicate": True}
    except Exception:
        pass
    try:
        await _handle_event(event)
    except Exception:
        logger.exception("stripe webhook handling failed for %s", event.get("type"))
    return {"received": True}
