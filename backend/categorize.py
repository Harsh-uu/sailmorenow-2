"""Keyword-based event categorizer. Unknown/ambiguous -> 'other' + needs_review flag for admins."""
import re
from typing import Dict, Any, Tuple

CATEGORIES = ["racing", "cruising", "social", "education", "volunteering", "other"]

# EVENTS-FIX-1: title keyword rules in priority order, FIRST MATCH WINS.
# Checked against the TITLE only (not the description) so an off-hand word in a
# long blurb cannot flip the category.
_ORDERED = [
    ("social",    r"\b(dinner|party|awards?|banquet|drinks?|potluck|social|fireside)\b"),
    ("education", r"\b(seminar|workshop|clinic)\b"),
    ("racing",    r"\b(regatta|races?|racing|opening day|cup|series|sailing on sundays)\b"),
    ("cruising",  r"\b(cruise|cruising|raft[- ]?up)\b"),
    ("other",     r"\b(meeting)\b"),
]
_COMPILED = [(c, re.compile(p, re.I)) for c, p in _ORDERED]

# A source's own event-type tag (e.g. the OWSA row label) mapped to our category.
_TAG_MAP = {
    "social": "social", "fireside": "social", "party": "social",
    "board meeting": "other", "meeting": "other",
    "race": "racing", "racing": "racing", "regatta": "racing", "series": "racing",
    "class": "education", "clinic": "education", "workshop": "education", "seminar": "education",
    "cruise": "cruising", "cruising": "cruising", "rendezvous": "cruising",
    "volunteer": "volunteering", "work party": "volunteering",
}


def categorize(ev: Dict[str, Any]) -> Tuple[str, bool]:
    """Return (category, needs_review). Explicit flags win, then TITLE keywords
    (first match wins), then the source's own type tag; unmatched -> other + review."""
    if ev.get("is_race"):
        return "racing", False
    if ev.get("is_volunteer"):
        return "volunteering", False
    title = ev.get("title") or ""
    for cat, rx in _COMPILED:
        if rx.search(title):
            return cat, False
    tag = (ev.get("source_tag") or "").strip().lower()
    if tag in _TAG_MAP:
        return _TAG_MAP[tag], False
    return "other", True


def apply_category(ev: Dict[str, Any]) -> Dict[str, Any]:
    if ev.get("category_manual") and ev.get("category") in CATEGORIES:
        ev["category_needs_review"] = False
        return ev
    cat, review = categorize(ev)
    ev["category"], ev["category_needs_review"] = cat, review
    return ev
