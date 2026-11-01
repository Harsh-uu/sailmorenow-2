# ADMIN-MAIL-1 Report

Date: 2026-06. Build stamp bumped `ES1-2026.06` -> `AM1-2026.06`.
Scope: web admin portal + backend only. No billing, scrapers, mobile screens, or
email-provider changes. No real emails sent (feature is read/manage only); any
hypothetical test email would go to jenn@sailmorenow.com only.

---

## A. Email delivery log  (DONE)
New admin page `/admin/email` ("Email delivery") + a tile on the Admin home grid.
- Lists rows from the `email_failures` collection: time, email (subject as the
  type indicator), recipient, reason, and route - "Sent via backup" (fallback) or
  "Failed". NO message bodies are shown or stored (confirmed: the list endpoint
  returns only id/kind/to/subject/reason/at/resolved).
- Each row shows a short plain-language hint on what to do (e.g. "The recipient
  address may be wrong or was rejected. Double-check the address." / "Hit a
  temporary rate limit or daily quota ... ask them to try again from the app." /
  "The email sending key may be missing, invalid or restricted.").
- Filters: All / Failed / Fallback, plus a From/To date range (inclusive).
- Actions: Mark resolved (toggles, with Reopen), Clear resolved (deletes resolved
  rows). Retry was intentionally DROPPED per Jenn - a true resend would require
  storing message bodies (incl. password-reset links/codes), which is a privacy
  risk; the existing retry-with-backoff + proxy fallback already cover transient
  failures.
- Count badge: the Admin nav button (desktop + mobile) shows a red badge with the
  unresolved count, polled every 60s from `GET /api/admin/email-failures/summary`.
- Auto-delete after 90 days via a TTL index on `expire_at` (set when a row is
  recorded in `mailer._record_event`).

Backend endpoints (all admin-only):
- `GET /api/admin/email-failures?status=all|failed|fallback&date_from&date_to`
- `GET /api/admin/email-failures/summary`
- `POST /api/admin/email-failures/{id}/resolve`
- `POST /api/admin/email-failures/clear-resolved`

## B. Contact messages  (DONE)
Reworked `/admin/contact`:
- Status per message: New / Handled / Archived (field `queue_status`, defaults
  New for existing rows). Shown as a badge on each card.
- Actions per message: Mark handled, Archive, Restore (back to New), and Delete
  with a confirm step ("Delete this message? This can't be undone.").
- Multi-select: a checkbox on each card + a bulk bar to Archive or Delete several
  at once (bulk Delete uses the same confirm dialog).
- Default view is New; filter tabs for Handled, Archived and All; search by sender
  (name/email) or subject.
- Delete redaction: the contact doc is replaced with a small tombstone
  (`id`, `created_at`, `deleted: true`, `deleted_by`, `deleted_by_name`,
  `deleted_at`, `queue_status: "deleted"`) - message text + sender details are
  removed - AND an admin audit-log entry is written (`action: delete`,
  `entity_type: contact_message`). Deleted messages are excluded from the queue.
- The "Open in admin" deep link from the contact email
  (`/admin/contact?msg=<id>`) still works: it switches to the All view, scrolls to
  the message and highlights it with an orange ring.
- Reply history and the reply composer / templates / Community Partner activate
  are all preserved.

Backend endpoints (all admin-only):
- `POST /api/admin/contact/{id}/status` {status: new|handled|archived}
- `POST /api/admin/contact/bulk` {ids, action: archive|delete}
- `DELETE /api/admin/contact/{id}`  (redact + audit)
- `GET /api/admin/contact` now returns `queue_status` and excludes deleted rows.

## C. Admin-only + responsive + account-deletion note
- Every new endpoint is admin-only, enforced on the SERVER via
  `Depends(require_admin)` (401/403 for non-admins). Verified: anonymous requests
  to the email-failures list and the contact status endpoint are blocked.
- Checked at laptop (1440), tablet (834) and phone (390) widths - both pages lay
  out cleanly, filters/tabs wrap, cards stack, bulk bar and dialog are usable.

Does contact_messages store a user id? (for Account-deletion Stage B)
- YES, but only for IN-APP support submissions (`/support/contact`,
  `source: "profile_support"`) - those store `user_id`.
- PUBLIC contact-form submissions (`/contact`) store NO user_id; they link to a
  person only through the `email` field.
- So Stage B should: (1) redact/delete contact_messages where `user_id` matches
  the deleted account, and (2) optionally match remaining messages by email.
  Nothing was changed for this now, as requested.

## Verified in browser vs code-only
- Verified in browser (screenshots, logged in as jenn/admin):
  - Email delivery page at laptop/tablet/phone: route badges, reasons, hints,
    Mark resolved/Reopen, Clear resolved, filters, date pickers, 90-day note.
  - Contact queue at laptop/tablet/phone: status tabs + counts, search, status /
    source / subject badges, select checkboxes, per-message actions.
  - Deep link `?msg=<id>` highlights the message (orange ring) and shows All.
  - Delete confirm dialog shows the exact copy + audit-log explanation.
- Verified by code/API test (as admin, with temp data, then cleaned up):
  list + all filters, summary count, resolve drops the count, clear-resolved
  deletes, contact status change, bulk archive, delete redaction (PII removed +
  tombstone kept), audit-log row written, list excludes deleted, and anonymous
  requests are blocked (17/17 checks passed).
- Not applicable: no emails were sent for this feature.

## Clean-up
All temp rows (email_failures + contact_messages tagged AM1TEST/AM1SHOT) and all
temp test scripts were deleted. No real/seed data was modified (the real
"Raejen Waters" message was only opened in a cancelled confirm dialog).

## Files changed
- backend/mailer.py: `_record_event` now stores id + resolved + 90-day expire_at
  (still no body); build stamp AM1-2026.06.
- backend/routers/admin_router.py: email-failures endpoints (+ TTL index), contact
  status/bulk/delete endpoints, `_redact_contact`, contact list returns
  queue_status + excludes deleted; removed an em-dash from the reply email.
- frontend/src/pages/AdminEmailDelivery.jsx (new), AdminContact.jsx (reworked),
  AdminHome.jsx (tile), App.js (route), components/Header.jsx (unresolved badge).
