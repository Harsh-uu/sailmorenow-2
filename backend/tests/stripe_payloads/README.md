# Stripe webhook payload fixtures (STRIPE-LIVE-PREP-1 Part B)

These are DOCUMENTATION-BUILT fixtures, NOT real captures. They are hand-built from
the Stripe API object reference and the basil 2025-03-31 changelog (the `parent` field
migration) to validate our parsing logic (`subscription_id_from_invoice`) and the
webhook event classification across BOTH the legacy (<=2024) and the newer
(basil/clover/endive) invoice shapes. Swap in a real exported event later if desired.
