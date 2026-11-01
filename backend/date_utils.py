"""Canonical ISO-8601 date/datetime normalization.

Everywhere we write starts_at / ends_at (and any other user-supplied ISO
timestamps) we run the value through `normalize_iso` so mongo stores a single
canonical string format:

    "2026-08-21T15:30:00+00:00"

That makes the read-time string comparisons in list_events / past_event_predicate
correct by construction (no more "2026-08-21" < "2026-08-21T...Z" surprises).

Rules:
  - `None` / empty string → `None`
  - Date-only "YYYY-MM-DD"          → midnight UTC of that day
  - Trailing "Z"                    → "+00:00"
  - Naive datetime (no tzinfo)      → assumed UTC
  - Aware datetime with any offset  → converted to UTC
  - Unparseable string              → returned unchanged (fail-open)
"""
from __future__ import annotations
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Union

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_date_only(value) -> bool:
    """True iff the raw input represents an all-day (date-only) event."""
    return isinstance(value, str) and bool(_DATE_ONLY.match(value.strip()))


def event_no_time(ev_or_iso, time_not_listed=None) -> bool:
    """Authoritative 'this event has no listed time' decision.

    Prefer the explicit stored flag `time_not_listed`; fall back to the legacy
    midnight-UTC sentinel ONLY when the flag is absent (older rows written before
    the flag existed). Pass an event dict OR an iso string + explicit flag.

    A genuine timed event can land at exactly 00:00:00Z (e.g. 5:00 PM PDT). Such
    an event stores time_not_listed=False and therefore still shows its real time.
    """
    if isinstance(ev_or_iso, dict):
        flag = ev_or_iso.get("time_not_listed")
        iso = ev_or_iso.get("starts_at")
    else:
        flag = time_not_listed
        iso = ev_or_iso
    if isinstance(flag, bool):
        return flag
    s = str(iso or "")
    return (not s) or len(s) <= 10 or s.endswith("T00:00:00+00:00")


def end_before_start(starts, ends, time_not_listed=None) -> bool:
    """True when an event's end is not strictly after its start (a backwards range).
    Both are canonical UTC ISO strings (lexical compare matches chronological).
    A date-only event with end == start is allowed (same all-day date)."""
    if not starts or not ends:
        return False
    if ends > starts:
        return False
    if ends == starts and event_no_time(starts, time_not_listed):
        return False
    return True



def end_of_day_iso(date_str: str) -> Optional[str]:
    """Given 'YYYY-MM-DD', return midnight of the NEXT day as canonical UTC ISO
    so string comparisons like `ends_at >= now` keep the whole event day visible."""
    try:
        d = date.fromisoformat(date_str.strip()) + timedelta(days=1)
    except ValueError:
        return None
    return datetime.combine(d, time.min, tzinfo=timezone.utc).isoformat(timespec="seconds")


def normalize_iso(value: Union[str, datetime, date, None]) -> Optional[str]:
    if value in (None, ""):
        return None
    dt: Optional[datetime] = None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime.combine(value, time.min, tzinfo=timezone.utc)
    elif isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if _DATE_ONLY.match(s):
            try:
                d = date.fromisoformat(s)
                dt = datetime.combine(d, time.min, tzinfo=timezone.utc)
            except ValueError:
                return s
        else:
            try:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            except ValueError:
                return s
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat(timespec="seconds")



import calendar as _calendar


def add_months(dt: datetime, months: int) -> datetime:
    """Advance `dt` by `months` CALENDAR months (non-negative), keeping the time
    of day and tzinfo. A plan that starts on the 12th ends on the 12th N months
    later. When the start day does not exist in the target month (e.g. Jan 31 +
    1 month), the day is clamped to that month's last valid day (Feb 28/29).
    Leap years are handled by calendar.monthrange. Use this everywhere a plan
    end date is derived from a start date (never 30*months)."""
    month_index = (dt.month - 1) + int(months)
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    day = min(dt.day, _calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)
