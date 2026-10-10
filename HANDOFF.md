# MarketReady Tours — Engineering Handoff

_Updated 2026-10-10. Read this entire file before acting._

**Current state.** The refresh is **LIVE** (cutover 2026-08-10) and edge-cached. Since
2026-10-10 **the landing-page configuration is restored at `/` for mobile and desktop; the app
lives at `/app/`**. See the October 10 release entry below for verification. **30** Cloud Functions. Sponsor payments run on Clover; transactional email runs on
Resend. The September 10 audit recorded 38 tours in each of `mrt_tours_private` and
`mrt_tours_public`, with matching IDs and versions; this was not re-audited September 29. Erik is Owner on
`marketready-tours` and has a standing go-ahead for production work — see `CLAUDE.md`, whose old
"never touch production" rule is retired. Open work is in `docs/TODO.md`.

**Closed since this file last said otherwise:**

- The **legacy `mrt_tours` PII exposure is gone** — the node was deleted 2026-08-13 and returns
  `null`. The permissive read rule stays on purpose; see the rollback runbook below.
- **Tour reminders work.** They were rewritten against RTDB, and as of 2026-08-25 they are
  created from the tour itself rather than only from listing approvals. See "Tour reminders"
  below — that section used to be headed "Known broken".

**The app is genuinely in use.** The 2026-09-02 North Phoenix tour was built in production over
two weeks and reached version 56 across ~55 saves with no lost data, which is the first real
exercise of the optimistic-concurrency work.

## 2026-10-10 — iPhone-first mobile audit

See `docs/MOBILE-AUDIT-2026-10-10.md` for the coverage matrix and limits. Compact iOS Safari
reproduced keyboard-covered Unlock, cramped stars and lost refresh drafts. Client fixes add
visual-viewport dialogs, 16px phone inputs, stacked rating rows, per-tab text drafts, expired
access recovery, retry IDs, pending photo decoding, and truthful offline/saved messaging.
Safari evaluation reached the local DB and organizer summary. Chrome phone upload plus
Offline/reconnect/retry retained all scores, note and private photo. No agent emails or
production test records. 129 tests, 13 static checks and 14 isolated preflight scenarios pass.
Live Safari Next tour opened Sonoran Showcase directly. Physical-device limits remain in the
report. Release `1812ecc` deployed: Pages `38079143171` and full CI `38079143138` green,
including rules and complete emulator workflows. Cloudflare purged; plain `/app/` contained
new draft/retry/offline code. Live Safari showed new Unlock layout, correct Phoenix route,
and working landscape/portrait layout. Follow-up lowers offline notice below dialog headings.
Final follow-up `b8195fe` is live: Pages `38079432905` and validation `38079432846` green.
Cloudflare purge confirmed again; plain app HTML verifies offline notice z-index 1 and draft
recovery. Live Safari calendar date selection also opened the correct Sonoran Showcase tour.
Mailgun remains deferred.

## 2026-10-10 — landing restoration and Mailgun deferral

Erik explicitly requested restoring mobile and desktop marketing with easy app entry and a
Next tour button that opens the actual tour. `MRT_LANDING` is back to `1`; `/app/` is retained.
No scroll snapping or smooth anchor interception. Header/hero Go to app buttons remain visible
on phones. All app links have real hrefs before JavaScript; next-tour empty/error fallback also
opens the app. Four regressions cover correct upcoming-tour selection, failure fallback, app
links/normal scrolling and preservation of query/hash on old emailed links.

Pre-release checks: 123 tests/13 static checks passed, website-mode build passed. Chrome iPhone
16 emulation at 393 x 852 verified the visible header/hero buttons and actual coordinate taps:
Next tour opened live `app/#/tour/tour-1791395647503-1-pnn6e` (Sonoran Showcase, October 29),
and header Go to app opened live `app/#/`. Preview uses public data and production app links;
no production content modified, no messages sent. This is not physical iPhone/Safari validation.
Release `e83443f` is live. Pages run `38075316489` and full validation run `38075316469`
both succeeded, including security rules and emulator workflow tests. Cloudflare Purge Everything
was confirmed in the signed-in dashboard. Plain root and www (iPhone user agent) return the
new landing HTML; `/app/` returns the real app with the production App Check key.
Live Chrome phone emulation verified actual taps on Next tour, hero Go to app, and sticky
header Go to app after normal page scrolling. Desktop screenshot/layout and actual Next tour
click also passed. Both Next tour clicks opened Sonoran Showcase directly. The signed-in test
browser used `?home` to bypass the existing staff auto-redirect; ordinary root/www HTML were
separately verified over HTTP. No physical iPhone was available, so do not claim device testing.

Erik deferred Mailgun work to a future to-do. Incoming root-domain MX remains Mailgun and
Braydon owns that account. He must add and verify exact-recipient forwarding from
`tours@marketreadytours.com` to `marketreadytours@gmail.com` before sender activation.
The prepared change is parked in `docs/patches/branded-email-identity.pending.patch`; active
function source is restored to the currently deployed identity. Patch applicability verified.
When resumed, apply it, rerun checks, deploy affected existing functions by name, preserve
30-function inventory and inspect an Erik-only email. No function or mail configuration deploy
is part of this landing release.

## 2026-10-09 — afternoon email delivery audit

Braydon reported an unidentified agent seeing only one email and expected eight per agent.
Read-only audit verified 43 individual ratings emails plus seven 12:51 follow-up summaries,
**all Delivered in Resend**. Forty current saved evaluations: 5/6/6/6/6/6/5 by stop; updates
account for three extra individual messages. Actual totals including summary: Payne 7, Robles 7,
Burkhart 7, Hubbard 8, Almazan 7, Brown 8, Dixon 6. Opened delivered summaries for Payne/Brown
and verified full evaluation content. Inbox versus spam/conversation grouping is not established.
Erik identified the affected agent as Lisa Payne (`lisapayne@cox.net`). A recipient-filtered
Resend check reconfirmed all six individual messages plus her summary as Delivered. Opened
the latest individual message (09:15) and summary (12:51) delivery events: both recipient-server
responses were `250 ok dirdel`. Her summary contains all five current saved evaluations.
Erik then provided Lisa's 16:20 screenshot confirming she found the missing emails in spam.
Spam placement is now recipient-confirmed for Lisa; the reason for filtering is still unknown.
No resend or production mutation. Deliverability improvements remain separate follow-up work.
Full evidence and limitations: `docs/HEALTH-CHECK-2026-10-09.md`, afternoon section.

## 2026-10-09 — landing return prepared locally (superseded by October 10 release)

Erik plans to restore the landing page October 10, with no scroll snapping and prominent app
access. Local `landing.html` now removes all scroll-snap rules and smooth anchor scrolling;
shows **Go to app** in the sticky header on every screen size and as the main hero button next
to **List your home**; and sends **Next tour** directly to that tour's app route. The temporary
mobile redirect is removed from the draft so it will not hide the repaired page when restored.
Production remains `MRT_LANDING: "0"`; do not restore it early or assume any timer is scheduled.

Local validation: 119 tests/13 checks passed, both landing scripts parse, and website-mode build
passes. Chrome verified desktop Go to app; 393 x 852 iPhone emulation shows both app buttons,
and an actual coordinate tap on Next tour navigated to the correct seven-stop app tour.
This is not physical iPhone/Safari verification. Review that actual-device journey before
restoring the homepage. Draft changes are committed locally, not pushed/deployed today.

The October 9 removal shipped as `27cee07` (CI and Pages green). Manual Cloudflare Purge Everything
completed and ordinary root/www responses were verified to contain the app. Automatic purge
still skips because GitHub Cloudflare secrets are absent; a deploy alone does not refresh the
public cache. Confirm ordinary root URLs after the eventual restore and purge manually if needed.

## 2026-10-09 — marketing homepage disabled for everyone

Erik urgently requested complete landing-page removal before the tour after a phone still
received cached marketing HTML. Production Pages now uses `MRT_LANDING: "0"`: the app is at
both `/` and `/app/`, preserving existing emailed links. This supersedes the mobile-only bypass.
The marketing source remains available for a later deliberate restoration, not the homepage.

## 2026-10-09 — mobile visitors go directly to the app (superseded)

At Erik's request, `landing.html` temporarily redirects phone/tablet visitors to `/app/` before
rendering the marketing page. Detection covers narrow viewports, mobile user agents (including
landscape phones), and iPad's desktop-style user agent. Desktop keeps the landing page. Existing
`#/` app links still take priority and preserve their query/hash; mobile root requests retain
query parameters. `?home` bypasses the desktop staff redirect only, not the mobile bypass.
To restore mobile marketing, remove the clearly marked mobile block in the first head script.

## 2026-10-09 — browser audit after reconnect

Computer use recovered. Live map and share link pass for all seven stops. Local browser tests
found and fixed favorites missing after reload, PDFs omitting collapsed property feedback,
per-keystroke private-note save conflicts, and route organizer copies treating UID as email.
117 unit tests/static checks pass; full details in the October 9 audit. PDF preview has seven
complete pages; both report actions processed seven fixtures; test email verified in Erik's Inbox
with full feedback. No production test ratings or agent notifications. Physical iOS and live
payment/campaign actions were not exercised. Client fixes shipped in `fdb5911`; CI and Pages green.

The share page is now modernized and live on Cloudflare worker `marketreadytourshare`, active
version `3875a9ad` (October 9, ~08:17 Phoenix). Source is `cloudflare/tour-share.mjs`; previous
worker source is retained as `cloudflare/tour-share-v7-backup.mjs`. It reads the current public
tour projection, replacing obsolete `mrt_tour_previews`, and displays the real first property
photo, tour title/date/time/count, and direct `/app/` link. Image proxy and social metadata remain.
Live HTML exactly matches the reviewed renderer; desktop/393px mobile view and CTA passed.
See `cloudflare/README.md` for deployment/rollback. Latest local validation: 119 tests and 13 checks.

## 2026-10-09 — expanded backend preflight; admin summaries repaired

The live October 9 tour is now **version 18/seven stops**, including 7001 North 14th Street.
Erik authorized comprehensive testing with no agent mail or visible test artifacts. Tested a
sanitized local copy against the actual deployed rules: all 14 targeted backend scenarios,
the full existing workflow, six rules tests, and 114 unit tests/13 checks passed.

**New production repair:** `mrt_ratings_private` lacked the admin collection-read permission
required by the app's summary subscription. A regression failed before and passed after adding
`.read` for existing admin/super roles. Published only that delta in the exact live rules and
verified read-back; no writes or attendee access expanded, no other rules changed. Both repo
rule files contain the repair. Never deploy the stricter file wholesale to production.

The local preflight now explicitly loads rules into `mrt-local-audit`; the CLI default namespace
is different and otherwise leaves the tested namespace permissive. Existing rules-suite setup
already loads its rules correctly. Real-tour preflight runner: `scripts/tour-preflight.mjs`.

Sent one TEST ONLY evaluation email to Erik. Later browser phase verified full content in Inbox.
All production tour/rating/reminder collections matched before/after snapshots. Browser testing
was completed after reconnection; see the browser phase above.
Full results and remaining browser checks: [expanded preflight](docs/HEALTH-CHECK-2026-10-09.md).

## 2026-10-08 late evening — October 9 tour readiness

Audited Braydon's **Scottsdale - 85013 Tour**, October 9 at 9 AM: six saved properties,
version 14. Live Chrome verified six map markers and driving route, tour-code unlock and the
10-category evaluation form, and Google address suggestions/selection (cancelled before save).
Resend confirmed all six 17:30 route emails Delivered, plus four 24-hour and one 48-hour reminders.
All 30 functions are ACTIVE; today's inspected logs have no server errors or 5xx responses.
Full validation and Pages are green for `75f36e3`. No test data or outbound emails were created.

**Monitoring repair:** the September 10 inverted uptime alert was still present. Changed the
existing failed-check count condition from `< 1` to `> 0`, preserving its five-minute duration
and notification channels. Read-back verified the change; all 108 preceding 30-minute uptime
samples passed. No application deployment was needed. Full evidence and limits:
[October 9 readiness audit](docs/HEALTH-CHECK-2026-10-08.md).

## 2026-10-08 — saved evaluations missing from delivered emails

**Confirmed cause:** the live `submitRating` sender emailed only “A new rating was submitted”
and told the agent to open the private feedback in the app. It did not include scores or
comments. Safari/Resend inspection of an actual delivered October 8 message for 27418 North
22nd Lane confirmed this exact body; delivery alone did not establish useful content.

**The data is intact.** Read-only checks of Lou's 85085 tour (`tour-1789066199267-1-4ilyi`,
October 8, version 26) found **32 saved evaluations across five listings**, including 14 with
comments and no uploaded photos: 26904 North 24th Lane (8), 27418 North 22nd Lane (7),
1948 West Black Hill Road (5), 2329 West Barwick Drive (6), 31918 North 20th Lane (6).
Logs showed 33 successful rating submissions (one updated an existing evaluation), no
error-level entries in the inspected logs, and no `sendAdminEmail` POSTs that day at audit time.

**Repair `8979b99`:** new submissions email all ten scores, pricing feedback and comments.
Post-Tour Follow-Up and Seller Report now ask the server to render the saved evaluations for
each listing. The server reads the private tour, saved agent recipient and ratings; arbitrary
client HTML, recipients and ratings remain untrusted. This also repairs the previous placeholder
text/escaped HTML report bodies and an undefined `listingBlock` reference. Agents with multiple
properties receive one report per property. Empty reports are skipped and failures are counted.
Rater identities and private photo paths are omitted; photo counts direct agents to the organizer.

**Verification:** `npm run check` passed **114 tests and 13 checks** (two existing heuristic
warnings); full local emulator workflow passed, covering admin authorization, trusted saved
recipients/data, idempotency, empty reports, bad IDs/types and both report buttons. Generated
all five reports locally from the 32 real saved records, checked every comment was present,
and visually inspected the rendered HTML in Safari. No live report was sent during testing.

**Backend deployed:** only `submitRating` and `sendAdminEmail`, both ACTIVE at
2026-10-08T21:07:53Z, revisions `submitrating-00007-pob` and `sendadminemail-00008-bos`.
The before/after inventory has the same 30 function names. Client release `391383d` passed
[Pages deployment](https://github.com/braydondennis-ux/marketreadytours/actions/runs/37844866856)
and [full validation CI](https://github.com/braydondennis-ux/marketreadytours/actions/runs/37844866699),
including security rules and emulator workflows. The normal live `/app/` response was checked
and contains `sendSavedEvaluationReports` and both report-button calls.

**Corrected reports sent with Erik's explicit approval:** October 8 at 20:02 Phoenix time,
used the live Chrome app's Manage → Post-Tour Follow-Up once for the five saved listing agents.
Resend showed all five `Listing Summary & Ratings` messages **Delivered**: Cesar Maldonado,
Gregory Janis, Tony Tramontozzi, Frank Trifeletti and Douglas Eggleston. Opened Greg's delivered
[report](https://resend.com/emails/01a11e9c-b0f4-7793-af59-9fe2b43e4326) and verified all seven
evaluations, scores, averages and comments are present. Delivery is provider-confirmed, not
proof of inbox placement or that recipients opened the reports. No further resend is pending;
do not repeat this batch without a new request.

## 2026-10-01 — embedded tour map centered in the ocean

**Reproduced in Chrome:** the 85085 tour (`tour-1789066199267-1-4ilyi`) had four saved
properties, but its embedded map was at latitude 0, longitude 180. All four geocoder calls
returned “This API is not activated on your API project.” The September 29 key switch missed
Geocoding: Maps JavaScript, Places and Directions were allowed, but Geocoding was neither
enabled nor allowed. The external Google Maps route uses addresses directly and still worked.

**Production configuration repaired:** enabled `geocoding-backend.googleapis.com` in
`marketready-tours` and appended that one service to browser key
`ec2d5b49-d3e8-4b8c-8d20-061084166aa0` (ending `C491V8`). Compared before/after metadata:
all 28 prior API targets and all six allowed referrers were preserved; Geocoding is target 29.
No billing settings or backend functions changed.

**Client patch `a8f2198`:** never fit empty bounds; hide the map until a property is located;
center single properties at street zoom; show the existing fallback on failed/stalled lookups.
Partial lookups retain numbered pins with a warning and do not silently route past missing
stops. Directions failure has a warning; leaving the view cancels pending UI updates.
Seven regression tests cover these cases. `npm run check`: **105 tests and 13 checks passed**,
with the two existing heuristic warnings.

**Live computer-use verification after the Google configuration repair:** the normal `/app/`
URL → 85085 → Route displayed all four numbered pins and the blue driving line in North
Phoenix (map center approximately 33.75471, -112.11554). Stops: 26904 North 24th Lane,
27418 North 22nd Lane, 2425 West Bronco Butte Trail, 1948 West Black Hill Road. The full
Google Maps route button retained all four addresses. This was a read-only check; no property
was created or changed. Repeated this check after deploying the client: loading state resolved
to the same four pins and route. The normal `/app/` artifact contains the empty-bounds guard.
[Pages](https://github.com/braydondennis-ux/marketreadytours/actions/runs/36952337108) and
[validation CI](https://github.com/braydondennis-ux/marketreadytours/actions/runs/36952337023)
both passed for `a8f2198`.

## 2026-09-29 — first-listing save failure found after the lookup repair

**The Maps repair alone did not resolve the reported inability to add a property.** On the
subsequent log review, `saveTour` returned HTTP 500 for tour `tour-1789066199267-1-4ilyi`
(`85085`) at **18:06:26, 18:28:58, 18:39:01 and 18:48:38 Phoenix time** September 29,
after the Maps deployment at 16:05. Auth and App Check passed. Each failed with:
`Data returned contains undefined in property 'mrt_tours_private.<tourId>.sponsors'`.
The same error also occurred before the Maps repair. Logs show a Windows Edge client, but
do not identify the person; do not claim that Lou personally made these attempts.

A read-only check found both private and public records still at **version 1, zero listings**,
last updated September 10. Failed request bodies are not available in these logs, so the
intended property address cannot be recovered from them.

**Cause and patch (`d43c919`):** RTDB removes empty arrays. After an empty tour is reloaded,
`sponsors` is absent; `sanitizeSponsorPayments` returned `undefined`, and the normalizer
explicitly wrote it into the transaction. Missing/null sponsors now normalize to `[]`.
Existing server-controlled sponsor payment fields retain their previous behavior.

Validation: the new unit regression failed before the patch and passed afterward; all
**98 unit tests and 13 validation checks** passed. The full local emulator workflow also
passed, including a regular admin creating an empty tour, reloading the actual RTDB record
(asserting `sponsors` is absent), adding its first listing and verifying version 2 plus the
persisted address in both private and public records. No production test listing was created.
**Deployed:** only `saveTour`, revision **`savetour-00009-luv`**, verified ACTIVE at
`2026-09-30T02:10:06Z` (September 29, 19:10 Phoenix). The before/after function inventory is
identical at 30 functions. [Validation CI](https://github.com/braydondennis-ux/marketreadytours/actions/runs/36658395310)
and [Pages](https://github.com/braydondennis-ux/marketreadytours/actions/runs/36658395277)
also passed for `d43c919`. The first post-deployment log query returned no save attempts or
errors yet. **October 1 follow-up:** a fresh live browser load shows four saved properties
on this same tour, confirming it is no longer empty after the save repair. This does not
identify which person entered them or establish a per-request success timeline.

## 2026-09-29 — address lookup repair

The old production Maps key (ending `Pizo_E`) returned `RefererNotAllowedMapError` for
`https://marketreadytours.com/app/`, reproduced in Chrome after the landing-page move.
That key belongs to a separate Google project (`211594997574`) that Erik cannot manage.
The lazy Maps loader now uses the existing browser key in **marketready-tours** (ending
`C491V8`, the same public key already used for production Firebase). Its existing website
restrictions include `marketreadytours.com/*`, and its API restrictions already include
Maps JavaScript, Places and Directions. No key restrictions, enabled services or billing
settings were changed. Vercel still uses the separate demo Maps key.

**Deployed to production:** commit `8047d3f60dd1dc5c3fc5626dd4565fb4b4c45023` on `origin/main`.
Both [Pages deployment](https://github.com/braydondennis-ux/marketreadytours/actions/runs/36643212575)
and [validation CI](https://github.com/braydondennis-ux/marketreadytours/actions/runs/36643212389)
passed. Local `npm run check` passed all 97 tests and 13 validation checks, with the two
existing heuristic warnings. The regular `/app/` URL was fetched and verified to serve the
new key. No backend deployment was needed.

**Browser verification after deployment (Chrome, computer use):**

- A fresh public List Home page returned suggestions for `3101 N Central Avenue Phoenix`;
  selection confirmed `3101 North Central Avenue` and populated `Phoenix, AZ 85012`.
- After Erik signed in, the actual admin flow was exercised from the normal `/app/` URL:
  **85085 → Manage → Add New Listing**. Suggestions, address confirmation, city/state/ZIP
  autofill and entry of beds, baths, square footage and price all worked. **Add Listing**
  became enabled. This used the deployed loader, with no temporary key override.
- The test entry was canceled. The editor still showed **0/8 listings** afterward.
  **Final saving, photo upload and Lou's own account were not tested.** No test property was
  saved and no messages were sent. A reply email was drafted for Erik, not sent.

**Testing trap:** `addListing` calls `onUpdateTour` immediately. Clicking **Add Listing**
persists the property; the separate **Save Changes** button is not a staging boundary.
Canceling the entry form before adding leaves the live tour unchanged.

Manual address entry remains available. For future site-path changes, test both Google
predictions and selection/details in a fresh browser tab; CI cannot validate live Maps
restrictions. If the report recurs, obtain the exact property address and distinguish lookup
failure from a final-save failure.

## September 2 reminders — verified September 10

The saved [September 10 health check](docs/HEALTH-CHECK-2026-09-10.md) supersedes the old
"First thing to check" warning: all **16 reminders across 8 listings** were `sent`, with
`sentAt` and zero failed attempts. Logs recorded eight 48-hour sends on August 31 and eight
24-hour sends on September 1, around 08:33 Phoenix, with exactly one successful-send event
per row and no failures. No overdue, failed, dead or processing rows remained at that audit.

This verifies the send path, **not recipient inbox delivery or opens**. It is a dated audit,
not a fresh September 29 check. The same report records a reversed uptime-alert condition
and a duplicate-tour submission race; their resolution is not recorded here. See `docs/TODO.md`.

## ROLLBACK RUNBOOK — read this before rolling back

**Rolling back is TWO steps, not one. Pushing `cd6f980` alone will serve a site with ZERO
tours.** The legacy build reads `mrt_tours`. **That node was DELETED on 2026-08-13** to close
audit M5 — it was world-readable and held 38 unpaid sponsors' contact details, 33 tour access
codes and 84 agent emails. Step 1 below rebuilds it from `mrt_tours_private`; it is mandatory,
not optional.

The read rule on `mrt_tours` was deliberately LEFT PERMISSIVE (`.read: true`). Do not tighten
it: the rollback build performs no authentication at all, so a rebuilt node must stay readable
for it to work. The node being absent is what closes the exposure; the rule is what keeps
rollback possible.

Rehearsed 2026-08-13 immediately after the delete — the script reports `mrt_tours` absent and
reconstructs all 36 tours in the original array order. Three recovery paths exist: this script
(current data), `.mrt-backups/mrt_tours-2026-08-13/` (the node exactly as deleted), and the
2026-08-10 cutover snapshots.

```bash
cd "/Users/erikyoungberg-aspelin/Desktop/Market Ready/Market Ready Tours/mrt/marketreadytours"

# 1. Rebuild the legacy node from live data (safe to run anytime; dry-runs by default)
node scripts/rebuild-legacy-mrt-tours.mjs            # inspect the counts
node scripts/rebuild-legacy-mrt-tours.mjs --apply    # write it

# 2. Confirm it landed — must print every tour, NOT null (36 as of 2026-08-13)
npx firebase-tools database:get /mrt_tours --shallow --project marketready-tours | head -5

# 3. Only then, revert the site
git push --force origin cd6f980:main
```

**Requirements.** Step 1 needs application-default credentials
(`gcloud auth application-default login`) and reads `mrt_tours_private`, which is never
deleted. If the script cannot run, both on-disk backups contain a complete `mrt_tours` array
that can be restored directly:
`.mrt-backups/production-2026-08-10/` and `…-2026-08-10-post-cutover/` (9.1 MB each, plus auth
exports). Restoring from backup loses any edits made after that snapshot; rebuilding from
`mrt_tours_private` does not.

**What rollback does and does not touch.** It reverts only the frontend. No data restore is
otherwise required: the migration was additive, and `mrt_tours_private` / `mrt_tours_public` /
`mrt_ratings_*` are simply ignored by the legacy build. The 19 callables can stay deployed —
the legacy build never calls them, so they are inert.

**Do not** roll back to fix a callable, App Check, or IAM problem. Those live in the Firebase
project and are unaffected by which frontend is served; reverting the site will not change them
and costs you the refresh.

**Rollback target:** `cd6f9808fc8a90237012834fcba9587b4e512c47`. Our work remains on
`erik/agent/mrt-refresh-release-2026-08-06`.

**Links under `/app/` do not survive this rollback.** Since 2026-09-26 the app emails tour-invite
and opt-out links as `marketreadytours.com/app/#/…`. The legacy tree has no `/app/`, so those links
404 after a full rollback. To undo only the landing page, use the landing-page rollback in the
2026-09-26 section instead — it keeps `/app/` serving.

## 2026-09-26 — landing page at `/`, app at `/app/`

**marketreadytours.com is now a sales landing page; the app lives at `marketreadytours.com/app/`.**
Commits `2faf924` → `de97818` on `main`. Everything below was verified on the live site in a real
browser, not just built.

**Files.** `landing.html` (standalone page: inline CSS/JS, DM Sans, brand tokens) and
`assets/landing/` (24 hero photos + 3 leaderboard photos, resized WebP copies of listing photos
from past tours — ~600 KB total). `scripts/build.mjs` writes both into `www/`.

**Build modes** (`scripts/build.mjs`, switched by env vars that only `pages.yml` sets):

| Env | `/` serves | `/app/` serves | Used by |
|---|---|---|---|
| none | app | — | local, Vercel preview, **Capacitor/iOS** (`webDir: "www"`) |
| `MRT_LANDING=1` | landing page | app | the website (`pages.yml`) |
| `MRT_PUBLISH_APP_SUBPATH=1` only | app | app | website with the landing page switched off |
| `MRT_MAINTENANCE=1` | maintenance page | app | wins over the others |

Never set `MRT_LANDING` for a Capacitor build — the iPhone app would open on the landing page.

**Why no old link broke.** Every link the app issues is a `#/` route: tour invites
(`#/request/<id>`), opt-outs (`?token=…#/not-interested`), sponsor payment (`?spt=…#/sponsor-pay`),
`#/payment-success`, and the PWA `start_url` (`./#/`). The landing page's first `<head>` script
forwards any `#/` address to `app/` with the query string intact (also on `hashchange`). Links the
app builds *now* use `location.pathname`, so new emails carry `/app/…` directly.

**Behaviour to know about:**

- **Signed-in staff skip the landing page.** The app's auth handler sets
  `localStorage.mrt_signed_in` on admin sign-in and clears it on sign-out/anonymous; the landing
  page sends flagged devices straight to `/app/`. `?home` shows the landing page anyway.
- **`#/login` opens the sign-in modal** (it had no route before). The landing footer's "Admin
  sign-in" and the `createAdmin` invite email (revision `createadmin-00011`, deployed by name
  2026-09-26, count still 30) both link to `https://marketreadytours.com/#/login`, which works
  whichever build mode is live.
- **Only admins have accounts.** Touring/listing agents never sign in, so nothing on the landing
  page may say "Agent login" — the nav button is "Open the app" (public tour dashboard).
- **Live data, no backend.** The page reads `mrt_tours_public` (tour/home counts, next tour and
  open spots, upcoming list — the whole screen and its nav link disappear when there are no
  upcoming tours) and `mrt_ratings_public` (top 3 from the newest *fully rated* tour; a baked
  snapshot of the 2026-09-02 North Phoenix tour shows until a newer one qualifies).
- **Service worker.** The app registers `sw.js` relatively, so at `/app/` its scope is `/app/`
  (verified). Returning visitors still hold the old root-scope worker; it is network-first for
  navigations, so it serves the landing page correctly and is otherwise inert.
- **Cloudflare.** `pages.yml`'s purge list now includes `/landing.html` and the `/app/` paths —
  still dormant until Braydon adds the two repository secrets.

**Design rules the page follows** (Erik's explicit preferences — keep them):

- Full-screen sections with mandatory scroll snap, each fitting one screen under the 68px nav.
  Phones split tall sections into `.part` snap screens; phones in landscape scroll normally.
- **No container may change size when its text changes** (live notes, loaded data, accordions).
  Fixed heights, loading rows the same size as loaded ones, FAQ sized for its longest answer.
- Client-facing copy only — no notes that explain how the page was built.
- Every clickable element has a hover state (mouse-only, via `(hover:hover)`).

**Trap: never put `overflow:hidden` on a section.** It makes the section a scroll container,
which captures the phone-sized snap points inside it; the page then jumped past the hero on load.
The hero uses `contain:paint` to clip its photo wall instead.

**Rollback (landing page only):** set `MRT_LANDING: "0"` in `.github/workflows/pages.yml` and
push. The app returns to `/`, and `/app/` keeps serving because `MRT_PUBLISH_APP_SUBPATH` stays
`"1"`. The landing page remains reachable at `/landing.html`.

**Open:** no real reviews/testimonials yet (the competitor's strongest element); Braydon has not
yet approved reusing listing photos on the page. See `docs/TODO.md`.

## 2026-08-10 — production cutover, resolved blockers

Braydon granted Erik (`erik@marketreadysystems.ai`) **Owner** on `marketready-tours`, clearing the
IAM gate the 2026-08-08 attempt stopped at. What follows are the traps found while executing the
cutover. Each one would have broken production; none is obvious from reading the code.

**Never run a bare `firebase deploy --only functions` on this project.** Our `functions/` source and
Braydon's deployed set only partially overlap. A blind deploy DELETES `sendEmail` and `trackEmail` —
which the currently-live legacy site calls — and CREATES `instantlyWebhook`, `processReminders`,
`processRemindersNow`, and `createSponsorInvoice`, all fenced off below. Always deploy by name.
The 19 callables were deployed this way on 2026-08-10; the 6 legacy services were left untouched.

**Cloud Run invoker bindings are not reapplied on update.** All 19 callables returned a raw HTML
`403 Forbidden` from the Cloud Run edge — the request never reached Firebase code. Their IAM policy
was completely empty (`etag: ACAB`). `invoker: "public"` in `callableOptions` is only applied by
firebase-tools when a function is CREATED, not updated, so redeploying does not fix it. Repaired by
granting `allUsers` → `roles/run.invoker` on the 19 services (Braydon's 6 legacy services already
carried the identical binding). Correct post-fix behaviour is a JSON `UNAUTHENTICATED` envelope, not
an HTML error page — App Check and `assertAuthenticated`/`assertAdmin` remain the security boundary.

**GitHub Pages now deploys via GitHub Actions, not from the branch.** Braydon switched Pages Source
to "GitHub Actions" on 2026-08-10 (`build_type: workflow`). This was necessary: Pages served the
repository ROOT, where `index.html` still carries the `__MRT_APP_CHECK_SITE_KEY__` placeholder.
`index.html:380` THROWS on an unsubstituted placeholder, and that throw is swallowed by the outer
`catch` before `_fb`/`_fbAuth`/`_fbStorage` are assigned — so the site would have silently degraded
to a dead, localStorage-only page with no visible error. `scripts/build.mjs` substitutes only into
`www/`, which the branch-mode Pages did not serve. `.github/workflows/pages.yml` now builds and
publishes `www/`, and fails loudly if the placeholders survive. Two bonuses: internal files
(`HANDOFF.md`, `SECURITY_NOTES.md`, `functions/`, `scripts/`) are no longer published, and a failed
build cannot take production down — Pages keeps serving the previous deployment.

**Production App Check values** (the site key is a public client value, not a secret):
`MRT_APP_CHECK_SITE_KEY=6LeP0XUtAAAAAJ8WdZG1lhaoJUXgGINFH1SUlEKT`, and the provider is
**`enterprise`**, NOT the default `v3` — `index.html:384` branches on it and an Enterprise key
activated through the v3 path fails. The dev/preview project uses a different key
(`6LcwV3gt…`), which is why the placeholder mechanism exists; do not hardcode either into source.

**`/_vercel/image` does not exist on GitHub Pages.** `mrtThumbUrl` listed `marketreadytours.com` as
a Vercel host, so every dashboard thumbnail would have 404'd in production while working perfectly
on the preview. Fixed to check `*.vercel.app` only; prod now serves original Firebase Storage URLs
(correct but unoptimised). This is the strongest argument for moving hosting to Vercel later.

**The push to Braydon's `main` is not a fast-forward** — 102 ahead / 22 behind, and the two builds
are not textually mergeable. Use `git merge -s ours origin/main`, which preserves his 22 commits as
ancestors while keeping our tree. Verified safe: his behavioural fixes are already present in our
build — `cd6f980`'s sync fix in a stronger form (content-comparison `fbSynced` rather than a one-shot
flag), multi-rater ratings, and the agent contact fields. The one item absent (`pac-container` CSS)
is unnecessary here: we use `AutocompleteService` with our own React dropdown, not Google's widget,
so no `.pac-container` element is ever created.

**Rollback is `git push --force origin cd6f980:main`.** This RESTORES Braydon's exact tree; only our
merge commit is removed, and our work stays on `erik/agent/mrt-refresh-release-2026-08-06`. **No data
restore is needed** — the migration is additive, `mrt_tours` was never modified, and the legacy build
reads it unchanged. The 19 callables can stay deployed; the old build never calls them.

**Known gaps, deliberately not blocking launch:** GitHub Pages serves no security headers, so the CSP
in `vercel.json` applies only on Vercel previews — this is NOT a regression (prod never had them, and
the refresh needs no `unsafe-eval` unlike the Babel-in-browser legacy build); close it with a
Cloudflare Transform Rule. `createCheckoutSession` is called by the live legacy site but is deployed
nowhere and exists in no source — it 404s in production today, a pre-existing bug. `www/` is
gitignored here but tracked on Braydon's `main`; the `-s ours` merge drops it, which is correct.

_Superseded sections below are kept for history._

## 2026-08-08 continuation status — production cutover

This section is the current assignment and supersedes the older branding-only assignment and
deployment guardrails below. The branding history is intentionally preserved for context.

### User authority and safety boundary

- Erik reports that Braydon explicitly approved the refreshed site for production.
- Production means both the existing Firebase project `marketready-tours` and the live
  `marketreadytours.com` site.
- The latest cutover attempt stopped at the read-only IAM gate. **No production data, Functions,
  GitHub branch, DNS, Vercel alias, or live website was changed during that attempt.**
- Do not publish only the static frontend while the new callable services return Cloud Run 403s.
  The refresh defaults to `MRT_SECURE_BACKEND=true`; publishing it with private callables would
  break tour-code verification, ratings, intake, admin saves, sponsorship administration, and
  other core workflows.
- Do not use `MRT_FORCE_LEGACY` as a launch workaround. It deliberately bypasses the secured
  public/private projection and trusted callable architecture.

### Release source and preview

- Working branch: `agent/mrt-refresh-release-2026-08-06`
- Current release commit: `82472cb` (`fix preview workflows and Safari states`)
- `HANDOFF.md` is intentionally the only uncommitted workspace change after this continuation
  update; preserve it when resuming.
- Erik fork: `https://github.com/abqerik/marketreadytours.git`
- Existing draft PR: `https://github.com/abqerik/marketreadytours/pull/1`
- Preview aliases:
  - `https://mrt-refresh.vercel.app/`
  - `https://marketready-refresh.vercel.app/`
- Current aliased preview deployment:
  `https://marketreadytours-fm4cnw2pd-abqeriks-projects.vercel.app`
- The branch was pushed only to Erik's fork. The worktree was clean immediately afterward.
- `npm run check` passed at `82472cb`: 32/32 tests and all 13 validation gates. The validator
  reports two known heuristic warnings, but the authoritative JavaScript parse passes.

The final workflow/design audit fixes included preview App Check, the rating-code flow, stalled
admin login/profile reads, Safari rankings visibility, Upcoming/Past selected state, accurate
manual-sponsorship result copy, icon/accessibility cleanup, and guarded preview configuration.
Earlier commits on the same release branch include the live-card cleanup, brighter route map,
thumbnail optimization, and sponsor-plan selected-outline fix.

### Actual production hosting topology

- `marketreadytours.com` currently returns the old site through **Cloudflare → GitHub Pages**.
- GitHub Pages source is `braydondennis-ux/marketreadytours`, branch `main`, path `/`.
- Erik's GitHub account `abqerik` has `push: true` on Braydon's repository.
- Local remote `origin` fetches Braydon's repository but has push deliberately disabled. Remote
  `erik` fetches/pushes Erik's fork. Do not re-enable or use Braydon push until every backend and
  data gate below passes.
- A Vercel production deployment exists as a rollback/candidate record, but `vercel --prod` does
  **not** publish `marketreadytours.com` in the current topology.
- Latest observed Braydon `main`: `cd6f980` (`fix(sync): stop tours/listings being silently
  destroyed on save`). Integrate this production hotfix into the release candidate before the
  GitHub Pages switch; do not overwrite it.

### Firebase authentication and the unresolved IAM state

- Use the repository-local CLI: `npx firebase-tools ...`; no global `firebase` binary is installed.
- Firebase CLI was successfully reauthenticated as `erik@marketreadysystems.ai` on 2026-08-07/08.
  `firebase projects:list` can see `marketready-tours`, `marketready-tours-dev`, and
  `marketreadynetwork`. Braydon's Google login or credentials are neither needed nor acceptable.
- `erik@mcguire-creative.com` is only an email alias. OAuth resolves to
  `erik@marketreadysystems.ai`; IAM must be granted to the latter principal.
- Before the most recent suspected IAM change, a live policy read showed Erik had `roles/editor`,
  Braydon (`braydondennis@gmail.com`) was the only project-level Owner, and Erik lacked only
  `run.services.setIamPolicy`.
- After Erik said Braydon may have changed access, repeated read-only project and service-level
  checks returned **no** Cloud Functions/Cloud Run deployment permissions. A policy read returned
  403. The active CLI identity was still correct and Firebase project listing still worked. This
  suggests the old Editor grant was removed/replaced, the new grant targeted the wrong principal,
  or the intended grant did not land; do not guess which.
- The last verified permission results were all `NO` for:
  `cloudfunctions.functions.{get,create,update,delete}`,
  `run.services.{get,update,getIamPolicy,setIamPolicy}`, `iam.serviceAccounts.actAs`, and
  `serviceusage.services.use`.

Braydon should use **Grant access** (not replace the existing grant) for
`erik@marketreadysystems.ai` and ensure both **Editor** (`roles/editor`) and **Cloud Run Admin**
(`roles/run.admin`) are present. The known working Editor grant supplied the deploy/update,
service-account, and service-usage permissions; Cloud Run Admin supplies the missing
`run.services.setIamPolicy` permission. Re-test effective permissions before any write.

### Safe continuation sequence

1. Confirm the active Firebase CLI identity is `erik@marketreadysystems.ai`.
2. Use `projects/marketready-tours:testIamPermissions` and require `YES` for Functions
   create/update, Cloud Run get/update/getIamPolicy/setIamPolicy, service-account act-as, and
   service usage. Stop if any required permission is absent.
3. Capture a **fresh read-only** production Database/Auth/Storage backup and compare it with the
   2026-08-05 cutover snapshot. Scott may have added tours since that snapshot. Reconcile counts,
   sampled records, and the legacy tour hash before applying any delta.
4. Preserve all existing additive production roots, transitional Rules, App Check configuration,
   admin claims, Storage assets, and rollback files. Do not repeat migrations blindly.
5. Deploy the approved `functions/` code explicitly to `--project marketready-tours`. Repair and
   verify public invoker bindings for the **19 new callable services only**; Firebase Auth, App
   Check, claims, validation, and rate limits remain the application security boundary.
6. Confirm the 19 callable endpoints reach Firebase code rather than failing at the outer Cloud
   Run layer. Run authenticated/App-Check production smoke tests without triggering real outbound
   campaigns or payment artifacts.
7. Integrate Braydon `main`/`cd6f980` into the release branch, resolve carefully, then run the full
   `npm run check` suite and inspect the exact production diff.
8. Only after all prior gates pass, intentionally publish the approved commit to Braydon's `main`.
   GitHub Pages will update `marketreadytours.com`; monitor the Pages build and Cloudflare-served
   result.
9. Smoke-test the live desktop/mobile public and authenticated workflows. Keep `cd6f980`, the old
   live build, the recorded Vercel rollback deployment, and the fresh backups available for
   immediate rollback.

The 19 new callables are: `approveListingRequest`, `approveSponsorSignup`, `createAdmin`,
`deleteIntake`, `deleteTour`, `denyListingRequest`, `disableAdmin`, `launchCampaign`,
`markSponsorPaid`, `optOut`, `requestAdminPasswordReset`, `saveTour`, `sendAdminEmail`,
`sendAdminPasswordReset`, `submitIntake`, `submitRating`, `updateAdmin`, `updateIntakeStatus`, and
`verifyTourCode`. Existing Node 24 scheduled/HTTP functions are not part of this invoker repair.

> **The branding pass below is DONE (2026-08-06) and has since been deployed to the isolated
> preview and audited. It has not been published to production.** See
> [Branding pass — completed 2026-08-06](#branding-pass--completed-2026-08-06) for what shipped,
> what was deliberately left alone, and what still needs a human eye. The assignment text is kept
> for context; the 2026-08-08 continuation section above is authoritative.

## Immediate assignment

Apply the visual branding from:

`/Users/erikyoungberg-aspelin/Desktop/MRC_BrandStandards_v5_Light.pdf`

to the existing Market Ready Tours light-mode refresh. This is a **visual branding pass only**.
Extract and follow the PDF's typography, colors, spacing, logo, icon, imagery, and accessibility
rules. Keep the current information architecture, content, interactions, responsive behavior,
Firebase contracts, and security model intact. Finish with a release-ready local build and a
clear visual QA report. Do not deploy or mutate any remote environment during the branding pass.

Use the PDF skill and its render/verify workflow. Work in source files, primarily `index.html`
and existing assets. `www/` is generated by `npm run build`; do not hand-edit it.

## Non-negotiable guardrails for the branding pass

- Do not deploy to Vercel, Firebase, Google Cloud, or `marketreadytours.com`.
- Do not change Firebase project IDs, App Check, Functions hosts, database paths, Rules, IAM,
  admin claims, migrations, Vercel aliases, environment variables, or secrets.
- Do not edit `functions/`, `database.rules*.json`, `storage.rules`, `firebase*.json`, cutover
  scripts, or files under `.mrt-backups/`.
- Do not change sponsor payment behavior. Production intentionally uses manual Venmo/Zelle/check
  invoicing plus admin mark-paid/unpaid. Stripe and Square are not production payment paths.
- Do not re-enable Instantly, Square Sandbox, reminders, or outbound campaign automation.
- Do not remove the loading timeout/fallback, App Check initialization, production hostname
  detection, secure callable paths, or legacy rollback compatibility.
- Do not reset, clean, checkout, or reformat the dirty worktree. Existing changes belong to the
  user. Do not commit or push unless separately requested.
- Preserve the old Vercel production rollback deployment exactly.

## Branding pass — completed 2026-08-06

Market Ready Brand Standards v5 applied to the refresh. This work was later deployed to the
isolated Vercel preview, but **not to production**.

### What the source PDF actually is (read this before reopening the file)

`MRC_BrandStandards_v5_Light.pdf` is a single 612×3152pt board for **Market Ready _Creative_**, not
Tours. Two things trip people up:

1. Its **copy is dark-mode-first** — "Midnight `#07090F`… Light mode is a print fallback, never the
   default." But the **board itself is rendered in light mode**, and that rendition is a complete,
   self-consistent system. Given the `_Light` filename, the assignment, and this handoff all specify
   light mode, the board's own light rendition was treated as the package. No palette was invented.
2. There is **no Tours-specific logo anywhere** in `~/Desktop/Market Ready/`. The MR lockup is the
   shared parent identity; "TOURS" is a descriptor beneath it.

### Palette (values sampled from the board, names are the PDF's)

| Token | Value | Role |
| --- | --- | --- |
| Canvas | `#F7F6F2` | page background |
| Paper | `#FFFFFF` | cards |
| **Ink** | `#101A36` | "the deep blue soul" — the ONE dark feature surface per view |
| **Cobalt** | `#2F44A0` | structure and authority; primary actions, eyebrows, links |
| **Steel** | `#AEBFD6` | the accent — one quiet highlight per view |
| Text / muted / subtle | `#111318` / `#5B5F6B` / `#8A8D97` | type ramp |
| Hairlines | `#E8E7E0` (canvas) / `#E4E2DB` (card) | structure comes from hairlines, not shadow |

**Gold is gone.** `#C9A55A` appears nowhere in v5. Typography moved from Fraunces + Hanken Grotesk
to **DM Sans** (single family, display and body). DM Sans was chosen over the PDF's stated Arimo
fallback because the supplied logo artwork is built in DM Sans and it matches the board's own
description of the brand face ("geometric sans with soft inner corners"); Arimo is a Helvetica clone.

### Files changed

| File | Change |
| --- | --- |
| `index.html` | design tokens, `B` palette, typography, logo, ~180 color sites |
| `manifest.json` | `background_color` → `#F7F6F2`, `theme_color` → `#101A36` |
| `offline.html` | rebranded; **system font only** — it must render with no network |
| `assets/icons/app-icon-{192,512}.png` | regenerated from `~/Desktop/Market Ready/MR Icon Custom.png` |
| `www/` | regenerated via `npm run build` — never hand-edited |

Everything else is untouched. All fenced-off files (`functions/`, `database.rules*.json`,
`storage.rules`, `firebase*.json`, `vercel.json`, `scripts/`, `sw.js`, `.mrt-backups/`) have
modification times predating this session; their "differs vs HEAD" status is the **pre-existing
cutover work**, which was preserved.

### Two things that will surprise the next person

1. **Token names now lie about their contents.** ~530 references resolve through `--mrt-*` and the JS
   `B` object. To avoid touching all of them, only the *values* moved — the *names* are inherited from
   the old "Quiet Luxury" system. So `--mrt-gold` / `B.gold` now carry **steel `#AEBFD6`**, and
   `--mrt-gold-deep` / `B.goldDeep` carry **cobalt `#2F44A0`**. There is no gold in the app. This is
   documented in a comment above the `:root` block and above `const B`. Rename them only if you are
   prepared to update every call site.
2. **`B.primary` is text, `B.surface` is a surface.** Both were `#17130F`. Now `B.primary`/`B.ink` =
   `#111318` for *type*, while 24 *background* sites were moved to `B.surface` = Ink `#101A36`. If a
   dark panel renders flat near-black instead of deep blue, it is using the wrong one.

### Logo

Built from the supplied vector assets, not redrawn:

- Monogram = the two real `<path>` elements from `MR Logo Ink.svg`.
- Wordmark = DM Sans **converted to outlines** via CoreText. This is deliberate and must be preserved:
  the lockup is consumed via `<img src={MRT_LOGO_DATA}>`, and an `<img>`-embedded SVG **cannot load an
  external font**. Live `<text>` would substitute a fallback face, and because the source SVG
  hand-positions the "D" and "Y" at `x=711.18` / `x=786.24`, the lockup visibly breaks (that is the
  mangled "REA̶DY" seen when rendering the PDF).
- Two colourways: `window.MRT_LOGO_DATA` (Ink, light surfaces) and `window.MRT_LOGO_ON_INK` (steel,
  dark surfaces). Regenerate both together or they drift.
- The accent dot beside "TOURS" was **removed at the user's request (2026-08-06)**; "TOURS" is now
  flush-left under the wordmark. Aspect ratio is 5.22:1 (was 2.8:1) — 251px wide at 48px tall.
  Header widths were re-verified at desktop and mobile after the change.

### Deliberately NOT changed

- **All 12 outbound email templates.** The brief fences off email, so they still carry the legacy gold
  and Georgia. One ("Peer Agent Feedback", the `const html` near the `sendCFEmail` call) uses
  single-quoted `style='` rather than escaped `style=\"`, slipped through the first color sweep, and
  **was reverted to baseline**. If you restyle emails later, that quoting difference is the trap.
- **Semantic status colors** (success green, error red, warning amber) — kept as function, not
  decoration. The calendar's "past" state was the one exception: it was amber, read as leftover gold,
  and is now neutral `#8A8D97`, which is also more semantically correct for a de-emphasised state.
- **Sub-44px controls** (Calendar / Request Tour / FAQ / segmented at 30px, Login 36px). These pass
  WCAG 2.2 AA (2.5.8, 24px) but not AAA/HIG 44px. Resizing them reshapes the action row — that is
  layout work, not branding. The mobile tab bar *was* fixed (43 → 44px, via a CSS rule since those
  buttons carry inline styles).

### Bugs fixed in passing

- **Sync/status pill was unreadable.** It used light-on-dark values (`#A0C8B0` on a 20% green tint),
  landing at **1.28:1** on the light canvas. Now uses the light-mode status tokens.
- **Mobile tab bar hairline was invisible** — `#2A2A2A` on the Ink surface; now steel-tinted
  `rgba(174,191,214,.22)`.

### Verification performed

- `npm run check` → **28/28 tests, 13/13 validation checks.** The two warnings are pre-existing
  heuristics, not regressions (baseline brace-net was −4, now −2; the authoritative parse passes both).
- `npm run build` → clean. Only `__MRT_APP_CHECK_SITE_KEY__` remains in `www/`, which is correct for a
  local build — `scripts/build.mjs` throws if `VERCEL=1` without the env.
- **Tour screen cannot hang** — confirmed with the emulator down; it falls through to
  "Tours couldn't be loaded / Try again".
- **Controls intact** — invoice, SMS, mark-paid/unpaid, Venmo/Zelle, sign-up, contact, listing-request
  all present at *identical occurrence counts* to the pre-branding baseline. Sponsor modal renders
  Paid/Pending markers and the invoice control live.
- **Nothing behavioral moved** — Firebase config, `mrt_` roots, DB paths, payment flags, App Check and
  emulator hosts are byte-identical to baseline. The **only** external-URL change is the Google Fonts
  stylesheet (Fraunces → DM Sans).
- Contrast + touch-target audit run at 390px and 1440px. One reported contrast "failure"
  ("More Tours", 1.08:1) is a **false positive** — it is white on a cobalt gradient, and the audit
  script cannot resolve gradient backgrounds.

Screenshots from the pass: `~/Desktop/MRT-brand-review/` (captured against seeded emulator data).
Note these still show the **dotted** lockup, taken before the dot was removed.

### Still needs a human eye

1. **Listing images never loaded** during QA — the storage emulator was empty, so thumbnails render as
   white boxes and price badges sit on a grey placeholder gradient. Worth one look with real images.
2. **Mark-paid/unpaid was not exercised end-to-end.** Only auth/database/storage emulators were run
   (not functions), and invoice/email actions were deliberately never fired. Presence and rendering
   are verified; the mutation itself was not executed.
3. Email templates remain off-brand by design — a separate, explicitly-scoped pass if wanted.

To reproduce the QA environment:

```sh
npx firebase-tools emulators:start --project=mrt-local-audit --only auth,database,storage
npm run seed:emu          # second shell — logins: super@example.com / test1234
npm run build && npx http-server www -p 8137 -c-1
```

## Current deployment state

> **Historical (pre-cutover, 2026-08-08).** Kept for the record; production went live 2026-08-10.
> For the current layout see "2026-09-26 — landing page" near the top.

`marketreadytours.com` still serves the **old frontend**. The refresh has **not** been promoted to
the production domain, so the branding pass is safe to do locally without disrupting users.

Recorded rollback deployment:

- ID: `dpl_7zRkm45bQL1Srq5QuFvwgov8UDr1`
- URL: `https://marketreadytours-rea0qro8q-abqeriks-projects.vercel.app`
- Record: `.mrt-backups/production-cutover-2026-08-04/vercel-production-before-cutover.txt`

Current refresh preview candidate after the branding/workflow audit (see the top continuation
section for the authoritative release record):

- `https://mrt-refresh.vercel.app/`
- `https://marketready-refresh.vercel.app/`
- URL: `https://marketreadytours-fm4cnw2pd-abqeriks-projects.vercel.app`
- Release commit: `82472cb` on `abqerik/marketreadytours`, branch
  `agent/mrt-refresh-release-2026-08-06`
- Both preview aliases resolve to the same deployment. Its served HTML matches the local generated
  bundle exactly after normalizing the injected Preview App Check site key.
- Firebase CLI was reauthenticated as `erik@marketreadysystems.ai` on 2026-08-07/08.
- Static surfaces, security headers, Preview App Check injection, dev-project routing, public data
  privacy, and the audited browser workflows passed the latest preview checks. Preview App Check
  now uses a preview-domain-only reCAPTCHA Enterprise key.

Braydon has since explicitly approved the candidate. Do not promote it until the Cloud Run invoker
blocker is resolved and the continuation gates at the top of this file pass.

## Production cutover work already completed

These production changes are intentional and must not be repeated or rolled back by the branding
model:

- Fresh read-only production backups exist under:
  - `.mrt-backups/production-cutover-2026-08-04/`
  - `.mrt-backups/production-cutover-2026-08-05/`
- 24 embedded listing images were copied to a new additive production Storage cutover folder.
- Four additive refresh database roots were imported:
  - `mrt_tours_public`
  - `mrt_tours_private`
  - `mrt_ratings_public`
  - `mrt_ratings_private`
- Transitional production database/storage Rules were deployed. They preserve all legacy paths
  for rollback while exposing only the public refresh projection.
- Existing admins were matched to Auth UIDs and given `mrtRole` claims; legacy admin entries and
  existing claims were preserved.
- Production App Check was configured for `marketreadytours.com` with reCAPTCHA Enterprise.
  Service-level enforcement remains off during cutover; callable code enforces App Check.
- Vercel Production has the public App Check provider/key configuration.
- The exact legacy email relay remains in use for transactional admin email.
- Instantly remains disabled. New Square/Stripe payment flows remain disabled.

## 2026-08-22 → 09-02 — what shipped

Six commits, `70a2853` → `f7840ce`. All on `main`, CI green, all deployed by name.

**Tour reminders now exist for tours built by hand.** `createReminderJobs` only ever ran from
`approveListingRequest`, and tours are built in the editor, so in practice almost nothing had
reminders — the Sept 2 tour had six listings and an empty queue. Reminders are now derived from
the tour and reconciled on every save. See the reminders section above.

**Two duplicate-send defects fixed before they could reach anyone.**

- Sends had no idempotency key, so a Resend timeout after acceptance would retry as a fresh send
  — up to five copies to one agent.
- `approveListingRequest` keyed rows on the listing REQUEST id while reconciliation keys on tour
  and listing id, so an approved listing would have owned two rows per offset. `createReminderJobs`
  is deleted; approval reconciles like everything else. **One source of truth.**

**`deleteTour` left reminders live.** Reminder rows live under `mrt_reminders`, not under the
tour, so nulling the tour never touched them — the worker would have gone on mailing agents about
a tour that no longer existed. Cancellation now rides in the same atomic update, and the delete
refuses rather than proceeding if those rows cannot be read.

**The worker would have gone silently blind.** Terminal rows kept a past `nextAttemptAt` and were
never cleaned up, so they returned on every scan forever and would eventually have filled the
100-row window. Fixed by parking them; proven in production (a scan before a test send saw 1 row,
the scan after saw 0 while the row still existed).

**Rules file had drifted from live.** `database.rules.transition.json` was missing the
`nextAttemptAt` index that live had — added out-of-band during the 2026-08-13 reminder fix, in a
commit that touched only `functions/index.js`. Deploying the file as it stood would have silently
dropped the index and re-broken the worker. The file now matches live exactly; diff before
deploying rules (command in `CLAUDE.md` Rule 3).

**CI had been red for 8 days and nobody noticed.** `scripts/seed-emulator.mjs` pinned the demo
tour to `2026-08-15`, so the emulator suite rotted as real time passed it — first failing the
`launchCampaign` two-day lead check, later the `submitIntake` not-in-the-past check. Both gates
were correct; the seed was wrong. It now derives from `localYmd(now + 30 days)`. **Audits must
check the Actions run, not just `npm test`** — see `CLAUDE.md`.

**A test asserted nothing 1 run in 16.** The Clover tamper helper overwrote the last hex character
with `"0"`, so whenever the digest already ended in `0` the "tampered" signature was identical to
the valid one. 6.7% of digests over 10,000 samples. Signature verification was never wrong; the
test was.

### Verification standard used for this work

Worth matching, because two of the bugs above were found *by* it rather than by review:

- 97 unit tests, including 27 over the pure reconciler covering every branch.
- End-to-end assertions in `npm run test:workflow` against real callables — this is the only
  thing that exercises full callable flows, and it runs **only in CI**.
- **Both new end-to-end assertions were mutation-tested.** Making reminder ids non-deterministic
  produced 12 rows where 6 were expected and failed the suite; removing cancellation from
  `deleteTour` failed it too. They catch regressions rather than passing vacuously.
- Live verification with a test reminder addressed **only** to `erik@marketreadysystems.ai`,
  deleted afterward.

## 2026-08-11 → 08-13 — what shipped after the cutover

The site went live 2026-08-10. Everything below landed after that, on production.

**Sponsor payments now run on Clover.** Clover Hosted Checkout (`functions/lib/clover.js`),
plans in `SPONSOR_PLANS`: full 19900, half 9950, split 4975 (cents). Admins send a payment link
from the sponsor card; `#/sponsor-pay` renders the sponsor-facing page; `cloverWebhook` marks
the sponsor paid on confirmation. Verified end to end on 2026-08-11 with a real $49.75 payment
(then voided — **Clover sends no webhook on void**, so a voided payment stays marked paid until
someone unmarks it). A second real payment processed unattended on 2026-08-13.

Webhook specifics that cost time: Clover's URL-verification probe is **unsigned**, and its test
pings carry dummy payloads — both must be answered `200` or registration fails. The signature is
HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``. There is no status API to poll, so the webhook
is the only completion signal. Sessions expire after 15 minutes.

**Sponsorship is gated on payment, server-side.** `publicSponsor()` returns `null` for an unpaid
sponsor, so unpaid records never reach `mrt_tours_public` at all — the guarantee is in the
projection, not the UI. Confirmed against live data 2026-08-13: a tour with 3 sponsors publishes
only the 2 that are paid. **This applies to the new nodes only** — see the legacy exposure in
`docs/TODO.md`, which is still open.

**Outbound email moved to Resend** (`noreply@marketreadytours.com`). See the section below for
who sends what. Firebase Auth templates are locked project-wide, so all account email is built
and sent by our own callables. Mailgun is no longer in the path. Firebase's DKIM records had
**never validated** — `firebase1/2._domainkey` were Cloudflare-proxied and resolved to Cloudflare
IPs; they are now DNS-only.

**Error alerting exists.** Cloud Monitoring alert policies plus an uptime check on
marketreadytours.com. Three schedulers were generating ~160 errors per 20h and are now `PAUSED`
(see below).

**Edge caching enabled** 2026-08-13 — see the next section, including the 10-minute deploy delay.

**Admin UX fixes:** sponsor deletion now asks for confirmation (and warns in red if the sponsor
has paid); contact-form submissions surface in the Requests page as a third tab; the two
competing sponsor payment buttons no longer contradict each other.

**Tour deletion never worked in production, and now does** (fixed 2026-08-13). The confirm modal
stores an id *string* and passed it to `persistDeleteTour`, which expected an *object* and read
`.id` off it — `undefined` on a string, so the callable received no `tourId` and threw. It
surfaced as an opaque `INTERNAL`. The same slip left `expectedVersion` at 0, which would have
failed the concurrency check even after the id was fixed. Both call sites were individually
correct; only the seam between them was wrong. Regression test pins both ends.

### Tour reminders — how they work now (rewritten 2026-08-13 → 2026-08-25)

Agents get a reminder **48 and 24 hours** before a tour, at the tour's start time, Phoenix time.

**The three legacy senders are dead and must stay that way.** `sendOneHourReminder`,
`sendTourReminders` and `sendCampaignEmails` are `PAUSED` in Cloud Scheduler AND target Cloud
Firestore, which is not enabled on this project. Their source is **not in this repo**. That is a
double lock: unpausing them alone does nothing, but do not unpause them, and do not enable
Firestore casually.

The live path is `processReminders` → `processDueReminders()` in `functions/index.js`, on Cloud
Scheduler every 5 minutes, with reconciliation in `functions/lib/reminders.js`.

**Where reminder rows come from.** Every `saveTour`, `deleteTour` and `approveListingRequest`
reconciles the tour's reminders:

| Editor action | Effect |
| --- | --- |
| Listing added | gets a 48h and a 24h reminder |
| Listing removed | its pending reminders are **cancelled**, not left to fire |
| Listing re-added | reminder revives, but only if it never attempted a send |
| Tour date moved | pending reminders reschedule |
| Agent email corrected | pending reminder retargets |
| Tour archived or deleted | pending reminders cancelled |
| Save with no changes | **nothing is written at all** |

Row ids are `stableHash(tour:<tourId>:listing:<listingId>:<hours>)`. Because the id is *derived*
rather than queried, reconciliation is idempotent and needs no `.indexOn` beyond the
`nextAttemptAt` the worker already uses. Verified: five consecutive saves of the real Sept 2 tour
wrote 12 paths then zero, zero, zero, zero.

**Four invariants that stop an agent being spammed. Do not weaken these.**

1. A row that is not `pending` or `failed` is **never** rewritten. Resurrecting a `sent` row is
   exactly how someone receives the same reminder twice.
2. A cancelled row revives **only when `attempts === 0`** — the one provably-never-sent state. A
   *failed* attempt may still have been delivered, and Resend only dedupes for 24h.
3. Sends carry `Idempotency-Key: reminder/<id>`. A send Resend accepted but whose response was
   lost otherwise retries as a fresh send, up to five times. The retry span is 30 minutes, well
   inside Resend's 24h dedupe window, and the payload is byte-stable so retries dedupe rather
   than 409.
4. Terminal rows park `nextAttemptAt` at `253402300799000` (9999-12-31). Leaving it in the past
   meant the worker's `endAt(now).limitToFirst(100)` scan returned finished rows forever; after
   ~100 accumulated it would have gone **silently blind**. Rows are parked, not deleted, so the
   audit trail survives.

**`MRT_OUTBOUND_ALLOWLIST=* in production**, so the allowlist is *not* a guardrail there — real
recipients get real mail. The four invariants above are the only thing between a bug and an
agent's inbox. Treat changes to `functions/lib/reminders.js` and `processDueReminders`
accordingly, and run `npm run test:workflow`, not just `npm test`.

## Cloudflare caching — a deploy takes up to 10 minutes to appear (2026-08-13)

The site is edge-cached. **After pushing to `main`, the change is live at the origin but
visitors keep getting the previous version for up to 10 minutes.** That is expected. Do not
re-deploy chasing it, and do not assume the build failed.

To make a deploy visible immediately: Cloudflare → Caching → Configuration → **Purge Everything**.

Until 2026-08-13 a Cache Rule named "No Cache" bypassed the cache for *all* incoming requests —
almost certainly a cutover-era measure to guarantee fresh content, left in place afterwards.
Every request therefore reached the GitHub Pages origin: TTFB measured 94ms–3558ms, wildly
variable. That rule is now `Cache at edge (respect origin TTL)`, action **Eligible for cache**,
still matching all requests, with **no** optional settings — Edge TTL and Browser TTL are
deliberately unset so both inherit the origin's `cache-control: max-age=600`. Measured after:
100% hit rate, mean TTFB 183ms, worst case 302ms.

Leave Browser TTL unset. A cache purge cannot clear what is already in a visitor's browser, so
that is the one setting here that cannot be undone from the dashboard.

**Why no `/sw.js` carve-out.** The obvious instinct is to exclude the service worker so it can
never go stale. That is backwards: Cloudflare caches `.js` by DEFAULT, so excluding `sw.js` from
the rule drops it to the default and caches it *more*. The blanket rule is what governs it, and
the 600s origin TTL bounds staleness everywhere. `sw.js` is also safe on its own terms — its
fetch handler is network-first for navigations (`www/sw.js:21`), so a page load never serves a
stale shell.

`.github/workflows/pages.yml` has a purge step that removes the 10-minute delay entirely, but it
is dormant: it no-ops until `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` exist as repository
secrets. Setting those needs **admin** on `braydondennis-ux/marketreadytours`; Erik has only
push/triage, so this needs Braydon.

## Outbound email: who sends what (2026-08-12)

Transactional mail goes out through **Resend** as `noreply@marketreadytours.com`
(`MRT_RESEND_API_KEY` in Secret Manager, declared on `callableOptions` so every callable has it).
The legacy Gmail relay is still the fallback when the key is absent. Resend's key is **send-only**,
so it cannot list past messages — check the Resend dashboard for delivery history.

**Firebase no longer sends any account email.** Its Auth templates are locked on this project:
the Identity Toolkit API returns `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` (that path needs Identity
Platform) *and* the console refuses too — "Email template updates are currently unavailable for
this project." So Firebase's mail can never be branded. All three account emails are therefore
built and sent by our own callables, each generating exactly one reset link:

| Action | Callable | Trigger |
| --- | --- | --- |
| New team member invite | `createAdmin` | admin adds a team member |
| Forgot password | `requestAdminPasswordReset` | sign-in page, self-service |
| Reset on someone's behalf | `sendAdminPasswordReset` | admin clicks resend |

**The trap:** never let the client *also* call `_fbAuth.sendPasswordResetEmail` for an action a
callable already handles. Two senders mean two oobCodes; Firebase invalidates the earlier one, so
the recipient gets two emails and the first link is always dead. That was the real cause of the
"expired or already used" reports, together with a separate issue — the browser API key's referrer
allowlist was missing `marketready-tours.firebaseapp.com`, which made the action page 403.
`scripts/bootstrap.test.mjs` guards the one-sender rule.

Testing these end-to-end needs both an App Check token and an auth context (the app signs in
anonymously before the login screen), so a bare `curl` gets 401. Register a temporary App Check
debug token, exchange it with a `Referer: https://marketreadytours.com/` header (the API key is
referrer-restricted), then **delete the debug token afterwards** — it bypasses App Check while it
exists.

## Latest production data verification

On 2026-08-05, production was exported again after the user asked whether Scott had added data.
The legacy `mrt_tours` tree matched the prior cutover snapshot exactly:

- Tours: 35
- Listings: 99
- Sponsors: 45
- Paid sponsors: 7
- Auth accounts: 22
- Changed legacy tours: 0
- Legacy tour SHA-256: `131c8ad9aa3c690976b0a712521d8c4e6fb299055a1923b79ee2233638dea2f3`

Do not perform another import for the branding task.

## Backend and payment state

The refresh implements trusted callable workflows in `functions/index.js`, including tour CRUD,
ratings, intake, admin management, listing approvals, sponsor approvals, and manual sponsor
mark-paid/unpaid. Production sponsor payments intentionally work as follows:

- Invoice instructions: Venmo `@MarketReadyTours`, Zelle
  `payments@marketreadytours.com`, or check payable to Market Ready Tours.
- Admins can send email invoices, open an SMS invoice, and mark a sponsor paid/unpaid.
- Paid sponsor projections are public; unpaid sponsors remain private.
- The existing legacy `sendEmail` relay is preserved.
- Stripe does not currently work on the old site.
- Square is not a working production checkout path; sandbox behavior is preview/local only.

Do not restyle by deleting, renaming, or bypassing any related controls or state markers.

## Current production blocker — re-test before cutover

Nineteen new Node 22 generation-2 callables were created and updated successfully, but their
underlying Cloud Run services are still private. Direct requests return the outer Cloud Run 403
before Firebase App Check/Auth can run.

The signed-in identity is `erik@marketreadysystems.ai`. The original live IAM check showed:

- Direct project role: `roles/editor`
- Effective permissions include `run.services.get`, `run.services.getIamPolicy`, and
  `run.services.update`
- Missing permission: `run.services.setIamPolicy`

`erik@mcguire-creative.com` is an email alias, not a distinct Google IAM login. OAuth resolves it
to `erik@marketreadysystems.ai`.

After Braydon reportedly changed access, the latest 2026-08-08 effective-permission checks returned
no Functions/Cloud Run deployment permissions at either the project or service level, and project
IAM policy reading returned 403. See the top continuation section for the exact results and required
re-test. Do not make a production write until those permissions pass. The user explicitly approved
the public invoker bindings; Firebase Auth, App Check, admin claims, validation, and rate limits
remain the application security boundary.

## Source architecture

- `index.html`: compiled React application and styles; this is the primary branding source.
- `assets/`: existing site assets; reuse/extend carefully according to the brand PDF.
- `manifest.json`, `offline.html`, `sw.js`: PWA surfaces; update only if visually necessary and
  keep behavior/cache semantics intact.
- `scripts/build.mjs`: generates `www/`, injects environment-specific App Check configuration, and
  picks the site layout (landing page at `/` + app at `/app/`, or app at `/`) — see the
  2026-09-26 section.
- `landing.html` + `assets/landing/`: the sales landing page served at `/` on the website.
- `functions/index.js`: trusted backend. Out of scope for branding.
- `database.rules.transition.json`: rollback-safe production rules. Out of scope.
- `www/`: generated output. Never edit directly.

## Required branding verification

At minimum, run:

```sh
npm test
npm run validate
npm run build
```

Prefer `npm run check` if available, since it combines tests and validation. Inspect the rendered
site at desktop and mobile widths. Specifically verify:

- Tours render without an infinite loading state.
- Upcoming/Past tabs, tour cards, detail views, modals, and admin screens remain usable.
- Sponsor invoice, SMS, mark-paid/unpaid, sign-up, contact, and listing-request controls remain.
- Focus states, contrast, text sizes, and touch targets satisfy the light-mode brand/accessibility
  rules.
- No build placeholders remain in generated output.
- No production URLs, Firebase paths, or payment behavior changed.

If browser control is unavailable, say so explicitly and provide the user a short manual visual
QA checklist. Do not substitute an unapproved browser automation stack.

## Working-tree warning

The `design-refresh` worktree contains extensive intentional modified and untracked files from the
refresh/cutover. Preserve all of them. Use focused patches and inspect diffs only for files touched
by the branding pass. Never use `git reset`, `git checkout --`, destructive cleanup, or bulk
formatting.
