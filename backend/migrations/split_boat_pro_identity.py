"""Migration: split Boat Pro accounts into a personal identity + a business identity.

WHAT IT DOES (idempotent):
  1. For every Boat Pro account (users.account_type == "boat_pro") that has a
     boat_pros listing:
       - business_handle  := the account's CURRENT users.handle (if not already set)
       - a NEW personal users.handle is generated from first/last name and marked
         personal_handle_pending = True (so a later task can prompt confirmation)
       - business_email starts blank (None)
       - business fields (company_name, logo, cover, gallery, bio, categories,
         markets, website, phone, credentials) are ensured on the boat_pros record;
         the OLD fields on the users doc are kept readable (never deleted) until the
         operator confirms the migration.
  2. Backfills last_identity = "personal" on users missing it.
  3. Backfills author_identity = "personal" (+ author_business_id = None) on existing
     posts / comments / discussions / reviews / mutual_reviews / dm_messages /
     dm_threads rows missing the field.

SAFETY:
  - Runs as a DRY RUN by default and only prints counts. Nothing is written.
  - With --commit it first backs up every affected collection to a timestamped
    JSON folder under ./migration_backups/, then performs idempotent writes.
  - Running it twice is a no-op on the second run.

USAGE:
  python migrations/split_boat_pro_identity.py            # dry run (report only)
  python migrations/split_boat_pro_identity.py --commit   # back up + write
"""
from __future__ import annotations
import os
import re
import sys
import json
import uuid
import argparse
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", ".env"))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

AUTHOR_IDENTITY_COLLECTIONS = [
    "posts", "comments", "discussions", "reviews",
    "mutual_reviews", "dm_messages", "dm_threads",
]

# Business fields that conceptually belong to the business record. Already stored
# on boat_pros for Boat Pro accounts; copied from the user doc only if missing on
# the listing (defensive). Old user-doc fields are left readable.
BUSINESS_FIELD_FALLBACK = {
    "company_name": "company_name",
    "website": "website",
}


def _slugify_handle(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "", (name or "")).lower()[:20]
    return s or "sailor"


def _handle_taken(db, handle: str, reserved: set) -> bool:
    h = handle.lower()
    if h in reserved:
        return True
    if db.users.find_one({"handle": h}, {"_id": 1}):
        return True
    if db.boat_pros.find_one({"business_handle": h}, {"_id": 1}):
        return True
    return False


def _gen_personal_handle(db, first, last, reserved: set) -> str:
    base = _slugify_handle(f"{first or ''}{last or ''}")
    for suffix in [""] + [str(i) for i in range(2, 999)]:
        cand = f"{base}{suffix}"
        if not _handle_taken(db, cand, reserved):
            return cand
    return f"{base}{uuid.uuid4().hex[:6]}"


def backup_collections(db, backup_dir: str, names: list):
    os.makedirs(backup_dir, exist_ok=True)
    for name in names:
        docs = list(db[name].find({}))
        for d in docs:
            d["_id"] = str(d["_id"])
        with open(os.path.join(backup_dir, f"{name}.json"), "w") as f:
            json.dump(docs, f, default=str)
    print(f"  backed up {len(names)} collections -> {backup_dir}")


def run(commit: bool):
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    now = datetime.now(timezone.utc).isoformat()

    report = {"dry_run": not commit, "at": now}

    # ---- 1. Boat Pro identity split --------------------------------------
    pros = list(db.boat_pros.find({}))
    pro_by_uid = {p.get("user_id"): p for p in pros if p.get("user_id")}
    boat_pro_users = list(db.users.find({"account_type": "boat_pro"}))

    to_split = []          # need handle split (not yet migrated)
    already_migrated = []  # business_handle already present
    no_listing = []        # boat_pro user with no boat_pros doc
    credentials_hidden_featured = 0
    reserved: set = set()

    for u in boat_pro_users:
        pro = pro_by_uid.get(u.get("user_id"))
        if not pro:
            no_listing.append(u.get("user_id"))
            continue
        if (pro.get("business_handle") or "").strip():
            already_migrated.append(u.get("user_id"))
            continue
        # Featured accounts whose credentials will become hidden (Premium-only now).
        tier = (u.get("subscription_tier") or "free").lower()
        if tier == "featured" and any(pro.get(k) for k in ("certifications", "licenses", "insurance")):
            credentials_hidden_featured += 1
        to_split.append((u, pro))

    planned_handles = []
    for u, pro in to_split:
        business_handle = (u.get("handle") or "").strip().lower() or None
        if business_handle:
            reserved.add(business_handle)
        personal = _gen_personal_handle(db, u.get("first_name"), u.get("last_name"), reserved)
        reserved.add(personal)
        planned_handles.append({
            "user_id": u.get("user_id"),
            "old_handle_now_business": business_handle,
            "new_personal_handle": personal,
        })
        if commit:
            biz_update = {
                "business_handle": business_handle,
                "business_email": pro.get("business_email") or None,  # starts blank
                "identity_migrated_at": now,
            }
            for biz_key, user_key in BUSINESS_FIELD_FALLBACK.items():
                if not pro.get(biz_key) and u.get(user_key):
                    biz_update[biz_key] = u.get(user_key)
            db.boat_pros.update_one({"user_id": u["user_id"]}, {"$set": biz_update})
            db.users.update_one({"user_id": u["user_id"]}, {"$set": {
                "handle": personal,
                "personal_handle_pending": True,
                "last_identity": u.get("last_identity") or "personal",
            }})

    report["boat_pro_identity"] = {
        "total_boat_pro_users": len(boat_pro_users),
        "to_split": len(to_split),
        "already_migrated": len(already_migrated),
        "boat_pro_users_without_listing": len(no_listing),
        "featured_accounts_credentials_now_hidden": credentials_hidden_featured,
        "sample_planned_handles": planned_handles[:10],
    }

    # ---- 2. last_identity backfill on users ------------------------------
    li_q = {"last_identity": {"$exists": False}}
    li_count = db.users.count_documents(li_q)
    if commit and li_count:
        db.users.update_many(li_q, {"$set": {"last_identity": "personal"}})
    report["users_last_identity_backfilled"] = li_count

    # ---- 3. author_identity backfill -------------------------------------
    ai = {}
    for name in AUTHOR_IDENTITY_COLLECTIONS:
        q = {"author_identity": {"$exists": False}}
        n = db[name].count_documents(q)
        ai[name] = n
        if commit and n:
            db[name].update_many(q, {"$set": {"author_identity": "personal", "author_business_id": None}})
    report["author_identity_backfilled"] = ai

    client.close()
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="back up + perform writes (default: dry run)")
    args = ap.parse_args()

    if args.commit:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_dir = os.path.join(HERE, "migration_backups", stamp)
        affected = ["users", "boat_pros"] + AUTHOR_IDENTITY_COLLECTIONS
        print(f"[commit] backing up collections: {affected}")
        backup_collections(db, backup_dir, affected)
        client.close()

    report = run(commit=args.commit)
    print(json.dumps(report, indent=2, default=str))
    if report["dry_run"]:
        print("\nDRY RUN — nothing was written. Re-run with --commit after approval.")


if __name__ == "__main__":
    main()
