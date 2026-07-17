# MRT — Session Handoff (2026-07-16)

> **STATUS UPDATE 2026-07-17: FIXED.** C1, H1–H5, M1–M4, M6, L1–L4, L6 are all fixed on
> `design-refresh` and verified green by an automated Playwright suite against the emulator
> (red-before/green-after for every browser-testable item). Still open by design:
> **M5** (move tour `code`/agent emails to `mrt_tours_private` — data-model change),
> **M7** (verify send-email CF auth — requires prod access), **L5** (spam protection/captcha —
> pre-launch item). The sections below are the original audit for reference.

Continuation of the MarketReady Tours "Quiet Luxury" refresh. This session: shipped a Google
Maps fallback placeholder, then ran a full audit of the live demo. **No audit fixes have been
made yet — awaiting the user's choice of what to fix.**

Model note: user switched to **Fable 5** partway through this session.

---

## 0. NON-NEGOTIABLE GUARDRAIL (read first)

Everything stays **DEV-only** until Braydon explicitly approves production. "Prod" =
`marketreadytours.com`, the `marketready-tours` Firebase project, and any `vercel --prod`.
Work on the local emulator or the `*.vercel.app` preview (which uses the isolated
`marketready-tours-dev` Firebase project). See `CLAUDE.md` RULE 1. Braydon is out of town;
he doesn't have to approve for "a while."

---

## 1. Deploy recipe — and the gotcha that bit us this session

The app is one file: `index.html`. **Mirror `www/index.html` byte-identical** before committing
(`cp index.html www/index.html`), then parse-check (CLAUDE.md has the one-liner).

**Deploy MUST run from the `marketreadytours/` subdirectory**, which is linked to the Vercel
project **`marketreadytours`** (public). The parent `mrt/` directory is linked to a *different*
project **`mrt`** that has **Deployment Protection ON** — deploying from there and aliasing it
puts a **Vercel SSO login wall** in front of the demo. This session I accidentally deployed from
`mrt/` and the demo went behind auth until I redeployed from `marketreadytours/`.

```
cd marketreadytours          # <-- IMPORTANT: not the parent mrt/
npx vercel --yes             # preview deploy → prints marketreadytours-xxxx.vercel.app
npx vercel alias set <that-url> marketready-tours-demo.vercel.app
# sanity: curl -s -o /dev/null -w "%{http_code}" https://marketready-tours-demo.vercel.app/  → 200 (not 302)
```

Live demo: **https://marketready-tours-demo.vercel.app** (dev Firebase, confirmed
`projectId=marketready-tours-dev`).

---

## 2. Done this session — Maps placeholder (committed + deployed)

**Problem:** the Tour Route page showed Google's gray "Oops! Something went wrong / didn't load
Google Maps correctly." Root cause = `RefererNotAllowedMapError`: the hardcoded Maps key
(`AIzaSyBoPhoNQ5…`, Braydon's prod key, `index.html:~70`) is HTTP-referrer-restricted and the
`*.vercel.app` demo domain isn't whitelisted. **Not** a fake-address issue; prod is unaffected
(its real domain IS whitelisted).

User declined standing up a separate demo key (would need a new GCP project + billing; Braydon's
project is inaccessible right now). Instead we made the failure graceful:

- Added `window.gm_authFailure` + `window.onMapsError()`/`_mapsErrorCallbacks` in the Maps loader
  (`index.html:~40`). `gm_authFailure` is the global Google calls on key/referrer failure.
- `TourMap` subscribes via `window.onMapsError(() => setMapError(true))` (`~5980`), routing to the
  component's **pre-existing but previously-dead** `mapError` placeholder (`~6270`). Swapped its
  emoji for a Lucide `MapPinOff`; copy = "Map preview unavailable" + stops-are-listed hint.
- Left a code-comment reminder at the key: to fix the demo map, add `https://*.vercel.app/*` to the
  key's Website restrictions in Braydon's GCP project (or wire a hostname-selected demo key).

Committed as `9b2073c`. Verified live: placeholder renders, no Google overlay.

---

## 3. Full audit — findings (VERIFIED; nothing fixed yet)

Method: live security probe of the dev RTDB (curl/REST), Playwright walkthrough (desktop 1440 +
mobile 390, incl. admin login as `marketreadytours@gmail.com` / `demo1234`), and a full
code-review pass. Each item verified live or by reading the cited code; races marked as such.

**Reassurance first:** the RTDB **security rules are solid** (`database.rules.json`): default-deny
root, roles super-admin-only (no escalation), sensitive collections read-protected, public intake
create-only. DB is NOT world-writable. Confirmed against the live dev DB.

### 🔴 Critical
- **C1 — "List Home" form writes to the PROD database from every environment.** `index.html:11939`
  hardcodes `marketready-tours-default-rtdb.firebaseio.com` and ignores the dev/prod hostname
  switch. Demo submissions pollute prod + never appear in the demo admin. Violates the guardrail.
  Fix: use `_fbConfig.databaseURL` (as the REST fallback at `:13906` correctly does).

### 🟠 High (broken core flows / data loss)
- **H1 — Deleting the LAST tour doesn't persist; it resurrects on reload.** Write effect bails on
  `tours.length === 0` (`:13969`). The `fbDeletingTour` guard (`:13952/13956`) is dead code (never
  set true). Delete handler `:10382`.
- **H2 — Public "Request a Tour" never written to `mrt_tour_requests`.** `onSubmit` only appends to
  local state (`:11039`); the form does Formspree + SMS (`:9656/9670`) so the team is emailed, but
  the in-app admin Attendance tab never shows these. (Listing requests DO write — via C1's bad path.)
- **H3 — Sponsor signup: no confirmation + hash desync.** Lead IS saved (`:14221`) but
  `setPage("dashboard")` unmounts the page before its `submitted` screen renders, and the hash
  stays `#/sponsor-signup` (refresh → blank form). App handler `:14217`.
- **H4 — Browser Back broken on tour detail.** ✅ verified live: open tour → Back → hash returns to
  `#/` but tour detail stays on screen (stuck). `ToursDashboard` local `activeTourId` never clears
  (`:10037-10041`, sync gate `:10112`). Hash change to a different tour also ignored.
- **H5 — Stale 60s non-admin poll survives admin login; can silently revert admin edits.** Race in
  the sync effect (`:13882`); the poll's `once()` handlers don't honor `fbIgnore`. Timing-dependent.

### 🟡 Medium
- **M1 — Contact form shows "Message Sent" even on failure** (`:13316`, unconditional `setSent` in
  try/catch). Message lost silently. Also no email-format validation.
- **M2 — Rating submit crashes for listings missing numeric price/sqft** (`:1734`,
  `.toLocaleString()` unguarded) → misreported as "Network error"; rating not saved/emailed. Needs
  legacy/hand-entered data.
- **M3 — "Ghost admin" from sessionStorage** (`:13822`): expired Firebase session + surviving
  `gat_session` → full admin UI but all writes silently fail behind a "Synced" status.
- **M4 — Unsanitized user input in notification emails** (`:1757`, uses raw `suggestions`/`sugPrice`
  instead of the `safe*` versions computed at `:1724`). `mrt_tour_requests` also has no `.validate`.
- **M5 — Data exposure:** `mrt_tours` is public-read (needed for guest links) but currently includes
  each tour's access **`code`** and **agent emails** — readable via unauth REST. `database.rules.json`
  flags this as a known residual; real fix = move private fields to a protected `mrt_tours_private/<id>`.
- **M6 — Logged-out deep-link to `/team` or `/requests-admin` → blank screen** (resolver `:13679`
  sets the page for everyone; render gate `:14182` requires auth). No redirect/login prompt.
- **M7 — Verify the send-email Cloud Function authenticates its caller** (`SEND_EMAIL_URL`,
  `:374`). Couldn't test without hitting prod; if open it's a spam/relay vector.

### 🟢 Low / polish
- **L1 — Duplicate header on ALL desktop public pages** (Sponsor / Tour Sign Up / List Home /
  Contact): the global top nav AND the old `PublicMasthead` both render (two logos, two navs, two
  Logins). Most-visible cosmetic issue. Fix = hide `PublicMasthead` under `body.mrt-desktop`.
- **L2 — Requests admin page never sets the hash** (`:14165`, missing `window.location.hash`) →
  refresh returns to dashboard.
- **L3 — Copy:** "1 stops" (pluralization); stop cards "Stop #0/#1" (zero-indexed) vs route map
  "Stop #1/#2".
- **L4 — `favicon.ico` 404** (none declared) → harmless console 404. (This was the walkthrough 404.)
- **L5 — No spam protection on public intake** (create-only but unlimited) — captcha/rate-limit
  before real launch.
- **L6 — Minor:** `mrt_tour_previews` written per-keystroke without debounce/`.catch` (`:13997`);
  `canSend` rate-limiter stamps the attempt before success (`:540`) so a legit retry after a failed
  submit is blocked.

---

## 4. Pending decision (where we stopped)

User asked "what to fix first?" I proposed batches; **no answer yet**:
1. **C1 + L1** — guardrail fix + double-header (quick, high-impact, low-risk).
2. **H1–H3** — the three broken submit/delete flows.
3. **H4–H5 + mediums** — routing/race fixes (more delicate).

Do NOT start fixing until the user picks. Per `mrt-refine-approach`: keep the familiar flow, fix
genuinely-bad stuff, don't rewrite good screens. The admin pages, tour detail, and dashboard all
look clean and on-brand — leave their structure alone.

---

## 5. Verification harness (recreate as needed)

Playwright-core drives system Chrome headless:
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Run node scripts from the `mrt/`
dir so `playwright-core` resolves. Demo super-admin login = the visible `.mrt-dash-login-action`
button on the dashboard (reveals email/password inputs), creds above. Dev RTDB REST base =
`https://marketready-tours-dev-default-rtdb.firebaseio.com/<path>.json`. Never probe-write prod.
