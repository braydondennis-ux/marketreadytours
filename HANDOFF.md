# MarketReady Tours — Project Handoff

_Last updated: 2026-07-17_

A real-estate "Tour · Rate · Decide" app for agents. This doc is the single source of truth
for the project's current state, how it's built, what's in flight, and how to ship it.

> **TL;DR status:** All work now lives on the **`design-refresh`** branch (a superset of
> `firebase-shared-backend`): shared-data backend + security hardening + the full "Quiet
> Luxury" visual refresh + **all fixes from the 2026-07-16 demo audit** (16 findings fixed
> 2026-07-17, commit `b28eb73`; only M5/M7/L5 deferred — see §2b). Live on the **isolated
> dev preview only**. It is **NOT merged to `main` and NOT deployed to production** — the
> live site and production Firebase are untouched. **Demo meeting ~2026-07-24; prod go-live
> may be approved after it.**

---

## 1. Architecture (read this first)

- **One file.** The entire app is `index.html` (~14k lines): React 18 via CDN, all UI as
  **compiled `React.createElement`** (there is **no JSX source** — edits are made directly to the
  compiled JS). Lucide icons + Firebase compat SDKs + Google Fonts load from CDNs.
- **Backend:** Firebase **Realtime Database + Auth + Storage**, project **`marketready-tours`**
  (Braydon owns it; Erik has admin/console access). Roles live in RTDB `admins/<email-dots-as-commas>`.
- **Hosting:** **Vercel** (Erik's account, user `abqerik`), static (`outputDirectory: "."`),
  custom domain **marketreadytours.com** (Cloudflare in front). Also wrapped as an **iOS app via
  Capacitor** (`webDir: www`, appId `com.marketreadytours.app`).
- **Deploy file is root `index.html`.** `www/index.html` is the Capacitor copy — keep it in sync
  (`cp index.html www/index.html`). The `build.js` pipeline is effectively dead (no JSX source).
- **CI gate:** `www/validate.js` runs on push (`.github/workflows/validate.yml`). It now uses an
  **authoritative `new Function` parse check**; the brace/paren heuristics are warnings only.

### Editing the compiled file — gotchas (important)
- Emoji are stored some as literal chars, some as `\uXXXX` escapes. The Edit tool normalizes
  `\u`↔char, so **type the literal emoji** in `old_string`.
- The middle-dot `·` is a Babel `\xB7` escape the Edit tool will **not** match — edit *around* it,
  or use a Python script via Bash.
- Replacing a bare-string child with `LI(...)`/`createElement` adds a nesting level → **watch
  paren balance**. Always run the parse-check after each edit:
  `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"`

---

## 2. What's done on the `firebase-shared-backend` branch (42 commits)

**A. Shared-data backend** (the headline fix — Braydon's `SECURITY_NOTES` "F1: guest ratings
never reach Firebase").
- Guest **ratings** and **favorites** now persist to Firebase and are shared with everyone (were
  local-only before). New granular guest-writable paths `mrt_ratings/<tourId>/<listingId>/<subId>`
  and `mrt_favorites/<tourId>/<listingId>/<userKey>`, **merged back into the tours on read**
  (`mergeSharedIntoTours`) so existing screens didn't have to change.
- Public **sponsor signups** go to a pending queue `mrt_sponsor_signups`; a sponsor only shows
  publicly once an admin marks it **paid**.
- Admin `mrt_tours` writes strip the now-shared fields (per-tour, only once shared data exists —
  so legacy inline ratings/favorites aren't wiped before migration).

**B. Security hardening** (`database.rules.json`, `storage.rules`, `vercel.json` CSP + headers,
XSS escaping, SRI) — see `SECURITY_NOTES.md`. New RTDB rules for the contribution paths
(anon create-only, no overwrite/delete; public read only where counts must be shared).

**C. Full UI redesign** — "refined editorial": **Fraunces** (display serif) + **Hanken Grotesk**
(body) fonts; **lucide line icons replacing emoji chrome across every screen** (dashboard, tour
detail, public forms, rating flow, login, all admin screens); calmer cards; readability pass
(higher contrast, real 800/900 font weights). Final scan: 0 chrome emoji left in buttons/headers.

**D. Icon bug fix** — lucide was 404'ing from cdnjs (which never hosted the package) and the
`LI()` parser mishandled lucide's format; now loads from **jsdelivr** with a corrected parser
(CSP + SRI updated).

---

## 2b. What's done on `design-refresh` (July — current working branch)

Branch contains everything above **plus**:

**A. "Quiet Luxury" visual refresh** (screens P1–P10, July 7–8): navy/ink/cream/gold palette,
Fraunces + Hanken Grotesk, Lucide icons, per-tour color tamed to dot + spine. Then surgical
UX passes: unified 1200px desktop content well, full-bleed page headers, ONE global desktop
top-nav bar (per-page header logos hidden on desktop), mobile = per-page headers + bottom tab
bar, deep-link routing fixed. Details: `docs/design/refresh-handoff.md`.

**B. Google Maps fallback** (2026-07-16, `9b2073c`): demo domain isn't whitelisted on the
referrer-restricted prod Maps key, so map auth failures now render a clean "Map preview
unavailable" placeholder instead of Google's gray error overlay. To actually show the map on
the demo, add `https://*.vercel.app/*` to the key's restrictions in Braydon's GCP project.

**C. 2026-07-16 audit — 16 findings FIXED** (2026-07-17, commit `b28eb73`), verified by a
red/green Playwright behavior suite against the emulator (14/14 green) + live smoke on the
deployed demo. Highlights:
- **C1 (critical):** public form REST writes no longer hardcode the **prod** database URL —
  new `mrtDbRestUrl()` helper resolves emulator/dev/prod by hostname. **Use it for every
  public-form REST write.**
- **H1–H5:** last-tour delete persists; public "Request a Tour" persists to
  `mrt_tour_requests`; sponsor signup shows its confirmation; browser Back works on tour
  detail (hash is source of truth); stale pre-login sync poll can't revert admin edits.
- **M1–M4, M6:** contact-form false success, rating crash on missing price/sqft, ghost-admin
  session, unsanitized email input, blank logged-out admin deep links (now an "Admin access
  required" screen).
- **L1–L4, L6:** desktop double header, requests-admin hash, "1 stops"/"Stop #0" labels
  (stop numbers now 1-based sorted position; seeds fixed), favicon, preview-write debounce +
  `canSend.clear()` retry-after-failure.

**Deferred (documented, not fixed):** **M5** — `mrt_tours` public-read still exposes tour
access `code` + agent emails; fix = split into protected `mrt_tours_private/<id>` (data-model
change). **M7** — verify the send-email Cloud Function authenticates callers (needs prod
access). **L5** — no spam protection on public intake (captcha/rate-limit before real launch).
Full audit detail: `docs/HANDOFF-audit-2026-07-16.md`.

---

## 3. The demo (share this with Braydon)

- **Stable URL:** https://marketready-tours-demo.vercel.app
- **Admin login:** `marketreadytours@gmail.com` / `demo1234`
- **Tour access codes** (to test the guest rating flow): `1234` (Demo North) · `5678` (Demo South)
- Runs against an **isolated dev Firebase project** — nothing there touches real data.
- Emails/SMS are **suppressed** on the preview (and on localhost), so testing sends nothing real.

**How the demo backend works:** `index.html` picks the Firebase project by hostname —
`*.vercel.app` → the **`marketready-tours-dev`** project; the real domain → prod;
`localhost` → the local emulator. The stable URL is a Vercel alias re-pointed on each deploy.

**⚠️ Deploy from the `marketreadytours/` subdirectory, NOT the parent `mrt/`.** The parent
dir is linked to a different Vercel project (`mrt`) with Deployment Protection ON — aliasing
a deploy from there puts an SSO login wall on the demo. Sanity-check the alias returns
HTTP 200, not 302:
```
cd marketreadytours
URL=$(npx vercel --yes | grep -oE 'https://marketreadytours-[a-z0-9]+-abqeriks-projects.vercel.app')
npx vercel alias set "${URL#https://}" marketready-tours-demo.vercel.app
curl -s -o /dev/null -w "%{http_code}" https://marketready-tours-demo.vercel.app/   # → 200
```
Re-seed the dev project with `node scripts/seed-dev.mjs` (creates the demo admin + tours +
a pending sponsor signup).

---

## 4. Local development

Safe local testing runs against the **Firebase Emulator Suite** (never prod). Requires Java
(`brew install --cask temurin`).
```
npm run emu                      # Auth + Database emulators (port 9000/9099, UI :4000)
node scripts/seed-emulator.mjs   # seed demo tours + admins + auth users (super@example.com / test1234)
npm run serve                    # static server on :8080
# open http://localhost:8080 (it auto-connects to the emulator; emails are suppressed)
```

---

## 5. Production go-live runbook (PENDING — not done yet)

Order matters — **security/rules first, then code**:
1. **Back up** prod RTDB (Firebase console → Realtime Database → ⋮ → Export JSON).
2. **Publish rules:** paste `database.rules.json` into prod console → RTDB → Rules → Publish;
   paste `storage.rules` into Storage → Rules → Publish. (Or `firebase deploy --only database,storage`.)
3. **Deploy code** to Vercel (`npx vercel --prod`). Ships `vercel.json` CSP/headers + the new
   `index.html`. The emulator/dev-preview/email-guard code is inert in prod (hostname-gated).
4. **Verify live:** no CSP violations in console; login + open a tour + submit a request work.
5. **(Optional) migrate** the ~4-5 legacy tours that have inline ratings/favorites into
   `mrt_ratings`/`mrt_favorites` (one-off script). Safe to skip — the strip-on-write is
   per-tour-conditional, so legacy inline data is preserved until migrated.
6. Roll back = remove the added rule blocks + revert the Vercel deploy (changes are additive).

Also: **merge `design-refresh` → `main`** when ready (it contains `firebase-shared-backend`).

---

## 6. External accounts / services

| Service | Role | Owner / notes |
|---|---|---|
| Firebase `marketready-tours` | DB + Auth + Storage (prod) | **Braydon owns; Erik has admin** |
| Firebase `marketready-tours-dev` | isolated demo backend | Erik (free Spark plan) |
| Vercel | hosting + deploys | Erik (`abqerik`, Hobby plan) |
| Domain registrar (marketreadytours.com) | DNS | confirm who holds it |
| Google Maps API key (`GOOGLE_KEY`) | autocomplete + route map | restrict by referrer in GCP |
| Cloud Run `sendemail-…run.app` | transactional email | confirm provider behind it |
| Formspree | contact / request notifications | forms `xykdngrr`, `xwvnrbqr`, `xdallqwa` |
| Cloudflare QR worker `…braydondennis.workers.dev` | tour QR/share links | **Braydon's PERSONAL account** — re-host or inherit |
| Square + `marketreadynetwork.com` (Netlify) | sponsor invoice payments | **separate business** — confirm transfer/rebuild |
| Apple Developer (Team `JH4P665D3Z`) | iOS app | only if shipping the app |

---

## 7. Open follow-ups / known issues

- **Demo meeting ~2026-07-24** — demo is ready; prod go-live may be approved after it.
- **Ship to prod** (section 5) + merge `design-refresh` to main — biggest pending item,
  gated on Braydon's explicit OK.
- **Deferred audit items:** M5 (split tour `code`/agent emails into protected
  `mrt_tours_private/<id>` — also covers the older "Phase 1" world-readable concern), M7
  (verify send-email CF authenticates callers; needs prod), L5 (spam protection on public
  intake before real launch). See §2b + `docs/HANDOFF-audit-2026-07-16.md`.
- **Demo map placeholder** — the Tour Route map shows "Map preview unavailable" on the demo
  until `https://*.vercel.app/*` is added to the Maps key restrictions (prod domain is fine).
- **Accepted v1 security tradeoffs** (documented): `mrt_favorites` anon writes aren't
  ownership-scoped (favorite tampering, low value); `mrt_ratings` is public-read (exposes
  voluntary rater names). Hardening = anonymous-auth scoping ("Approach C"), deferred.
- **Dead "Invite Campaign"** feature (Instantly.ai short-circuited; only email #1 of the drip
  ever sends). Mass-emailing agents has CAN-SPAM exposure — understand before using.
- **Root vs `www` drift** — always `cp index.html www/index.html` before committing/deploying.
- The QR share worker + Square/Netlify payment fn are the two things most likely to **not
  transfer cleanly** from Braydon — budget time to re-host/rebuild if needed.

---

## 8. Reference docs in this repo
- `SECURITY_NOTES.md` — the security hardening (Phase 0) detail + residual/Phase 1 items.
- `docs/HANDOFF-audit-2026-07-16.md` — the full demo audit (all findings + fix status).
- `docs/design/refresh-handoff.md` + `docs/design/design-tokens.css` — the visual refresh.
- `docs/superpowers/specs/2026-06-24-firebase-shared-backend-design.md` — feature design spec.
- `docs/superpowers/plans/2026-06-24-firebase-shared-backend.md` — implementation plan.
