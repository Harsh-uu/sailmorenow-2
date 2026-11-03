#!/usr/bin/env python3
"""Plan-copy consistency check (PLAN-HOME-B). NOT a testing agent.

Fetches the single source of truth (GET /api/plans/matrix) and then scans the
web, mobile and backend surfaces that show plan prices / tier names / benefits.
It fails if:
  - a drifted / forbidden benefit phrase appears anywhere (e.g. "priority search",
    "yearly feature in newsletter", "photo instead of avatar"), or
  - a dollar price appears that is not one of the matrix prices, or
  - an em dash appears in a scanned plan-copy surface.

Run:  python scripts/check_plan_copy.py
Prints PASS or a list of file:line mismatches and exits non-zero on failure.
"""
import os
import re
import sys
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Surfaces that render plan prices / tier names / benefits. Matrix-bound files
# are listed too: the check confirms they carry no stray static price or phrase.
SURFACES = [
    # web
    "frontend/src/pages/Landing.jsx",
    "frontend/src/pages/Pricing.jsx",
    "frontend/src/pages/MyPlan.jsx",
    "frontend/src/components/UpgradeNudge.jsx",
    # mobile
    "mobile/app/index.tsx",
    "mobile/app/pricing.tsx",
    "mobile/app/register.tsx",
    "mobile/app/(tabs)/profile/my-plan.tsx",
    "mobile/src/components/partner.tsx",
    "mobile/src/lib/plans.ts",
    # backend static copy (FAQ answers, welcome/lapse emails)
    "backend/routers/content_router.py",
    "backend/mailer.py",
    # welcome email templates
    "backend/email_templates/welcome-sailor.html",
    "backend/email_templates/welcome-boat-owner.html",
    "backend/email_templates/welcome-boat-pro.html",
    "backend/email_templates/welcome-club-org.html",
]

# Phrases that must NOT appear anywhere (old wording Jenn retired).
BANNED = [
    "priority search",
    "yearly feature in newsletter",
    "photo instead of avatar",
    "priority placement premium only",
    # FREE-TIER-BUILD-1: posting, commenting and reacting are now free for
    # individuals (Sailors, Boat Owners, Boat Pros). These claim they are Premium.
    "upgrade to post",
    "posting & reactions",
    "posting &amp; reactions",
    # Old free-org feed wording (now: 1 post / month, a marketplace listing counts).
    "1 update each calendar month",
    # Wrong Boat Pro entry price (Basic is $12.99, not $19.99).
    "boat pros from $19.99",
    # EMAIL-WORDING-FIX-1: welcome emails no longer list posting as plan-gated.
    "like posting, reviews, and direct messages",
]

# Per-surface exceptions: a banned phrase that is intentionally KEPT in a specific
# file. welcome-club-org keeps "posting" because org posting IS plan-limited
# (1 post / month free vs unlimited for Community Partners), so the phrase is
# correct there and Jenn chose to leave it unchanged.
BANNED_EXCEPTIONS = {
    "backend/email_templates/welcome-club-org.html": {
        "like posting, reviews, and direct messages",
    },
}

PRICE_RE = re.compile(r"\$(\d{1,3}(?:,\d{3})*\.\d{2})\b")
EMDASH_RE = re.compile(r"\u2014|&mdash;")

# Em dashes are only flagged on lines that are plan copy (contain a tier name,
# a benefit word or a $ price), so decorative prose elsewhere is not reported.
PLAN_CONTEXT = re.compile(
    r"\$\d|Basic|Featured|Premium|Community Partner|Founding Partner|"
    r"market|gallery|newsletter|messaging|review|credential|directory placement|per month|/mo",
    re.IGNORECASE,
)


def matrix_url():
    # Prefer the in-pod backend (the external ingress may block non-browser
    # clients). Override with PLAN_MATRIX_URL if needed.
    return os.environ.get("PLAN_MATRIX_URL", "http://localhost:8001") + "/api/plans/matrix"


def load_allowed_prices():
    with urllib.request.urlopen(matrix_url(), timeout=20) as r:
        m = json.load(r)
    allowed = set()
    pr = m["pricing"]
    for aud in ("sailor", "boat_owner"):
        for p in pr["member"].get(aud, []):
            allowed.add(f"{p['monthly']:.2f}")
            allowed.add(f"{p['total']:.2f}")
    for tier in ("basic", "featured", "premium"):
        for p in pr["boat_pro"].get(tier, []):
            allowed.add(f"{p['monthly']:.2f}")
            allowed.add(f"{p['total']:.2f}")
    return allowed, m


def main():
    try:
        allowed, _m = load_allowed_prices()
    except Exception as e:
        print(f"FAIL: could not fetch matrix ({e}). Is the backend running?")
        return 1

    problems = []
    for rel in SURFACES:
        f = ROOT / rel
        if not f.exists():
            problems.append(f"{rel}: MISSING surface file")
            continue
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            low = line.lower()
            allowed_here = BANNED_EXCEPTIONS.get(rel, set())
            for b in BANNED:
                if b in low and b not in allowed_here:
                    problems.append(f"{rel}:{i}: banned phrase '{b}'")
            if EMDASH_RE.search(line) and PLAN_CONTEXT.search(line):
                problems.append(f"{rel}:{i}: em dash in plan copy (use a hyphen)")
            for pm in PRICE_RE.finditer(line):
                val = pm.group(1)
                if val not in allowed:
                    problems.append(f"{rel}:{i}: price ${val} not in matrix prices {sorted(allowed)}")

    if problems:
        print("MISMATCHES:")
        for p in problems:
            print("  -", p)
        print(f"\nFAIL: {len(problems)} issue(s).")
        return 1
    print("PASS: all plan-copy surfaces match the matrix (prices, phrasing, no em dashes).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
