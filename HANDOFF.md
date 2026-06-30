# MarketReady Tours — Project Handoff

_Last updated: 2026-06-29_

A real-estate "Tour · Rate · Decide" app for agents. This doc is the single source of truth
for the project's current state, how it's built, what's in flight, and how to ship it.

> **TL;DR status:** A large body of work (shared-data backend + full UI redesign + security
> hardening) is complete on the **`firebase-shared-backend`** branch and live on an **isolated
> dev preview only**. It is **NOT merged to `main` and NOT deployed to production** — the live
> site and production Firebase are untouched.

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

## 3. The demo (share this with Braydon)

- **Stable URL:** https://marketready-tours-demo.vercel.app
- **Admin login:** `marketreadytours@gmail.com` / `demo1234`
- **Tour access codes** (to test the guest rating flow): `1234` (Demo North) · `5678` (Demo South)
- Runs against an **isolated dev Firebase project** — nothing there touches real data.
- Emails/SMS are **suppressed** on the preview (and on localhost), so testing sends nothing real.

**How the demo backend works:** `index.html` picks the Firebase project by hostname —
`*.vercel.app` → the **`marketready-tours-dev`** project; the real domain → prod;
`localhost` → the local emulator. The stable URL is a Vercel alias re-pointed on each deploy:
```
URL=$(npx vercel --yes | grep -oE 'https://marketreadytours-[a-z0-9]+-abqeriks-projects.vercel.app')
npx vercel alias set "${URL#https://}" marketready-tours-demo.vercel.app
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

Also: **merge `firebase-shared-backend` → `main`** when ready.

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

- **Ship to prod** (section 5) + merge branch to main — biggest pending item.
- **Accepted v1 security tradeoffs** (documented): `mrt_favorites` anon writes aren't
  ownership-scoped (favorite tampering, low value); `mrt_ratings` is public-read (exposes
  voluntary rater names). Hardening = anonymous-auth scoping ("Approach C"), deferred.
- **Pre-existing, NOT introduced here** (`SECURITY_NOTES` Phase 1): `mrt_tours` and `admins` are
  world-readable (leak campaignContacts/notes/per-tour code, and the admin email list). Fix =
  split sensitive fields into `mrt_tours_private/<id>`.
- **Dead "Invite Campaign"** feature (Instantly.ai short-circuited; only email #1 of the drip
  ever sends). Mass-emailing agents has CAN-SPAM exposure — understand before using.
- **Root vs `www` drift** — always `cp index.html www/index.html` before committing/deploying.
- The QR share worker + Square/Netlify payment fn are the two things most likely to **not
  transfer cleanly** from Braydon — budget time to re-host/rebuild if needed.

---

## 8. Reference docs in this repo
- `SECURITY_NOTES.md` — the security hardening (Phase 0) detail + residual/Phase 1 items.
- `docs/superpowers/specs/2026-06-24-firebase-shared-backend-design.md` — feature design spec.
- `docs/superpowers/plans/2026-06-24-firebase-shared-backend.md` — implementation plan.
