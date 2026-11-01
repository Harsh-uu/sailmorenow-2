"""EVENTS-FIX-1: ONE lock rule shared by the admin editor and the org/owner edit
path. Every field an editor changes is added to admin_locked_fields so the importer
never overwrites it, and time_not_listed is DERIVED from the edited start value so a
hand-set time can never be flipped back to "no time" by a later scrape."""
from datetime import datetime, timezone

from date_utils import is_date_only

# Bookkeeping fields that are set as a side effect of an edit and must NOT be
# treated as "a field the editor chose to pin".
_META_KEYS = {"category_manual", "category_needs_review", "admin_edited",
              "updated_at", "admin_locked_fields"}


def finalize_editor_changes(changes: dict, raw_starts=None):
    """Return (changes, locked_fields).

    `changes` is the editor's already-validated, non-null change set (starts_at/ends_at
    already normalized to ISO). `raw_starts` is the editor's ORIGINAL starts_at value
    (before normalization) or None when the start was not edited; it decides whether a
    real time was given. time_not_listed is added to `changes` (and therefore locked)
    whenever the start was edited.
    """
    if raw_starts is not None:
        changes["time_not_listed"] = bool(is_date_only(raw_starts))
    if "category" in changes:
        changes["category_manual"] = True
        changes["category_needs_review"] = False
    locked_fields = sorted(k for k in changes.keys() if k not in _META_KEYS)
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    changes["admin_edited"] = True
    return changes, locked_fields
