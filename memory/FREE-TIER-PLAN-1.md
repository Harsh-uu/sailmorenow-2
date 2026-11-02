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
- HUB forums/blogs: hub_router.py:387-388 `require_interaction` for free
  individuals (sailor/owner/boat_pro); :381-386 blocks free orgs. DECIDED (Jenn
  Q5): hub forum/blog count as "post" and OPEN to free sailor/owner/boat_pro. The
  org branch stays locked. [CHANGES for sailor/owner/boat_pro]
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
## 2) Exactly what changes and what stays  (UPDATED per Jenn, see section 3 answers)
SCOPE (who gets free post/comment/react): free SAILOR, free BOAT OWNER, and free
BOAT PRO (no listing). Organizations (Free, Community Partner, Founding Partner)
are NOT changed. "Post" now INCLUDES hub forum threads and blog posts (Jenn Q5).
Replies under a post count as COMMENTS (open); direct messages stay locked (Jenn Q4).

CHANGES (open to free sailor / boat_owner / boat_pro):
- create_post else branch (community_router.py:171)
- create_comment (community_router.py:1749)
- react (reactions_router.py:92)
- HUB create forum/blog: hub_router.py:387-388 (the `elif not is_paid_subscriber(u):
  require_interaction(u)` branch). The partner/org branch at hub_router.py:381-386
  is UNCHANGED (free orgs still blocked). Note: blog posts still go to status
  "pending" (admin approval) regardless of tier - that gate is separate and stays.
- plan_features.py member row `post_comment_react` -> free:Y (+ copy)
- web lib/plan.js and mobile lib/plan.ts: add a NEW helper (e.g. `canParticipate`)
  = free allowed when account_type in {sailor, boat_owner, boat_pro}; gate
  post/comment/react (and the hub compose) UI on it instead of canInteract.
  canInteract stays as-is for everything else.

STAYS LOCKED (confirmed): direct messaging send AND receive, writing reviews, Crew
Bank listing, ID verification / ID-verified badge, event creation (account-type
gate), and every other current gate. Free partner-org post/event limits are
unchanged. Free organizations are NOT given individual posting.

Recommended implementation shape (smallest, safest): do NOT loosen
require_interaction (that would open everything). Add ONE narrow backend helper,
e.g. `require_participation(u)`:
  1. require_not_locked(u)  # keeps the 24h verification lock (Jenn Q1)
  2. if u.account_type in {sailor, boat_owner, boat_pro} and tier == free: allow
  3. else: require_interaction(u)  # paid allowed; free orgs still blocked
Call it ONLY at the four sites above (post, comment, react, hub create). Every
other require_interaction / can_interact / can_review call site is untouched.

Note on "boat_pro no listing": a public Boat Pro listing REQUIRES a paid tier
(directory_router.py upsert_boat_pro calls require_interaction). So a FREE Boat Pro
cannot have a live public listing - "free Boat Pro" and "Boat Pro with no listing"
are the same set in practice. Keying eligibility off tier==free + account_type is
therefore sufficient; we do NOT need to separately inspect the boat_pros doc. (If
Jenn ever wants a paid Boat Pro's extra posting treated differently we revisit, but
paid already gets everything, so no action now.) See open question OQ-A.

================================================================================
## 3) Jenn's decisions (RESOLVED) + gate findings

Q1 Email verification lock: KEEP IT. Unverified free members stay locked out of
posting, commenting and reacting after the 24-hour window until the email is
confirmed. -> Implementation: require_participation(u) calls require_not_locked(u)
FIRST, exactly as require_interaction does today. No change to the 24h logic
(deps.py verification_state / require_not_locked, VERIFY_GRACE_HOURS = 24).

Q2 Abuse controls: Jenn does NOT want a hard per-hour limit for free members.
  FINDING - do per-hour rate limits exist today? YES, but not on this flow:
  - There IS a per-IP sliding-window limiter: deps.py:55 `rate_limit(bucket,
    request, limit, window)`, backed by an in-memory bucket and logged to
    db.rate_limit_events. It is PER IP ADDRESS, not per account.
  - It is applied to: EVENT posting (community_router.py:702,921 -> 10/hour, all
    accounts), event blast (:1096 -> 5/hour), ID session (identity_router:59 ->
    5/hour), directory contact (:713 -> 3/10min), support contact (:785 ->
    5/10min), review disputes (dispute_file/attach), admin hero analytics, Zoho
    secret endpoints, and failed-login lockout (auth_router tiered lockout).
  - It is NOT applied to feed posts, comments, or reactions today. (Free members
    simply could not reach those endpoints before, so no limiter was needed.)
  - There is also an admin abuse view today: GET /admin/abuse (admin_router:948),
    but it is RATE-LIMIT-BLOCK / IP based (groups db.rate_limit_events by IP and
    bucket). It does NOT measure per-account content volume.
  DECISION: do NOT add a hard hourly cap on free post/comment/react. Instead build
  an ADMIN FILTER / FLAG (see section 8) that surfaces accounts posting/commenting/
  reacting at spam-like volume and routes them through the EXISTING moderation and
  report flows. Sized SEPARATELY (new task FREE-TIER-ABUSE-1), not part of the
  core gate change. Link limits from new accounts and image-upload limits: DEFER
  to after launch (tracked, not built).

Q3 Scope: free SAILOR, free BOAT OWNER, and free BOAT PRO (no listing) get
posting, commenting and reactions. Organizations (Free, Community Partner, Founding
Partner) are NOT changed. -> Reflected in section 2 (account_type in {sailor,
boat_owner, boat_pro}; partner excluded). Org gate findings:
  - Feed post: free org = 1 post/calendar-month (community_router.py:161-169);
    Community/Founding = unlimited. UNCHANGED.
  - Hub forum/blog: free org blocked (hub_router.py:381-386); Community/Founding
    allowed. UNCHANGED.
  - Everything routes through can_interact()/org_status(); ENTITLED_ORG_STATUSES =
    {community_partner, founding_partner}. We touch none of it.

Q4 Replies vs messages: replies under a post ARE COMMENTS -> open to free (handled
by the create_comment gate change). DIRECT MESSAGES stay locked (messaging_router
require_interaction at :487,:550,:591 and visibility can_interact at :93,:206 -
all UNCHANGED). Confirm during build that every "reply" UI surface posts a comment,
not a DM; any reply that creates a DM must stay gated.

Q5 Hub forum threads and blog posts: INCLUDED as "post" -> open to free sailor/
owner/boat_pro. -> hub_router.py:387-388 gate changes to require_participation
(see section 2). Blog admin-approval (status "pending") is a separate gate and
stays. Free ORG hub posting stays blocked (unchanged).

Also confirmed by Jenn: reviews, messaging, Crew Bank and ID verification stay
Premium.

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
  Premium feature" answer to the new free wording. INCLUDE hub forum/blog here -
  any FAQ that says starting a forum thread or blog is Premium must change.
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
  pings). Pair with the admin FLAG/FILTER in section 8 (not hard rate limits, per
  Jenn Q2) so moderation can watch volume at launch.
- No change to who can report or hide. Admin tools and 403/402 handling unaffected.

================================================================================
## 8) Admin spam-volume FILTER / FLAG  (NEW task: FREE-TIER-ABUSE-1, sized separately)
Per Jenn Q2: no hard per-hour cap for free members. Instead give admins a way to
SEE and FLAG accounts posting/commenting/reacting at spam-like volume, reusing the
existing moderation and report flows. Build and size this SEPARATELY from the core
gate change; it is NOT required for the gate to ship, but should land close to
launch so moderation can watch volume.

What exists today (reuse, do not reinvent):
- db.reports (status open/...) + the admin report queue; purge_content();
  hidden_pending_review flow already handle member posts/comments.
- GET /admin/abuse (admin_router.py:948) - but it is IP / rate-limit-block based
  (groups db.rate_limit_events), NOT per-account content volume. It does not answer
  "which accounts are posting too much", so it is not a substitute.
- Admin overview counters (admin_router.py:~891) already count reports.

Proposed shape (plan only):
- New admin-only read endpoint, e.g. GET /api/admin/activity-volume?days=N, that
  aggregates per author_id over a window: counts of posts (db.posts), comments
  (db.comments), reactions (db.reactions), and hub items (db.hub_* / forum+blog),
  joined to the user (account_type, tier, email, created_at). Sort by total desc;
  highlight brand-new accounts (created within X days) and free accounts. This is a
  lightweight on-demand aggregation, same style as /admin/overview and /admin/abuse.
- Surface it in the existing Admin moderation UI as a "High activity" / "Flag"
  panel. From a row, an admin can jump to that user's content and use the EXISTING
  actions (hide/purge via purge_content, open a report, suspend) - no new
  enforcement mechanism, just visibility + the current tools.
- Optional soft FLAG field on the user (e.g. users.flagged_high_volume) an admin can
  toggle, purely to mark/triage; it does NOT auto-block (Jenn does not want hard
  limits). Decide during that task whether a flag is needed or the queue view alone
  suffices.
- DEFER to after launch (tracked, not built now): link restrictions from brand-new
  accounts, and image-upload limits on free posts.

Size estimate: SMALL-to-MEDIUM backend (one aggregation endpoint) + a small admin
UI panel on web. No change to the free-tier gate itself.

================================================================================
## 6) Test plan (after approval; no testing agent, temp accounts only, zero residue)
Accounts: one free Sailor, one free Boat Owner, one Premium member, one trial
member, one free org, one free Boat Pro. Web (desktop) and phone width.
- Free Sailor/Owner/Boat Pro (no listing): CAN create a feed post, a COMMENT, a
  REACTION, and a HUB forum thread / blog post (200; blog still lands "pending").
  CANNOT message, write a review, create a Crew Bank listing, verify ID, create an
  event, or create a public directory listing (still 402/403 with the right prompt).
- Premium/trial: unchanged (all allowed).
- Free org (partner): still 1 feed post/month, hub blocked, volunteer event rules
  (ALL unchanged). Paid Boat Pro: unchanged (all allowed).
- Reply-as-comment vs DM: confirm a reply under a post is a comment (open) and that
  no reply surface silently creates a DM (DMs stay locked).
- Matrix: GET /api/plans/matrix shows post_comment_react free:Y; Pricing/My plan/
  PlanComparison render the new Free column; locked prompts no longer mention post/
  react but still mention message/review/crew/ID.
- Verify the 24h unverified lock behaves per Q1 decision.
Tests/checks that would break and need updating:
- scripts/check_plan_copy.py (expected strings).
- Any backend test asserting free post/comment/react/hub returns 402/403 (e.g.
  community/reactions/hub tests) - must flip to expect success for
  sailor/owner/boat_pro(free).
- Plan-matrix snapshot tests, if any.
Test sends: none (no emails in this feature). Temp accounts deleted afterward
(users, signup_events, user_sessions, zoho_outbox), residue verified 0.

================================================================================
## 7) Risk, size, and launch timing
Size: SMALL-to-MEDIUM. Backend is a tight change (one new narrow gate helper +
4 call sites: post, comment, react, hub create + 1 matrix row). The bulk of the
work is COPY + the client gate helper + updating check_plan_copy.py and tests.
Est. ~0.5-1 day including copy sweep and manual verification on web + mobile.
The admin spam-volume filter (section 8 / FREE-TIER-ABUSE-1) is a SEPARATE add.
Risk: MODERATE, concentrated in two places: (a) accidentally opening more than
intended if require_interaction is loosened instead of adding a narrow gate - avoid
by NOT touching require_interaction; (b) stale copy claiming posting is Premium
slipping through - mitigated by check_plan_copy.py. Abuse/spam risk rises, but is
handled by visibility (admin filter) rather than hard caps, per Jenn.
Recommendation (risk-based): ship RIGHT AT or JUST BEFORE web launch is fine
PROVIDED Q1 (verification lock, DECIDED: kept) is honoured and the copy sweep +
check_plan_copy.py update are done. The change is low-blast-radius if scoped with a
dedicated gate helper. Because there are no hard rate limits, landing the admin
spam-volume filter (section 8) close to launch is recommended so moderation has
visibility. No toggle, so correctness of the scoped gate and the copy sweep are
what matter most before shipping.

================================================================================
## 9) Remaining open questions for Jenn (small; do not assume)
- OQ-A Boat Pro eligibility key: confirm it is fine to treat ANY free Boat Pro as
  eligible (key off tier==free + account_type), since a free Boat Pro cannot have a
  live public listing anyway. (Recommended: yes. Only revisit if you want a
  different rule for a Boat Pro who has a hidden/lapsed listing doc.)
- OQ-B check_plan_copy.py expected strings: I will propose the exact new strings
  during BUILD and show you the diff before changing the guard. Just flagging that
  it changes.
- OQ-C Admin filter (FREE-TIER-ABUSE-1): do you want it as its own task to schedule
  now, or folded into the FREE-TIER-PLAN-1 build? (Recommended: own task, landing
  close to launch.)
Everything else from the five questions is RESOLVED above.

================================================================================
## Dependency note
EMAIL-TRIAL-1 is blocked on this: its Free-column copy and comparison tables must
reflect free post/comment/react (now including hub forum/blog, and now covering
free Boat Pro) before those emails are built.
