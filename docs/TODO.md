# MarketReady Tours — open items

_Updated 2026-08-13. Production is live; see `CLAUDE.md` for what you are cleared to do._

Verified items note how they were confirmed, so nobody has to re-derive it.

---

## 🔴 1. Legacy `mrt_tours` is world-readable — M5, the cost of keeping rollback

**This is live and needs no credentials.** Re-measured 2026-08-13 with an **unauthenticated**
request to `https://marketready-tours-default-rtdb.firebaseio.com/mrt_tours.json`: 35 tours, 38
unpaid sponsors with name + email + phone, 33 tour access codes, 84 distinct agent emails. e.g.
`Local Mortgage | jeff@localmortgage.com | 6023161263`, a sponsor who has not paid.

**This is deliberate, not an oversight, and tightening the rule is the WRONG fix.** The reasoning
is recorded in a `"//"` comment inside `database.rules.transition.json` — read it before acting.
In short: the rollback target `cd6f980` performs **no authentication at all** (zero
`signInAnonymously` calls), so any auth requirement on this node makes the rolled-back site load
nothing. `scripts/production-cutover.test.mjs:150` asserts `.read: true` **on purpose** — a test
failure there means someone tried this and it will break rollback.

**The fix is to DELETE the node once the rollback window closes.** Not to restrict it.

**Careful — two rules files, and `firebase.json` points at the wrong one for current reality:**

| file | `mrt_tours` | status |
| --- | --- | --- |
| `database.rules.transition.json` | `.read: true` | **what is actually deployed** |
| `database.rules.json` | `.read: false` | the target state, **not deployed** |
| `firebase.json` → `database.rules` | → `database.rules.json` | so a plain deploy publishes the strict file |

So **`firebase deploy --only database` would publish the strict rules** and silently break
rollback readability. It would not break the live site — the refresh reads `mrt_tours_public`,
which is `.read: true` in both files. Know which one you are shipping.

**When closing this:** back up first (`.mrt-backups/` holds the 2026-08-10 snapshots), confirm
`node scripts/rebuild-legacy-mrt-tours.mjs` runs cleanly, then delete the node and update the
cutover test that asserts the permissive rule. A `close-m5.sh` existed during the 2026-08 work
but lived in a scratch directory and is **gone** — it is not in `scripts/`.

**Not the same as sponsorship gating, which is done.** New data is safe: `publicSponsor()`
returns `null` for unpaid sponsors, so they never reach `mrt_tours_public`. The exposure is the
frozen pre-cutover copy.

**Rollback is not a reason to keep it.** The runbook already regenerates `mrt_tours` from
`mrt_tours_private` via `scripts/rebuild-legacy-mrt-tours.mjs`, and it *must* be run at rollback
time regardless, because the legacy node is stale — 35 tours against 36 in the public projection
as of 2026-08-13. Keeping it buys nothing and costs the exposure above.

Also worth confirming as part of this: that no unpaid sponsor leaks through share/OG preview
images, tour route email, campaign email, or the seller report.

---

## 🔴 2. Tour reminders do not work, and a real tour is scheduled

`sendOneHourReminder`, `sendTourReminders`, `sendCampaignEmails` — all three **`PAUSED`** in
Cloud Scheduler, none functional since April.

The cause is architectural, not configuration: the code targets **Cloud Firestore**, which this
project does not use and has never enabled. It fails with `PERMISSION_DENIED: Cloud Firestore
API has not been used in project marketready-tours`. This app stores everything in the Realtime
Database. Pausing the jobs stopped ~160 errors per 20h; it fixed nothing.

**A tour is scheduled for 2026-09-02 and will send no reminders.** Rewrite against RTDB.

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
concurrency and rejects stale writes with 409. Verified working — the 2026-08-12 tour reached
`version: 8` across 8 saves with no lost updates.

---

## 🟡 6. Smaller open items

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
- **M7** — verify the legacy send-email Cloud Function authenticates its caller.
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
