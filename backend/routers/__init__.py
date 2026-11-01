"""Router package for Sail More Now.

Each router is a domain slice:
  auth_router.py       - authentication + newsletter + admin (Zoho + scheduler)
  directory_router.py  - markets + Boat Pro directory + reviews + crew positions
  community_router.py  - posts + events + registrations + crew bank + aggregator admin
  messaging_router.py  - direct messaging + WebSocket
  payments_router.py   - Stripe checkout + webhook
  seed_router.py       - idempotent demo seed + health root
"""
