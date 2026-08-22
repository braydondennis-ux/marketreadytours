# MarketReady Tours — working rules

_Updated 2026-08-13. **Production is LIVE.** The refresh serves marketreadytours.com._

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

The expected function count is **28**. Check it after any deploy; a changed count means
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

## Deploying

- **Client:** `git push origin HEAD:main` → GitHub Actions builds `www/` → Pages serves it.
  `origin` is `braydondennis-ux/marketreadytours`; Erik has push but **not** admin, so he
  cannot manage repository secrets.
- **Edge cache: a deploy takes up to 10 minutes to appear.** This is expected — do not
  re-deploy chasing it. For an immediate update: Cloudflare → Caching → Configuration →
  Purge Everything.
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
- After editing the script region, always run the parse check:
  `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"`
- Then `npm run check` — 58 tests plus 13 static checks.

## Two traps that have each cost a day

**Do not hand Erik a command prefixed with `!`.** That prefix is Claude Code's own syntax. He
runs commands in a real terminal, where zsh reads `!` as logical-NOT: `! cd /path && git push`
runs the `cd`, inverts its success into failure, and `&&` short-circuits. The real command
never runs and prints **no error at all**. This has silently swallowed a production push.

**A raw `TypeError` from `cleanText` surfaces as an opaque `INTERNAL` 500.** Every callable
validates with `cleanText(..., required=true)`, which throws a plain `TypeError`, not an
`HttpsError`. The user sees only "INTERNAL" and the real message is in Cloud Logging. When a
callable fails inexplicably, read the logs before theorising.
