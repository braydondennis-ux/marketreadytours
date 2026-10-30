# October 29 tour health check

Read-only production check completed around 17:10 Phoenix on October 29, 2026.
No customer data changes, test messages, resends or deployments.

## Today's tour and saved activity

One current tour dated October 29: Sonoran Showcase, 09:00, version 14, five listings.
48 saved evaluations: Windstone Trail 10, North 66th Street 11, North 40th Place 9,
Calle de Las Estrellas Road 9, Happy Coyote Trail 9. Public aggregates match private
records. Across the site: 43 matching private/public tours and 143 matching evaluations.
The previously flagged Sonoran duplicate is absent in the current data. This audit did
not remove it; duplicate prevention remains deferred.

## Emails and reminders

53 evaluation email jobs created today, all status sent, with provider IDs and zero
recorded retry attempts. Current saved evaluation count is lower because an attendee's
later submission replaces their earlier saved evaluation while email history remains.
The sole older outbox job is the October 23 Erik test. No unsent/dead outbox jobs.
No sendAdminEmail log entries today, so no organizer-triggered post-tour report was
observed. Do not send one without authorization.

Resend GET /emails rejected the configured credential with restricted_api_key:
“This API key is restricted to only send emails.” Thus sent records confirm provider
acceptance, not downstream delivery, spam placement or inbox reading. Permissions were
not changed. Sonoran reminder records: ten sent and two cancelled. Site-wide reminders:
40 sent, ten pending, four cancelled; none overdue, missing or terminal in the active queue.

## Errors and recovery

All 30 functions ACTIVE. Reminder scheduler ENABLED with successful latest attempt.
One actual HTTP 500 today: submitRating at 11:14:05 Phoenix, Firebase database transaction
failed with disconnect. HTTP 200 followed at 11:14:09, and the client reporting the error
has a saved Happy Coyote Trail evaluation at 11:14:09.278 plus a sent email job/provider ID
at 11:14:09.700. A 09:51 network-error report from the same client also coincides with a
saved North 66th Street evaluation and sent email receipt. No unresolved aggregate drift.
Do not claim every intended evaluation was submitted: attendance intent is not available.

Five unhandledPromise/internal browser reports from three other clients remain unexplained.
Two of those clients have all five listings rated; the third has four. Diagnostics intentionally
omit exception messages and stacks, so the failing browser operations cannot be established.
Nine ERROR log entries consist of seven client diagnostics plus the one server failure's
request/error pair, not nine separate server failures.

## Validation and follow-ups

Live app release db8f2c05b11ba50ee3befb96782f0bca8fd13180. Today's scheduled validation
40934631453 passed security rules, full emulator workflows and iPhone/Chrome checks.
Read-only endpoint probes saveTour, submitIntake and submitRating each returned expected 401.
The snapshot consistency audit returned needsReview false. Request inbox collections were not
included in the snapshot; the audit script's default zero counts do not mean empty inboxes.

Follow up on transient database transaction disconnect handling and on privacy-preserving
classification of generic browser promise failures. Current saved state recovered; underlying
transport cause and generic promise causes are unconfirmed. Consider provider delivery-event
visibility separately from send receipts. No scope expansion or live fixes performed here.

Private snapshot: ignored .mrt-backups/2026-10-29-health/snapshot.json.

## Follow-up investigation and client hardening

All 139 submitRating idempotency receipts are complete; none is stuck processing. Both
reported submission errors have completed receipts, saved ratings and accepted email jobs.
The server exception identifies a Firebase SDK database connection disconnect during a
transaction. It does not identify the underlying network cause. No automatic mutation retry
was added because a lost response can leave an uncertain transaction outcome.

The five historic generic reports cannot be attributed conclusively. Reproduced separate
client failure paths with injected browser/storage failures: native share cancellation rejected
without a catch, and secure favorite writes could reject without feedback. The client now
handles share cancellation quietly, shows failure feedback for sharing/favorites, and awaits
favorite update callbacks. Global diagnostics use fixed error categories (Auth, AppCheck,
Storage, TypeError, Abort, Permission, Unknown); no raw messages, stacks or user fields.
This improves future diagnosis, not retrospective attribution.

Local validation: 160 unit tests, 13 static checks and all 24 isolated Chrome/iPhone browser
checks passed (two existing static heuristic warnings).
No backend configuration, customer records, evaluation submission behavior, email routing or
duplicate prevention changes. No test emails sent.
