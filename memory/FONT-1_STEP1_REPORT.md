# FONT-1 Step 1 (BUILD) - large-text layout, one shared approach

Date: 2026-11-02. Mobile only (Expo), JS/TS only - no backend, no native (app.json) change. testing_agent NOT used (forbidden). No em-dashes.

## Shared approach implemented (two-tier text policy)
Chrome capped, content wraps. Rather than a global Text.defaultProps cap (which would wrongly cap body text and hurt accessibility), the policy lives in the SHARED chrome components, so every screen inherits it by using them.

## Files changed
New:
- `src/components/AppHeader.tsx` - the ONE shared navy header: `minHeight` (never fixed height), title capped at 1.3x and allowed 2 lines, `flexShrink` title, non-shrinking right accessory.

Shared components / chrome:
- `src/components/Screen.tsx` - now renders `AppHeader` (was a fixed `height:52`, single-line, uncapped title).
- `app/(tabs)/_layout.tsx` - tab label: removed the fixed `lineHeight:14` that clipped descenders, added `includeFontPadding:false` + `paddingBottom:2`; kept `maxFontSizeMultiplier 1.15`, `adjustsFontSizeToFit`, and `TAB_BASE + insets.bottom` + the bottom-nav filler (MOBILE-FIX-1 preserved).
- `src/components/ui.tsx` - `Avatar` fixed size now `flexShrink:0` (image + initials) so it never slivers; `Chip` and `Badge` get `minHeight` + 2-line + 1.2x cap; `SegmentedControl` segments `flex:1` + label `adjustsFontSizeToFit` + 1.2x cap (no mid-word break).

Six tab headers routed through `AppHeader`:
- `feed/index.tsx` (also: Hub author name wraps to 2 lines, market label cap 1.2x, FAB list `paddingBottom` 100 -> 120).
- `events/index.tsx` (also: event date `when` and location `meta` now wrap to 2 lines + `flexShrink`).
- `messages.tsx` (also: both sender-name lines wrap to 2 + `flexShrink`, timestamps cap 1.3x).
- `directory/index.tsx` (also: pro `company_name` wraps to 2).
- `my-listing.tsx`, `my-events.tsx`.

Content wrap + inputs:
- `src/components/reviews/ReviewsSection.tsx` - review author name and the Overall + count line wrap (were single-line).
- `app/(tabs)/profile/index.tsx` - hero gets `paddingHorizontal:20` (name/Log out/Switch account no longer touch edges), name wraps to 2 lines + centered, Appearance segment label capped/auto-fit, handle row `height:44` -> `minHeight:44`.
- `app/new-post.tsx`, `app/edit-post.tsx`, `app/onboarding.tsx` - text input `height:50` -> `minHeight:50` + vertical padding so scaled text is not clipped.

Inherited for free (no per-screen edit needed) via the shared components above: every screen using `Screen.tsx` header (CrewBank, EventDetail, HubDetail/PostDetail, PublicProfile, FollowingList, Saved, Faq, pricing, review-compose, messages/[id], following, my-plan, reviews, directory org/[id], boat-pro-listing, org-listing, community-guidelines, Admin) and every `Avatar`/`Chip`/`Badge`/`SegmentedControl` usage app-wide. Admin screens were not otherwise touched.

## Verified vs code-only
- Preview-checked at NORMAL text size (Expo web preview, authenticated temp account), no regression, at three widths: phone 390, tablet 834, desktop 1280. Confirmed: shared `AppHeader` renders on Hub/Events/Profile, tab-bar labels full incl. "Pros/Orgs" and "Messages", Hub FAB clear of content, Profile hero padded with avatar intact, event card title/date/location + Badges correct.
- Metro bundles clean (iOS + web, 1601 modules, no error overlay); mobile service restarted.
- CODE-ONLY (not device-tested): the actual iOS Larger Accessibility behavior. The Expo web preview runs at font-scale 1 and has no iOS text-size control, so the large-text result (header 2-line growth, descenders, wrapping vs truncation) is implemented per the two-tier policy but was NOT reproduced on a device. Needs Jenn on an iPhone, or a Publish build.

## Could not fully fix / caveats
- A single very long UNBREAKABLE word in a tight control can still character-break at extreme sizes (there is no space to wrap on); multi-word content wraps correctly. The Newsletter label already takes full width (`flex:1`).
- Pre-existing tsc type noise is unchanged and unrelated to these edits (ref typing on TextInput/ScrollView, `EmptyState`/`Screen subtitle` prop mismatches, `tabBarIcon` color typing, `Pro[]|null` FlatList data, EventMap). None are from this change; Metro (Babel) bundles regardless.

## Deferred to the later iPad pass (NOT touched, as instructed)
- Hub author label `maxWidth: 140` (feed/index).
- Fixed-width circles/tiles: event date badge `width:52`, calendar day circles, avatar sizes, gallery tile widths.
- Percentage `maxHeight` bottom sheets.
- General wide-column content width for large iPad screens.

## Android / MOBILE-FIX-1 risk
Low. The tab bar still uses `TAB_BASE + insets.bottom` and keeps the bottom-nav filler; only the label `lineHeight`/padding changed. Recommend a quick re-check of Android "Display size Large" + 3-button nav since the tab bar is shared by both platforms.
