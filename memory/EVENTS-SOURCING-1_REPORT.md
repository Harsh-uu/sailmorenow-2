# EVENTS-SOURCING-1 report (reduce manual event-sourcing work)

REPORT ONLY. No code or data changes, no testing agent, no em dashes. All pricing is "best
public figure as of mid-2026" and should be reconfirmed on the vendor page before any signup.
We do NOT propose bypassing any site's bot protection. For 48 North we wait for Jenn (she has
emailed Joe Cline).

## 1. Every event source today
Pulled live from the `event_sources` registry and the `events` collection.

| Source | Key | Type | Events now | Last success | Failures | Notes |
|---|---|---|---|---|---|---|
| OCSA (sailpdx) | ocsa-sailpdx | ICS (Google Calendar public .ics) | 115 | 2026-10-31, status ok, 115 fetched | none | Healthy. Most events are date-only (VALUE=DATE). |
| OWSA | owsa | HTML scraper (owsa.net/events) | 10 | 2026-10-31, status ok, 8 fetched | none recently | Custom HTML parser class in code. |
| SARC / 48 North | sarc-48north | ICS (The Events Calendar .ical export) | 0 | never succeeded | HTTP 403 on every fetch (Cloudflare bot protection) | Dead until 48 North allows access; waiting on Joe Cline. |

Duplicate handling (how it works now):
- Each event gets a stable `external_id = hash(source_key, UID-or-title, starts_at)` and is
  upserted under id `agg_{source_key}_{external_id}`. Same event on the next run updates in
  place instead of duplicating.
- Fields an admin edited are recorded in `admin_locked_fields` and are never overwritten by a
  later import (untouched fields still refresh).
- Deleting an imported event writes an `event_tombstones` row, so it is never re-imported.
- Weakness: the key includes `starts_at`. If a source CHANGES an event's date or renames it,
  the hash changes and the old copy is orphaned while a new copy appears (see item 5).

## 2. Why admin work is needed now, and how often
Manual steps happening today:
- Fixing date-only / all-day events that used to import a bogus time (addressed by PACIFIC-1/2).
- Category review: `category_needs_review` is set when auto-categorization is unsure
  (2 events flagged right now); an admin confirms the category.
- Missing data: 109 of 125 imported events have no location (ICS feeds often omit it); an admin
  adds a venue if they want the map pin.
- Editing individual imported events (title cleanup, flyer image, registration link). These
  become `admin_locked_fields`.
- Re-enabling or chasing a broken source (48 North has been failing every run).
Frequency: light but constant. The scraper runs on a schedule, so every run can surface a
handful of review/junk items, and any feed breakage needs a human to notice. Today there is no
single "here is what needs you" screen, so the admin scans the whole list.

## 3. Options to reduce manual work

### 3a. Official feeds and APIs (lowest effort, highest reliability, no scraping risk)
- OCSA: already an official Google Calendar .ics. Keep as is.
- 48 North / SARC: the site runs "The Events Calendar" (WordPress). It exposes BOTH an official
  JSON REST API at `/wp-json/tribe/events/v1/events` and the .ical export we use now. The REST
  API returns clean structured JSON (title, start/end, venue, organizer, cost, recurrence) and
  is the better integration IF 48 North whitelists us or gives a key. This is a permission
  question for Joe Cline, not a technical blocker. Do not work around the 403.
- OWSA: replace the HTML scraper with an official feed if OWSA can publish a Google Calendar or
  The Events Calendar feed. Ask them. HTML scrapers are the most fragile and highest-maintenance
  option we have.
- General rule: prefer, in order, (1) official API, (2) official ICS/Google Calendar feed,
  (3) HTML scrape only as a last resort and only where terms allow.

### 3b. Let organizations bring their own events (best long-term, near-zero admin)
- "Connect your calendar": an org pastes a public Google Calendar / The Events Calendar / .ics
  URL once; we validate it and auto-import on the normal schedule, attributed to them. This is
  the same machinery we already have, just self-service, and it removes us from the loop.
- "Post your own events": verified orgs already can create events in-app. Encourage this for new
  partners so there is nothing to scrape at all. Edits they make are theirs (no admin lock
  needed).
- This is the single biggest lever: every org that self-serves is a source we never maintain.

### 3c. Third-party scraping / aggregation services (3 to 5 named, current pricing)
These matter only for sites with no feed and no willingness to share one. Pricing reconfirm on
the vendor page; all are usage/credit based and none roll credits over.

1. Apify (apify.com/pricing): actor-based scraping platform. Free $5 credit/mo; Starter $19/mo;
   Scale $199/mo (credits included at those amounts). Plug-in: run an actor on a schedule, it
   posts JSON to our ingest; cheapest for a few calendar pages. Terms: you are responsible for
   respecting each target site's robots/ToS; Apify does not grant permission to scrape a site.
2. Browse AI (browse.ai/pricing): no-code "watch this page" robots. Free 50 credits/mo;
   Personal ~$19/mo (annual); Professional ~$69/mo (annual); Premium from $500/mo. 1 credit ~ 10
   rows. Plug-in: point a robot at an events page, webhook the rows to us. Easiest to set up,
   good for monitoring a page for changes. Same ToS caveat: respect the target site.
3. ScrapingBee (scrapingbee.com/pricing): raw HTML/JS-render API. Hobby $19/mo (75k credits);
   Freelance $49/mo (250k). 1 credit basic, 5 with JS render. Plug-in: our backend calls their
   API to fetch a page we then parse. Lowest level, most flexible, but we still write the parser.
   Respect robots/ToS.
4. Zyte API (zyte.com/pricing): pay-as-you-go, charged per successful response. ~$0.13 to $1.27
   per 1,000 HTTP responses, higher with browser render; $100/mo cap on PAYG, $5 free. Plug-in:
   like ScrapingBee, a fetch layer; good when volume is tiny. Respect robots/ToS.
5. PredictHQ (predicthq.com/pricing): a true event-intelligence API (not a scraper). Quote-based,
   roughly from ~$500/yr entry to multi-thousand enterprise. Categories include sports/community
   events with attendance ranking. Plug-in: query their REST API by location. Likely overkill and
   weak on niche PNW sailing club calendars, but worth knowing for broad "events near you" data.

Recommendation on this bucket: for OUR problem (a handful of club calendars) a general paid
scraper is poor value and adds ToS risk. The win is feeds + self-serve (3a, 3b). Keep a scraper
service in mind only for a specific no-feed site, and only with that site's permission.

### 3d. AI-assisted normalization (cheap, keep it as a suggestion, never silent)
Send each imported event's title + description to a small LLM via the Emergent universal key to
propose a clean title, a category, and (see item 6) a single start time when clearly stated.
Cost per event: roughly $0.0001 to $0.001 (a small fraction of a cent) for a short title +
~800-char description on a small model; at 125 events that is pennies per full re-run.
Accuracy risk: categorization and title cleanup are low risk; time extraction is the riskiest
(see item 6). Mitigation: AI output is always a SUGGESTION in the admin queue labelled "from
description", never auto-applied, and only shown when the model is confident.

## 4. Design: linking scraped events to an organization
Goal: an imported feed belongs to a real club, and when that club goes live on Sail More Now the
events become theirs without duplicating or re-scraping chaos.

How an admin links (three levels, pick the most specific available):
- By source: on the `event_sources` row, set `organizer_handle` / `organizer_id`. Every event
  from that feed is attributed to that org. (We already resolve an org by handle/name at import.)
- By host name: fuzzy match a feed's organizer/host string to an existing org; admin confirms the
  mapping once, and it sticks for future imports.
- Individually: on a single event, pick the owning org (for mixed feeds).

What happens when the org goes live (claims their listing):
- Attribution: events show "Hosted by {Org}" with their partner badge; the "imported feed" note
  is dropped once claimed.
- Edit rights: the org can edit their own imported events going forward (today imported events
  are read-only in-app). Their edits set `admin_locked_fields` so a later scrape will not clobber
  them.
- Scraping continuation: offer the org a choice at claim time:
  (a) "Keep importing from our calendar" (we keep the feed as the source of truth, they edit
      only exceptions), or
  (b) "We will post events ourselves" (we PAUSE the feed for that org, mark existing imported
      events as org-owned, and stop scraping to avoid duplicates).
- Duplicate guard: when an org both posts in-app AND has a linked feed, de-dupe by (title, start
  day, venue) and prefer the org-posted copy; hide or merge the feed copy.

## 5. Exceptions-only admin queue
Fit with the existing queue: today the admin already has category review (`category_needs_review`)
and missing-info flags. Extend that same surface into one "Needs attention" tab on the Admin
Events page (and an optional daily email digest), driven by per-run flags so nothing silent slips
through. The admin only sees exceptions, not the whole list.

What should count as "odd" (flag, do not auto-change):
- A date-only event whose title/description contains a clock time (candidate for item 6).
- end before start.
- Far-future date (more than ~18 months out) or a date in the distant past.
- `[Draft]` / tentative events (surface them so an admin can confirm or wait).
- A sudden drop in a source's event count vs its previous run (likely feed breakage, e.g. 48N).
- Possible duplicates (same title + start day across sources, or feed copy vs org-posted copy).
- Source error on last run (48 North 403 belongs here today).
- Missing category after auto-categorization, or missing venue where a map pin is wanted.
Effort: low. The counts already flow through `run_aggregator`; this is mostly a filtered view
plus a few boolean flags and a digest email.

## 6. Conservative description-time extraction
Design goals: never invent a time, never overwrite, always reversible.
- Trigger: only for events that are date-only (`time_not_listed = true`).
- Extract: find clock times in the description/title with a strict parser (regex first, optional
  small-LLM confirmation). Apply ONLY when EXACTLY ONE unambiguous start time is found
  (e.g. "Skippers meeting 5 PM"). If zero, multiple, or ambiguous (ranges, "doors at 6",
  "5-7 pm"), do nothing and leave it date-only.
- Store as a SUGGESTION: write a `suggested_time` + `suggested_time_source: "description"` that
  appears in the admin queue as "time from description, confirm?". An admin taps to accept, which
  sets the real start time and `time_not_listed = false`; otherwise the event stays date-only.
- Never silent, never auto-applied. Labelled "time from description" wherever shown so it is clear
  the time came from text, not the feed.
- This is exactly the case Jenn hit with OCSA Tropical Party ("5 PM Social", "6 PM Dinner"): the
  feed is date-only but the description states a time. Under this design it would be SUGGESTED,
  and Jenn confirms, rather than us guessing.

## 7. Store each event's own IANA time zone
Proposal: add an optional `time_zone` field (IANA, e.g. "America/Los_Angeles"), default
"America/Los_Angeles". Keep storing the instant in UTC as today; the time zone is only for
display/parsing context. Benefits:
- Correct parsing of floating (zone-less) feed times by that source's real zone instead of a
  global Pacific assumption, which matters the moment a non-PNW feed is ever added.
- Display stays Pacific today (our product is PNW), but the field future-proofs us and documents
  the source's intent.
- Low risk: with a Pacific default, current behaviour is unchanged; nothing about UTC storage
  changes.

## 8. Recommended plan (with effort)

Before launch (do these):
- P0, small: ship the exceptions-only "Needs attention" queue (item 5) reusing the existing
  review surface + a daily digest. Biggest reduction in day-to-day admin scanning.
- P0, small: harden duplicate handling against renames/re-dates (item 5 weakness): match on a
  stable source UID when present, and fall back to (title, venue) rather than start date, so a
  moved event updates instead of orphaning.
- P1, small/medium: self-serve "connect your calendar" + push verified orgs to post their own
  events (item 3b). This is the durable fix; each org onboarded is one less thing to maintain.
- P1, small: add the optional `time_zone` field with a Pacific default (item 7). Cheap, future
  proofs, no behaviour change now.
- Waiting on Jenn/48 North: switch SARC to the official Events Calendar REST API or an allowed
  .ics once Joe Cline responds. No code until we have permission/a key.

After launch (fast-follow):
- P1, medium: description-time extraction as a SUGGESTION in the queue (item 6), starting
  regex-only, adding small-LLM confirmation if needed. Cheap per event, admin-approved only.
- P2, medium: org-linking lifecycle (item 4): source/host/individual linking, claim-time
  "keep importing vs we will post", and the post-vs-feed de-dupe.
- P2, as-needed only: a paid scraper service (item 3c) for a specific no-feed, permission-granted
  site. Default to NOT adding one; feeds + self-serve should cover the PNW clubs.

Net: the manual work drops mostly by (1) showing only exceptions, (2) moving orgs to self-serve
feeds/posting, and (3) making AI/time extraction a one-tap confirm instead of manual data entry.
Paid scrapers are a last resort, not the plan.
