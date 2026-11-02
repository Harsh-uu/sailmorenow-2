# FINAL-LARGE-TEXT-PASS (rv3a-24)

Mobile only. No logic or copy changes except the em-dash sweep (Section 4). All
sizing uses wrapping / minHeight / flexShrink / flex, never fixed heights or
widths. Chrome caps unchanged (header 1.3, tab labels 1.1, chips/badges/buttons/
segmented/Picker 1.2). testing_agent NOT used. Hyphens only. Build stamp bumped
to rv3a-24, BUILD_TIME "2026-11-02 UTC" (hand-typed).

IMPORTANT: the Expo web preview renders at iOS font-scale 1.0 and cannot emulate
iOS "Larger Text", so every large-text behavior below is CODE-ONLY. What I could
verify in the browser is that nothing regressed at normal size and the new
conditional layouts compile and render.

--------------------------------------------------------------------------------
## SECTION 1 - FONT-2f: public screens + Google button

### 1a) Founding Partner cards (src/components/partner.tsx, FoundingWall)
- Names already wrap to 2 lines; market lines now wrap to 2 lines (was
  numberOfLines 1) and are center-aligned.
- Each card width is now responsive: `PixelRatio.getFontScale() > 1.3 ? 188 : 120`,
  so at large text names/markets have room instead of truncating or clipping at
  the card edge. No fixed height.
- The horizontal scroller gets `paddingRight: 16` (was 8) so the last card is not
  cut off.
- VERIFIED: browser (normal size) - wall renders unchanged. CODE-ONLY: the wider
  188pt cards and 2-line market wrap at large text.

### 1b) "What you get" two-column cards (app/index.tsx)
- Root cause of "Communi / ty Hub": at large text the fixed ~47.5% columns are
  too narrow, so a single long word character-breaks.
- Fix: above a font-scale THRESHOLD of 1.3 the grid switches to a SINGLE column
  (`singleCol = PixelRatio.getFontScale() >= 1.3` -> card width 100% vs 47.5%), so
  every title wraps at word boundaries with room to spare. Threshold chosen as
  1.3 because that is where a 2x-capped title first risks overflowing a half-width
  column; normal/mild users keep the 2-column layout.
- VERIFIED: browser at 390/820 shows the normal 2-column layout unchanged.
  CODE-ONLY: the single-column switch at large text.

### 1c) "Become a Community Partner" heading (app/index.tsx)
- The upgrade-block heading now has `flex: 1` so it wraps inside the card, and the
  header row is `alignItems: "flex-start"` so the ribbon icon stays aligned to the
  first line. The block already had 14pt padding. Icon and heading no longer
  overflow the card edge.
- VERIFIED: browser (normal size). CODE-ONLY: wrap at large text.

### 1d) "Continue with Google" button (all uses)
- Found 3 uses: the shared `src/components/GoogleButton.tsx` (used by sign-in and
  register) and TWO inline buttons on the landing page (hero + final CTA in
  app/index.tsx).
- All fixed the same way: label capped at the chrome 1.2x, `flexShrink: 1` with
  `numberOfLines={2}` so it can wrap instead of clipping, the G icon stays
  vertically centered (row `alignItems: center`), and the button uses `minHeight`
  (50) + vertical padding instead of a fixed height.
- VERIFIED: browser - the button renders correctly on the landing hero, landing
  CTA and sign-in (light mode). CODE-ONLY: 2-line wrap at large text.

### 1e) Audit of other no-login screens
- app/signin.tsx, app/forgot-password.tsx ("Forgot your password?" and the "Check
  your email" sent state): already use theme tokens (onSurface/muted/teal/
  surface/border/error) so they are dark-mode safe, and single-line inputs
  (height 50) comfortably fit 2x text. No change needed. VERIFIED in browser.
- app/register.tsx (Create account): uses theme tokens throughout. Fixed the two
  dropdown "selects" (Home market, Club/Org category) so the value text is
  `flex:1, flexShrink:1` (shrinks/wraps) with the chevron fixed, and the select
  uses `minHeight:50` + vertical padding instead of a fixed 50. Also fixed the
  "Sail More Now - the quarterly digest" em-dash (see Section 4). The account-type
  grid, plan rows and newsletter row already use flex:1 and wrap. CODE-ONLY: the
  select wrap at large text.

--------------------------------------------------------------------------------
## SECTION 2 - FONT-2g: bell counter + New event form

### 2a) Notification bell badge (src/components/NotificationBell.tsx)
- The badge is a fixed small pill at the bell's top-right; its count text is now
  capped at 1.0x (`maxFontSizeMultiplier={1}`, `numberOfLines={1}`) so it never
  grows and can no longer overflow the pill or garble. `minWidth` bumped 18 -> 20
  so two glyphs ("9+") fit; "9+" is still shown for 10 or more. This is the ONE
  shared bell used by every main tab header, so all screens are covered.
- VERIFIED: browser (count renders in pill). CODE-ONLY: the 1.0x cap at large text
  (but by construction it cannot scale).

### 2b) New event form (app/new-event.tsx)
- "Time to be decided (show the date only)" label: wrapped with `flex:1,
  flexShrink:1` next to the checkbox so it no longer runs off the right edge.
- Start/End time pickers: the value text is now `flex:1, flexShrink:1` with an
  8pt right margin and the chevron stays fixed, so "No end time" (and long time
  values) shrink/wrap instead of being clipped by the arrow. The select style
  changed `height:48` -> `minHeight:48` + vertical padding.
- Start vs End column alignment: above font-scale 1.2 the two pickers STACK
  vertically (`stackTimes`), each full width, so the longer "End time (optional)"
  label can wrap without misaligning the columns; below 1.2 they sit side by side
  with one-line labels as before.
- Audit of other event/listing forms: new-post, edit-post (marketplace listing)
  use the shared `Picker`, and crew-listing, crew-signup use `MultiSelectPicker`.
  Both trigger components already cap at 1.2x with `flex:1 numberOfLines
  adjustsFontSizeToFit` value text, a fixed chevron and `minHeight`, so they do
  not clip at large text. No change needed.
- VERIFIED: browser (normal size, form renders). CODE-ONLY: the TBD wrap, value
  shrink and the stacked time pickers at large text.

### 2c) Hub list - FAB over month count (app/(tabs)/feed/index.tsx)
- The month header rows (e.g. "October 2026" with a right-hand count) now reserve
  `paddingRight: 64` so the count always sits to the LEFT of the floating + button
  (which occupies the right ~78pt), and the count text is capped at the chrome
  1.2x. The month title keeps `flex:1`, wraps to 2 lines and is capped 1.4x.
- VERIFIED: browser (normal size). CODE-ONLY: that the count clears the FAB at
  large text.

--------------------------------------------------------------------------------
## SECTION 3 - VERIFY-UI-1: email verification screen (src/components/VerifyGate.tsx)
- Replaced the hardcoded NAVY/INK colors (which rendered dark navy title + "Wrong
  email? Fix it" link on the dark navy background, nearly invisible) with theme
  tokens: screen background `surfaceSecondary`, title `onSurface`, body
  `onSurfaceSecondary`, links `tealText`, "Sign out" `onSurfaceSecondary`, and the
  input uses `surface`/`border`/`onSurface`/`muted`.
- The two primary actions ("Resend verification email", "Send new link") now use
  the shared `Button` (accent/onAccent), which is high-contrast in both modes and
  has a built-in `minHeight` of 50. Wording, testIDs and the verification logic
  are unchanged.
- 2x layout: content stays centered with consistent 14pt gaps in a ScrollView
  (flexGrow 1); the footer is `flexWrap: "wrap"` with row/column gaps so "Contact
  support" and "Sign out" wrap instead of colliding.
- Contrast checked with the WCAG relative-luminance formula (sRGB linearize ->
  (L1+0.05)/(L2+0.05)). Results (threshold: body >= 4.5:1, large text >= 3:1):
    DARK (bg #0B1220):  title 16.78:1, body 12.84:1, link 9.27:1, sign out 12.84:1
    LIGHT (bg #F1F5F9): title 14.78:1, body  9.45:1, link 4.74:1, sign out  9.45:1
    Button label onAccent #10233A on accent #F2A03B: 7.45:1 (both modes)
  All pass.
- Other auth screens checked for dark-on-dark: the amber VerifyBanner keeps a fixed
  amber bg with dark-ink text (high contrast in both modes, left as-is); sign-in,
  register and forgot-password/"Check your email" already use theme tokens and are
  fine. There is no separate "Verify success" or in-app "password reset" screen in
  the mobile app (the reset link opens on the web), so nothing else to fix.
- VERIFIED: contrast via the math above; sign-in/register/forgot rendered in the
  browser. CODE-ONLY: the live dark-mode render of the locked screen (it requires
  an account in the locked-verification state, which the preview cannot stage).

--------------------------------------------------------------------------------
## SECTION 4 - EMDASH-1: em-dash sweep (customer-facing copy only)
Replaced "—" with "-" (keeping surrounding spaces) in:
- app/(tabs)/my-listing.tsx: "Photos - upgrade to Premium" and "Photos - Premium only"
- app/(tabs)/messages.tsx: "...messages waiting - now unlocked."
- app/(tabs)/feed/index.tsx: crew card fallback "{name} - crew available"
- app/(tabs)/profile/index.tsx: "Relisted - live for 30 more days" and the photo-error toast ("- " + message)
- app/(tabs)/directory/index.tsx: share text "...Sail More Now - the Pacific Northwest sailing community."
- app/messages/new.tsx and app/messages/[id].tsx: "On a free plan - won't receive this until they upgrade: ..."
- app/register.tsx: "Sail More Now - the quarterly digest"

Extra customer-facing strings found and also changed:
- src/components/InlineComments.tsx: "No comments yet - start the conversation." (a 3rd copy of the comment empty state not covered by FONT-2a).
- backend/scheduler.py (email/notification templates): the volunteer-reminder notification body, the volunteer-reminder email HTML line, and the email footer "- The Sail More Now team" all had em-dashes; changed to hyphens.

NOT changed (per instructions / scope):
- Admin-only empty-value placeholders "—" in src/screens/AdminScreen.tsx and the
  date fallback in src/lib/format.ts (admin/placeholder, listed as such in FONT-2a).
- All code comments (theme.ts, api.ts, storage, Icon, etc.) and docstrings.
- Demo/seed fixture content (backend/demo_seed.py, routers/seed_router.py) and the
  weather-station display names (backend/sailflow_stations.py) - these are dev
  fixtures / data labels, not production UI copy; left untouched to avoid changing
  seeded data. Flagging here in case you want them swept too.
- The "Boat Pros from $19.99/mo" landing copy (you are holding that fix).

--------------------------------------------------------------------------------
## Verified vs code-only (summary)
- VERIFIED in the browser at normal text size: landing page at phone 390 and
  tablet 820 (hero, Google button, 2-column "What you get" cards, account pins),
  sign-in at 390 (Google button + theme), Metro bundles clean (iOS + web), web
  preview HTTP 200, no console warnings.
- CODE-ONLY (preview cannot show iOS Larger Text): every large-text behavior -
  the single-column card switch, wider Founding cards, 2-line Google label,
  stacked time pickers, bell 1.0x cap, month-count FAB clearance, and the
  VerifyGate dark-mode render of the locked state. Contrast for Section 3 was
  checked by calculation (numbers above), not by eye in dark mode.
- Could not fully fix: nothing outstanding. The VerifyLockedScreen could not be
  staged in the preview (needs a locked-verification account); its colors are
  verified by contrast math and code review.

## Temp accounts
None were created this pass - all verified screens (landing, sign-in, register,
forgot) are reachable without logging in. Zero residue.
