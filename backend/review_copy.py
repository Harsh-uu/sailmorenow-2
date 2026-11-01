"""Single source of truth for the approved review policy + dispute copy
(project doc 92 sections B and C, verbatim). Web now, and the later mobile
(REVIEWS-4m) and Help Center (REVIEWS-5) work reuse this via /api/review-disputes/meta.
Do NOT paraphrase; edit here only.
"""

# --- Constants (placeholders where counsel is still to decide) ---------------
SELF_REMOVAL_DAYS = 30
MAX_IMAGE_MB = 10
MAX_PDF_MB = 25
ATTACHMENT_RETENTION_DAYS = 365  # placeholder, counsel to confirm
MAX_ATTACHMENTS = 5
EXPLANATION_MAX = 1000
MAX_DISPUTES_PER_DAY = 5           # per filer
MAX_REQUESTS_PER_REVIEW = 2        # original + one contest

# Allowed attachment types, validated by CONTENT (magic bytes), not extension.
ALLOWED_IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
ALLOWED_PDF_TYPE = "application/pdf"

# --- Reason enum -> user-facing label (doc 92 section C, in order) -----------
REASON_LABELS = {
    "not_worked_or_sailed_together": "we did not work or sail together",
    "private_information": "private information",
    "threats_harassment_hate": "threats, harassment or hate",
    "conflict_of_interest_or_competitor": "conflict of interest or competitor",
    "written_for_payment_or_favors": "written for payment or favors",
    "accuses_of_crime": "accuses me of a crime",
    "not_about_actual_experience": "not about the actual experience",
    "remove_my_own_review": "I want to remove my own review",
    "other_rule_violation": "other rule violation",
}
REASONS = list(REASON_LABELS.keys())

DECISION_LABELS = {
    "stays": "The review stays",
    "removed": "The review is removed",
    "kept_with_details_removed": "The review is kept with the private details removed",
}

# Private-details-removed marker written into a redacted review comment.
REDACTED_COMMENT = "[Private details were removed by our team.]"

# --- Standard removal reasons (shown to the REVIEWER only) -------------------
# The admin picks one of these when removing a review. The admin's own written
# note (decision_reason) stays INTERNAL and must never appear in any notice or
# email. Keyed by the same reason codes used when filing.
REMOVAL_REASON_MESSAGES = {
    "not_worked_or_sailed_together": "It did not appear to be based on a real working or sailing relationship.",
    "private_information": "It included private information.",
    "threats_harassment_hate": "It broke our rules on threats, harassment or hate.",
    "conflict_of_interest_or_competitor": "It appeared to involve a conflict of interest.",
    "written_for_payment_or_favors": "It appeared to be written in exchange for payment or favors.",
    "accuses_of_crime": "It accused someone of a crime.",
    "not_about_actual_experience": "It was not about the actual experience.",
    "other_rule_violation": "It broke our Reviews Policy.",
}
REMOVAL_REASON_CODES = list(REMOVAL_REASON_MESSAGES.keys())

# --- Dispute notification copy (approved, verbatim) --------------------------
# Every notice ends with the Code of Conduct link, added by COC_SUFFIX below.
COC_SUFFIX = "Please read our Code of Conduct."

NOTICE_FILED_FILER = ("We received your request about a review. The review stays live while we look, "
                      "and we aim to decide within 72 hours. We'll tell you the outcome here and by email. "
                      "A review isn't removed just because it is critical or you disagree with the rating.")
NOTICE_FILED_OTHER = ("A review you're part of has been reported. The review stays live while we look, "
                      "and we aim to decide within 72 hours. You don't need to do anything. "
                      "We'll tell you the outcome here and by email.")
NOTICE_STAYS_FILER = "We looked at your request and the review stays. Reviews aren't removed just because they're critical."
NOTICE_STAYS_REVIEWER = "We looked at a request about your review and it stays live."
NOTICE_REMOVED_FILER = "We looked at your request and the review was removed."
NOTICE_REMOVED_REVIEWER_PREFIX = "Your review was removed. Reason: "
NOTICE_REMOVED_REVIEWER_SUFFIX = " If you have new information, you can ask us to look again one time."
NOTICE_DETAILS_REMOVED_BOTH = "We removed private details from the review. The rest stays live."
NOTICE_SELF_REMOVED_REVIEWER = "Your review was removed at your request."
NOTICE_SELF_REMOVED_OTHER = "The review was removed at the reviewer's request. Your review of them stays live."
NOTICE_RESTORED_BOTH = "A review that was removed has been restored by our team and is live again."


def with_coc(body: str) -> str:
    """Append the Code of Conduct sentence to a notice body (single source)."""
    body = (body or "").strip()
    if body and not body.endswith(COC_SUFFIX):
        return body + " " + COC_SUFFIX
    return body

# --- Form-facing copy (doc 92 section C) -------------------------------------
ATTACHMENT_NOTICE = ("Please do not upload government ID numbers, medical information, "
                     "information about children, or criminal records. We will not use them.")
ATTACHMENT_HELP = "Attach up to 5 supporting documents if you have them (for example an invoice, contract, photos or message screenshots)."
DECISION_TIMELINE = ("We aim to give you a decision within 72 hours and will email you and show the result in the app. "
                     "The review stays live and counted while we look.")
SECONDARY_EMAIL = "disputes@sailmorenow.com"
SECONDARY_EMAIL_NOTE = ("You can also email disputes@sailmorenow.com, but the in-app form is faster "
                        "because it links your request to the review.")
NOT_A_REASON = ("What is not a reason to remove: the review is critical, you disagree with the rating, "
                "or you would rather it were not public.")
MISUSE_NOTE = "Filing dispute requests that are false or meant to harass may lead to action on the account."
SELF_REMOVAL_NOTE = ("You can ask us to remove your own review for 30 days after it goes live. "
                     "If you remove your review, the other person's review of you stays up.")

# --- Full policy text (doc 92 section B + C) for the Help Center / in-form panel ---
SECTION_B_REVIEWS_POLICY = [
    {"h": "Why we have reviews", "p": "Reviews help our community find people and organizations they can trust. They only work when they are honest, fair and based on a real experience."},
    {"h": "Who can review", "p": "Paid members can write reviews. Free accounts can read reviews and reply to reviews about them. You may review someone only if you actually worked together, hired them, sailed together or used their services, and you confirm this when you submit. You cannot review yourself. Sailors and owners can review other sailors and owners they have sailed with. Organizations cannot review other organizations. A Boat Pro can review another Boat Pro only from their personal profile, only if the two do not share a category, and only if you worked together. Each pair can review each other once."},
    {"h": "Write about your own experience", "p": "Say what happened. Rate only what you can judge. Overall is required; Personality, Skill, Promptness and Communication are optional."},
    {"h": "What is not allowed in a review or reply", "ul": [
        "Threats, harassment, hate speech, discrimination or personal attacks",
        "Private information about anyone (phone numbers, addresses, medical or financial details, ID numbers)",
        "Statements you know are false, or accusing someone of a crime",
        "Reviews written for payment, discounts, favors or a business referral arrangement, or reviews you were pressured to write",
        "Reviews written to harm a competitor, or to promote yourself, a friend or your own business",
        "Reviews about a person or business you did not actually deal with",
        "Advertising, links or contact details meant to draw people elsewhere",
        "Impersonating another person or organization",
        "Duplicate reviews of the same experience, or reviews from accounts you control about each other",
        "Using a review, or the threat of one, to demand something",
    ], "p": "A review is not removed just because it is critical."},
    {"h": "How two-way reviews work", "p": "When you submit a review it stays private. The person you reviewed is told that a review exists and has 7 days to write one back (paid members) and to prepare a reply. Neither person can see the other's review until both are submitted, or until the 7 days end, whichever comes first. Then both go live at the same time. We send a reminder on day 3 and day 6. Reviews of organizations by sailors and owners are one-way and go live right away."},
    {"h": "Replying", "p": "After a review goes live, the person reviewed can post one public reply, up to 500 characters. A reply follows the same rules as a review. A reply cannot be edited after posting. The reviewer is notified when a reply is posted."},
    {"h": "Changing or removing your review", "p": "While your review is private and the other person has not responded, you can edit or withdraw it. If you withdraw it, the other person is told. If they still want to review you, the process starts over from the beginning with a new 7-day window. Once it is live you cannot edit it. For 30 days after it goes live you can ask us to remove it through the review dispute process. If you remove your review, the other person's review of you stays up."},
    {"h": "Ratings", "p": "Averages include only live reviews. A review that is under dispute stays live and counted until we decide."},
    {"h": "What we may do", "p": "We may remove or redact reviews that break these rules, restrict someone's ability to review or reply, or limit or close accounts that repeatedly post false, abusive or manipulated reviews. We keep removed reviews in our internal records."},
]

SECTION_C_DISPUTE_PROCESS = [
    {"h": "Who can ask", "p": "The person who was reviewed, an admin of an organization that was reviewed, or the reviewer (to remove their own live review within 30 days of it going live)."},
    {"h": "How", "p": "In the app (web or mobile), open the review, choose \"Report or dispute this review\", then choose a reason, explain in up to 1,000 characters what is wrong, attach up to 5 supporting documents if you have them, and submit. " + SECONDARY_EMAIL_NOTE},
    {"h": "Please do not upload", "p": ATTACHMENT_NOTICE},
    {"h": "What happens next", "p": DECISION_TIMELINE + " Outcomes: the review stays; it is removed; or it is kept with the private details removed."},
    {"h": "Both sides are told", "p": "The reviewer is told if their review is removed and why. The reviewer can contest once with new information. We accept no more than two requests for the same review."},
    {"h": "What is not a reason to remove", "p": "The review is critical, you disagree with the rating, or you would rather it were not public."},
    {"h": "Misuse", "p": MISUSE_NOTE},
]
