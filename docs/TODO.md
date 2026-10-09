# MarketReady Tours — open items

_Updated 2026-10-08. Production is live; see `CLAUDE.md` for what you are cleared to do._

Verified items note how they were confirmed, so nobody has to re-derive it.

**October 8 follow-up:** the missing-evaluations email defect is repaired (`8979b99`); all 32
85085 evaluations are saved. Backend deployment and verification are in `HANDOFF.md`.
Erik subsequently authorized the corrected reports: sent all five through the live Post-Tour
Follow-Up action October 8 at 20:02 Phoenix time. Resend confirmed all five Delivered, and
Greg's report was inspected for complete evaluation content. No resend remains pending;
see `HANDOFF.md` for evidence. Do not repeat the batch without a new request.

---

## ✅ 1. Legacy `mrt_tours` PII exposure — CLOSED 2026-08-13 (M5)

Until 2026-08-13 an unauthenticated request to
`https://marketready-tours-default-rtdb.firebaseio.com/mrt_tours.json` returned 35 tours, 38
unpaid sponsors with name + email + phone, 33 tour access codes and 84 distinct agent emails.
**The node has been deleted.** That request now returns `null`.

**The read rule stays permissive on purpose — do not tighten it.** The rollback build
(`cd6f980`) performs no authentication at all, so requiring auth would make a rolled-back site
load nothing. `scripts/production-cutover.test.mjs` asserts `.read: true` deliberately. Absence
of the data closes the exposure; the permissive rule preserves rollback.

Rollback was rehearsed against the real post-delete state: `rebuild-legacy-mrt-tours.mjs`
reports the node absent and reconstructs all 36 tours in original array order. Recovery paths:
that script (current data), `.mrt-backups/mrt_tours-2026-08-13/` (the node exactly as deleted),
and the 2026-08-10 cutover snapshots.

**Still true — two rules files.** `database.rules.transition.json` is what production runs;
`database.rules.json` is the stricter target state and is NOT deployed; `firebase.json` points
at the strict one. So `firebase deploy --only database` would publish the strict rules and break
rollback readability without breaking the live site. Know which file you are shipping.

## ✅ 2. Tour reminders — CLOSED 2026-08-25

Rewritten against RTDB and now created from the tour itself rather than only from listing
approvals. `HANDOFF.md` has the full behaviour table and the four invariants that keep an agent
from being emailed twice. The September 10 health check verified the final **16 reminders
across 8 listings** for the September 2 tour: all sent, zero failed attempts, and one successful
log event per reminder. This verifies the send path, not inbox delivery or opens. See
`HEALTH-CHECK-2026-09-10.md`; this was not re-audited September 29.

The three legacy senders stay **`PAUSED`** and target Firestore, which is not enabled on this
project. Their source is not in this repo. Leave both locks in place.

---

## 🟠 3. Callable errors surface as an opaque `INTERNAL` 500

Every callable validates with `cleanText(value, max, label, required)`, which throws a plain
`TypeError` when a required field is missing. Firebase turns any non-`HttpsError` into
`INTERNAL`, so the user sees a red `INTERNAL` banner and the real reason is only in Cloud
Logging.

This is what made the tour-deletion bug (fixed 2026-08-13) take log-diving to diagnose rather
than being self-evident from the UI. Converting `cleanText` to throw
`HttpsError("invalid-argument", ...)` would surface the field name to the user. It touches every
callable, so it deserves its own change.

---

## 🟠 4. Harden the remaining realtime writes (19 sites)

RTDB writes go over the realtime socket with no timeout, so a stalled socket leaves the UI
spinning with no error (this is what hung Sign In and Team Management). `mrtDbSet()` races the
socket write against a REST write, but is applied to the three `admins/` writes only. **19 other
`_fb.ref(...)` write sites remain unprotected.**

Note the "Synced" pill reflects `fbReady` (initial data loaded, possibly via REST fallback) and
**not** socket health, so a dead socket looks healthy until you try to write.

---

## 🟠 5. Sync is whole-collection last-write-wins

Production lost data on 2026-07-31 (Scott: 7 of 8 listings, repeatedly). The immediate bug is
fixed, but every write still replaces the entire collection and resolution is last-write-wins:

- A genuine remote edit arriving inside our own 2.5s ignore window is **dropped**, and nothing
  re-fetches it — that client stays stale until reload.
- Two admins editing different tours simultaneously can still clobber one another.

Real fix is per-tour granular writes (`mrt_tours/<id>`), which the pre-rollback May build had in
`15e501f` and the February rollback discarded.

Note this is partially mitigated for tours: `saveTour` uses `expectedVersion` optimistic
concurrency and rejects stale writes with 409. Now well evidenced — the 2026-09-02 tour was built
in production over two weeks and reached **version 56 across ~55 saves** with no lost updates.

---

## 🟡 6. Smaller open items

- **September 10 create-tour guard still needs follow-up.** It releases after 1,500 ms while
  the save may still be pending; recheck before changing it. The inverted uptime-alert condition
  was reverified and repaired October 8: failed-check count now `> 0` for five minutes, with the
  existing notification channels preserved. See `HEALTH-CHECK-2026-10-08.md`. The separate
  admin-delete permission mismatch was resolved September 11 in `8eab1cf`. Historical duplicate
  tour records are not authorization to delete anything now. Original audit: `HEALTH-CHECK-2026-09-10.md`.

- **Square still posts webhooks at production.** `squareWebhook` took 35 signed-but-rejected
  POSTs in the 7 days to 2026-08-22, all HTTP 403, all from Square's own IP `34.202.99.168`
  (`Square Connect v2`), roughly every 1-4 hours. Rejection is correct — payments moved to
  Clover — but the webhook subscription was never removed on Square's side, so each hit
  cold-starts a container for nothing. Remove the subscription in the Square dashboard.

- **Refunded sponsors stay publicly visible.** Marking paid is what publishes a sponsor; a
  refund in Clover does not unmark them. Also, **Clover sends no webhook on void** — a voided
  payment stays marked paid until someone unmarks it by hand. Verified 2026-08-11.
- **Email footer says `marketreadytours@gmail.com`.** Should be a domain address.
- **Purge-on-deploy is dormant.** `.github/workflows/pages.yml` has the step; it no-ops until
  `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` exist as repository secrets. Setting those
  needs **admin** on `braydondennis-ux/marketreadytours` — Erik has push/triage only, so this
  needs Braydon. Until then, purge by hand in the Cloudflare dashboard.
- **Two of three account emails are untested end to end.** Forgot-password was verified with a
  real send on 2026-08-12. The new-member invite (`createAdmin`) and the admin-triggered reset
  (`sendAdminPasswordReset`) share the same sending path but no real message has gone through
  either. The first person invited is currently the test — when they are, also confirm the
  invite's "sign in" link (`/#/login`, changed 2026-09-26) opens the sign-in screen.
- **M7** — verify the legacy send-email Cloud Function authenticates its caller. Partly
  evidenced: since 2026-08-14 every `sendEmail` hit has been a bot probe rejected with 403
  (Netcraft, Amazonbot, spoofed-iOS scanners), and no function has fallen back to it. The live
  client does not reference it at all.
- **`mrt_reminders` is indexed on `nextAttemptAt` only.** Fine for everything today —
  reconciliation looks rows up by derived id rather than querying — but an admin view that lists
  reminders by tour would need `tourId` added to `.indexOn`, in
  `database.rules.transition.json`, which is the file production actually runs.
- **Terminal reminder rows are never deleted.** They are parked at `nextAttemptAt`
  9999-12-31 so the worker cannot see them, which is correct, but the node grows forever. Not
  urgent at ~12 rows per tour; revisit if it reaches thousands.
- **L5** — no captcha on public intake forms (rate limiting and a honeypot are in place).
- **`createCheckoutSession` 404s.** The live legacy site calls it; it is deployed nowhere and
  exists in no source. Pre-existing.

---

## 🟡 7. Landing page follow-ups (live since 2026-09-26)

- **No real reviews or testimonials.** The competitor (besthomeontour.com) leads with "5.0 · 336
  Google reviews" next to its main button; we have nothing equivalent. Real agent quotes are the
  single biggest conversion gap. Nothing was fabricated to fill it.
- **Listing photos need Braydon's OK.** The hero wall and leaderboard reuse photos that agents
  submitted to promote a listing on a tour. Addresses are never shown, but the reuse itself is
  his call.
- **Unconfirmed claims to check with Braydon:** that listing agents actually receive a
  feedback report, and that the seller only sees it if the agent shares it (both appear in the
  page's copy and FAQ). Listing-agent pricing is not stated anywhere on the page.
- **Possible next step:** a shorter multi-step listing form in place of the app's current
  one-page `#/request` form.

---

## ✅ 8. Property address lookup — CLOSED 2026-09-29

Lou's report was reproduced as Google's `RefererNotAllowedMapError` at `/app/`. Commit
`8047d3f` switches the loader to the existing production project browser key. Pages deployment,
validation CI, all 97 local tests and 13 static checks passed. Chrome computer-use checks
verified suggestions and address details in both public List Home and the signed-in admin
Add Listing form. Listing details accepted input and Add Listing became enabled.

The test entry was canceled with the tour still at 0/8 listings. **Final saving, photo upload
and Lou's own account were not tested.** Add Listing saves immediately, so do not click it
with a dummy property on a live tour. If the issue recurs, collect the exact address and
whether failure occurs during lookup or saving. See the September 29 section of `../HANDOFF.md`.

**Follow-up:** a later log review confirmed four failed saves after the lookup repair; the
address-only test did not cover persistence. Missing sponsors after an RTDB round trip caused
`saveTour` to write `undefined`. Fix `d43c919` passed 98 unit tests, 13 checks, the full local
emulator workflow including first-listing persistence, and CI. Only `saveTour` was deployed;
revision `savetour-00009-luv` is ACTIVE, with the inventory unchanged at 30 functions.
**October 1 live browser check:** the same tour now has four saved properties. The identity
of the person who added them was not established. See the first-listing section of
`../HANDOFF.md` for the failure timeline and deployment evidence.

---

## ✅ 9. Embedded tour map in the ocean — CLOSED 2026-10-01

All four property lookups were rejected because Geocoding was missing from the production
project/key configuration after the September 29 switch. Enabled Geocoding and appended it
to the key's API targets, preserving all prior restrictions. Chrome verified four numbered
pins and the driving route on the live 85085 tour. Client patch `a8f2198` handles failed,
partial and stalled lookups without displaying empty ocean bounds. Seven regression tests;
105 tests and 13 checks passed. See the October 1 section of `../HANDOFF.md`.

---

## Known behaviour worth a decision (not bugs)

- **Favourites are global, not per-user.** `mergeSharedIntoTours` collapses a listing's
  favourites with `.some(Boolean)`, so a heart shows filled if *anyone* favourited it, and you
  cannot un-favourite someone else's. Fine if the heart means "the group liked this"; wrong if
  it is meant to be personal.
- **Buyer Est. / Seller Est.** both pointed at the bare marketing homepage. Greyed out and
  labelled "Work in progress" pending real destinations.
- **Braydon-dependent:** does anyone read `payments@marketreadytours.com`? Mailgun account
  access. Repository admin (see above).
