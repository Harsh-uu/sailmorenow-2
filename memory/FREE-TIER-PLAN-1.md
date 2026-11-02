# FREE-TIER-PLAN-1 - open POST, COMMENT, REACT to free Sailor and Boat Owner (PLAN ONLY)

Decision (Jenn): free Sailor and Boat Owner accounts can POST, COMMENT and REACT.
Everything else stays Premium-only: messaging (send and receive), writing reviews,
Crew Bank listing, ID verification / ID-verified badge, and all current gates.
Existing upgrade prompts on still-gated features stay. NO admin toggle - Jenn would
rather delay launch a day or two than ship a toggle. Hyphens only, no em-dashes.
No code until Jenn approves.

================================================================================
## 1) Inventory - where free-tier access is decided today

### Backend (central)
- deps.py:325 `can_interact(u)` - single source of truth, returns tier != "free".
- deps.py:420 `require_interaction(u)` - raises 403 UPGRADE_REQUIRED (deps.py:359)
  if not paid; also blocks long-unverified accounts first (require_not_locked).
- deps.py:339 `can_review(u)` - stricter paid check for WRITING reviews.
- deps.py:425 `is_paid_subscriber(u)` - paid gate used in create_post/create_event.
- plan_features.py - SINGLE source of truth for displayed benefits, served by
  GET /api/plans/matrix (route in routers/plans_router.py). Member row
  `post_comment_react` is free:N, premium:Y (plan_features.py:87-90).

### Backend gates by feature (file:line -> what changes)
- POST feed post: community_router.py:152 create_post; free non-partner hits
  `require_interaction(u)` at :171 (the else branch). Free partner org keeps its
  1/month cap at :161-169. [CHANGES for sailor/owner]
- COMMENT: community_router.py:1743 create_comment -> `require_interaction(u)` at
  :1749. [CHANGES for sailor/owner]
- REACT: reactions_router.py:92 `require_interaction(u)`. [CHANGES for sailor/owner]
- MESSAGE send: messaging_router.py:487, :550 (group), :591 -> require_interaction.
  Receive/visibility gated via can_interact at :93, :206. [STAYS locked]
- REVIEW write: reviews_router.py:200, :319 raise upgrade_required; :666 reason_code.
  Uses can_review. [STAYS locked]
- CREW BANK listing: community_router.py crew upsert (standalone) + directory
  gate; directory_router.py:1209, :1305, :1177 upgrade_required. [STAYS locked]
- ID VERIFICATION / badge: identity_router -> is_paid_subscriber (per
  plan_features.py:106). [STAYS locked]
- EVENT creation: community_router.py:695 create_event. Sailors/owners are blocked
  by an ACCOUNT-TYPE gate at :708 (event_posting_closed), independent of plan;
  free orgs limited at :716-733. [STAYS - unchanged; not a tier change]
- HUB forums/blogs: hub_router.py:384-388 require_interaction (orgs/pros). The
  decision is about the community FEED (post/comment/react), not hub authoring.
  [STAYS locked - confirm with Jenn, see section 3]
- RSVP: community_router.register_for_event - no paid gate today (free already).
- Reactions/comments read, feed read: open today (no gate).

### Web (frontend/src)
- lib/plan.js - client mirror of can_interact (gate helper).
- components/UpgradeNudge.jsx, ReviewButton.jsx, MessageLink.jsx, RenewalReminder.jsx
  and pages Dashboard/Profile/Reviews - show upgrade prompts, driven by plan.js and
  402/403 upgrade_required from lib/api.js.
- PlanComparison.jsx - the comparison table (reused by welcome emails later).

### Mobile (/app/mobile/src)
- lib/plan.ts:7 `canInteract`, :20 `isFreeIndividual` (mirror of backend).
- lib/upgrade.ts:11 handleUpgrade (detects 402/403 upgrade_required), :22
  promptCommentUpgrade.
- Gated UI today: components/Reactions.tsx:28 (blocks react), InlineComments.tsx:37,
  :46, :93 (blocks comment), app/(tabs)/feed/index.tsx compose (isFreeIndividual ->
  promptCommentUpgrade), RosterRow.tsx:28. ReviewButton.tsx (review), MessageLink
  (message) stay gated.

================================================================================
## 2) Exactly what changes and what stays
CHANGES (open to free Sailor and Boat Owner only):
- create_post else branch (community_router.py:171)
- create_comment (community_router.py:1749)
- react (reactions_router.py:92)
- plan_features.py member row `post_comment_react` -> free:Y (+ copy)
- web lib/plan.js and mobile lib/plan.ts: add a NEW helper (e.g. `canParticipate`)
  = free allowed when account_type in {sailor, boat_owner}; gate post/comment/react
  UI on it instead of canInteract. canInteract stays as-is for everything else.

STAYS LOCKED (confirmed): messaging send AND receive, writing reviews, Crew Bank
listing, ID verification / ID-verified badge, event creation (account-type gate),
hub forums/blogs, and every other current gate. Free partner-org post/event limits
are unchanged. Boat Pro free and free orgs are NOT given individual posting.

Recommended implementation shape (smallest, safest): do NOT loosen
require_interaction (that would open everything). Add a narrow backend helper, e.g.
`require_participation(u)` that allows free sailor/owner (still blocks locked-
unverified per section 3) and otherwise defers to require_interaction, and call it
only at the three sites above.

================================================================================
## 3) Open questions for Jenn (not assumed)
- Q1 Email verification: does the existing 24-hour unverified-email lock still
  apply to posting/commenting/reacting for free accounts? (require_interaction
  calls require_not_locked first today. Recommend: keep the 24h lock applying so a
  brand-new unverified free account cannot post until verified or within the grace
  window. Needs your call.)
- Q2 Abuse controls now that free can post: add rate limits on free post/comment/
  react (e.g. per-hour caps like events already have at community_router:702),
  restrict links from brand-new accounts, and/or limit image uploads on free posts?
  (Recommend at least a basic per-hour rate limit on free posting and comments.)
- Q3 Boat Pro and organizations: does this change touch them at all? (Recommended:
  no. Free Boat Pro individuals and free orgs keep today's rules; only Sailor and
  Boat Owner get free post/comment/react.)
- Q4 Do message-style replies count as comments? (If any "reply" UI posts a DM
  rather than a comment, it must stay Premium. Confirm which reply surfaces are
  comments vs messages so we gate correctly.)
- Q5 Hub forums/blogs: stay Premium/partner-only (recommended), or also open? The
  decision text says feed post/comment/react; confirm hub is out of scope.

================================================================================
## 4) User-facing references that become wrong + proposed wording
All must move from "posting/commenting/reacting is Premium" to "free can post,
comment and react; messaging, reviews, Crew Bank and ID verification are Premium."

- plan_features.py member row `post_comment_react` (the source for Pricing, My plan
  and locked prompts):
    label: "Post, comment and react"
    meaning: "Create feed posts, comment on posts and add reactions. Free for
    Sailors and Boat Owners."
    short: "Posting, comments and reactions are free."
    values: {free: Y, premium: Y}
  (Premium's distinct value then becomes messaging, reviews, Crew Bank, ID badge.)
- Free vs Premium comparison table (PlanComparison.jsx + the matrix it renders, and
  the welcome-email copy reusing it):
    Free: Read the full feed, directory, events and hub; follow clubs/orgs/pros;
    RSVP to events; POST, COMMENT and REACT in the feed.
    Premium: Everything in Free, plus direct messaging, writing reviews, a Crew Bank
    listing and the ID-verified badge.
- constants.py: confirm no plan-benefit strings there claim posting is Premium
  (prices live here; benefit copy should come from plan_features.py). Audit during
  build.
- Pricing page (frontend Pricing.jsx), My plan (MyPlan.jsx): re-render from the
  matrix - will update automatically once plan_features.py changes; audit any
  hard-coded "post" copy.
- FAQ (backend content_router seed_faqs + any FAQ docs): update any "posting is a
  Premium feature" answer to the new free wording.
- Locked / upgrade prompts: deps.py:361 UPGRADE_REQUIRED message currently lists
  "post, react" - reword to "message, review, list yourself and verify your ID"
  (drop post/react). mobile lib/upgrade.ts promptCommentUpgrade default message and
  Reactions.tsx:28 / InlineComments prompts - remove (no longer gated).
- Visitor/marketing pages and register screens (app/index.tsx paths copy,
  register.tsx): any "upgrade to post" line -> free can post.
- Terms (terms doc/route): if Terms enumerate Premium features including posting,
  update the list.
- Welcome emails (EMAIL-TRIAL-1, on hold): the Free column and the trial pitch - the
  reason this is blocking EMAIL-TRIAL-1.
- Billing brief (/app/memory billing doc) and doc/seed copy (demo_seed, seed_router):
  update any "posting is Premium" references.
- scripts/check_plan_copy.py: this guard scans copy against plan rules (regex at
  :58). It WILL need its expected strings updated so it does not flag the new free
  posting copy (and so it catches any stale "posting is Premium" text). Treat as a
  required build step.

================================================================================
## 5) Moderation and reports impact
- Report/hide/moderation flows: unchanged in mechanism (purge_content, report
  queue, hidden_pending_review all already handle member posts/comments). No code
  path change needed, but VOLUME will rise: more free authors means more posts,
  comments and reactions, so more potential reports and more moderation queue
  items. Notification volume rises too (comment/reaction notifications, saved-search
  pings). Recommend pairing with Q2 abuse controls (rate limits, new-account link
  limits) before launch to keep the queue manageable.
- No change to who can report or hide. Admin tools and 403/402 handling unaffected.

================================================================================
## 6) Test plan (after approval; no testing agent, temp accounts only, zero residue)
Accounts: one free Sailor, one free Boat Owner, one Premium member, one trial
member, one free org, one free Boat Pro. Web (desktop) and phone width.
- Free Sailor/Owner: CAN create a feed post, comment, and react (200). CANNOT
  message, write a review, create a Crew Bank listing, verify ID, create an event
  (still 402/403 with the right prompt).
- Premium/trial: unchanged (all allowed).
- Free org: still 1 post/month + volunteer event rules (unchanged). Free Boat Pro:
  still gated (unchanged).
- Matrix: GET /api/plans/matrix shows post_comment_react free:Y; Pricing/My plan/
  PlanComparison render the new Free column; locked prompts no longer mention post/
  react but still mention message/review/crew/ID.
- Verify the 24h unverified lock behaves per Q1 decision.
Tests/checks that would break and need updating:
- scripts/check_plan_copy.py (expected strings).
- Any backend test asserting free post/comment/react returns 402/403 (e.g.
  community/reactions tests) - must flip to expect success for sailor/owner.
- Plan-matrix snapshot tests, if any.
Test sends: none (no emails in this feature). Temp accounts deleted afterward
(users, signup_events, user_sessions, zoho_outbox), residue verified 0.

================================================================================
## 7) Risk, size, and launch timing
Size: SMALL-to-MEDIUM. Backend is a tight change (one new narrow gate helper + 3
call sites + 1 matrix row). The bulk of the work is COPY + the client gate helper +
updating check_plan_copy.py and tests. Est. ~0.5-1 day including copy sweep and
manual verification on web + mobile.
Risk: MODERATE, concentrated in two places: (a) accidentally opening more than
intended if require_interaction is loosened instead of adding a narrow gate - avoid
by NOT touching require_interaction; (b) stale copy claiming posting is Premium
slipping through - mitigated by check_plan_copy.py. Abuse/spam risk rises (Q2).
Recommendation (risk-based): ship RIGHT AT or JUST BEFORE web launch is fine
PROVIDED Q1 (verification lock) and Q2 (basic rate limits) are decided and the copy
sweep + check_plan_copy.py update are done. The change is low-blast-radius if scoped
with a dedicated gate helper. If abuse controls (Q2) are deferred, prefer shipping a
day after launch so moderation can watch volume. No toggle, so correctness of the
scoped gate and the copy sweep are what matter most before shipping.

================================================================================
## Dependency note
EMAIL-TRIAL-1 is blocked on this: its Free-column copy and comparison tables must
reflect free post/comment/react before those emails are built.
