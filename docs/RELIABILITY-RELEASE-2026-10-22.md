# Reliability implementation, October 22, 2026

Erik approved the audit repairs and explicitly deferred duplicate prevention until the current
tour is over. Existing duplicate stops and Create Tour's existing guard are untouched. No
normalization or rejection of duplicate addresses was added, and no tour entry was removed.

## Prepared implementation

- Admin inline edits, reorder/remove, contact sync, branding, sponsors and campaign contact/
  template edits acknowledge success only after the server responds. Failed edits retain the
  editor. Reorder copies listing objects rather than mutating the saved tour before acknowledgment.
- Sponsor links accept canonical website and legacy url fields, normalize missing HTTPS and
  reject executable schemes in the UI. Server projections recognize the legacy alias too.
- Organizers load request collections when opening Requests, rather than downloading historical
  inline request photos on every tour view. Explicit contact sync fetches its source on demand.
  Existing requests/photos are retained. Request history still loads when Requests is opened;
  complete metadata pagination is future work.
- Pages calls the full reusable validation workflow and waits for it before building/publishing
  the same commit. Validation includes actual WebKit/iPhone and Chrome workflows, and runs daily
  at 13:00 UTC once merged. Failure traces, screenshots and video are retained for 14 days.
- Twenty-one browser checks cover direct landing navigation, fresh Rate Home labeling, failed inline
  save/retry/persistence, listing draft refresh/cancellation, signup intent/validation, actual
  evaluation persistence and outbox receipt, and attendance signup → organizer listing recovery.
  Every case uses clean local emulators. CDN scripts are replayed from integrity-verified cache;
  production API/email/payment/tracking traffic is blocked. These are simulated phone layouts,
  not physical iPhone camera/cellular or native keyboard testing.
- Browser failure reports contain only an event ID, operation, error code and release. Bounded
  local storage retains them through an outage; a later successful call or reconnect flushes
  them through an authenticated, App Check-protected, rate-limited diagnostic branch of
  submitIntake. Entered text, contact details, credentials, photos and URLs are excluded.
  Server logs use the existing Cloud error alert channel.
- New evaluation notifications use a private durable outbox with frozen message bytes and a
  stable provider idempotency key. Immediate delivery remains the normal path. The existing
  reminder worker retries future failures with bounded backoff, stops after five attempts or
  23 hours, and can reclaim interrupted processing leases. It never replays historical ratings.
  It requires the configured Resend sender for safe retries. Feedback stays saved independently.
- The existing worker also checks public/private tour consistency, rating aggregates and missing/
  overdue reminder jobs, and logs failures to existing alerts. It does not overwrite or remove
  customer records as an automatic repair. A public projection transaction rejects an older
  version overwriting a newer public save. No new function or scheduler is created.
- Compatible dependency updates: firebase-admin 14.5.0; patched transitive backend packages;
  Capacitor core/iOS/CLI 8.5.1; Firebase CLI 15.34.1 and a patched development gRPC override.
  Root production and backend production dependency scans report zero advisories. Nine
  development-only advisories remain (three high, six moderate); no forced major downgrade
  was applied. The native wrapper compiles but has not been distributed to users.

- CI caught the iOS install tip covering form buttons. It is now in normal document flow,
  without a delayed overlay. Requests reserves bottom space for the mobile tab bar.

## Verification so far

- 156 unit/regression tests and 13 static checks pass.
- Seven privacy/rules tests pass, including denying browser reads/writes to outbox/diagnostics.
  A separate test checks the production transition rules (documentation keys stripped) for reminder permissions.
- Full isolated callable workflow suite passes with mocked outbound email.
- 21 browser checks pass locally and in hosted CI across small iPhone/WebKit, large
  iPhone/WebKit and Chrome.
- iOS simulator build: BUILD SUCCEEDED using Capacitor 8.5.1.
- Full hosted validation passed for source d6ca33b: Actions run 39899007006, PR #1.

## Approved production rollout, October 23

Erik explicitly approved the staged rollout and reiterated that test emails go only to
erik@marketreadysystems.ai. All 25 existing repository-owned functions were deployed by name
and verified ACTIVE with new revisions. The full inventory remains 30 ACTIVE functions.
Service accounts, secret bindings, environment variables and ingress settings match the
pre-rollout inventory. processReminders has the approved 540-second timeout. The five legacy
functions (sendCampaignEmails, sendEmail, trackEmail, sendTourReminders and sendOneHourReminder)
retain their original revisions. No endpoint or scheduler was created.

The deployment paused when cloud credentials expired. One Cloud Build remained queued and
expired without replacing its live revision; the named retry succeeded after reauthentication.
This is not evidence of the original listing-save incident's root cause. Final runtime logs
contain zero ERROR entries from the start of this rollout through the backend completion check.

Live rules now deny direct browser reads/writes to the private email outbox and diagnostics.
Reminder jobs are admin-readable and server-write-only. The exact live rules were backed up
and narrowly patched; every other rule and index was preserved and read-back verified.
No strict rules-file cutover occurred.

Seven sponsor website corrections across three public tour projections were conditionally
applied and read-back verified. No private tour content, listing order or duplicate stop was
changed. Ignored backups are under .mrt-backups/2026-10-23-approved-reliability/.

Live consistency audit: 44 private/public tours match, all 95 evaluations match public
aggregates, and no future reminders are missing or overdue. The existing worker's normal
scheduled runs also report 44 checked tours, zero mismatches and zero delivery failures.
The three legacy schedulers remain paused.

Exactly one release test email was queued, addressed only to Erik. The normal scheduled
worker sent it at 06:37 Phoenix with a provider receipt and zero failed attempts. Gmail
computer use confirmed Inbox placement. No test customer tour, listing or evaluation was
created, and no test agent email or financial transaction occurred.

The matching web release ships through PR #1 and the gated Pages workflow: full validation
of the merge commit must pass before publication. Application source d6ca33b passed hosted
CI run 39899007006; the only subsequent pre-merge changes record this rollout in documentation.
The release meta tag identifies the actual deployed commit. Native Capacitor compilation
passed, but no App Store/native distribution was published.

## Deferred work

Duplicate prevention and existing duplicate stops remain explicitly deferred until Erik
reopens that work after the tour. Mailgun forwarding/branded sender depends on Braydon.
Physical-phone camera/cellular testing, actual checkout, automated backup/restore verification,
complete request pagination and a confirmed cause of the original runtime startup failure
remain follow-up items. Do not equate passing checks with a guarantee against every failure.
