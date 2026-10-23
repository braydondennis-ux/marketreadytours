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
- 18 original browser checks pass locally; 21 checks including the install tip regression are rerunning
  across small iPhone/WebKit, large iPhone/WebKit and Chrome.
- iOS simulator build: BUILD SUCCEEDED using Capacitor 8.5.1.
- Final GitHub validation is tracked on the implementation PR.

## Production state and approval boundary

Live already: two new private rule nodes for mrt_email_outbox (with nextAttemptAt index) and
mrt_client_events. The exact current production rules were read/backed up and patched; every
existing rule was preserved. Both new nodes deny direct client reads and writes. No strict
rules-file cutover occurred.

The first named saveTour source/dependency update is ACTIVE and safely returns 401 to an
unauthenticated test request. No test tour/listing was saved during this implementation pass.

Automatic approval review rejected the proposed broad staged rollout. The verified inventory
contains 25 existing functions whose source is in this repository. Its stated concern was the large production rollout,
including new email and scheduler behavior, could disrupt service and needed specific user
approval. That rollout has not run. No workaround or series of deployments was used to bypass it.
The five legacy functions outside this source (sendCampaignEmails, sendEmail, trackEmail,
sendTourReminders and sendOneHourReminder) are preserved; no bare functions deployment is used.

Final review also found that the old transition rules allowed any authenticated account to
read/write reminder jobs. The staged patch makes jobs admin-readable and server-write-only,
matching the active backend's ownership. This existing reminder rule has **not** been changed
live yet; the earlier two-node rules patch preserved it. The rollout approval includes this
narrow hardening, with every other existing rule retained.

Reviewable approval plan: deploy the 25 named existing functions in small verified stages,
checking ACTIVE revision, unchanged identities/secret bindings and safe callable responses after
each. processReminders receives a 540-second timeout for bounded retry work. Publish the matching
client only after its backend contract is live and full GitHub validation is green. Keep inventory
at 30. Stop and inspect any failed stage before moving on.

Seven derived sponsor website corrections across three public tour projections are prepared
from existing private sponsor data; they must be applied conditionally against current versions,
without changing private tour content, listing order or duplicate stops. They are not yet applied.
An Erik-only outbox test can follow approval; no agent receives a test email.

Mailgun forwarding/branded sender still depends on Braydon and remains deferred. Actual checkout,
physical-phone testing, automated backup/restore verification, complete request pagination and
a known cause for the original runtime startup failure remain separate follow-up items.
