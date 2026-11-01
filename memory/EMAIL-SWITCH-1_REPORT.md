# EMAIL-SWITCH-1 Report

Date: 2026-06 (build stamp bumped `EF3-2026.06` -> `ES1-2026.06`)
Scope: `backend/mailer.py` send path only. Templates, layout, logo, footer and the
burst guard are UNCHANGED. No DNS changes. No mailbox-record changes. Real test
emails sent to jenn@sailmorenow.com ONLY.

---

## 1. How Jenn added the key (done)
`RESEND_API_KEY` was requested via the secure secrets card (never pasted in chat)
and Jenn confirmed it is saved as a backend secret.
- Preview: injected into this preview's backend env immediately (I restarted the
  backend; the key is present and valid - prefix `re_`, 36 chars).
- Production: the same secret carries into the published app on the next Publish.

## 2. All email now sends through Jenn's Resend account
`send_email` now has two paths:
- PRIMARY: Jenn's Resend account via `POST https://api.resend.com/emails`
  (`Authorization: Bearer RESEND_API_KEY`, `User-Agent` header, JSON body).
  - From: `"Sail More Now" <notifications@notifications.sailmorenow.com>`
    (`RESEND_FROM_NAME` + `RESEND_FROM_EMAIL`, overridable by env).
  - Reply-To: `customersupport@sailmorenow.com` by default; contact-form emails
    pass the sender's address as Reply-To (unchanged behaviour).
  - `List-Unsubscribe` / `List-Unsubscribe-Post` headers preserved for
    promotional email.
- Every one of the 21 email types flows through this single `send_email`, so all
  of them (digests, admin alerts, contact messages, welcome, password reset,
  dispute, billing, etc.) now go out via Resend. No template was touched.

## 3. Designs / burst guard unchanged
No template, layout, logo, footer or the admin_notify burst guard was modified.
Only the transport inside `send_email` changed.

## 4. Fallback (verified) - mail is never dropped
If `RESEND_API_KEY` is missing OR invalid (401/403) OR Resend stays unavailable
after retries, `send_email` logs an `EMAIL FALLBACK` event and re-sends through
the Emergent managed proxy instead of dropping the email.
Verified live (to jenn@ only):
- Invalid key -> Resend 401 -> `EMAIL FALLBACK` logged + recorded -> delivered via
  proxy (`provider: proxy_fallback`, status ok).
- Missing key -> delivered via proxy (`provider: proxy`).
Each fallback is logged at WARNING as `EMAIL FALLBACK ...` and recorded to the
`email_failures` collection with `kind: "EMAIL FALLBACK"`, so you can see exactly
when and why a fallback happened:
`grep "EMAIL FALLBACK" /var/log/supervisor/backend.err.log` or query
`email_failures` where `kind = "EMAIL FALLBACK"`.

Platform note: nothing on the platform forces the managed proxy or blocks sending
from your own key. The proxy is used ONLY as the fallback. The one limitation I
hit is on Resend's side, not the platform's: your API key is a restricted
(send-only) key - see section 6.

## 5. Rate limits, quota and retries
- Resend rate limit is 10 requests/second per team (confirmed live:
  `ratelimit-limit: 10`, `ratelimit-remaining: 5`). On `429` or `5xx`,
  `_send_via_resend` retries up to 4 attempts with backoff (1s, 2s, 4s),
  honouring the `retry-after` header, each sleep capped at 10s. A send is NEVER
  silently skipped: after retries are exhausted it falls back to the proxy, and
  any non-retryable 4xx (e.g. 422) is recorded as `EMAIL SEND FAILED` and also
  falls back. `EMAIL SEND FAILED` recording is unchanged.
- FREE plan caps: 3,000/month, 100/day.

How digests behave if the DAILY cap (100/day) is hit:
When the daily quota is exceeded, Resend returns a 429/403 that will not clear
within seconds. The code does a few short retries (sleep capped at 10s so it
never hangs for hours), then FALLS BACK to the managed proxy and delivers the
digest anyway, logging one `EMAIL FALLBACK` per affected recipient. So a digest
run that crosses the daily cap is NOT dropped - the remainder goes out via the
proxy, and the fallback rows in `email_failures` show you exactly how many
crossed over. (If you would rather pause/queue instead of falling back once the
cap is hit, that is a product decision - tell me and I'll add a cap-aware queue.)

## 6. Sender / headers / SPF-DKIM-DMARC
From a real test send (verified the request Resend accepted, HTTP 200 + message
id returned):
- From name: `Sail More Now`
- From address: `notifications@notifications.sailmorenow.com`
- Reply-To: `customersupport@sailmorenow.com` (sender's address for contact forms)
- Transport: Jenn's Resend account (not the managed proxy).

SPF/DKIM/DMARC alignment: I could NOT read it programmatically because your
`RESEND_API_KEY` is a restricted send-only key - the Resend `/domains` endpoint
returned `401 restricted_api_key`. Based on the setup it SHOULD align: you are
sending From `notifications.sailmorenow.com`, which you confirmed is verified in
Resend, so Resend signs DKIM with a `d=` on that domain and provides SPF; because
the From domain matches the DKIM signing domain, DMARC aligns. To CONFIRM, either
(a) open one of the test emails in Gmail -> "Show original" and check
`Authentication-Results` shows `spf=pass`, `dkim=pass`, `dmarc=pass` for
notifications.sailmorenow.com, or (b) check the domain shows "Verified" in the
Resend dashboard. If you want me to verify it from code, add a full-access Resend
key (or temporarily allow the domains scope) and I'll report the exact status.

## 7. Tests (real, jenn@ only)
Sent via Resend to jenn@sailmorenow.com ONLY, all `provider: resend`, status ok:
- Contact message        id 01a18be6-be46-...
- Dispute admin alert     id 01a18be6-bf4a-...
- Welcome (sailor)        id 01a18be6-bfd9-...
- Password reset          id 01a18be6-c065-...
Plus a raw header check (id 01a18be6-c0fb-...) to read rate-limit headers, and two
fallback checks (invalid-key + missing-key) that also went to jenn@ only. All temp
scripts and the one `email_failures` fallback row created during testing were
cleaned up. Build stamp bumped to `ES1-2026.06`.

### Verified vs code-only
- Verified live via Resend (HTTP 200 + ids, provider=resend): the four email
  types above actually sent through Jenn's Resend account.
- Verified live: fallback to proxy on invalid key and on missing key (both
  delivered; `EMAIL FALLBACK` recorded); 10/sec rate-limit headers.
- Code-verified only (not triggered, to honour jenn@-only): the live `/contact`,
  `/support/contact`, dispute, digest and billing endpoints - they all call the
  same `send_email`, which is proven to use Resend, so they inherit the new path.
- Could NOT verify (restricted key): SPF/DKIM/DMARC status via API, and whether
  Gmail shows pass - Jenn to confirm in her inbox / dashboard (section 6).

## Files changed
- `backend/mailer.py`: added Resend constants + `_send_via_resend` (retry/backoff),
  generalised `_record_event` (EMAIL SEND FAILED + EMAIL FALLBACK), rewrote
  `send_email` to prefer Resend and fall back to the managed proxy, bumped build
  stamp. No template/layout/footer/burst-guard changes.
