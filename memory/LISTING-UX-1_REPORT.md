# LISTING-UX-1 Report (Jun 2026)

Scope: Boat Pro listing-editor empty states, brand-icon replacement, fixed-order tier-card
feature matrix with "Not included" states, and visual plan-comparison listing-card previews.
Standing rules honored: NO testing agent (web browser screenshots + code review), NO em dashes
in new copy, no seed data touched, no temp data created, Campaigns switch stays OFF.

Decision confirmed by Jenn: comparison listing-card previews shipped on WEB ONLY. Mobile previews
logged to the backlog (not built, not dropped).

## (a) Final feature order on the Boat Pro tier cards
Single source of truth = backend/plan_features.py -> GET /api/plans/matrix. Web and mobile both
render this exact order top to bottom; each tier (Basic / Featured / Premium) lines up row-by-row,
showing "Not included" where a tier lacks the feature:
1. Read the feed
2. Public directory listing
3. Markets
4. Logo
5. Cover photo
6. Gallery photos
7. Trust and credentials
8. Enhanced listing card
9. Reviews received
10. Direct messaging
11. Directory placement

## (b) Flag icon - every place it appeared for Boat Pros + replacement
The literal "flag" icon appeared in ONE place: mobile/src/components/ProfileCardEditor.tsx logo
empty-state fallback (`<Icon name="flag" size={26} color={colors.teal} />`).
- Replaced with the Boat Pros brand icon (ICON_BOAT_PROS, 28x28, contentFit=contain) for
  entityKind === "boat_pro"; non-boat_pro entities now show a neutral `image-outline` icon.
Related brand-icon usages added (these did NOT previously show a flag; they used a generic/initials
placeholder):
- frontend/src/components/ProfileCardEditor.jsx logo empty-state: boat_pro now renders ICON_BOAT_PROS
  (28x28), non-boat_pro renders `image-plus`.
- frontend/src/pages/Pricing.jsx "How your listing looks" preview cards: Featured & Premium logo
  slots render ICON_BOAT_PROS (Basic has no logo entitlement, so it shows "HR" initials).

## (c) Browser-verified vs code-only
WEB:
- Browser-verified (public /pricing, Boat Pros tab): the three comparison preview cards render
  correctly - Basic (initials logo, plain cover), Featured (brand-icon logo, navy cover), Premium
  (brand-icon logo, navy cover, "Trust and credentials" badge). "What Premium adds" + fixed feature
  copy render.
- Code-only: the listing-editor empty states (cover-empty / logo-empty / gallery-empty) and the
  brand-icon logo placeholder - the editor is behind the owner/auth gate, so verified by code +
  compile, not screenshotted.
MOBILE:
- Code-only / compile-checked for ALL changes (empty states, flag->brand-icon replacement, matrix
  fixed-order with "Not included"). Not browser/device-verified. Mobile service restarted after edits.
- Mobile comparison previews: NOT built (backlog, per Jenn).

## (d) Editor empty-state sizes
WEB (frontend/src/components/ProfileCardEditor.jsx):
- Logo: 80x80px circle (h-20 w-20, rounded-full, dashed border when empty). Brand icon rendered 28x28
  (h-7 w-7). Label "Add logo".
- Cover: aspect ratio = coverAspect prop, default BANNER_ASPECT = 1024/224 (approx 4.57:1). Empty-state
  recommended size shown = 1600 x 350 (computed 1600 x round(1600 / aspect)). Label "Add cover photo".
MOBILE (mobile/src/components/ProfileCardEditor.tsx):
- Logo: circular (borderRadius 999, dashed border). Brand icon 28x28. Label "Add logo".
- Cover: aspect BANNER_ASPECT = 1024/224. Recommended size shown = 1600 x 350. Label "Add cover photo".

## Files changed
- frontend/src/components/ProfileCardEditor.jsx (empty states, brand-icon logo)
- frontend/src/lib/planMatrix.js (fixed-order rows + "Not included")
- frontend/src/pages/Pricing.jsx (comparison preview cards, brand icon)
- frontend/src/pages/BoatProListing.jsx
- mobile/src/components/ProfileCardEditor.tsx (empty states, flag->brand icon)
- mobile/src/lib/planMatrix.ts (fixed-order rows + "Not included")
- mobile/src/lib/plans.ts (ICON_BOAT_PROS export), mobile/app/pricing.tsx,
  mobile/app/(tabs)/profile/boat-pro-listing.tsx

## Backlog item logged
- MOBILE-LISTING-PREVIEW: port the web "How your listing looks" comparison cards to mobile pricing
  (deferred; structural risk judged too high to fit this sprint).
