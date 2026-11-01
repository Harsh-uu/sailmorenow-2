#!/usr/bin/env python3
"""REVIEWS-4 copy guard: fail if banned pre-two-way wording ("48 hours",
"accept"/"reject"/"not accepted", "delete review") leaks back into the review /
dispute copy. Run: python scripts/check_review_copy.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [
    ROOT / "backend" / "review_copy.py",
    ROOT / "backend" / "routers" / "review_disputes_router.py",
    ROOT / "frontend" / "src" / "components" / "ReviewDisputeForm.jsx",
    ROOT / "frontend" / "src" / "components" / "ReviewReply.jsx",
    ROOT / "frontend" / "src" / "pages" / "Reviews.jsx",
]
# Targets the OLD pre-two-way flow wording, not the word "accept" generally
# ("we accept no more than two requests" and the file-input accept= are fine).
BANNED = [r"48 hours", r"24 hours", r"\bnot accepted\b", r"\bdelete review\b",
          r"\breject\b", r"accept or reject", r"accept the review", r"accept it \(it goes"]


def main() -> int:
    hits = []
    for f in TARGETS:
        if not f.exists():
            continue
        for i, line in enumerate(f.read_text().splitlines(), 1):
            for pat in BANNED:
                if re.search(pat, line, re.IGNORECASE):
                    hits.append(f"{f.relative_to(ROOT)}:{i}: {line.strip()[:100]}")
    if hits:
        print("REVIEW COPY CHECK FAILED - banned wording found:")
        print("\n".join(hits))
        return 1
    print("review copy check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
