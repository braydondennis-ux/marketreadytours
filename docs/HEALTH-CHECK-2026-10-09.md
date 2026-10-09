# October 9 expanded tour preflight

Backend phase completed October 9, approximately 07:30–07:45 Phoenix time. Erik authorized
comprehensive testing, with no agent notifications or visible test data and any real test mail
going only to `erik@marketreadysystems.ai`.

## Current target and isolation

`tour-1791219970929-1-ivt0w`, Scottsdale - 85013 Tour, October 9 at 9 AM, is now **version 18
with seven stops**, superseding last night's version-14 six-stop audit. Added stop: **7001 North
14th Street**, now stop 6; 5835 North 16th Place is stop 7.

Copied the refreshed private tour into local Firebase emulators as `local-only-oct9-preflight`.
All fixture email fields were replaced with Erik's address and phone fields cleared. Emulator
transactional email, campaign sends and payments are mocked by existing server guards. Never
created a production test tour or redirected real agents' addresses.

## Defect found and repaired: empty admin rating summary

The app subscribes to `mrt_ratings_private` as an admin to populate summaries and comments.
The deployed rules allowed admins to read individual rating leaves but lacked an admin read
rule at the collection level. Realtime Database rules do not filter a collection query down to
readable children. The collection subscription therefore failed even though ratings were saved
and email reports could be built by the server.

Reproduced with a failing emulator test: `admins can subscribe to the rating collection used by
the summary; attendees cannot`. Added a collection `.read` restricted to the existing `admin`
and `super` claims in both rule files. The regression now passes and confirms anonymous users
and ordinary attendees still cannot read the collection. Existing individual-owner reads and
all write restrictions are unchanged.

Published only this one rule delta using the actual live rules snapshot, with a pre-write
comparison and full read-back assertion. All other 28 rule entries, reminder indexes, and
legacy rollback behavior were preserved. **Did not deploy `database.rules.json` wholesale.**
The transition file, excluding its documentation-only `//` key, equals the verified live rules.

## Backend results

The full existing emulator workflow suite passed: ratings, intake, approvals, manual payment,
campaign/opt-out, payment/refund mocks, reminders, and admin deletion permissions.

The new `scripts/tour-preflight.mjs` passed these 14 scenarios using the exact verified live
rules and the refreshed seven-stop fixture:

1. Public tour contains every stop; private tour and code remain protected.
2. Correct code unlocks; bad code and another attendee's grant fail.
3. Favorite can be saved, reloaded and removed.
4. Evaluations persist on all seven properties; retrying each request does not duplicate it.
5. Uploaded photo moves from temporary to private storage; owner/admin can read and outsiders cannot.
6. Re-rating replaces the attendee's prior rating without increasing the count.
7. Six concurrent additional attendees preserve all seven records and correct averages in all ten categories.
8. Admin collection subscription reads all saved feedback; attendees cannot read it or send admin reports.
9. Expired access fails; entering the correct code renews it.
10. Both report types process every property's saved feedback; all comments retained and user HTML escaped.
11. Tour edit/reordering saves; stale-version overwrite is rejected.
12. Adding/removing a listing saves; a report with no evaluations is skipped.
13. Rescheduling seven stops creates exactly fourteen 48h/24h reminder records.
14. Cancelling/deleting the local tour removes its ratings and cancels unsent reminders.

Six security-rules tests passed, including the new admin subscription regression. `npm run check`
passed all 114 unit tests and 13 checks with the existing two heuristic warnings.

**Test setup correction:** the emulator CLI installed rules into `mrt-local-audit-default-rtdb`
while this app uses namespace `mrt-local-audit`. The preflight now explicitly installs the chosen
rules into the exact namespace under test before checking permissions. Do not rely on a passing
workflow test as proof of database permissions unless rules were loaded into that namespace.
The separate rules suite already does this explicitly.

## Production verification and authorized email

- All 30 deployed functions remain ACTIVE; no production function deployment was needed.
- Fresh production query found zero ERROR-or-higher/HTTP-5xx entries since October 9 00:00 Phoenix.
- Live app and share URL returned HTTP 200 with a browser user-agent.
- Sent exactly one real email using the production Resend sender and shared evaluation renderer
  to **Erik only**, subject `[TEST ONLY] October 9 tour evaluation email check`.
  Resend accepted it at 07:37 Phoenix, ID `01a12119-20ff-75ec-aa97-5f21c127e39c`.
  It contains two explicitly synthetic evaluations. No live evaluation was submitted.
  Later browser phase confirmed Inbox delivery and full feedback rendering (see below).
- After tests, the entire production private-tour, public-tour, private-rating and reminder
  collections were identical to their before-test snapshots. Target remains version 18/seven stops.
  No agent email was sent by this test session.

## Remaining checks and limits

Computer use initially failed with `Sky Computer Use native pipe startup failed`. Erik restarted
Codex, restoring access. The expanded browser phase below completes those formerly pending checks.
All write workflows used an isolated local copy with mocked outbound mail.

The live transition rules retain legacy shared favorite reads/writes; the stricter target rules
have per-user ownership. This existing compatibility behavior was not tightened in a tour-day
repair. The favorites preflight verifies persistence/removal, not a claim of private ownership
under live rules. No actual payment was charged and no external campaign was launched.

Backend success plus the permission repair is stronger evidence than last night's read-only
check, but does not constitute a guarantee that every browser workflow is perfect.

## Browser phase after computer-use reconnect

Computer use recovered after Erik restarted Codex. Chrome verified the live share link opens
`/app/#/tour/...`, and the live Route map displays all seven numbered properties and their driving
line in Phoenix, including the new 7001 North 14th Street stop. No production evaluation or
outbound agent message was triggered.

On a sanitized local seven-stop copy, using the actual live database rules and mocked mail:
incorrect code and incomplete ratings rejected; correct code unlocked; ten-category evaluation
with comment, suggested price and uploaded photo saved; re-rating replaced the same attendee
(count stayed one); Skip returned without creating a rating; rankings reflected updated scores.
Admin summary displayed saved notes and scores. Additional labeled fixtures populated all seven
homes for report coverage. Both report types successfully processed seven properties. Phone-sized
(393 x 852 Chrome iPhone emulation) summary was usable. This is viewport emulation, not physical
Safari/iOS validation. The local unbuilt server's missing manifest icon is not a production error.

Browser testing found and repaired four more client defects:
- Favorite persisted in Firebase but vanished after reload: anonymous auth restored after the
  sync effect chose paths. Track auth UID in React state and resubscribe when it changes.
  Verified favorite restored after reload and removal persisted.
- Download PDF omitted scores/comments for collapsed homes. Expand all homes during native
  beforeprint, restore collapse state afterprint, and use print-specific layout. Chrome PDF
  preview verified seven pages, all ten scores and the expected comment for every property.
- Private notes autosaved each keystroke, causing version conflicts and partial saves. Notes now
  remain drafts until Save Changes, which awaits success and stays open on failure. Reopening
  the editor loads the latest saved notes. Browser and database verified the full saved note.
- Send Route treated `createdBy` (Firebase UID on this real tour) as an email. Resolve the
  organizer's existing admin profile, retaining legacy email-valued creators. Local route send
  now reports two recipients with no failures, with both deliveries mocked.

Three new regressions cover print lifecycle/content, failed editor-save behavior, and organizer
UID/email resolution. `npm run check` passes 117 tests and the static checks.

The real TEST ONLY email was found in Erik's Gmail **Inbox** at 07:37, not Spam. Opened and
verified both evaluations, ten score categories, averages, comments, pricing feedback and working
app URL. No second real test message was sent.

Local address autocomplete did not return suggestions, so no claim is made that the entire
Google selection-to-add flow was exercised locally. Live production address lookup/selection
was verified in the previous evening's browser audit, and add/remove persistence passed backend
preflight. Real payments, external campaigns and physical mobile-device behavior remain outside
this isolated test. No universal guarantee is implied.

## Share-page modernization and final verification

After completing tour tests, updated the Cloudflare share worker, which still read obsolete
`mrt_tour_previews` and rendered a generic stock-photo card. The replacement reads only
`mrt_tours_public`, shows the actual title/date/time/seven-home count/first property photo,
uses responsive navy/cream styling and links directly to `/app/#/tour/:id`. Existing `/img/:id`
proxy and social metadata remain, with versioned image URLs and safe escaped HTML.

Deployed through the signed-in Cloudflare dashboard: `marketreadytourshare`, active version
`3875a9ad`, approximately 08:17 Phoenix. Live HTML matches the local renderer byte-for-byte.
Production image endpoint returned the real 625 West Ocotillo Road photo. Chrome desktop and
393 x 852 mobile emulation are readable; View this tour opened the correct seven-stop app tour.
The share page console had zero messages. Source, rollback source and deployment notes are now
versioned in `cloudflare/`. Two additional regression tests cover public data, escaping, direct
links, image proxy and upstream failure. Latest `npm run check`: 119 tests/13 checks passed,
with the same two existing heuristic warnings.

Final read-only production checks at approximately 08:20 Phoenix: all 30 functions ACTIVE;
zero ERROR-or-higher/HTTP-5xx entries since midnight Phoenix. All four full collections
(private tours, public tours, private ratings, reminders) still exactly match their pre-test
snapshots. Target remains version 18/seven stops. No agent was emailed by testing and no fake
production evaluation or tour was created. The single authorized real test email went to Erik.

Evidence: `/tmp/mrt-oct9-share-check.log`, `/tmp/mrt-oct9-share-deployed.html`,
`/tmp/mrt-oct9-final-errors.json`, `/tmp/mrt-oct9-final-functions.json`, and private snapshot
`/tmp/mrt-oct9-final-production-snapshot.json` (local only, not committed).
