# FONT-2c - Events screen large-text fixes + global cap root cause

Build stamp bumped to **rv3a-21** (2026-06-18 UTC).
Scope: mobile only. No logic or copy changed. Hyphens only. No testing agent used.

## Root cause of the uncapped text (the real bug)
The app-wide 1.5x content ceiling was set in `app/_layout.tsx` via
`(Text).defaultProps = { maxFontSizeMultiplier: 1.5 }`. Under **React 19,
`defaultProps` is ignored on `forwardRef` host components** (both `Text` and
`TextInput` are forwardRef in React Native). So that default silently did
nothing. Every component that set an EXPLICIT cap (header 1.3, tab labels 1.1,
chips/badges/buttons/segmented 1.2) kept working; anything relying on the
inherited 1.5 default (calendar legend, Following subtitle, Today button, event
card body text) scaled unbounded at large iOS accessibility sizes.

## The fix for the cause (global, native only)
In `app/_layout.tsx` the broken `defaultProps` lines were replaced with a
render-level patch:

- `applyFontCap(Component)` wraps the component's internal `render`. After the
  original render produces its element, it injects `maxFontSizeMultiplier: 1.5`
  ONLY when the element has none set.
- `hasExplicitCap(props)` returns true if `maxFontSizeMultiplier` is present as a
  prop OR inside the `style` (single object or array), so an explicit cap -
  inline, via StyleSheet, or passed down by a wrapper component - is NEVER
  overridden.
- Applied to both `Text` and `TextInput`.
- Guarded against double-patching (`__fontCapPatched`) and against a missing
  `render`.
- **Native only** (`Platform.OS !== "web"`). `maxFontSizeMultiplier` is a
  native-only prop; injecting it on react-native-web leaks an unknown prop onto
  DOM nodes (it produced a "React does not recognize the prop" warning in the
  web preview). The web preview cannot emulate iOS large text anyway, so scoping
  to native keeps web byte-identical to before while giving iOS the real 1.5x
  ceiling.

### How to remove the patch
In `app/_layout.tsx`, delete the `hasExplicitCap` and `applyFontCap` helper
functions and the `if (Platform.OS !== "web") { applyFontCap(...) }` block. That
fully reverts to stock React Native text scaling (no global ceiling).

## The three reported Events fixes
1. **Today button row** (`app/(tabs)/events/index.tsx`): `calTopRow` now uses
   `flexWrap: "wrap"` + `rowGap`. The Week/Month `SegmentedControl` gets
   `flexShrink: 1` so it shrinks. The Today button gets `flexShrink: 0` and
   `marginLeft: "auto"` so it stays fully inside the card and right-aligned on
   the same line, and wraps to its own right-aligned line only if it truly
   cannot fit. The "Today" label is capped at 1.2x.
2. **Calendar legend**: legend labels now `maxFontSizeMultiplier={1.2}` and
   `numberOfLines={1}` (chrome tier). Wrap and small gaps kept. The dots are
   fixed-size `View`s and never scaled with text. Root cause above explains why
   the 1.5 default never applied.
3. **Following banner** (`src/components/FollowingBanner.tsx`): title capped at
   1.3x; subtitle now wraps to 2 lines at 1.2x (`numberOfLines={2}`,
   `maxFontSizeMultiplier={1.2}`). Icon and chevron unchanged.

## Audit of the rest of the Events screen
Verified every Text element:
- Filter pills (market + category Pickers): already capped 1.2x (chrome). OK.
- Header action icons: `Icon` components, fixed size, do not scale. OK.
- Calendar month label, weekday row, day numbers, date-box month/day: already
  carry explicit caps (1.3 / 1.1-1.2). OK.
- Event card title / when / location / "N going": no explicit cap -> now capped
  at the restored 1.5 content ceiling and already use `numberOfLines`, so they
  wrap gracefully. Not broken; left as-is.
- Selected-day bar date + "Show all": no explicit cap -> now capped at 1.5 via
  the restored default. Not broken; left as-is.
- Empty / Error states: inherit the restored 1.5 default. Not broken.
No further clearly-broken items found, so nothing else changed (per "fix only
things that are clearly broken").

## Verification
- Mobile bundles clean (iOS + web) after the patch; mobile service restarted.
- Browser (normal size) screenshots after the patch: Events (calendar open),
  Hub, and the public landing render unchanged with no console warnings; the
  earlier "React does not recognize the prop" web warning is gone after scoping
  the patch to native. VERIFIED at normal size.
- iOS large-text behavior is **code-only, not device-tested** - the Expo web
  preview cannot emulate iOS "Larger Text", so the large-size layouts could not
  be device-verified here. Needs a live iPhone check on build rv3a-21.
- Temp partner account `jenn+font2c@sailmorenow.com` was created for the signed-in
  screenshots and then fully purged (users, signup_events, sessions, zoho_outbox);
  residue verified 0.
