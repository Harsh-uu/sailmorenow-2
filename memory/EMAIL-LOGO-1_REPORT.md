# EMAIL-LOGO-1 Report (email logo hosting, backend)

Rules honored: no testing agent (render checks + direct fetch checks + 3 live sends to jenn@ only),
no em dashes, no tokens printed. Build stamp bumped EMAILFIX2-2026.06 -> EMAILLOGO1-2026.06.

## TL;DR
The logo broke because it was being served from the ephemeral preview domain
(APP_PUBLIC_URL), which changes on every branch and sits behind Cloudflare bot checks. I pinned
EMAIL_LOGO_URL to the canonical Sail More Now round mark already hosted on the production WordPress
media library, a stable public host with no cookie, no login, and no app-domain dependency. That is
the same host the logo used before the regression.

## 1. Smaller logo version (deliverable)
- Made `frontend/public/smn-email-logo-240.png`: the same round artwork, resized 768 -> 240 px with
  LANCZOS (not stretched, not recropped), palette-optimized. 11.4 KB, well under the 40 KB target.
  Measured difference vs the faithful 240 px downscale: mean 1.1/255, max 30 only on ~3.5 percent of
  edge pixels (anti-aliasing). No recolor, no distortion.
- The original `frontend/public/smn-email-logo.png` (768x768, 457 KB) is untouched.
- NOTE this 240 px file is a deliverable, not the live source (see section 2 for why). If you upload it
  to the same WordPress media library and send me the URL, I will repoint EMAIL_LOGO_URL to it in one
  line so the live emails use the lighter 11 KB file.

## 2. Hosting choice and why
Chosen host: the production WordPress media library on sailmorenow.com, using the existing canonical
round mark `.../wp-content/uploads/.../cropped-smn_round_logo_transparent_200x200.png` (the file is
actually 512x512, 162 KB).

Why this and not the alternatives:
- Emergent Object Storage: REJECTED. I tested it. Objects are not publicly readable; every GET needs an
  `X-Storage-Key` header (a no-key GET returns 400). Serving it would require a backend route on the app
  domain, which is exactly the preview/Cloudflare dependency we are trying to escape.
- Platform image-generation CDN (customer-assets): it is public and stable, but the only way to put a
  file there programmatically regenerates the artwork, which would recolor or distort the logo. Rejected.
- App backend route on APP_PUBLIC_URL: still on the preview domain in preview (ephemeral + Cloudflare),
  so it would not fix your iPhone test today. Rejected.
- WordPress canonical mark: CHOSEN. Same artwork and colors (verified side by side), already hosted,
  zero upload needed, and it is the host that worked before the regression.

Verification of the WordPress URL (fetched from the server):
- HTTP 200, content-type image/png, 0 redirects, cache-control max-age 1 year.
- NO set-cookie at all (the preview URL returns a Cloudflare `__cf_bm` bot cookie; this host does not).
- No login or auth required.
- A request with a Gmail image-proxy user agent also returned 200 image/png.
- Independent of APP_PUBLIC_URL, the preview URL, branching, and pod changes: it lives on sailmorenow.com,
  a host that does not change when the app is branched or the pod rotates.

## 3. Pin + attributes
- `backend/.env`: `EMAIL_LOGO_URL` set to the WordPress URL. `email_logo_url()` already prefers
  EMAIL_LOGO_URL over APP_PUBLIC_URL, so every email now uses it. Backend restarted to load the env.
- alt text "Sail More Now": present on every logo img (verified).
- explicit width and height attributes: present on every logo img (56/72/100 px per template; verified).
- navy background fallback: the logo sits inside the navy header cell (bgcolor navy) in every email, so
  a blocked image shows navy with the alt text rather than a broken box.
- Per your "do not change any other part of the emails" rule, I changed only the env var and the build
  stamp; the alt/width/height/navy-bg were already in place, so no template markup was touched.

## 4. Logo appears once per email
Rendered through the real pipeline: verification, trial reminder, and sailor welcome each contain exactly
one logo (count = 1) with exactly one `alt="Sail More Now"`. No duplicate or second logo.

## 5. Test sends (jenn@ only)
Sent via Resend, status ok, subjects prefixed "[EMAIL-LOGO-1 test]": verification, trial reminder (member
monthly, "$6.99 per month for Premium"), sailor welcome. Please check Gmail on your iPhone in both light
and dark mode.

## 6. After we publish on the live domain + what if the app domain changes
- After publish: nothing to change for the logo, because it is NOT tied to the app domain. Just confirm
  in a real inbox that the logo still loads (it will come from sailmorenow.com either way). Do confirm
  your other email links that DO use the app domain point at the live domain after publish.
- If the app domain changes: the logo is unaffected, because EMAIL_LOGO_URL points at sailmorenow.com,
  not at the app domain. The only thing that would break the logo is if that WordPress file is moved,
  renamed, or deleted, or if the sailmorenow.com domain itself goes away. Keep that file in place.
- Optional hardening: if you ever retire the WordPress site, move the logo to a dedicated CDN or bucket
  and update EMAIL_LOGO_URL once; no code change beyond the env var.

## Verified in a real inbox vs code-only
- CODE / SERVER VERIFIED: EMAIL_LOGO_URL resolves to the WordPress mark; logo renders once per email with
  alt text; the WordPress URL returns 200 image/png with no cookie and no auth, including under a
  Gmail-proxy user agent; the new 240 px file is 11 KB and visually faithful; no em dashes.
- REAL INBOX: 3 emails were accepted and sent by Resend (status ok) to jenn@sailmorenow.com. Actual
  rendering on your iPhone Gmail in light and dark mode is yours to confirm; I cannot open your mailbox.

## Files changed
- backend/.env: EMAIL_LOGO_URL set to the WordPress canonical round mark.
- backend/mailer.py: EMAIL_BUILD EMAILFIX2-2026.06 -> EMAILLOGO1-2026.06.
- frontend/public/smn-email-logo-240.png: new 240 px, 11 KB deliverable (original PNG untouched).

## Update - EMAIL-LOGO-2 (jenn uploaded the lighter logo)
EMAIL_LOGO_URL repointed to the WordPress-hosted 240 px file:
`https://sailmorenow.com/wp-content/uploads/2026/10/smn-email-logo-240.png`.
Server-verified: HTTP 200, image/png, no set-cookie, no auth, 11,407 bytes, 240x240 px, valid PNG, and
200 under a Gmail image-proxy user agent. Byte-identical to the approved deliverable and same artwork as
the prior logo (mean diff 1.1/255). Logo still appears once per email with alt "Sail More Now" and
explicit width/height; displayed size unchanged (e.g. 56x56 on the verification email). Build stamp
EMAILCOPY1-2026.06 -> EMAILLOGO2-2026.06. One verification-email test sent to jenn@ (ok). Real-inbox
rendering is yours to confirm; server/code-verified here.
