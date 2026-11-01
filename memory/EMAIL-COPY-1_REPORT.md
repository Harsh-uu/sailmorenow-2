# EMAIL-COPY-1 Report (email wording only, backend)

Rules honored: no testing agent (render checks + 2 live sends to jenn@ only), no em dashes, no color/
layout/logo/structure changes. Only wording changed. Apostrophes: curly (’) to match the rest of the
emails. Build stamp bumped EMAILLOGO1-2026.06 -> EMAILCOPY1-2026.06.

## 1. Store wording swap (all welcome emails)
Replaced "...an app from the App Store and Google Play, with one login everywhere" with
"...an app from the Apple and Google Play stores, with one login everywhere" in every welcome template:
- email_templates/welcome-sailor.html
- email_templates/welcome-boat-owner.html
- email_templates/welcome-club-org.html
- email_templates/welcome-boat-pro.html (via the Boat Pro section rewrite in part 2)

Full-codebase search for "App Store and Google Play" wording: the only occurrences were those four
welcome sentences (now changed). No partner / community-partner welcome variant and no other template
in mailer.py contained that phrase (the community_partner_welcome email has no store sentence). The two
download BUTTON labels "Get it on the App Store" and "Get it on Google Play" were left untouched (they
are buttons, not the sentence, and you asked not to change buttons).

Confirmed: zero remaining "App Store and Google Play" sentence wording; "Apple and Google Play stores"
now appears once in each of the four welcome emails.

## 2. Boat Pro welcome section rewrites (before -> after)
Only these five passages changed. Every other section, its order, and the button are unchanged.

Intro
- BEFORE: "We’re so excited you’re here. Sail More Now was created so you can spend less time searching
  the web and more time on the water. This note walks you through where to start as a Boat Pro, and why
  each step helps."
- AFTER: "We’re so excited you’re here. Sail More Now was created so people can spend less time searching
  for information like who to hire and more time on the water. This email walks you through where to
  start as a Boat Pro to ensure your listing stands out so the leads start rolling in."

Use it wherever you are
- BEFORE: "Sail More Now works on the web at app.sailmorenow.com and as an app from the App Store and
  Google Play, with one login everywhere. Whether you are managing future outings, events, or boat
  projects, you will have more resources available in one spot, on the spot."
- AFTER: "Sail More Now works on the web at app.sailmorenow.com and as an app from the Apple and Google
  Play stores, with one login everywhere. Whether you are using the app to promote your business, manage
  leads, or plan well-deserved time on the water, you will have more resources available in one spot, on
  the spot." (the app.sailmorenow.com link is preserved exactly.)

Search by market
- BEFORE: "Pick your market and what you see (events, pros, clubs, posts) is filtered to where you sail.
  Portland/Vancouver is our home market at launch, and you’ll see events from other markets too. Heading
  somewhere else for a race or a trip? Switch markets to see what’s there."
- AFTER: "Browse by market and what you see (posts, marketplace, directories, events) is filtered to that
  area. We launched in Portland/Vancouver and are expanding across the Pacific Northwest and beyond, so
  you’ll see events from other markets too. Traveling out of town or interested in expanding your reach?
  Switch markets to see what’s there."

The feed
- BEFORE: "See what’s happening in your market, including updates, questions, and Sailing Opportunities.
  New posts are how you hear about things first."
- AFTER: "See what’s happening in your area, including conversations between sailors, owners, pros, and
  clubs via posts, forums and blogs. This is the place to share your industry knowledge and interact with
  potential customers."

The marketplace
- BEFORE: "Browse boats, gear, and parts for sale. Skip the noise of general marketplaces and connect
  directly with people who value what you have."
- AFTER: "Browse boats, gear, and parts for sale. Skip the noise of general marketplaces and connect
  directly with people who value what you post."

### Sections preserved unchanged (nothing dropped)
Header "Welcome, {{first_name}}!"; the "Where to start as a Boat Pro" block with all six steps (Set up
your listing, Choose your markets, Add your logo and photos, Watch your inbox, Confirm your reviews,
Share what you know) and their "Why:" lines; "A quick note on plans"; the support/FAQ line; the "Open
Sail More Now" button; the App Store / Google Play download buttons; the "Know someone who’d use this?"
share box with the "Share with a friend" button; and the "See you on the water, Jenn McDonald" sign-off.

## 3. Apostrophes + test sends
- All new copy uses curly apostrophes (’) and curly quotes (“ ”) to match the existing emails. Verified
  no straight apostrophes slipped into the new text; no em dashes anywhere.
- Test copies sent via Resend (status ok) to jenn@sailmorenow.com, subjects prefixed "[EMAIL-COPY-1
  test]": Boat Pro welcome and sailor welcome.

## Verified in a real inbox vs code-only
- CODE-VERIFIED: all four welcomes now read "Apple and Google Play stores"; the five Boat Pro passages
  match the requested copy exactly; full Boat Pro render confirms every other section/order/button is
  intact; curly apostrophes; no em dashes; build stamp updated.
- REAL INBOX: 2 emails accepted and sent by Resend (status ok) to jenn@. Actual rendering is yours to
  confirm in your inbox; I cannot open your mailbox.

## Files changed
- email_templates/welcome-sailor.html, welcome-boat-owner.html, welcome-club-org.html: store wording swap.
- email_templates/welcome-boat-pro.html: store wording swap + five section rewrites (intro, use-it-
  wherever, search-by-market, the-feed, the-marketplace).
- backend/mailer.py: EMAIL_BUILD EMAILLOGO1-2026.06 -> EMAILCOPY1-2026.06.
