# Mobile audit, October 10, 2026

Erik requested a full mobile audit and confirmed most attendees use iPhones. Prioritize the
attendee path over desktop-only organizer assumptions. This is simulator/browser testing,
not a physical-device guarantee.

## Environment and safety

- iOS 26.5 Safari in Xcode Simulator, compact iPhone layout approximately 375 x 667.
- Chrome responsive layouts at 320 x 568 and 430 x 932.
- Local app with Firebase Auth, Database, Storage and Functions emulators in `mrt-local-audit`.
- Seven-stop October 9 fixture copied to `local-only-oct9-ui`; contact emails sanitized,
  phone numbers removed, campaigns empty. All outbound delivery mocked. No agent emailed.
- Production landing/app navigation inspected read-only. No fake production evaluations,
  tour changes, payments or campaign sends.

## Defects corrected

1. Software keyboard covered the tour Unlock button on compact iPhone Safari. Code gate,
   sign-in and reset dialogs now follow the visual viewport, scroll within available space,
   and hide decorative content while typing. All three primary actions visually verified
   above the actual iOS software keyboard. Remember maximum viewport height across input
   changes because Safari can shrink innerHeight too.
2. Five rating stars crowded/clipped the right edge. Labels stack above the stars at 430px
   and below, retaining the existing 44px rating buttons.
3. Unfinished feedback disappeared on refresh. Text/scores now persist in sessionStorage per
   tour/property/attendee for 24 hours and clear only after acknowledged submission. Photos
   are not restored; a restored-photo notice explicitly asks the attendee to reattach them.
4. Expired tour access left a dead-end submission error. It now reopens the code gate with
   feedback intact. Identical in-page retries reuse a request ID; changed payloads get a new
   one. A ref guards double taps. This does not claim deduplication across browser restarts.
5. Photo decoding was not counted as pending upload and could be omitted by a quick Submit.
   Pending begins before decoding. Unreadable images become removable failures and the same
   file can be selected again. Unsupported image conversion reports a JPEG/PNG fallback.
6. Phone inputs use 16px to prevent Safari focus zoom. Rating footer respects safe-area inset;
   Add to Home Screen banner is hidden during ratings. Long contact address wraps at 320px.
7. Offline banner promised automatic sync and covered navigation. It now occupies normal
   layout and asks users to reconnect before submitting. Reconnection does not claim a send.
   Failed network submissions explain that saving is unconfirmed and invite a safe retry.
8. Submission success says feedback was saved for the agent, not that an email reached them.

## Verified UI workflows

| Workflow | Evidence |
| --- | --- |
| Upcoming/past tours and seven property stops | iPhone Safari, public attendee |
| Favorite/unfavorite and reload | Favorite persisted in Safari |
| Wrong and correct tour code | Wrong code rejected, 4100 accepted locally |
| Full evaluation | Ten category scores and note submitted in Safari; DB and organizer summary matched |
| Refresh recovery | Nine category scores and note restored, tenth added, submission completed |
| Expired access | Local grant expired deliberately; re-entry retained all ten scores and saved |
| Rankings | Safari showed actual 4.1 average and all category scores |
| Photo attachment and dropped connection | Chrome phone layout selected a test PNG through native picker, uploaded it, set DevTools Offline, failed submit, restored network and retried successfully; DB had one evaluation for that attendee with ten scores, note and private photo path |
| Organizer login | Local super account signed in at 430px |
| Organizer summary/PDF | Actual Safari feedback displayed; Download PDF opened readable one-page print report; cancelled printing |
| Manage tour | Seven stops and bottom actions reachable; private note saved, version advanced to 2 and DB note matched |
| Contact | 320px local form submitted and showed Message Sent; outbound mocked |
| Sponsor / tour signup / list home | Phone forms opened, fields and primary actions reachable; signup required-field validation exercised; no live requests submitted |
| Login/reset keyboard | Compact Safari showed primary buttons above software keyboard; no reset email sent |
| Landing Next tour | Live compact Safari tap opened Sonoran Showcase October 29 directly in app, without scrolling down the landing page |

## Automated checks

- `npm run check`: 129 unit/regression tests and 13 static checks pass. Two existing heuristic
  warnings remain; authoritative JavaScript parse passes.
- Six new regressions exercise draft persistence/isolation/expiry, blocked browser storage,
  retry IDs, pending/invalid photo handling, failed and expired-access submission recovery,
  and truthful offline-banner behavior.
- Fourteen tour preflight scenarios passed today against the seven-stop fixture and production
  transition rules: public/private access, grant ownership, favorites, all evaluations,
  deduplication, private photos, rerating, concurrency/averages, report permissions/content,
  expired access, optimistic save/reorder, add/remove, reminders, cancellation/cleanup.
- Local evidence logs: `/tmp/mrt-oct10-mobile-check.log`,
  `/tmp/mrt-oct9-preflight-results.json` (completedAt October 10),
  `/tmp/mrt-oct10-mobile-emulators.log`. These temporary paths are not durable artifacts.

## Limits and follow-up

- Physical iPhone camera/HEIC selection, cellular handoff/poor coverage, background suspension,
  large text/VoiceOver, installed Home Screen mode and older supported iOS still need device
  checks. Simulator scrolling used keyboard paging where automation swipes were ineffective;
  do not claim physical swipe behavior verified.
- Drafts are per browser tab and text-only. Closing a tab, clearing site storage or attaching
  photos then reloading requires recovery expectations stated above. Offline submission is
  not queued automatically.
- Sponsor payments, campaigns, invitations and external email delivery were not sent from UI.
  Existing isolated backend tests cover those callables; inbox placement is a separate open
  deliverability task. Mailgun/branded-sender patch remains deferred.
- Mobile intake/address autocomplete and sponsor onboarding need a complete physical-phone
  pass with disposable test data before claiming every feature certified.

## Release

Client release and post-deploy verification pending at time of initial report entry.
