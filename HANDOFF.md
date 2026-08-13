# MarketReady Tours — Engineering Handoff

_Updated 2026-08-10. Read this entire file before acting._

## ROLLBACK RUNBOOK — read this before rolling back

**Rolling back is TWO steps, not one. Pushing `cd6f980` alone will serve STALE tours.** The
legacy build reads `mrt_tours`, which is no longer maintained — the refresh writes to
`mrt_tours_private` and the server projects `mrt_tours_public`. `mrt_tours` is only regenerated
by the rebuild script, so it silently misses every tour created since the cutover. Verified
2026-08-13: `mrt_tours` held 35 tours while `mrt_tours_public` held 36 — the North Phoenix tour
created 2026-08-12 was absent. Rebuild first, or roll back onto data that is missing work.

(Audit M5 would delete `mrt_tours` outright; it has NOT been applied, so the node still exists
and is still publicly readable. If M5 is ever closed, rolling back without step 1 serves ZERO
tours rather than stale ones.)

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
- `scripts/build.mjs`: generates `www/` and injects environment-specific App Check configuration.
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
