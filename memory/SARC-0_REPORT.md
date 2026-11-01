# SARC-0 — 48° North Seattle Area Racing Calendar scraper feasibility (REPORT ONLY)

Date: 2026-06-24. The content belongs to 48° North; Jenn is seeking permission. Only a few polite test requests were made (robots.txt, /sarc/, the list view, the sitemap index, one events sitemap, one single-event page). robots.txt ALLOWS `/sarc/` and `/event-calendar/` (only woocommerce/wp-admin are disallowed) with `Crawl-delay: 10`, and publishes `sitemap_index.xml`.

## 1. Why the old feed fails
The seeded source (`event_sources.DEFAULT_SOURCES`, key `48north`) is an **ICS** row pointing at `https://48north.com/?post_type=tribe_events&ical=1&eventDisplay=list&tribe_events_cat=sailboat-races`. That endpoint now errors, so `aggregator._fetch_text` tries curl then httpx and raises **"All fetch strategies failed"** (exactly the Admin > Event sources error). The site is Cloudflare-fronted (that's why the built-in 48north row was seeded `prefer_curl=True`), but the iCal export itself is gone/blocked - so we must switch this source from an ICS feed to a bespoke HTML scraper like we did for OWSA.

## 2. What a scraper can read (inspected)
- **Rendering: server-side HTML** (The Events Calendar / "Tribe" plugin). No JS execution needed - plain GET returns the events. Good for a BeautifulSoup scraper.
- **List + Month views** both exist at `/event-calendar/` with `?tribe_events_cat=sailboat-races&eventDisplay=list` (or `eventDisplay=month`). The list view also renders a "Latest Past Events" block (this is the "Previous events" behavior) and paginates with standard Tribe `?tribe_event_display=past` / page params.
- **Event permalinks**: `https://48north.com/event-calendar/<slug>/`. A complete, reliable list of them is published in the **tribe_events sitemaps** (`tribe_events-sitemap.xml`, `-sitemap2`, `-sitemap3`, plus `tribe_events_cat-sitemap.xml`) - the cleanest way to enumerate events without scraping calendar pages.
- **Single-event page is richly structured** (verified on `/event-calendar/grand-prix-regatta-48n-top-25-7/`). Tribe renders JSON-LD + `.tribe-events-*` microdata containing:
  - title: "Grand Prix Regatta (48N Top 25)"
  - start/end with timezone: 2026-10-23T00:00:00-07:00 -> 2026-10-25T23:59:59-07:00
  - venue: name "Seattle Yacht Club" + address "Seattle, Washington" (gives city/region -> market)
  - organizer: name "Seattle Yacht Club", **abbreviation "SYC"**, website, phone, email
  - registration/website link
  - description text
  - **category**: "Sailboat Races (SARC)"
  - **tags**: ["Seattle Area", "48N Top 25"]
- **Blocking**: robots allows these paths; Cloudflare may still fingerprint-block raw Python TLS, so reuse the `prefer_curl` path (curl first, httpx fallback) already in `_fetch_text`. Respect `Crawl-delay: 10` (sequential, ~1 request / 10s, cap total).

## 3. How the previous custom scraper was built (reuse this)
`backend/aggregator.py` has a small framework we copy:
- `Source` base class with an async `fetch() -> List[dict]`.
- `ICalSource` for standard ICS feeds; **`OWSAHTMLSource`** (key `owsa`) is the bespoke HTML example: it `_fetch_text("https://owsa.net/events")`, parses with BeautifulSoup, selects event anchors, regex-extracts the date from the surrounding block, builds a normalized event dict, categorizes, and dedupes by `external_id` within the source.
- Every event sets `external_id = _hash_key(source_key, uid-or-title, starts_at)` and the aggregator stores it under the stable id `agg_{source_key}_{external_id}` (this is the dedup key - re-imports update the same doc, they do not duplicate).
- `SCRAPER_CLASSES = {"owsa": OWSAHTMLSource}` maps a source `key` to its code class; `_load_sources` turns an `event_sources` row of `type=="scraper"` into that class instance. ICS rows with `prefer_curl` shell out to curl for Cloudflare hosts.
So SARC-1 = a new `SARC48NHTMLSource` class, registered in `SCRAPER_CLASSES`, and the seeded 48north row flipped from `type:"ics"` to `type:"scraper"` (keeping `prefer_curl`).

## 4. Club abbreviation -> full name + website (the 72-row CSV)
The event page already exposes the organizer's full name, abbreviation (e.g. "SYC"), and website, but not every event is complete, and the booklet CSV is the authoritative normalization. Plan:
- Load the 72-row CSV (abbreviation, organization, website) into a lookup dict `{abbr_upper: {name, website}}` (seed it into a small `club_lookup` collection or ship it as a constant, admin-viewable).
- Match priority per event: (a) organizer abbreviation from the page -> CSV; (b) fall back to fuzzy-match the organizer/venue full name to a CSV `organization`; (c) if no match, keep the page's organizer name and leave website blank.
- Where it shows on our event: `organizer_name` = full club name, and a "Hosted by {Club}" line linking to the club `website` (and `registration_url` when the event has its own reg link). This enriches events whose source text only had an abbreviation.

## 5. Color legend (WA/OR/BC/Youth) and the Top 25 star - are they exposed?
Yes, both are machine-readable on the event page as **tags**, not just booklet styling:
- The region legend surfaces as a region **tag** ("Seattle Area" in the sample; expect "Washington"/"Oregon"/"British Columbia"/"Youth"-style tags). Map region tag -> our `market` (e.g. Washington/Seattle-area -> "Greater Seattle" etc.), with the venue city as a tiebreaker.
- The **48° North Top 25 star** surfaces as the tag **"48N Top 25"** AND in the title suffix "(48N Top 25)" / slug `...-48n-top-25-...`. Map it to a boolean/tag (e.g. `tags:["Top 25"]` or a badge) on our event - do NOT rely on booklet color only.
Both should be read from the event's tag list (with the title/slug as a fallback for Top 25).

## 6. Crediting and linking back to 48° North (required on every scraped event)
Only proceed once 48N grants permission. On every imported SARC event:
- `source_label` = "48° North - Seattle Area Racing Calendar" (already the seeded label) and store the canonical `source_url` = the event's `/event-calendar/<slug>/` permalink.
- Render a visible credit on the event detail (both web + mobile): "Source: 48° North Seattle Area Racing Calendar" linking to the event permalink, plus a link to `https://48north.com/sarc/`. Keep the registration/host link pointing at the club.
- Optionally add the 48° North name/logo per whatever attribution wording 48N approves.

## 7. Proposed build plan (SARC-1) + re-import protection
1. **Add `SARC48NHTMLSource`** (key e.g. `sarc48n`) in `aggregator.py`, registered in `SCRAPER_CLASSES`; flip the seeded 48north `event_sources` row to `type:"scraper"` (keep `prefer_curl=True`). Use `_fetch_text(prefer_curl=True)`.
2. **Enumerate** events from the tribe_events sitemaps (preferred) filtered to the `sailboat-races` category, or from `/event-calendar/?tribe_events_cat=sailboat-races&eventDisplay=list`. Respect Crawl-delay 10 and cap requests per run.
3. **Parse** each single-event page's JSON-LD / `.tribe-events-*` microdata for title, start/end (+tz), venue, organizer (name/abbr/website/phone/email), description, category, tags.
4. **Normalize**: `external_id = _hash_key("sarc48n", slug, starts_at)`; enrich organizer via the CSV lookup; map region tag -> market; map Top 25 tag -> badge; set `source_url` (permalink) + `source_label` + credit.
5. **Dedup** by the stable id `agg_sarc48n_{external_id}` (aggregator upserts the same doc, never duplicates). Handle "Latest Past Events" by skipping events older than ~1 day (same as OWSA).
6. **Protect admin work (reuse ADMIN-EVENTS-1):** deletions write an `event_tombstones` row keyed by the stable id, and the aggregator already SKIPS any tombstoned id -> a deleted SARC event never comes back. Admin edits set `admin_locked_fields`, and the importer drops those fields from its `$set` -> an edited SARC event is not overwritten on the next run (untouched fields still refresh). Category stays protected by `category_manual`.
7. **Verify** (when built): delete a test SARC event, re-run the importer, confirm it does not return; edit a field, re-run, confirm the edit survives while an untouched field refreshes.

### Files read
backend/event_sources.py (DEFAULT_SOURCES, seed, SSRF ICS fetch); backend/aggregator.py (`_fetch_text`, `Source`, `ICalSource`, `OWSAHTMLSource`, `SCRAPER_CLASSES`, `_load_sources`, `run_aggregator`, `_hash_key`).
### Live pages inspected (test requests only)
48north.com/robots.txt; /sarc/; /event-calendar/?tribe_events_cat=sailboat-races&eventDisplay=list; /sitemap_index.xml; /tribe_events-sitemap3.xml; /event-calendar/grand-prix-regatta-48n-top-25-7/.
