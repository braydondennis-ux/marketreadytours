# October 9 tour readiness audit

Performed October 8, 2026, approximately 22:40–22:50 Phoenix time, at Erik's request following
Braydon's pre-tour check. Production source: `75f36e3`; no application code changes or email
sends were made during this audit. One existing monitoring configuration defect was repaired.

## Result

No blocking issue found for **Scottsdale - 85013 Tour**, Friday **October 9 at 9:00 AM**,
`tour-1791219970929-1-ivt0w`. All six properties are saved at version 14:

1. 625 West Ocotillo Road
2. 1415 West Tuckey Lane
3. 8211 North 17th Avenue
4. 325 West Loma Lane
5. 100 West Northern Avenue
6. 5835 North 16th Place

All six have saved listing-agent email addresses and property photos. All 39 private/public
tour IDs and versions match. Tomorrow's public listing details match private data except the
intentional omission of agent email/phone fields. The signed-in app shows those private contacts.

## Live browser checks

- Normal `/app/` URL loaded and showed Synced, the correct date/time, and all six stops.
- Embedded Route view showed all six property markers and a continuous driving route around
  Phoenix, centered near 33.539927, -112.070770. External Google Maps link includes all six stops.
- Saved tour access code was accepted by the live backend, and the first property's evaluation
  form loaded with all ten rating categories, comments and the correct listing-agent recipient.
  Left the form without submitting. Production has no ratings for this upcoming tour.
- Signed-in Manage → Add New Listing returned Google address suggestions; selecting 625 West
  Ocotillo Road resolved Phoenix, AZ 85013 and displayed Address confirmed. Cancelled the form.
  Confirmed afterward that the saved tour is still version 14 with six listings.
- No test listing, evaluation, tour edit or outbound email was created.

## Email and reminders

Resend's `marketreadysystems` workspace showed all **six route emails Delivered**, sent October 8
at 17:30 Phoenix. Opened Lisa Dixon's actual delivered message and verified October 9, 9:00 AM,
all six stops in the saved order, and the Google Maps route URL:
[delivery record](https://resend.com/emails/01a11e11-cb80-7f36-b627-bf4541928fac).
Delivery status confirms acceptance by recipients' mail systems, not inbox placement or opens.

Four eligible 24-hour reminders were sent at 09:04 October 8; all four are Delivered in Resend.
One earlier 48-hour reminder is also Delivered. The two late-added listings have no 24-hour
reminder rows because their addition was after the cutoff; both received the complete route email.
No pending/failed reminders remain. Global reminder inventory: 30 sent, 2 cancelled.
The RTDB reminder scheduler is ENABLED and ran successfully; the three retired Firestore
schedulers remain PAUSED as intended.

The October 8 evaluation-email repair remains deployed (`submitrating-00007-pob`,
`sendadminemail-00008-bos`), and both repaired report actions are present in live `/app/` HTML.
The first-listing persistence fix remains on `savetour-00009-luv`. Previously authorized
corrected evaluation reports were already delivered earlier tonight; no repeat send occurred.

## Production and CI

- All **30 functions ACTIVE**; no function was deployed or removed during this audit.
- Reviewed 1,596 Cloud Run/Functions/Scheduler log entries from October 8 00:00 through 22:39
  Phoenix. No ERROR-or-higher log entries and no HTTP 5xx responses in that window.
- 33 rating submission POSTs returned 200; 11 admin-email POSTs returned 200; 10 tour-save
  POSTs returned 200. Two stale-version saves returned 409, each immediately followed by a
  successful save; two earlier tour-code requests returned 403. These are not server outages.
- 272 successful reminder worker invocations; the one nonempty run sent four reminders with
  zero failed or expired records.
- [Latest full validation](https://github.com/braydondennis-ux/marketreadytours/actions/runs/37877527946)
  and [Pages deployment](https://github.com/braydondennis-ux/marketreadytours/actions/runs/37877527945)
  passed for `75f36e3`, including security-rule and complete emulator workflow coverage.
  Application code is unchanged since that passing run; no redundant test rerun was needed.

## Monitoring defect repaired

Rechecked the September 10 finding: the enabled `MarketReady Tours — site is DOWN` policy
`12095145717698811372` still used `REDUCE_COUNT_FALSE < 1`. This triggered on zero failed
checks rather than failures. Corrected it to **failed-check count > 0 for 300 seconds**.
Updated the policy description to match one or more failing regions. Re-read the saved policy
and verified all other condition fields, notification channels, enabled state, combiner and
incident autoclose settings were preserved. Before the change, all 108 uptime samples from
the previous 30 minutes were passing.

Google documents that `REDUCE_COUNT_FALSE` counts failed boolean samples in the
[alert-policy API reference](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies).
The monitoring check still targets the landing page `/`; this audit separately exercised `/app/`.
No outage was deliberately induced to test notifications.

## Limits

No synthetic production rating or listing was submitted, and no payment was initiated. Mutation
coverage comes from passing emulator workflows and recent real successful production traffic;
this is a point-in-time readiness check, not a guarantee of tomorrow's network or provider uptime.
