# MarketReady Tours — Shared Firebase Backend (Design Spec)

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Author:** Erik (with Claude)

## Problem

The app is a single-file React app (`index.html`) backed by Firebase Realtime
Database (RTDB) project `marketready-tours`. Today, **only authenticated admins
write to Firebase** — every `fbWrite` is gated behind `isAnyAdmin`
(`index.html:13709, 13731, 13735, 13739`). Public users (agents touring homes)
mutate only their own browser state, which the next admin sync overwrites. This
causes the reported symptoms:

1. **Review counts are local-only.** A public rating updates the rater's browser
   but never reaches Firebase, so counts/averages aren't shared.
2. **Favorites are local-only.** Same cause.
3. **Sponsors show regardless of paid status.** Public sponsor signups can't
   persist (public can't write `mrt_tours`), and the public tour view renders all
   `tour.sponsors` with no `paid` filter (`index.html:7925, 8127`).

## Goals

- Public rating submissions persist and are visible to everyone (shared counts +
  averages).
- Public favorites persist and are shared (anonymous, one per browser).
- Public sponsors appear on the tour page **only after an admin marks them paid**;
  public signups persist as pending for admin review.
- A **safe local dev/test loop** that never touches the live production database
  or sends real emails.

## Non-goals (YAGNI for this pass)

- Anonymous Firebase Auth / per-user write scoping (future hardening, "Approach C").
- Reworking admin-only data (notes, tour CRUD, sub-admins) — unchanged.
- Fixing unrelated known bugs (reminder `tourDateMs` TDZ, dead Instantly campaign,
  root-vs-`www` file drift). Tracked separately.
- Reconciling the legacy dual tour-request channels.

## Pre-existing staged security pass (Phase A — ships FIRST)

The working tree already contains an **uncommitted, undeployed "Phase 0 security
hardening" pass** (documented in `SECURITY_NOTES.md`) that overlaps our files. Per
decision 2026-06-24, we **keep it as the baseline and ship it first** as a separate,
smaller deploy, then build the feature (Phase B, this spec) on top.

Staged artifacts (all uncommitted):
- `database.rules.json` — hardened RTDB rules draft (default-deny root; `admins` /
  `mrt_subadmins` / `mrt_settings` writes locked to super-admin; `mrt_tours` write
  requires auth; create-only public intake). **This is the file our new paths get
  added to** — not the looser live rules.
- `storage.rules` — hardened Storage rules; **already allows guest `mrt_rating_photos`
  uploads**, so our rating-photo flow is covered.
- `firebase.json` (database+storage rules pointers; **no emulator block yet — we add
  one**) + `.firebaserc` (project `marketready-tours`).
- `vercel.json` — security headers + CSP. Its `connect-src` already whitelists
  `https://*.firebaseio.com` + `wss://*.firebaseio.com`, so **our new writes are
  already CSP-allowed**. (CSP must be verified against a real session before prod.)
- `index.html` + `www/index.html` — XSS escaping (`esc()`/`jsId()`) + SRI hashes.

Phase A = review + emulator-test + commit + deploy (rules via console/CLI, code via
Vercel), verify live. Phase B (this spec) then builds on the deployed baseline.

## Deploy/source reality (verified 2026-06-24)

- Live `marketreadytours.com` is served by **Vercel** (Cloudflare CDN in front),
  serving **root `index.html`** (`vercel.json` outputDirectory `.`). `www/index.html`
  is **not deployed** and is stale (60KB smaller) — ignore it for the live site.
- **No JSX `text/babel` source exists** in the repo; both files are already compiled
  `React.createElement`. `build.js` is effectively dead. **Edits are made directly to
  the compiled JS in root `index.html`.**

## Current production facts (verified 2026-06-24)

- `mrt_tours` is a **30-element array** of real tours; tour id (`tour.id`, stable
  string like `tour-1772832237838`) and listing id are stable keys.
- Tours use `code` (4-digit gate) on all 30 (`accessCode` appears on 1 legacy tour
  — ignore). Sponsors already carry `paid`, `paymentPlan`, `tourLead`, `email`,
  `logo`, `headshot`, `tourLead`.
- `ratings`/`ratingSubmissions`/`favorites` are **sparse inline fields** on tours
  (only 4/5 tours have them) — confirming they only persist on admin writes.
- Project is on the **Blaze** (metered) plan. Design stays within free-tier usage.

### Existing security rules (relevant excerpt)

```
mrt_tours:            .read true,  .write auth!=null   (sub ratings/favorites/notes redundant auth!=null)
mrt_listing_requests: .read auth,  .write true         (public write convention)
mrt_tour_requests:    .read auth,  .write true
mrt_not_interested:   .read auth,  .write true
mrt_tour_previews:    .read true,  .write auth!=null
admins:               .read true,  .write auth!=null
$other:               deny / deny                       (new paths blocked until ruled)
```

## Approach (chosen: "A — granular paths + merge-on-read")

Public contributions write to **new, stable-id-keyed, top-level paths**, never to
the monolithic `mrt_tours` array. The app reads those paths and merges them into
the in-memory tour for display, so admins and public see identical data. This
mirrors the existing `mrt_listing_requests` public-write pattern and avoids races
on the big tours blob. (Rejected: B = let public write `mrt_tours` — clobbers
admin edits via stale array indices; C = anonymous-auth scoping — overkill now.)

### New RTDB paths

```
mrt_ratings/<tourId>/<listingId>/<submissionId> = {
  ratings: {<catKey>: 0..5, ...}, suggestions, sugPrice, pricedRight,
  raterName, photoCount, photoUrls, submittedAt
}
mrt_favorites/<tourId>/<listingId>/<userKey> = true   // userKey = stable anon UUID in localStorage
mrt_sponsor_signups/<tourId>/<signupId> = {
  name, contactName, email, phone, url, tagline,
  paymentPlan, paid:false, tourLead:false, createdAt
}
```

`mrt_ratings` becomes the **single source of truth** for review counts/averages,
replacing the current dual `tour.ratings` (last-write-wins) vs
`tour.ratingSubmissions` (array) split. This also fixes the Ranking-vs-Summary
disagreement and the stale "7 categories" copy.

### Rules to ADD (into `database.rules.json`, the hardened draft — additive)

```json
"mrt_ratings": {
  ".read": true,
  "$tour_id": { "$listing_id": { "$submission_id": {
    ".write": "auth != null || (!data.exists() && newData.exists())",
    ".validate": "newData.hasChildren(['ratings','submittedAt'])"
  } } }
},
"mrt_favorites": {
  ".read": true,
  "$tour_id": { "$listing_id": { "$user_key": {
    ".write": true,
    ".validate": "newData.isBoolean() || !newData.exists()"
  } } }
},
"mrt_sponsor_signups": {
  ".read": "auth != null",
  "$tour_id": { "$signup_id": {
    ".write": "auth != null || !data.exists()",
    ".validate": "newData.hasChildren(['name','email'])"
  } } }
}
```

- Ratings: public **create-only** (no overwrite/delete); admins may moderate.
  Public read enables shared counts.
- Favorites: public toggle (create/delete) of their own anon key; public read for
  counts. Accepted v1 risk: anonymous keys aren't ownership-verified, so a
  malicious user could toggle another key — low value, noted.
- Sponsor signups: public **create-only**, **admin-read-only** (pending signups
  stay private). Paid sponsors become public only after promotion into
  `mrt_tours[].sponsors` (already public-read).

## Code changes (`index.html` source, then `node www/build.js`)

1. **Anon user key** — add `mrtUserKey()` helper: read/create a UUID in
   `localStorage["mrt_uid"]`. Used for favorites.
2. **Rating submit (`RatingPage` → `handleRatingSubmit`, ~1469 / ~5963)** — write
   the submission via scoped REST PUT to
   `mrt_ratings/<tourId>/<listingId>/<submissionId>` for **all users** (reuse the
   unauthenticated REST-PUT pattern at `index.html:11320`). Keep the existing
   email send. Stop relying on the admin-only `tour.ratings` write.
3. **Read + merge ratings (`App`, ~13639)** — add an `_fb.ref("mrt_ratings")`
   listener (admins) / poll (public) into new `ratings` state. Derive per-listing
   count + per-category averages from it. Point `RankingPage`, `SummaryDashboard`,
   and any count badge at this derived data. Drive category list from `RATING_CATS`
   (kill the hardcoded inline list at ~2278 and "7 categories" at ~2100).
4. **Favorites** — `toggleFavorite` writes/removes
   `mrt_favorites/<tourId>/<listingId>/<userKey>` via REST for all users; favorite
   count/among reads from merged `mrt_favorites` state (new listener/poll).
5. **Sponsor signup (`SponsorSignupPage` onSubmit, ~13030/13912)** — public submit
   writes to `mrt_sponsor_signups/<tourId>/<id>` (REST), not `tour.sponsors`.
6. **Sponsor admin (`TourSponsorsModal`)** — load pending signups from
   `mrt_sponsor_signups/<tourId>`; "Mark as Paid" promotes a signup into
   `tour.sponsors` with `paid:true` (admin write to `mrt_tours`), and clears the
   pending entry.
7. **Public sponsor visibility** — add `.filter(sp => sp.paid)` to the two public
   render sites (`index.html:7925, 8127`). Admin manager still shows all.

## Local dev / test harness (Firebase Emulator Suite)

Production is live with real PII and real outbound emails, so **all dev/testing
runs against local emulators**, never prod.

- `firebase.json` already exists (rules pointers); **add an `emulators` block** for
  **Auth + Database** (+ Storage if we test photo upload). `.firebaserc` already set.
- **Emulator connect shim** in `index.html`: when
  `location.hostname === "localhost"`, call `_fb.useEmulator(...)` /
  `_fbAuth.useEmulator(...)` before first use. Production hostname → real Firebase,
  untouched.
- **Email guard:** `sendCFEmail` (and `sendSMS`) short-circuit on localhost (log
  instead of POST) so no real agent is emailed during tests.
- **Seed data:** a synthetic `seed.json` (a few fake tours/listings/sponsors — no
  real PII) imported into the DB emulator on start. Erik's prod export is his
  backup only; it is **not** read into the repo.
- **Run loop:** `npm run dev` = `node www/build.js` (compile JSX) + serve compiled
  `index.html` on a fixed localhost port + start emulators. Erik tests in Safari.
  Auth emulator auto-trusts localhost; create a test admin + test public session.

## Acceptance test (two browser sessions on localhost emulator)

1. Public (incognito) submits a rating → admin tab's review count/average updates.
2. Public favorites a listing → count is shared across both sessions.
3. Public submits a sponsor signup → **not** shown on public tour page → admin
   sees it pending → "Mark as Paid" → it appears on the public tour page.
4. Reload both sessions → all of the above persist (from the emulator DB).
5. Confirm **no** network POST to the real `sendemail` endpoint fired (email guard).

## Rollout (prod) — two phases, security first

**Phase A — ship the staged security pass (separate, smaller deploy):**
1. Erik exports prod RTDB (backup).
2. Review staged changes; emulator-test that the hardened rules don't break the
   guest flow (open tour, submit a listing request, etc.).
3. Commit the staged work.
4. Deploy: `database.rules.json` + `storage.rules` (paste into console, or
   `firebase deploy --only database,storage`) **and** the code (`vercel.json` CSP +
   index.html XSS/SRI) to Vercel. **Verify CSP against a real session.**
5. Smoke-test live: login, open a tour, submit a request — confirm nothing broke.

**Phase B — ship the shared-backend feature (this spec) on the deployed baseline:**
1. Add the 3 new rule blocks to `database.rules.json`; deploy rules.
2. Merge feature code into root `index.html`; deploy to Vercel.
3. Optional one-time migration of existing inline ratings/favorites.
4. Smoke-test the acceptance flow against prod with a throwaway tour.
5. Roll back = remove the 3 rule blocks + revert deploy (additive, reversible).

## Risks / open items

- **Anonymous favorite tampering** — accepted for v1; revisit with Approach C if abused.
- **`mrt_ratings` public read** exposes voluntary `raterName`/suggestions — low
  sensitivity; flagged.
- **Migration of existing inline ratings/favorites** (4–5 tours) into the new paths
  — one-time script during rollout, or accept that historical counts start fresh.
  Decision needed: migrate vs. start-fresh. **Default: migrate** the handful that exist.
- **Root `index.html` vs `www/index.html` drift** — confirm which is the deploy
  source before editing so changes land in the served file.
