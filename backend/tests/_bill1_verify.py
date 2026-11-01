"""BILLING-1 Stripe subscription verification. Creates a temp user + a real
test-mode Stripe customer/subscription (trial), exercises entitlement, cancel,
resume, and trial-eligibility rules, then deletes ALL temp data (DB + Stripe).
No passwords. No emails sent from here."""
import os, sys, asyncio, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()
import stripe
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
from deps import db
import billing

UID = "billtest_" + uuid.uuid4().hex[:8]


async def main():
    ok = []
    user = {"user_id": UID, "email": f"{UID}@example.com", "name": "Bill Test",
            "account_type": "sailor", "subscription_tier": "free"}
    await db.users.insert_one(dict(user))

    # trial eligibility rules
    ok.append(("trial ok monthly sailor", await billing.user_trial_eligible(user, "sailor_premium_1")))
    ok.append(("no trial on 3mo", not await billing.user_trial_eligible(user, "sailor_premium_3")))
    ok.append(("no trial pro basic", not await billing.user_trial_eligible(user, "pro_basic_1")))

    # real Stripe customer + trialing subscription with a card
    cust = stripe.Customer.create(email=user["email"], metadata={"user_id": UID})
    await db.users.update_one({"user_id": UID}, {"$set": {"stripe_customer_id": cust.id}})
    pm = stripe.PaymentMethod.attach("pm_card_visa", customer=cust.id)
    stripe.Customer.modify(cust.id, invoice_settings={"default_payment_method": pm.id})
    price_id = billing.price_id_for("sailor_premium_1")
    sub = stripe.Subscription.create(
        customer=cust.id, items=[{"price": price_id}],
        trial_period_days=30, metadata={"user_id": UID, "package_id": "sailor_premium_1"})
    ok.append(("stripe sub trialing", sub.status == "trialing"))

    # entitlement from the live sub object (what the webhook does)
    await billing.apply_subscription_entitlement(sub)
    u = await db.users.find_one({"user_id": UID}, {"_id": 0})
    ok.append(("entitled tier premium", u.get("subscription_tier") == "premium"))
    ok.append(("status trialing", u.get("subscription_status") == "trialing"))
    ok.append(("trial_used set", u.get("trial_used") is True))
    ok.append(("provider stripe", u.get("subscription_provider") == "stripe"))
    ok.append(("expires set", bool(u.get("subscription_expires"))))

    # one trial per account: after trial_used, not eligible again
    ok.append(("trial not reusable", not await billing.user_trial_eligible(u, "sailor_premium_1")))

    # cancel at period end
    updated = stripe.Subscription.modify(sub.id, cancel_at_period_end=True)
    await billing.apply_subscription_entitlement(updated)
    u = await db.users.find_one({"user_id": UID}, {"_id": 0})
    ok.append(("cancel_at_period_end", u.get("subscription_cancel_at_period_end") is True))
    ok.append(("still entitled while trialing", u.get("subscription_tier") == "premium"))

    # resume
    updated = stripe.Subscription.modify(sub.id, cancel_at_period_end=False)
    await billing.apply_subscription_entitlement(updated)
    u = await db.users.find_one({"user_id": UID}, {"_id": 0})
    ok.append(("resumed", u.get("subscription_cancel_at_period_end") is False))

    print("=== results ===")
    for n, p in ok:
        print("PASS" if p else "FAIL", n)
    print("ALL PASS" if all(p for _, p in ok) else "SOME FAILED")

    # cleanup: Stripe (cancel sub, delete customer) + DB temp user
    try:
        stripe.Subscription.cancel(sub.id)
    except Exception as e:
        print("sub cancel cleanup:", e)
    try:
        stripe.Customer.delete(cust.id)
    except Exception as e:
        print("cust delete cleanup:", e)
    await db.users.delete_one({"user_id": UID})
    print("cleaned temp user + Stripe test objects")


asyncio.run(main())
