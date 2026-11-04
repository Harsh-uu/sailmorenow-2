"""STRIPE-LIVE-PREP-1 C5 - PRE-PUBLISH CLEANUP, DRY RUN ONLY.

Prints what the real cleanup WOULD do before the one-time preview->production DB
copy. It WRITES NOTHING and DELETES NOTHING. Run the real cleanup only after Jenn's
explicit go-ahead, right before the first Publish.

Option (a), approved: clear sandbox Stripe ids and KEEP the accounts; anyone whose
plan came only from a sandbox subscription (subscription_provider == 'stripe') reverts
to Free. Comp-grant users are ALWAYS protected. Real testers are protected via
REAL_TESTER_ALLOWLIST (fill in before the real run). Hyphens only.

    cd /app/backend && python prepublish_cleanup_dryrun.py
"""
import asyncio
from dotenv import load_dotenv
load_dotenv()
from deps import db  # noqa: E402

# Real testers to PROTECT (never cleared/deleted). Add emails before the real run.
REAL_TESTER_ALLOWLIST = set()

# Fields the real cleanup would $unset on each matched sandbox user (tier -> 'free').
SANDBOX_FIELDS = [
    "stripe_customer_id", "stripe_subscription_id", "subscription_package_id",
    "subscription_provider", "subscription_status", "subscription_expires",
    "is_promo", "trial_used", "trial_end",
]

DEMO_MATCH = {"$or": [
    {"user_id": {"$regex": "^seed_"}},
    {"email": {"$regex": r"@sailmorenow\.dev$"}},
]}

SANDBOX_MATCH = {"$and": [
    {"$or": [
        {"subscription_provider": "stripe"},
        {"stripe_customer_id": {"$nin": [None, ""]}},
        {"stripe_subscription_id": {"$nin": [None, ""]}},
    ]},
    {"subscription_provider": {"$ne": "comp"}},
]}


async def main():
    print("=== PRE-PUBLISH CLEANUP - DRY RUN (no writes, no deletes) ===\n")

    demo = await db.users.count_documents(DEMO_MATCH)
    print(f"[DEMO] seed/demo users that WOULD be removed: {demo}")
    async for u in db.users.find(DEMO_MATCH, {"_id": 0, "user_id": 1, "email": 1}):
        print(f"    - {u.get('user_id')}  {u.get('email')}")

    total = protected = 0
    matched = []
    async for u in db.users.find(SANDBOX_MATCH, {
            "_id": 0, "user_id": 1, "email": 1, "subscription_provider": 1,
            "subscription_tier": 1, "stripe_customer_id": 1, "stripe_subscription_id": 1}):
        if u.get("email") in REAL_TESTER_ALLOWLIST:
            protected += 1
            continue
        total += 1
        matched.append(u)

    comp = await db.users.count_documents({"subscription_provider": "comp"})

    print(f"\n[SANDBOX] users that WOULD have sandbox ids cleared + revert to Free: {total}")
    print(f"[SANDBOX] protected by allowlist (skipped): {protected}")
    print(f"[COMP]    comp-grant users ALWAYS protected (untouched): {comp}")
    print("\n--- matched sandbox users (review before the real run) ---")
    for u in matched:
        print(f"    {u.get('email')}  tier={u.get('subscription_tier')}  "
              f"provider={u.get('subscription_provider')}  "
              f"cus={u.get('stripe_customer_id')}  sub={u.get('stripe_subscription_id')}")

    print(f"\nFields the real run WOULD $unset on each: {', '.join(SANDBOX_FIELDS)}")
    print("and set subscription_tier -> 'free'.")
    print("\nDRY RUN COMPLETE. No documents were modified or deleted.")


if __name__ == "__main__":
    asyncio.run(main())
