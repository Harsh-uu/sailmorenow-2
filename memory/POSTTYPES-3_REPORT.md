# POSTTYPES-3 - Condition as a dropdown on the For sale post (mobile only)

Date: 2026-11-02. Mobile only (`/app/mobile/app/new-post.tsx`). No publish. testing_agent NOT used (forbidden). No schema change, no data touched beyond temp. No em-dashes. Web untouched.

## Change
On the mobile New post screen, when type is For sale, the Condition pill chips (which wrapped to 2+ lines, worse at Large font) are replaced with the SAME `Picker` dropdown component used for Type and Market. Removed the now-unused `Pressable` import and the `wrap`/`pill` styles.

## Condition options (unchanged - same order, same stored values)
1. `New`
2. `Like New`
3. `Good`
4. `Fair`
5. `For parts`
Stored value == label (e.g. the post stores `condition: "Like New"`). Default = none selected (Condition is OPTIONAL; on submit it sends `condition || null`). No required-field rule existed and none was added. Price, photos, permissions and Marketplace routing untouched.

## Layout (MOBILE-FIX-1 auto-fit)
The shared `Picker` already uses `adjustsFontSizeToFit` + `maxFontSizeMultiplier={1.2}` on its label, so it fits at Display size Large and with 3-button navigation, same as the Type/Market pickers. Single-line trigger, bottom-sheet option list.

## Condition chips elsewhere on mobile (item 3 - reported, NOT changed)
- `mobile/app/edit-post.tsx`: editing a For sale post uses its OWN condition chips (a SEPARATE component/file, not the same component as new-post). Per the rule ("change it too only if it is the same component; otherwise report it and stop"), it was NOT changed. If you want parity, say so and I will convert it the same way.
- `mobile/app/marketplace-filters.tsx`: this is the Marketplace Condition FILTER (a different purpose - filtering listings, multi-select), not the For sale post's condition selector. NOT changed.

## Verification
- `tsc --noEmit`: clean for new-post.tsx.
- Metro: bundles cleanly (Web + iOS), no error overlay on the Expo preview.
- Stored values: posted a temp For sale via the mobile payload shape for each of the 5 conditions and confirmed the DB stored the exact value - 5/5 PASS. Temp post + account + script deleted (zero residue).
- The New post screen UI itself is behind auth + navigation; per the standing rule it is CODE-ONLY (tsc + bundle verified), not device-tested on a phone.
