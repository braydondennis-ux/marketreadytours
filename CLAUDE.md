# MarketReady Tours — working rules

_Updated 2026-10-10. **Production is LIVE.** The landing page is restored for mobile and
desktop at `marketreadytours.com/`; the app lives at `marketreadytours.com/app/`.
Mailgun/branded-sender changes are deferred in a patch. See `HANDOFF.md` before deploying._

## Rule 1: production is live, and you are cleared to work on it

The pre-cutover rule ("never touch production without Braydon's OK") is **retired**. It was
correct while the refresh was unreleased; it is now wrong and would block routine work.

What changed: Braydon granted Erik **Owner** on `marketready-tours` and was present for the
2026-08-10 cutover. Erik also holds Cloudflare admin. He has stated a standing go-ahead — you
do not need per-action approval for ordinary production work.

Ordinary work you should just do: deploy functions by name, deploy the client, read and write
prod data through the app's own callables, change Cloudflare settings, run diagnostics.

**Still confirm first**, because these are hard to reverse or affect other people:

- Deleting or overwriting production data, Auth users, or Storage objects.
- Emailing anyone who is not `erik@marketreadysystems.ai`. In testing, that address ONLY.
  This constraint has been restated repeatedly; treat it as absolute.
- Anything that charges, refunds, or moves money.
- Force-pushing `main`, or anything that discards Braydon's work.

## Rule 2: never run a bare `firebase deploy --only functions`

Our `functions/` source and Braydon's deployed set only partially overlap. A blind deploy
**DELETES** `sendEmail` and `trackEmail` — which the legacy site still calls — and **CREATES**
four fenced-off functions including `createSponsorInvoice`. Always deploy by name:

```bash
npx firebase deploy --only functions:saveTour,functions:deleteTour --project marketready-tours
```

The expected function count is **30**. Check it after any deploy; a changed count means
something was created or destroyed that you did not intend.

## Rule 3: there are two database rules files, and `firebase.json` points at the unused one

`database.rules.transition.json` is what production actually runs. `database.rules.json` is the
stricter target state and is **not deployed** — yet `firebase.json` names it, so
`firebase deploy --only database` would publish the strict rules.

That would not break the live site (the refresh reads `mrt_tours_public`, permissive in both),
but it would silently break **rollback**: the rollback target does no authentication at all, so
restricting `mrt_tours` makes a rolled-back site load nothing. `docs/TODO.md` item 1 has the
detail. Know which file you are shipping before deploying rules.

**And check the file against live before you trust it.** On 2026-08-22 the transition file was
found missing `".indexOn": ["nextAttemptAt"]` on `/mrt_reminders` — the index was added to the
live rules out-of-band during the 2026-08-13 reminder fix, and that commit touched only
`functions/index.js`. Deploying the file as it stood would have silently dropped the index and
re-broken the reminder worker, with nothing in git to explain it. The file now matches live. Diff
before deploying rules:

```
curl -s "https://marketready-tours-default-rtdb.firebaseio.com/.settings/rules.json?access_token=$(gcloud auth application-default print-access-token)"
```

## Rule 4: client and server ship together

A callable's contract lives in two files. Deploying one side alone creates a live mismatch —
on 2026-08-12 deploying `createAdmin` before the client left `createAdmin` with two email
senders, and every invite would have carried a dead link. If a change spans both, land both.

## Rule 5: outbound email has four invariants — do not weaken them

`MRT_OUTBOUND_ALLOWLIST=*` in production, so the allowlist stops nothing there: real agents get
real mail. What prevents someone being emailed six times is the reminder state machine, and it is
load-bearing.

1. A row that is not `pending` or `failed` is **never** rewritten.
2. A cancelled row revives **only when `attempts === 0`**.
3. Sends carry `Idempotency-Key: reminder/<id>`, and the payload must stay byte-stable across
   retries or Resend 409s instead of deduping.
4. Terminal rows park `nextAttemptAt` in the far future, or the worker eventually goes blind.

Touching `functions/lib/reminders.js` or `processDueReminders` means running
`npm run test:workflow`, not just `npm test`. Full detail in `HANDOFF.md`.

## Rule 6: an audit is not done until CI is green

`npm test` and healthy Cloud Functions are not enough. `npm run test:workflow` — the only thing
that exercises full callable flows — runs **only in CI**. On 2026-08-22 it had been failing for
8 days while an audit reported everything healthy.

```bash
gh run list --workflow="Validate MarketReady Tours" --limit 8 --json createdAt,conclusion,headSha
```

If it failed, read the failing step before assuming it is unrelated, and compare `headSha` across
runs to see whether the failure predates your changes.

## Deploying

- **Client:** `git push origin HEAD:main` → GitHub Actions builds `www/` → Pages serves it.
  `origin` is `braydondennis-ux/marketreadytours`; Erik has push but **not** admin, so he
  cannot manage repository secrets.
- **Edge cache: a deploy takes up to 10 minutes to appear.** This is expected — do not
  re-deploy chasing it. For an immediate update: Cloudflare → Caching → Configuration →
  Purge Everything.
- **Site layout** is chosen by env vars in `.github/workflows/pages.yml`: `MRT_LANDING: "1"` puts
  `landing.html` at `/` and the app at `/app/`; `MRT_PUBLISH_APP_SUBPATH: "1"` keeps `/app/`
  serving even with the landing page off (emailed links point there). A plain `npm run build`
  keeps the app at `/` — that is what Capacitor/iOS bundles, so never set `MRT_LANDING` there.
  To test the website layout locally: `MRT_LANDING=1 npm run build`.
- **Functions:** deploy by name (Rule 2).
- Verify the deployed artifact, not the absence of an error. `curl` the live URL and grep for
  a marker you just changed. A silent no-op is the common failure here.

## Where things live

- Canonical project state + architecture: **HANDOFF.md** (read it first).
- Open work and known-broken things: **docs/TODO.md**.
- Security posture: **SECURITY_NOTES.md**.
- The whole app is one file: **`index.html`** (compiled `React.createElement`, no JSX source).
  `www/` is **gitignored** — the Actions workflow builds it. `cp index.html www/index.html`
  is still worth doing for local serving, but it is not what gets deployed.
- The landing page is one file too: **`landing.html`** (+ images in `assets/landing/`). Its first
  `<head>` script forwards every `#/` link to the app — don't remove it, or old invite, opt-out
  and payment links land on the marketing page.
- After editing the script region, always run the parse check:
  `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"`
- Then `npm run check` — 114 tests plus 13 static checks.

## Traps that have each cost a day

**Evaluation emails must contain the saved feedback.** `submitRating` used to send only a
notification; this was confirmed in a delivered email October 8. Use the shared server renderer
in `functions/lib/evaluation-email.js`. For full reports, the client sends `reportType`, `tourId`
and `listingId` to `sendAdminEmail`, which reads private ratings and the saved agent recipient.
Do not restore arbitrary client HTML support to fix formatting. Test both report buttons and
actual email content; a successful provider delivery does not prove evaluations were included.

**Maps keys must allow the app's full URL.** Address lookup broke at `/app/` with
`RefererNotAllowedMapError`. Fixed in `8047d3f` by using the existing browser key managed in
`marketready-tours`; the old key belongs to a different project Erik cannot manage. Keep the
separate Vercel demo key. For hostname/path changes, verify suggestions and selection/details
in both the public listing form and the signed-in admin Add Listing form. CI alone does not
exercise Google's live key restrictions. Full deployment and browser evidence is in `HANDOFF.md`.

**Embedded routes also require Geocoding.** The managed browser key must allow Maps JavaScript,
Places, Directions and `geocoding-backend.googleapis.com`, and those APIs must be enabled in
`marketready-tours`. Geocoding was missed during the September 29 key switch; enabled and
added to the existing key restrictions October 1. Test the actual Route view with all property
pins and the driving line, not just autocomplete or the external Google Maps link.

**Add Listing saves immediately.** The admin editor calls `onUpdateTour` as soon as Add Listing
is clicked; do not assume the separate Save Changes button is required. For an address-only
browser test, cancel the entry form before adding. The September 29 test verified address
confirmation and the enabled Add Listing button, but deliberately did not test final saving.
A later log check found a separate save failure; an enabled button is not evidence of persistence.

**RTDB drops empty arrays.** Reloading a new tour removes `sponsors: []` from the returned
record. `saveTour` must normalize missing sponsors to an empty collection, never insert
`undefined` into its transaction (`d43c919`). The emulator workflow now covers creating an
empty tour, reloading it, then persisting the first listing as a regular admin. Keep that real
database round trip: fixtures that always include `sponsors: []` missed the production defect.

**Do not hand Erik a command prefixed with `!`.** That prefix is Claude Code's own syntax. He
runs commands in a real terminal, where zsh reads `!` as logical-NOT: `! cd /path && git push`
runs the `cd`, inverts its success into failure, and `&&` short-circuits. The real command
never runs and prints **no error at all**. This has silently swallowed a production push.

**A raw `TypeError` from `cleanText` surfaces as an opaque `INTERNAL` 500.** Every callable
validates with `cleanText(..., required=true)`, which throws a plain `TypeError`, not an
`HttpsError`. The user sees only "INTERNAL" and the real message is in Cloud Logging. When a
callable fails inexplicably, read the logs before theorising.

**`gcloud` is not on the PATH, and credentials expire roughly daily.** The SDK lives at
`/opt/homebrew/share/google-cloud-sdk/bin/gcloud` — Homebrew never symlinked it, so the bare name
is "command not found". Export it first:

```bash
export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"
```

Erik must reauth interactively; it cannot be done from a non-interactive shell. Give him the full
path, and note `npx firebase` only works from `marketreadytours/`, which is where `package.json`
lives:

```
/opt/homebrew/share/google-cloud-sdk/bin/gcloud auth login
/opt/homebrew/share/google-cloud-sdk/bin/gcloud auth application-default login
cd "<repo>/marketreadytours" && npx firebase login --reauth
```

The two expire independently — the Firebase CLI has repeatedly outlived gcloud, and
`npx firebase database:get <path>` will read the database when gcloud is dead.

**Verify a deploy by revision, not by its success message.** `firebase deploy` has reported
"Successful update operation" while still serving the previous revision. After deploying, check
the revision actually rolled and diff the inventory:

```bash
gcloud functions describe <fn> --project=marketready-tours --region=us-central1 \
  --format='value(serviceConfig.revision,state)'
```

**Reading a truncated `curl` is how you get a wrong answer confidently.** A dead credential makes
the RTDB REST API return an HTML error, and `gcloud functions list` returns a partial list before
failing — on 2026-08-23 that briefly reported 12 functions instead of 30. Sanity-check that a
query returns data at all before reporting "no errors found".
