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


def main():
    if not stripe.api_key:
        print("No STRIPE_SECRET_KEY / STRIPE_API_KEY in env"); sys.exit(1)
    acct = stripe.Account.retrieve()
    print(f"Stripe account {acct.id} ({'LIVE' if stripe.api_key.startswith('sk_live') else 'TEST'})")
    products = {}
    for pid, meta in PRODUCTS.items():
        prod = get_or_create_product(pid, meta["name"])
        products[pid] = prod
        print(f"  product {pid} -> {prod.id}")
    n = 0
    for pkg_key, pkg in SUBSCRIPTION_PACKAGES.items():
        prod = products[product_key_for(pkg_key)]
        amount = int(round(package_total(pkg) * 100))
        pr, state = ensure_price(
            prod.id, pkg_key, amount, recurring_for(pkg["months"]),
            meta={"tier": pkg["tier"], "audience": pkg["audience"],
                  "months": str(pkg["months"]), "discount": str(pkg["discount"])})
        n += 1
        print(f"    price {pkg_key:18s} ${amount/100:7.2f} {pkg['months']:>2}mo -> {pr.id} [{state}]")
    print(f"Done: {len(products)} products, {n} prices.")


if __name__ == "__main__":
    main()
