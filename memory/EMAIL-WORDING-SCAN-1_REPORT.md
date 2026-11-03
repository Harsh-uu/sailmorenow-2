# EMAIL-WORDING-SCAN-1 - Plan/free/premium wording across every email (post FREE-TIER-BUILD-1)
REPORT ONLY. No files changed, no emails sent. Hyphens only.

Context: free Sailors, Boat Owners and free Boat Pros (no listing) can now POST,
COMMENT and REACT. Messaging, reviews, Crew Bank, ID verification and events stay
Premium/paid. Organizations are unchanged (free org = 1 post + 1 volunteer event
per calendar month; forums/blogs blocked). So any email saying "posting" is
plan-gated for individuals is now STALE.

## What was scanned
- backend/email_templates/*.html : welcome-sailor, welcome-boat-owner,
  welcome-boat-pro, welcome-club-org (the only template files).
- backend/mailer.py : all inline HTML/text builders (billing, trial, lapse,
  message-waiting, digest, review nudges/disputes, Community Partner upgrade,
  account-deleted).
- backend/scheduler.py : digest + review-nudge + lapse senders.
- Every router that builds email/notification copy: account_router, admin_router,
  admin_access_router, auth_router, community_router, directory_router,
  messaging_router, payments_router, review_disputes_router.

================================================================================
## STALE (needs minimal wording fix)

### S1-S3. "A quick note on plans" - lists POSTING as plan-gated (3 templates)
Files/line: welcome-sailor.html:73, welcome-boat-owner.html:73,
welcome-boat-pro.html:73 (identical sentence in each).
Current: "Sail More Now has free and paid options, and a few features, like
posting, reviews, and direct messages, depend on your plan."
Why stale: posting is now FREE for Sailors, Boat Owners and free Boat Pros.
Proposed minimal replacement (change only the feature list):
"Sail More Now has free and paid options, and a few features, like reviews, direct
messages and a Crew Bank listing, depend on your plan."
(Replace the substring "like posting, reviews, and direct messages" with
"like reviews, direct messages and a Crew Bank listing". Nothing else changes.)

### S4. Boat Owner - "Sailing Opportunity ... (paid tier only)"
File/line: welcome-boat-owner.html:65.
Current: "Browse the Seasonal and Per Event Crew Banks, and post a Sailing
Opportunity in the feed (paid tier only)."
Why stale: a Sailing Opportunity is a feed post; Boat Owners can now post it for
free. The "(paid tier only)" tag is wrong.
Proposed minimal replacement (drop the tag only):
"Browse the Seasonal and Per Event Crew Banks, and post a Sailing Opportunity in
the feed."
(Note: "Browse ... Crew Banks" stays - browsing is free; only LISTING yourself in
the Crew Bank is paid, and that is not claimed here.)

================================================================================
## CORRECT-but-OPTIONAL (true today; align only for consistency)

### O1. Club/Org "A quick note on plans"
File/line: welcome-club-org.html:73. Same sentence as S1-S3.
Status: TECHNICALLY CORRECT for organizations - a free org's posting IS plan-
limited (1 post + 1 volunteer event per month; forums/blogs blocked), so "posting
... depend on your plan" is true for them. OPTIONAL: for consistency with the
other three templates and to avoid implying individuals are gated, you MAY apply
the same replacement as S1-S3. The org template already states the 1-post/month
rule explicitly elsewhere (line 73 area, verified correct in FREE-TIER-BUILD-1),
so dropping "posting" here loses nothing. Recommendation: align it (low effort),
but it is not factually wrong today.

================================================================================
## CORRECT (reviewed, no change needed)

Welcome templates:
- welcome-sailor.html:65 "add yourself to the Seasonal/Per Event Crew Banks (paid
  only)" - CORRECT. Crew Bank listing is still Premium; "(paid only)" attaches to
  listing yourself, not to browsing.
- welcome-boat-owner.html "leave a review where your plan includes it" - CORRECT
  (reviews are paid).
- welcome-boat-pro.html listing/markets/logo/photos "depend on / as your plan
  allows", "Owners can message you", "Confirm your reviews" - CORRECT (Boat Pro
  directory tiers, messaging and reviews are all still paid).
- welcome-boat-pro.html "Share what you know - Post a How to blog, respond to a
  forum question" - CORRECT. It encourages posting and makes NO plan claim; free
  Boat Pros can now do this, which only makes the invitation more accurate.
- All "New posts are how you hear about things first" / "what you see (... posts)
  is filtered to your market" lines - CORRECT (descriptive, no gating claim).

mailer.py:
- billing_welcome_email_html (426-433), billing_payment_failed_email_html
  (436-443), billing_trial_ending_email_html (446-460) - CORRECT. Generic billing
  copy; no free-vs-premium feature claims; trial wording is plan-length guidance,
  not a feature list (and EMAIL-TRIAL-1 remains postponed).
- Community Partner "now unlocked" upgrade email (857-886) with perks
  (837-843): "Direct messaging...", "Unlimited calendar event posts", "Post &
  respond across forums and feeds", "An enhanced organization profile", "Build a
  following" - CORRECT. These are genuine org upgrades: free orgs are capped at 1
  post + 1 volunteer event/month and BLOCKED from forums/blogs, so unlimited posts
  and forum/blog access really are newly unlocked at Community Partner. Orgs are
  unchanged by the free-tier work.
- message-waiting email (999-1027): "upgrade your membership to read it and reply"
  - CORRECT (direct messaging stays Premium).
- lapsed-membership email (1038-1057): "Your Premium features are paused - direct
  messaging, writing reviews, your Crew Bank listing and the ID-verified badge" -
  CORRECT (already fixed in FREE-TIER-BUILD-1; posting/reactions removed).
- weekly digest (1078+): "{n} new comments across the {market} feed", crew/events
  counts, reviews section - CORRECT (counts/descriptions, no gating claim).
- account-deleted email (987): "This included your profile, posts, comments,
  listings, reviews, messages..." - CORRECT (describes deleted data, not plan gates).

scheduler.py:
- review nudges, volunteer reminders, lapse trigger, digest payload builders - no
  free/premium feature claims. CORRECT. (Internal docstrings at lines ~168 and
  ~482-487 contain em dashes, but they are code comments, not customer-facing email
  copy, so out of scope for this scan.)

Router-built email/notification copy (NOT emails about free vs premium posting):
- messaging_router.py:96-97 "Upgrade to read and reply" - CORRECT (messaging paid).
- community_router.py:1631/2017 Crew Bank "Premium feature. Upgrade" - CORRECT.
- directory_router.py market/credentials "Upgrade" messages - CORRECT (Boat Pro
  directory tiers). These are API error messages, not emails, but confirmed
  consistent.
- auth_router / account_router / review_disputes_router / directory contact
  relay emails - transactional (verify link, receipts, dispute status, contact
  relay); no plan/feature wording. CORRECT.

================================================================================
## Does scripts/check_plan_copy.py cover email text?
PARTIALLY.
- It scans backend/mailer.py (SURFACES list, line 41) - so the inline emails ARE
  covered by the BANNED-phrase + em-dash + price checks (this is why the lapse
  email was caught/fixed earlier).
- It does NOT scan backend/email_templates/*.html or backend/scheduler.py. The
  stale "like posting..." sentence in the four welcome HTML templates is therefore
  NOT currently caught.

Can it be extended cheaply? YES, very cheaply:
1. Add the four template paths to SURFACES:
   "backend/email_templates/welcome-sailor.html",
   "backend/email_templates/welcome-boat-owner.html",
   "backend/email_templates/welcome-boat-pro.html",
   "backend/email_templates/welcome-club-org.html"
   (optionally "backend/scheduler.py").
2. Add one BANNED phrase to catch the stale wording, e.g.
   "like posting, reviews, and direct messages".
This is ~5 added lines and reuses the existing scan loop. Caveat: the HTML uses
HTML entities (&rsquo;, &amp;) and hyphens, which the current em-dash/price checks
handle fine; no other adjustment needed. (Implement only when the template fixes
are approved, so the checker does not fail on the known-stale strings in the
meantime.)

================================================================================
## Summary of actions (when approved - NOT done here)
- Fix S1, S2, S3 (3 welcome templates): drop "posting" from the "quick note" list.
- Fix S4 (boat-owner): remove "(paid tier only)" from the Sailing Opportunity line.
- O1 (org template): optional alignment, same edit as S1-S3.
- Optionally extend check_plan_copy.py to scan the 4 template files + add the
  BANNED phrase.
No redesign, no tier tables, no trial blocks (EMAIL-TRIAL-1 stays postponed).
