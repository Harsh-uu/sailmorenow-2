"""STRIPE-LIVE-PREP-1 Part B tests - webhook payload format handling.

Validates `billing.subscription_id_from_invoice` across the legacy and the
basil/clover/endive (`parent`) invoice shapes, the `mask_email` helper, and the
`_handle_event` classification (processed | ignored | unmapped | no_subscription).
All Stripe and DB calls are stubbed - NO live Stripe calls and no DB writes.
Fixtures are documentation-built (see stripe_payloads/README.md). Run with:
    cd /app/backend && python -m pytest tests/test_webhook_formats.py -q
"""
import asyncio
import json
import os
import types

import pytest

import billing
import routers.payments_router as pr

FIX = os.path.join(os.path.dirname(__file__), "stripe_payloads")


def load(name):
    with open(os.path.join(FIX, name)) as f:
        return json.load(f)


def obj(name):
    return load(name)["data"]["object"]


# ---------- subscription_id_from_invoice ----------
def test_invoice_legacy_top_level():
    assert billing.subscription_id_from_invoice(obj("invoice_paid_legacy.json")) == "sub_legacy"


def test_invoice_endive_parent():
    assert billing.subscription_id_from_invoice(obj("invoice_paid_endive.json")) == "sub_endive"


def test_invoice_endive_lines_only():
    assert billing.subscription_id_from_invoice(
        obj("invoice_payment_succeeded_endive_lines.json")) == "sub_lines"


def test_invoice_failed_parent():
    assert billing.subscription_id_from_invoice(obj("invoice_payment_failed_endive.json")) == "sub_failed"


def test_invoice_expanded_dict_subscription():
    assert billing.subscription_id_from_invoice({"subscription": {"id": "sub_expanded"}}) == "sub_expanded"


def test_invoice_customer_fallback(monkeypatch):
    called = {}

    def fake_list(customer=None, status=None, limit=None):
        called["customer"] = customer
        return types.SimpleNamespace(data=[types.SimpleNamespace(id="sub_fallback")])

    monkeypatch.setattr(billing.stripe.Subscription, "list", fake_list)
    inv = {"id": "in_x", "customer": "cus_z"}  # no subscription anywhere
    assert billing.subscription_id_from_invoice(inv) == "sub_fallback"
    assert called["customer"] == "cus_z"


def test_invoice_unresolvable_returns_none():
    assert billing.subscription_id_from_invoice({"id": "in_x"}) is None


# ---------- mask_email ----------
def test_mask_email():
    assert billing.mask_email("doug@topmarktech.com") == "d***@topmarktech.com"
    assert billing.mask_email(None) == "***"
    assert billing.mask_email("bogus") == "***"


# ---------- _handle_event classification ----------
def _stub_handlers(monkeypatch, entitled=True):
    async def fake_entitle(sub):
        return "user_doc" if entitled else None

    async def fake_welcome(sub):
        return None

    async def fake_recipient(x):
        return None  # skip the payment-failed email path

    def fake_retrieve(sid, **kw):
        return {"id": sid, "customer": "cus_doc", "status": "active",
                "metadata": {"user_id": "user_doc"},
                "items": {"data": [{"price": {"lookup_key": "sailor_premium_1"}}]}}

    monkeypatch.setattr(pr, "apply_subscription_entitlement", fake_entitle)
    monkeypatch.setattr(pr, "_maybe_welcome", fake_welcome)
    monkeypatch.setattr(pr, "_recipient", fake_recipient)
    monkeypatch.setattr(pr.stripe.Subscription, "retrieve", fake_retrieve)


@pytest.mark.parametrize("fixture", [
    "invoice_paid_legacy.json",
    "invoice_paid_endive.json",
    "invoice_payment_succeeded_endive_lines.json",
    "invoice_payment_failed_endive.json",
    "subscription_created_endive.json",
    "subscription_updated_endive.json",
    "subscription_deleted_endive.json",
    "checkout_session_completed.json",
])
def test_handle_event_processed(monkeypatch, fixture):
    _stub_handlers(monkeypatch, entitled=True)
    result = asyncio.run(pr._handle_event(load(fixture)))
    assert result == "processed", f"{fixture} -> {result}"


def test_handle_event_unknown_type_ignored(monkeypatch):
    _stub_handlers(monkeypatch, entitled=True)
    ev = {"id": "evt_pi", "type": "payment_intent.succeeded", "data": {"object": {"id": "pi_1"}}}
    assert asyncio.run(pr._handle_event(ev)) == "ignored"


def test_handle_event_checkout_without_subscription_ignored(monkeypatch):
    _stub_handlers(monkeypatch, entitled=True)
    ev = {"id": "evt_cs0", "type": "checkout.session.completed",
          "data": {"object": {"id": "cs_0", "status": "complete"}}}
    assert asyncio.run(pr._handle_event(ev)) == "ignored"


def test_handle_event_unmapped_subscription(monkeypatch):
    _stub_handlers(monkeypatch, entitled=False)  # entitlement resolves no user
    assert asyncio.run(pr._handle_event(load("subscription_created_endive.json"))) == "unmapped"


def test_handle_event_invoice_no_subscription(monkeypatch):
    _stub_handlers(monkeypatch, entitled=True)
    # no top-level, no parent, no lines, no customer -> cannot resolve
    ev = {"id": "evt_inv_none", "type": "invoice.paid",
          "data": {"object": {"id": "in_none"}}}
    assert asyncio.run(pr._handle_event(ev)) == "no_subscription"
