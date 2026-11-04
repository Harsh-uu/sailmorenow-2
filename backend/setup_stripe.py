"""Create the Sail More Now Stripe subscription catalog (BILLING-1).

Idempotent. Runs in TEST or LIVE mode depending on which secret key is in the
environment (STRIPE_SECRET_KEY). 5 products, one recurring Price per package
(17 total) with stable lookup_keys that match constants.SUBSCRIPTION_PACKAGES.
Multi-month discounts are baked into the price amount. Resolve prices by
lookup_key at runtime; never hardcode price IDs.

    python setup_stripe.py            # uses STRIPE_SECRET_KEY from env
"""
import os
import sys
import stripe
from typing import Optional
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from constants import SUBSCRIPTION_PACKAGES, package_total  # noqa: E402

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")
SAAS_TAX_CODE = "txcd_10103001"  # Software as a service (digital subscription)

# One Product per tier that has its own feature set.
PRODUCTS = {
    "pro_basic":      {"name": "Boat Pro Basic",     "audience": "boat_pro"},
    "pro_featured":   {"name": "Boat Pro Featured",  "audience": "boat_pro"},
    "pro_premium":    {"name": "Boat Pro Premium",   "audience": "boat_pro"},
    "sailor_premium": {"name": "Sailor Premium",     "audience": "sailor"},
    "owner_premium":  {"name": "Boat Owner Premium", "audience": "boat_owner"},
}


def product_key_for(pkg_key: str) -> str:
    # pkg key e.g. "pro_basic_6" -> product "pro_basic"; "sailor_premium_3" -> "sailor_premium"
    return pkg_key.rsplit("_", 1)[0]


def recurring_for(months: int) -> dict:
    if months == 12:
        return {"interval": "year", "interval_count": 1}
    return {"interval": "month", "interval_count": months}


def get_or_create_product(emergent_id: str, name: str) -> stripe.Product:
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if p.get("metadata", {}).get("emergent_product_id") == emergent_id:
            return p
    return stripe.Product.create(
        name=name, tax_code=SAAS_TAX_CODE,
        metadata={"managed_by": "sailmorenow", "emergent_product_id": emergent_id})


def ensure_price(product_id: str, lookup_key: str, amount_cents: int, recurring: dict, meta: dict):
    existing = stripe.Price.list(lookup_keys=[lookup_key], active=True, limit=1).data
    if existing:
        pr = existing[0]
        same = (pr.unit_amount == amount_cents and pr.currency == "usd"
                and pr.recurring and pr.recurring.get("interval") == recurring["interval"]
                and pr.recurring.get("interval_count") == recurring["interval_count"])
        if same:
            return pr, "unchanged"
        stripe.Price.modify(pr.id, active=False)  # deactivate old, recreate below
    pr = stripe.Price.create(
        product=product_id, unit_amount=amount_cents, currency="usd",
        lookup_key=lookup_key, transfer_lookup_key=True,
        recurring=recurring, metadata=meta)
    return pr, "created"


# Signup promo: 100% off for 3 months. Different code per mode so a test code can
# never be redeemed in live. setup_stripe does not otherwise create coupons.
PROMO_CODE_FOR = {"test": "SMNTEST3FREE", "live": "SMNALPHA3FREE"}


def current_mode() -> str:
    m = (os.environ.get("STRIPE_MODE") or "").strip().lower()
    if m in ("test", "live"):
        return m
    return "live" if (stripe.api_key or "").startswith("sk_live") else "test"


def ensure_promo(mode: str) -> dict:
    """Idempotent: a 100%-off, repeating-3-months coupon + a promotion code with
    the mode's code. If the promotion code already exists it is reused as-is."""
    code = PROMO_CODE_FOR[mode]
    existing = stripe.PromotionCode.list(code=code, limit=1).data
    if existing:
        return {"code": code, "state": "unchanged", "id": existing[0].id}
    coupon = stripe.Coupon.create(
        percent_off=100, duration="repeating", duration_in_months=3,
        name=f"{code} (3 months free)",
        metadata={"managed_by": "sailmorenow"})
    pc = stripe.PromotionCode.create(coupon=coupon.id, code=code)
    return {"code": code, "state": "created", "id": pc.id, "coupon": coupon.id}


def sync_catalog(stripe_key: Optional[str] = None) -> dict:
    """Idempotently ensure the 5 products, 17 prices and the promo code exist in
    whichever Stripe mode is live. Returns a summary dict. Safe to re-run."""
    if stripe_key:
        stripe.api_key = stripe_key
    if not stripe.api_key:
        raise RuntimeError("No STRIPE_SECRET_KEY / STRIPE_API_KEY in env")
    mode = current_mode()
    acct = stripe.Account.retrieve()
    products: dict = {}
    prod_ids: dict = {}
    for pid, meta in PRODUCTS.items():
        prod = get_or_create_product(pid, meta["name"])
        products[pid] = prod
        prod_ids[pid] = prod.id
    created = unchanged = updated = 0
    prices = []
    for pkg_key, pkg in SUBSCRIPTION_PACKAGES.items():
        prod = products[product_key_for(pkg_key)]
        amount = int(round(package_total(pkg) * 100))
        pr, state = ensure_price(
            prod.id, pkg_key, amount, recurring_for(pkg["months"]),
            meta={"tier": pkg["tier"], "audience": pkg["audience"],
                  "months": str(pkg["months"]), "discount": str(pkg["discount"])})
        if state == "created":
            created += 1
        elif state == "unchanged":
            unchanged += 1
        else:
            updated += 1
        prices.append({"lookup_key": pkg_key, "amount": amount, "state": state, "id": pr.id})
    promo = ensure_promo(mode)
    return {
        "mode": mode, "account": acct.id,
        "products": prod_ids,
        "prices_created": created, "prices_unchanged": unchanged, "prices_updated": updated,
        "prices": prices,
        "promo_code": promo["code"], "promo_state": promo["state"],
    }


def main():
    summary = sync_catalog()
    print(f"Stripe account {summary['account']} ({summary['mode'].upper()})")
    for pid, pid_id in summary["products"].items():
        print(f"  product {pid} -> {pid_id}")
    for p in summary["prices"]:
        print(f"    price {p['lookup_key']:18s} ${p['amount']/100:7.2f} -> {p['id']} [{p['state']}]")
    print(f"  promo {summary['promo_code']} [{summary['promo_state']}]")
    print(f"Done: {len(summary['products'])} products, {len(summary['prices'])} prices.")


if __name__ == "__main__":
    main()
