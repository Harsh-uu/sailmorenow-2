# FONT-2e - Content text ceiling raised 1.5x -> 2x

Build stamp **rv3a-23**, BUILD_TIME **2026-11-02 UTC** (typed by hand). Mobile only.
No logic or copy changed. Hyphens only. testing_agent NOT used.

## 1. Global default changed to 2x
`app/_layout.tsx` -> `installContentFontCap()`: the injected default is now
`maxFontSizeMultiplier={2}` (was 1.5). The mechanism is unchanged (native-only
getter override that injects ONLY when the caller set no cap), so every explicit
chrome cap is still preserved exactly: header 1.3, tab labels 1.1, chips/badges/
buttons/segmented control/Picker 1.2, calendar day/weekday/month 1.3, legend/Today
1.2, etc.

## 2. Other explicit 1.5 content ceilings changed to 2 (full list)
- `src/screens/ProDetailScreen.tsx` line ~190: `Badge ... maxScale={1.5}` -> `{2}`
  (Pro detail CATEGORY chips).
- `src/screens/ProDetailScreen.tsx` line ~195: `Badge ... maxScale={1.5}` -> `{2}`
  (Pro detail MARKET chips).
- `src/components/DeleteAccountSheet.tsx` line ~102: the red business-deletion
  warning `maxFontSizeMultiplier={1.5}` -> `{2}`.
NOT touched (per "do not touch any explicit cap below 1.5", and these are not
1.5): all 1.1/1.2/1.3/1.4 caps stay; DeleteAccountSheet's 1.4 and 1.6 caps are
intentional and left as-is (only its single 1.5 was a content ceiling to align).
The `Badge` component default stays `maxScale = 1.2` (chrome). Grep confirmed
these were the only explicit 1.5 font ceilings in the app besides the global one.

## 3. KB probe updated for 2x
`src/components/BottomBarKeyboardView.tsx` -> `FontCapProbe`: `PROBE_CAP = 2`;
expected = `min(fontScale, 2)`; tolerance widened slightly to 0.15. Line now reads
e.g. `fontcap fs=3.57 probe=2.00 cap=2 OK`, and OK means the measured ratio is
within 0.15 of the cap (or of fs when fs is below the cap). Still lives entirely
inside the KB_DEBUG strip and is removed with it at launch.

## 4. Layout review for 2x (less headroom than 1.5x) - what changed and what was fine
Changed (`app/(tabs)/feed/index.tsx`, the Hub):
- Create sheet: the option rows had uncapped 16px labels with no flex, so at 2x a
  long label ("New marketplace listing") could overflow the row. Added
  `flex: 1, flexShrink: 1` to the label Text (wraps), and wrapped the option list
  in a `ScrollView` so the sheet can never clip a row at 2x. (minHeight/flex only,
  no fixed heights.)
- Market picker sheet: same fix on its row label (`flex: 1, flexShrink: 1`) so long
  market names wrap instead of overflowing; the trailing check icon stays put.
- Hub FAB vs "Found crew" pill: raised the FlatList `paddingBottom` 120 -> 140 so
  the last card's bottom controls (the right-aligned "Found crew"/"Still looking"
  toggle on a sailing-opportunity card) always clear the floating + button, which
  sits at bottom 24 + height 58. The toggle itself uses padding (no fixed height)
  so it grows cleanly at 2x.

Reviewed and already robust at 2x (no change needed, and why):
- Events calendar cells and day circles: every label there is explicitly capped
  below 2x (day number 1.3 with adjustsFontSizeToFit, weekday/month 1.3, legend/
  Today 1.2), and cells use `minHeight`, so the 1.5->2 change does not affect them.
- Crew Bank listing popup (`CrewListingPopup.tsx`): header and footer heights are
  MEASURED (onLayout) and the body is a bounded ScrollView; the name is capped 1.3,
  pills wrap, all body content scrolls. Grows safely at 2x.
- My markets / Home market sheets (`profile/index.tsx`): titles capped 1.3, rows
  use `paddingVertical` + `flex:1/flexShrink:1` on the name with a `flexShrink:0`
  "primary" tag, list is a bounded ScrollView (maxHeight 360). Rows grow/wrap, no
  fixed heights.
- Comment box + Post button (`PostDetailScreen.tsx`): input uses `minHeight:42`
  (+ maxHeight with internal scroll), the bar is `alignItems:"flex-end"`, and the
  send button uses `minHeight:42` + padding, so both grow with 2x text.

## 5. Build stamp
`src/lib/buildStamp.ts`: `BUILD_ID = "rv3a-23"`; `BUILD_TIME = "2026-11-02 UTC"`
(hand-typed, not from the server clock).

## 6. Verification (honest)
- VERIFIED in the browser at normal size (authenticated temp account on Expo web):
  the compose/new-message KB strip shows `b=rv3a-23` and `fontcap fs=1.00
  probe=1.00 cap=2 OK`; the Hub Create sheet opens and renders all options cleanly
  with the new ScrollView wrapper; no crash, no console warning. On web the cap is
  intentionally skipped (fontScale 1), which is why fs and probe read 1.00 - this
  confirms the plumbing and that web is unchanged.
- CODE-ONLY (NOT device-tested): the actual 2x behavior at large iOS text. The Expo
  web preview cannot emulate iOS Dynamic Type, so I could not observe fs>1 /
  probe~2.00 or the real 2x layouts here. On a real iPhone at the largest size on
  build rv3a-23 the strip should read roughly `fs=3.57 probe=2.00 cap=2 OK`.
- tsc: no new errors in the files I changed (remaining tsc output is the project's
  pre-existing strict-null / ScrollView-ref / route-type noise). Metro bundles
  clean; mobile service restarted.
- Temp sailor account `jenn+font2e@` created for the signed-in screenshots and
  fully purged (users, signup_events, sessions, zoho_outbox); residue verified 0.
