# FONT-2d - Why the 1.5x cap did not apply, and the method that does

Build stamp bumped to **rv3a-22** (2026-11-02 UTC). Mobile only. No logic or copy
changed. Hyphens only. testing_agent NOT used.

## 1. The exact previous patch and why it did nothing on device
The code in `app/_layout.tsx` (build rv3a-21) was:

    function hasExplicitCap(props) { ... checks maxFontSizeMultiplier on prop/style ... }
    function applyFontCap(Component) {
      if (!Component || Component.__fontCapPatched) return;
      const orig = Component.render;            // <-- the problem
      if (typeof orig !== "function") return;   // <-- early return on native
      Component.render = function (...args) { ... React.cloneElement(..., {maxFontSizeMultiplier:1.5}) };
      Component.__fontCapPatched = true;
    }
    if (Platform.OS !== "web") { applyFontCap(RNText); applyFontCap(RNTextInput); }

That patch assumed `Text`/`TextInput` were `React.forwardRef` OBJECTS, which expose
a `.render` function you can wrap. They are not. Checked against the installed
source (not guessed):

- `node_modules/react-native/package.json` -> version **0.88.0**; `react` -> **19.3.0**.
- `node_modules/react-native/Libraries/Text/Text.js` line 47 defines Text with
  React Native's new "component" syntax:
  `const TextImpl: component(ref?, ...props) = ({ ref: forwardedRef, ... }) => { ... }`
  and `export default TextImpl;`. That compiles to a **plain function component**
  (it reads `ref` from props, the React 19 ref-as-prop pattern). It is NOT a
  forwardRef object, so it has **no `.render` field**.
- Result: `orig = Component.render` was `undefined`, `typeof orig !== "function"`
  was true, so `applyFontCap` **returned immediately and patched nothing**. The
  cap never existed on device. (`defaultProps`, the version before that, is also
  ignored by React 19 for function components - a second dead end.)
- `react-native/index.js` lines 147 and 153 export them as configurable getters:
  `get Text() { return require('./Libraries/Text/Text').default; }` and the same
  for `TextInput`. Consumers (`import { Text } from "react-native"`) read these
  getters lazily at render time.

## 2. The method that provably works (and how many files change)
`app/_layout.tsx`, function `installContentFontCap()` (native only):

- `const RN = require("react-native")` returns the SAME cached module object every
  other file imports from.
- For `Text` and `TextInput`: capture the original component, then
  `Object.defineProperty(RN, key, { configurable: true, get: () => Capped })`.
  The original getters are configurable (object-literal getters), so redefining
  is allowed; we guard with `desc.configurable === false` and skip if so.
- `Capped` is a thin wrapper: `props.maxFontSizeMultiplier == null ? <Orig {...props}
  maxFontSizeMultiplier={1.5}/> : <Orig {...props}/>`. It injects the 1.5x ceiling
  ONLY when the caller set no cap; every explicit cap (inline, via StyleSheet, or
  passed down by a wrapper component such as AppHeader) flows through untouched.
  `{...props}` forwards `ref` (React 19 ref-as-prop), so refs keep working.
- Because consumers read `RN.Text`/`RN.TextInput` lazily at each render and we
  redefine the getter before the tree renders, every call site gets `Capped`
  with **no edits to the ~93 files** that import Text/TextInput. **Files changed:
  1** (`app/_layout.tsx`) for the cap itself. (Grep confirmed no file captures
  `Text` via early `const { Text } = require("react-native")` destructuring, which
  is the only pattern that would bypass a lazy getter.)
- Native only (`Platform.OS === "web"` returns early): `maxFontSizeMultiplier` is a
  native concept and the web preview cannot emulate iOS Dynamic Type, so web stays
  exactly as before.

Why this is reliable where the old ones were not: it does not depend on `.render`
or `defaultProps`; it swaps the component the app actually renders, via the public
(configurable) module getter, using only documented React element composition.

TO REMOVE: delete `installContentFontCap()` and its call in `app/_layout.tsx`.

## 3. On-device probe (temporary, tied to the green KB debug strip)
In `src/components/BottomBarKeyboardView.tsx`, the `KbDebugStrip` now renders a
`FontCapProbe` line. It draws two hidden (offscreen, opacity 0) Text nodes at the
same base size:
- a REFERENCE with explicit `maxFontSizeMultiplier={1}` (never scales -> baseline
  height), and
- a PROBE with NO cap (subject to the global ceiling).
It measures both via `onLayout`, and `ratio = probeHeight / referenceHeight` is the
effective multiplier iOS applied. It prints one line:
`fontcap fs=<PixelRatio.getFontScale()> probe=<ratio> OK|FAIL`, e.g.
`fontcap fs=3.10 probe=1.50 OK`. OK when `|ratio - min(fontScale, 1.5)| <= 0.12`
(so at normal size fs=1.00 probe=1.00, and at max accessibility fs>1.5 the probe
must land near 1.50, proving the cap bit). It lives entirely inside the
`KB_DEBUG`-gated strip, so it is REMOVED with the strip at launch cleanup (set
`KB_DEBUG = false`, then delete the strip + `FontCapProbe`).

## 4. Build stamp
`src/lib/buildStamp.ts`: `BUILD_ID = "rv3a-22"`, `BUILD_TIME = "2026-11-02 UTC"`
(set by hand, not from the server clock, correcting the earlier 2026-06-18 regression).

## 5. Honest verification status
- VERIFIED in the browser (normal size, authenticated temp account on the Expo web
  preview): the compose screen's KB debug strip shows `b=rv3a-22` and
  `fontcap fs=1.00 probe=1.00 OK`; no crash, no console warning; the hidden Mg/Mg
  probe nodes are not visible. On web the cap is intentionally skipped, which is
  why fs and probe both read 1.00 - this confirms the probe plumbing and that web
  is unchanged.
- CODE-ONLY (NOT device-tested): the actual iOS Larger-Text behavior. The Expo web
  preview cannot emulate iOS Dynamic Type, so I could not observe fs>1 or confirm
  probe=1.50 here. On a real iPhone at the largest text size on build rv3a-22, the
  strip should read roughly `fs=3.1 probe=1.50 OK`; if it shows FAIL or a probe
  near fs, the getter override did not take (e.g. a non-configurable export) and
  we fall back to the shared-wrapper-import approach. The probe exists precisely so
  this is visible on device without guessing.
- Temp sailor account `jenn+font2d@` created for the signed-in screenshot and fully
  purged (users, signup_events, sessions, zoho_outbox); residue verified 0. (An
  earlier `jenn+font2c@` from FONT-2c was already purged.)
- tsc: the two files I changed introduce no new errors (the remaining tsc output is
  the project's pre-existing strict-null/route-type noise). Metro bundles clean
  (iOS + web); mobile service restarted.
