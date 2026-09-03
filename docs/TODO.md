# MarketReady Tours — open items

_Updated 2026-09-02. Production is live; see `CLAUDE.md` for what you are cleared to do._

Verified items note how they were confirmed, so nobody has to re-derive it.

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
from being emailed twice. The 2026-09-02 tour was armed on 2026-08-25 with 12 reminders across 6
agents; it later grew to 8 listings, so the final row count should be higher. **Whether those
sends actually landed is unverified** — see "First thing to check" at the top of `HANDOFF.md`.

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
  either. The first person invited is currently the test.
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

## Known behaviour worth a decision (not bugs)

- **Favourites are global, not per-user.** `mergeSharedIntoTours` collapses a listing's
  favourites with `.some(Boolean)`, so a heart shows filled if *anyone* favourited it, and you
  cannot un-favourite someone else's. Fine if the heart means "the group liked this"; wrong if
  it is meant to be personal.
- **Buyer Est. / Seller Est.** both pointed at the bare marketing homepage. Greyed out and
  labelled "Work in progress" pending real destinations.
- **Braydon-dependent:** does anyone read `payments@marketreadytours.com`? Mailgun account
  access. Repository admin (see above).
