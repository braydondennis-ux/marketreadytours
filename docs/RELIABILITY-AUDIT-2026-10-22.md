# MarketReady Tours reliability audit

October 22, 2026 (Phoenix). Erik's priority: reliability first, no growth target yet.
Audit baseline: `5a7d5f5`; production snapshot taken October 22 evening.

The saved data is consistent and the backend has recovered. The highest-value next work is
making every editor truthful about failed saves, preventing duplicate properties/tours, and
requiring real browser workflows to pass before a release. This audit found additional defects;
it does not certify every device, integration or failure condition.

## Recent customer reports reviewed in Gmail

| Date | Report | Evidence and current disposition |
| --- | --- | --- |
| Oct 22 | Lou, **Market Ready tours**: Norterra saves show Failed to fetch; homes do not save | Runtime startup failure confirmed earlier. Original endpoint recovered; an authenticated unchanged save persisted. Lou was asked to retry; no subsequent customer confirmation in the thread at audit time. [Thread](https://mail.google.com/mail/u/0/#all/FMfcgzQhWxbxZRWgmmthnDtHDjpBZHph) |
| Oct 21 | Nicole, **Market ready tour**: agents appear in Attendance; manually adding a listing is blocked | Existing October 21 repair covers typed addresses, listing/attendance intent and awaited Add Listing saves. Her follow-up asked where to find messages. Sonoran Showcase now has six saved stops, versus two during that earlier diagnosis; this shows new saves occurred, not that every reported action was verified by Nicole. [Thread](https://mail.google.com/mail/u/0/#all/FMfcgzQhWxZpWjGRcFLMZTbWjmxqZjWN) |
| Oct 8–9 | Lou, **Marketready tour**: emails arrive without evaluations; house 4, 2329 West Barwick Drive | Existing renderer repair/resend is documented. Today's isolated tests rendered saved evaluations in both report types for every stop. This does not establish current inbox placement. [Thread](https://mail.google.com/mail/u/0/#all/FMfcgzQhWnvRZVPfHDmRQkCSLXkXpQCM) |
| Oct 6–7 | Lou, **Payment Link**: two 85085 sponsors do not receive the link; asks email or phone | Reply says email and asks sponsors to check spam. Current receipt was not independently reverified. [Thread](https://mail.google.com/mail/u/0/#all/FMfcgzQhWnrzMBPpQgMQdscqSkbNcDnC) |

The inbox also contains Google Cloud backend-error alerts from October 22, including the
original central saveTour failure and the unsuccessful west-region recovery. Existing alert
mail did arrive. The new direct backend probes improve coverage, while attention/escalation
still needs an agreed owner and response path. No customer email was sent during this audit.

## Verified production and isolated results

| Area | Result | Limit |
| --- | --- | --- |
| Tours | 44 private and 44 public; all IDs, versions and full server projections match | Point-in-time comparison |
| Evaluations | 95 submissions across 34 listing buckets in seven tours; all public counts/category averages match; no orphan rating tours | Does not prove email receipt |
| Reminders | 48 records: 30 sent, 16 pending, two cancelled; no overdue sendable work, missing future jobs or terminal rows blocking the queue | Duplicate property below legitimately owns separate jobs under current rules |
| Infrastructure | 30 functions ACTIVE; RTDB reminder scheduler enabled with a successful recent run; three retired Firestore schedulers remain paused | ACTIVE alone does not prove request health |
| Logs since Oct 16 UTC | 33 Cloud Run error entries and two legacy-function error entries, including diagnosis/recovery attempts; latest matching entry Oct 22 22:00 UTC | These are not 35 distinct customer failures; queried resource types/severity only |
| Live access | Unauthenticated private tours, ratings, listing requests and contact requests return 401; legacy mrt_tours returns null | Not a penetration test |
| Hosted assets | Root, /app/, manifests, service worker and both privacy paths return 200 | Content/behavior also needs browser testing |
| Public browser | Landing has prominent app links; Next tour targets Sonoran Showcase directly; fresh incognito eventually loaded six stops and the embedded Cave Creek route | Initial navigation was blank until reload; cause/timing not established. Desktop Chrome, not physical iPhone |
| Isolated tour preflight | All 14 scenarios pass using current six-stop Sonoran fixture, fake identities and mocked outbound mail | No production submissions, payments or sends |
| Release CI | Baseline `5a7d5f5` validation run 39887001339 passed, including rules and full callable workflows | Browser tests are missing, see R4 |

The 14 preflight scenarios cover public/private access, correct/incorrect/expired codes,
grant ownership, favorites, evaluations and retries, private photos, rerating, six concurrent
attendees, admin report permissions/content, version conflicts, add/remove, rescheduling,
and cancellation/cleanup. Firebase CLI reported expired credentials during metadata discovery,
but the local suite completed successfully with real assertions against the isolated emulators.

## Findings in priority order

### R1. P1: inline edit announces success before persistence

Confirmed by executing the current inline-edit handler with a delayed, rejected save promise.
It changes local listings, closes the editor and says “Listing updated and saved” before the
server replies. Reorder/remove, contact sync, sponsor and campaign handlers also contain
unawaited save calls and need an active-path review. Add Listing's awaited flow is already fixed.

Repair: one shared mutation pattern that awaits acknowledgment, keeps editable values on
failure, prevents conflicting clicks, and shows an actionable error. Test rejected saves,
20-second delays, timeouts after server commit, and concurrent organizer edits for every editor.
Source: index.html inline listing Save Changes, moveStop, deleteStop, syncAgentContacts.

### R2. P1: slow Create Tour permits two different tours

Confirmed locally: the 1,500ms timer releases creatingTourRef while the first request is still
pending. A second click issues another save with a new tour ID. Two distinct IDs were observed
in the isolated reproduction; no production tour was created.

Repair: hold the guard until completion; retain a stable draft tour ID and request identity
through an uncertain failure. A backend timeout after acceptance must not create a second tour
on retry. Test rapid double taps and a second tap after five seconds of delayed networking.
Source: index.html createTour.

### R3. P1: likely duplicate property on the upcoming October 29 tour

Sonoran Showcase version 8 contains **32644 North 40th Place at stops 3 and 6**, with the same
agent email. IDs differ: one manually created listing and one attendance-recovery listing.
The duplicate is visible in the public tour/route. Current ID-only checking cannot detect it.

Organizer review is required before removing either record. Nothing was deleted or merged.
Add normalized-address/city/unit checks across manual entry, attendance recovery and approvals,
with a clear duplicate warning. Preserve unit distinctions and allow an explicit reviewed
exception. Include duplicate stops in the pre-tour report before reminders/evaluations multiply.

### R4. P1: releases can publish before full validation; browser suite is empty

pages.yml runs independently of validate.yml. Its build verifies bundle assets and App Check
wiring, but publishing does not wait for the separate security/emulator validation result.
`npm run test:e2e` invokes Playwright, but `playwright test --list` discovers **zero browser
tests**. Without a dedicated test directory it also imports Node unit-test files during discovery.
There is no scheduled browser rehearsal in the two existing workflow files.

Repair: publish only the exact commit/artifact that passed validation. Add a dedicated browser
suite against isolated emulators with outbound delivery blocked. Cover small iPhone/WebKit,
large iPhone/WebKit and Chrome; preserve screenshots, traces and release IDs on failures.
Required journeys: landing → exact tour, attendee rating → stored result → report contents,
listing signup → approval, attendance recovery, admin edits and sponsor onboarding.

### R5. P1 review: production dependency lockfiles have security advisories

`npm audit --omit=dev` flags 13 backend packages (one critical, three high, nine moderate),
including transitive proxy-addr 2.0.7 and @fastify/busboy 3.2.0. Maintainer advisories describe
[proxy trust/IP spoofing under particular subnet configurations](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
and [multipart parsing denial of service](https://github.com/fastify/busboy/security/advisories/GHSA-xjh9-v7x6-24jw).
Affected lockfiles are confirmed; exploitability in this deployment and exact dependencies of
every older function image have not been established. Do not attribute today's outage to them.

Root production dependencies also flag native @capacitor/ios 8.1.0. The maintainer's
[WebView proxy-path advisory](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv)
requires a patched native build/release; it is distinct from Safari visiting the website.
Prepare controlled compatible upgrades, run full checks, deploy named functions in small
batches and verify live revisions. No dependency or production function was changed by this audit.

### R6. P2: paid sponsor website is broken/omitted through inconsistent fields

Norterra's private sponsor stores url = www.azgat.com. The admin UI renders that raw href as
`/app/www.azgat.com`, which returns 404. The public server projection reads website instead,
so it omits this legacy url altogether. Normalize aliases and require an HTTPS URL at the
boundary; verify both signed-in and public cards before considering this repaired.

### R7. P2: organizers load old request photos with every full request collection

The listing-request snapshot is about 2.2 MB although it holds only two records. Almost all of
that is seven inline photos on a denied request. The secure admin subscribes to the complete
request collection. Public initial tours are much smaller (about 81 KB), but organizer phone
sessions already carry this avoidable historical payload. Paginate/filter request metadata and
load images on demand; migrate legacy inline images only with backups and reviewed retention.

### R8. P2: email failures and split projections need reconciliation

submitRating preserves feedback when an email send fails, logs the failure and returns
notificationStatus. There is no durable retry outbox at that call site. saveTour commits the
private record before writing its public projection. A failed second step can leave drift;
current data has none. Add durable delivery/reconciliation state, idempotent bounded retries
and a read-only consistency alert. Preserve existing reminder deduplication invariants.
Provider acceptance, saved content and inbox placement must remain separate statuses.
Mailgun forwarding/branded sender remains deferred pending Braydon, as already documented.

## Prevention plan

1. **First repair batch:** R1–R3. Complete every save/error path, prevent duplicate tours and
   warn about duplicate properties. Confirm the Sonoran duplicate with its organizer. Add
   negative tests before each repair so the current failures demonstrably become impossible.
2. **Release gate and browser rehearsal:** R4. Every candidate must pass real workflows under
   good, delayed, offline/reconnect, expired-auth and concurrent-edit conditions before publish.
   Make every customer-reported bug a permanent regression scenario.
3. **Run checks between releases:** keep the one-minute production availability probes; add
   scheduled safe browser checks and a daily consistency report using the snapshot checker.
   A future authenticated production canary needs isolated test records and an enforced
   Erik-only mail boundary before it is enabled. No recurring automation was created here.
4. **Observe actual failures:** collect sanitized browser error codes, failed operation names,
   release IDs and support correlation IDs. Exclude form text, tokens, emails, photos and
   full payloads. Agree who acknowledges urgent alerts and how an unacknowledged incident
   escalates beyond an unread inbox. Test recovery notices as well as failure notices.
5. **Close external-service gaps:** patch dependencies in controlled batches; verify real
   sponsor checkout in the proper sandbox, signature/replay behavior, report contents and an
   Erik-only delivered email. Finish Mailgun forwarding, then inspect spam-message headers
   and provider events. Routine resending is not a deliverability strategy.
6. **Pre-tour and device checks:** before each tour, review duplicate addresses, missing agent
   email/price/photo, un-geocodable stops, unpaid sponsors, reminders and report counts. Rehearse
   on a physical iPhone over cellular, including camera/HEIC, background/resume, large text,
   installed Home Screen mode and code entry. These device checks remain incomplete.
7. **Recovery readiness:** verify automated backup configuration and rehearse a restore to an
   isolated environment. Local snapshots exist, but automated backup/restore readiness was
   not established today. Keep the runtime startup incident open until evidence identifies it.

A release is ready when its actual deployed commit passed the workflow/browser checks, the
live read-only probes are healthy, and no unresolved high-impact issue affects the upcoming
tour. A green homepage, ACTIVE function or unit-test count alone cannot establish that.

## Repeatable audit added

`scripts/audit-production-snapshot.cjs` reads an ignored local snapshot and reports projection
and rating drift, missing/late reminders, invalid IDs and possible duplicate upcoming properties.
It rejects incomplete exports and exits 1 for review findings. It never connects to Firebase,
repairs data, deletes records or sends mail. Run:

```
node scripts/audit-production-snapshot.cjs .mrt-backups/2026-10-22-full-audit.json
```

It correctly flagged the Sonoran duplicate. Four regressions cover clean data, duplicate
addresses across distinct IDs, missing reminder plans, stale saves/rating totals, late work
and incomplete exports. All 149 unit/regression tests and 13 static checks pass locally.
Raw snapshots stay ignored; only redacted findings belong in git. Evidence logs/results are
under /tmp/mrt-full-audit-* and /tmp/mrt-audit-* and are temporary. The durable findings and
reproduction conditions are recorded here. Final release CI is recorded in HANDOFF.md.
