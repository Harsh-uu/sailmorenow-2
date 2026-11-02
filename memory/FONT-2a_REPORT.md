# FONT-2a (BUILD) - large-text fixes for sheets, calendar, map, comment box, tab labels

Date: 2026-11-02. Mobile only, JS/TS only (no backend, no native/app.json). testing_agent NOT used (forbidden). No em-dashes added; comment empty state fixed.

## Files changed
1. `app/_layout.tsx` - app-wide CONTENT ceiling: `Text` and `TextInput` defaultProps `maxFontSizeMultiplier: 1.5`. Chrome components keep their own tighter caps (they override the default), so this only affects uncapped content text.
2. `app/(tabs)/_layout.tsx` - tab label fix (see root cause below): removed `adjustsFontSizeToFit`, set explicit `lineHeight: 16` + `paddingBottom: 3`, cap `1.1x`, kept one line; `TAB_BASE` 52 -> 58 so the taller label fits. Preserved `TAB_BASE + insets.bottom` and the bottom-nav filler (Android fix intact).
3. `src/lib/buildStamp.ts` - `BUILD_ID` -> `rv3a-19`, `BUILD_TIME` -> `2026-11-02 UTC` (stamp now reads "build rv3a-19 . 2026-11-02 UTC . v1.0.0", browser-confirmed).
4. `src/components/ui.tsx` - `Badge` gets a `maxScale` prop (default 1.2 chrome; profiles pass 1.5 for content chips). (Chip/Badge already had minHeight + wrap + cap from FONT-1.)
5. `src/screens/ProDetailScreen.tsx` - category and market Badges pass `maxScale={1.5}` (content chips scale with body text).
6. `src/components/CrewListingPopup.tsx` - header name wraps to 2 lines + cap 1.3 + flexShrink; market line wraps to 2; Close button label cap 1.2. (Sheet already respected the top safe area via `height*0.88 - insets.top`, had a bounded scrolling body with a 120 minimum, and a fixed footer.)
7. `app/(tabs)/profile/index.tsx` - My markets + Home market sheet titles wrap to 2 + cap 1.3; the "primary" tag is now `flexShrink:0` with the market name `flex:1 flexShrink:1` so the tag can never squeeze the name.
8. `app/(tabs)/events/index.tsx` - calendar: `calCell` gets `minHeight:48`; `calDay` fixed 34x34 -> `minWidth/minHeight:34` + horizontal padding so two-digit dates show fully; date numerals and weekday letters capped 1.3 with auto-fit; the month/week title wraps 2 lines, caps 1.3, and is `flex:1` centered between the arrows so the arrows and Today button stay inside the card; the legend already wraps.
9. `src/components/EventMap.native.tsx` - added `renderCluster` drawing a fixed 36pt circle with the count `allowFontScaling={false}`, so the cluster numeral always fits.
10. `src/screens/PostDetailScreen.tsx` - comment input `minHeight:42` (keeps multiline + maxHeight scroll); Post button `height:42` -> `minHeight:42` + vertical padding so it stays fully visible and bottom-aligned with the input at every size; fixed the em dash in the empty state.
11. `src/screens/HubDetailScreen.tsx` - fixed the same comment empty-state em dash.

## Tab-label root cause (point 6)
FONT-1 used `adjustsFontSizeToFit` with `numberOfLines={1}` plus `includeFontPadding:false`. On iOS that shrinks the text WIDTH but the glyph line box stays tall, and inside React Navigation's label slot the descenders (g, q, s) were clipped at the bottom; `includeFontPadding` is an Android-only prop so it did nothing on iPhone. Fix: drop `adjustsFontSizeToFit`, give the label an explicit `lineHeight` (16) and `paddingBottom` (3) so descenders have room, cap at 1.1x, and raise `TAB_BASE` to 58 for the extra height. This is code-only until on-device confirmation (the preview cannot render iOS accessibility sizes).

## Content ceiling (point 1)
Implemented once in the root layout via Text/TextInput defaultProps (1.5), not per screen. Chrome keeps FONT-1 caps: header title 1.3 (AppHeader), tab labels 1.1, chips/badges/buttons/segmented/Picker 1.2. Profile category/market chips opt into 1.5 via the new `maxScale` prop.

## Verified vs code-only
- Checked in the Expo web preview at NORMAL text size (authenticated temp account), no regression, at three widths: phone 390 (Events + open calendar: AppHeader, week nav inside card, legend wraps, full tab labels Hub/Events/Pros-Orgs/Messages/Profile), tablet 820 (Hub: header, Following banner, FAB clear of content, full tab labels), desktop 1024 (Profile: Newsletter row, Appearance Light/System/Dark fit, Danger zone, build stamp rv3a-19 confirmed). Metro bundles clean (iOS + web); mobile restarted.
- CODE-ONLY (not device-tested): the actual iOS Larger Accessibility behavior (the preview runs at font-scale 1 with no iOS text-size control). The tab-label descender fix, the 1.5 content ceiling wrapping, the calendar numeral/title caps, the map cluster numeral, and the sheet caps are all implemented but must be confirmed by Jenn on the iPhone (or a Publish build).

## Could not fully fix
- The map cluster `renderCluster` cannot be previewed (native maps do not render in the Expo web preview), so the cluster-count cap is code-only.
- A single very long unbreakable word in a tight control can still character-break at extreme sizes (no space to wrap on) - multi-word content wraps.
- Pre-existing tsc type noise unchanged (EventMap platform-extension resolution, TextInput ref/focus/blur typing, EmptyState/Screen subtitle props, tabBarIcon color, Pro[]|null) - none are from these edits; Metro bundles regardless.

## Em dashes in user-visible mobile copy (point 8 - comment empty state fixed; rest listed for your call)
Fixed: the comment empty state in PostDetailScreen and HubDetailScreen ("No comments yet - start the conversation.").
Remaining em dashes in user-visible strings (NOT changed):
- `app/(tabs)/my-listing.tsx`: "Photos - upgrade to Premium" and "Photos - Premium only".
- `app/(tabs)/messages.tsx`: "...messages waiting - now unlocked."
- `app/(tabs)/feed/index.tsx`: crew card fallback title "{name} - crew available".
- `app/(tabs)/profile/index.tsx`: toast "Relisted - live for 30 more days" and the photo-error toast.
- `app/(tabs)/directory/index.tsx`: the share message "...Sail More Now - the Pacific Northwest sailing community."
- `app/messages/new.tsx` and `app/messages/[id].tsx`: "On a free plan - won't receive this until they upgrade: ...".
- `app/register.tsx`: "Sail More Now - the quarterly digest".
- `src/screens/AdminScreen.tsx` and `src/lib/format.ts`: an em dash used as an empty-value placeholder ("—") in admin stats and the date fallback (admin-facing / placeholder, not member copy).

## Android / MOBILE-FIX-1 risk
Low. Tab bar still `TAB_BASE + insets.bottom` with the bottom-nav filler; only the label styling and base height (58) changed. Recommend a quick Android Large + 3-button recheck since the tab bar is shared.
