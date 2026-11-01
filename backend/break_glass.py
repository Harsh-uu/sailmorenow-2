"""Off-by-default break-glass: temporarily re-enable password login for ONE admin
account if Google sign-in is unavailable.

Controlled ONLY by environment variables (never committed to the repo). The
password is NEVER stored in plain text: the environment carries a bcrypt HASH of
a freshly chosen password. The window auto-expires a short time after it is first
seen, even if the flag is left on, and every successful use is audit-logged and
emailed to ADMIN_NOTIFY_EMAIL (handled by the caller).

Environment variables (set via the secure environment, remove to disable):
  BREAK_GLASS_ENABLED=1
  BREAK_GLASS_EMAIL=<the admin email allowed to use password login>
  BREAK_GLASS_PASSWORD_HASH=<bcrypt hash of a freshly chosen password>
  BREAK_GLASS_WINDOW_MINUTES=30   (optional; default 30, hard-capped at 60)

To generate the hash WITHOUT the plaintext ever touching a file or a log, run
locally and paste only the printed hash into the secure environment:
  python -c "import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass().encode(),bcrypt.gensalt()).decode())"
"""
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta

from deps import db

DEFAULT_WINDOW = 30
MAX_WINDOW = 60
_TRUE = {"1", "true", "yes", "on"}


def _target_email() -> str | None:
    if (os.environ.get("BREAK_GLASS_ENABLED") or "").strip().lower() not in _TRUE:
        return None
    email = (os.environ.get("BREAK_GLASS_EMAIL") or "").strip().lower()
    h = os.environ.get("BREAK_GLASS_PASSWORD_HASH") or ""
    if not email or not h:
        return None
    return email


def window_minutes() -> int:
    try:
        n = int(os.environ.get("BREAK_GLASS_WINDOW_MINUTES") or DEFAULT_WINDOW)
    except ValueError:
        n = DEFAULT_WINDOW
    return max(1, min(n, MAX_WINDOW))


async def status_for(email: str) -> tuple[bool, str]:
    """(active, reason) for the given email. Only the configured break-glass email
    can ever be active. Activation time is recorded the first time the current
    window is seen so it auto-expires; re-arming with a new hash resets the clock."""
    target = _target_email()
    if not target or (email or "").strip().lower() != target:
        return False, "disabled"
    now = datetime.now(timezone.utc)
    win = window_minutes()
    sig = (os.environ.get("BREAK_GLASS_PASSWORD_HASH") or "")[:20]
    doc = await db.app_settings.find_one({"key": "break_glass"})
    if not doc or doc.get("sig") != sig:
        await db.app_settings.update_one(
            {"key": "break_glass"},
            {"$set": {"key": "break_glass", "sig": sig, "activated_at": now.isoformat()}},
            upsert=True,
        )
        started = now
    else:
        started = doc.get("activated_at") or now.isoformat()
        try:
            started = datetime.fromisoformat(started)
        except Exception:
            started = now
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
    if now > started + timedelta(minutes=win):
        return False, "expired"
    return True, "active"


def verify_password(password: str) -> bool:
    import bcrypt
    h = (os.environ.get("BREAK_GLASS_PASSWORD_HASH") or "").encode()
    if not h or not password:
        return False
    try:
        return bcrypt.checkpw(password.encode(), h)
    except Exception:
        return False
