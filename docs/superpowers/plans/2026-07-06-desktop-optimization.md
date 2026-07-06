# Desktop Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MarketReady Tours use desktop viewport width intelligently (widened columns + grid reflow) while leaving the mobile/iOS experience byte-for-byte unchanged and keeping the whole layer switchable off by one constant.

**Architecture:** A single additive CSS layer in the existing `<style>` block, double-gated by `@media (min-width:1024px)` AND a `body.mrt-desktop` class. A `DESKTOP_MODE` constant + a one-line effect apply the class (with a `?desktop=0/1` URL override). Screens get small, inert `className` hooks; card lists get layout-transparent wrapper divs (`display:contents` at base, `display:grid` on desktop) so mobile layout is provably identical.

**IMPORTANT — global width authority (discovered during Task 1 verification):** `App()` wraps EVERY screen in one shared shell div — `React.createElement("div", { style: { maxWidth: 480, margin: "0 auto", minHeight: "100vh" } }, ...)` (the main shell at ~line 14038; a near-identical auth-loading skeleton at ~line 13960). This `maxWidth: 480` caps the whole app, so per-screen `maxWidth` columns cannot exceed it. Therefore widening is two-layer: **`mrt-shell`** on that shared shell lifts the 480 cap on desktop (the expander), and per-screen **`mrt-col`** is a *constraint* that keeps single-column content readable (~720px) inside the now-wide shell. Grid screens use wider inner caps (`mrt-dash-col` / `mrt-detail-col` / `mrt-admin-col`) plus the `mrt-list` grid wrapper.

**Tech Stack:** React 18 via CDN as compiled `React.createElement` (no JSX), single-file `index.html` (~14k lines), plain CSS. No build step, no new dependencies.

## Global Constraints

- **Mobile is untouched.** Nothing may change at viewport width < 1024px, ever. Every desktop rule lives inside `@media (min-width:1024px){ body.mrt-desktop ... }`.
- **No workflow/nav/route/state changes.** Only additive CSS, `className` props, layout-transparent wrapper divs, the `DESKTOP_MODE` toggle, and its body-class effect.
- **Reuse existing brand.** Palette object `B` (navy `#1B3A6B`, gold `#C9A55A`, cream `#F7F4EF`, paper `#FFFDFA`), fonts Fraunces (display) + Hanken Grotesk (body). No new fonts/colors.
- **Breakpoint = `1024px`.** Desktop + landscape tablets get the layer; phones + portrait tablets + the Capacitor iOS app (phone width) do not.
- **Parse-check after every script edit:** `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"` → must print `parse OK`.
- **Keep root and www in sync:** after finishing edits in a task, `cp index.html www/index.html` before committing.
- **Edit-tool gotchas:** type literal emoji in `old_string`; the `·` (`\xB7`) escape won't match — edit around it. Adding a `className` to an element that already has a `style` prop is a pure key addition (no new nesting, no paren risk). Wrapping a `.map(...)` in a new div IS a nesting change — recount parens and run the parse-check.

## Local verification harness (used by every task)

The dashboard/admin screens need data to see reflow. Firebase is not required — the app reads tours from `localStorage` key `mrt_tours` (writes are gated behind a session, reads are not). Serve statically and seed localStorage:

```bash
# from repo root
python3 -m http.server 8000    # static server; Firebase errors are caught & ignored
```

Seed fixture (run in the browser console or via Playwright `browser_evaluate` before reload):

```js
localStorage.setItem("mrt_tours", JSON.stringify([
  {id:"t1",name:"North Scottsdale",emoji:"🌵",color:"#0D0D0D",date:"2026-08-01",time:"10:00 AM",code:"1234",
   listings:[{order:0,address:"123 Palm Dr",agentName:"A",agentEmail:"a@x.com",beds:4,baths:3,sqft:2600,price:900000},
             {order:1,address:"456 Cactus Way",agentName:"B",agentEmail:"b@x.com",beds:3,baths:2,sqft:2100,price:720000},
             {order:2,address:"789 Mesa Rd",agentName:"C",agentEmail:"c@x.com",beds:5,baths:4,sqft:3400,price:1250000}],
   ratings:{},favorites:{},sponsors:[]},
  {id:"t2",name:"South Chandler",emoji:"☀️",color:"#2D6A4F",date:"2026-08-08",time:"1:00 PM",code:"5678",
   listings:[{order:0,address:"12 Sun Ct",agentName:"D",agentEmail:"d@x.com",beds:4,baths:3,sqft:2800,price:850000}],
   ratings:{},favorites:{},sponsors:[]},
  {id:"t3",name:"East Mesa",emoji:"🏜️",color:"#9B1C1C",date:"2026-08-15",time:"9:00 AM",code:"9012",
   listings:[],ratings:{},favorites:{},sponsors:[]}
]));
location.reload();
```

**Every task's visual check is the same three-way comparison:**
1. **Desktop (1280px)** — content uses the width / grids reflow / nothing overlaps or overflows horizontally.
2. **Mobile (390px, or `?desktop=0`)** — screen is pixel-identical to `git stash`'d baseline (spot-check: same single column, same spacing).
3. **Off switch (`DESKTOP_MODE=false`)** — desktop width renders exactly like today.

Playwright/`browser_navigate` works against this static server (per project notes). Take screenshots at 1280px and 390px for each screen.

---

### Task 1: Toggle infrastructure + base desktop CSS (proof on Contact screen)

Stands up the whole mechanism and proves it end-to-end on one simple single-column screen (Contact). No reflow yet — just the switch, the column-widening hook, and the light desktop frame.

**Files:**
- Modify: `index.html` — script region near `const B = {` (~line 165); `App()` effect region (~line 13632); `<style>` block (before `</style>`, ~line 76); `ContactPage` (~line 12893).
- Sync: `www/index.html`.

**Interfaces:**
- Produces:
  - Constant `DESKTOP_MODE` (boolean) near palette `B`.
  - Body class `mrt-desktop` applied on mount when active.
  - CSS hook class `mrt-col` — add to a screen's primary centered column to widen + lightly frame it on desktop. Inert on mobile.
  - CSS hook class `mrt-list` + per-screen modifier (e.g. `mrt-list-tours`) — wrapper convention defined here, used by later reflow tasks: `display:contents` at base (layout-transparent), `display:grid` on desktop.

- [ ] **Step 1: Add the `DESKTOP_MODE` constant.** After the `B` palette object closes (`};` at ~line 184), insert:

```js
// ── DESKTOP LAYER TOGGLE ──────────────────────────────────────────────
// true  → desktop CSS layer active (>=1024px only; mobile/iOS never affected).
// false → layer fully inert everywhere (one-line revert to the mobile-only app).
// URL override for live A/B without redeploy: ?desktop=1 forces on, ?desktop=0 forces off.
const DESKTOP_MODE = true;
```

- [ ] **Step 2: Apply the body class from `App`.** Inside `function App()`, add a dedicated effect (place it next to the existing `React.useEffect` for hashchange, ~line 13632):

```js
React.useEffect(() => {
  const q = new URLSearchParams(window.location.search).get("desktop");
  const on = q === "1" ? true : q === "0" ? false : DESKTOP_MODE;
  document.body.classList.toggle("mrt-desktop", on);
}, []);
```

- [ ] **Step 3: Run the parse-check.**

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 4: Add the base desktop CSS.** Insert immediately before `</style>` (~line 77):

```css
/* ══ DESKTOP LAYER (>=1024px AND body.mrt-desktop only) ═══════════════════
   Everything here is double-gated: it cannot affect phones, portrait tablets,
   or the Capacitor iOS app (all < 1024px), and DESKTOP_MODE=false removes the
   body class so none of it applies at any width. ════════════════════════ */
/* Layout-transparent list wrapper: invisible to layout at base width (cards
   stay direct children of their original parent → mobile is identical). */
.mrt-list{display:contents}
@media (min-width:1024px){
  /* Shell: lifts the app-wide 480 cap so screens can use desktop width. */
  body.mrt-desktop .mrt-shell{ max-width:1200px !important; }
  /* Inner single-column constraint: keeps forms/reading readable inside the
     now-wide shell. Meaningful ONLY because .mrt-shell widened the parent. */
  body.mrt-desktop .mrt-col{
    max-width:720px !important;      /* readable single-column measure */
    margin-left:auto !important; margin-right:auto !important;
  }
  /* generic grid behavior for any reflowed list; per-screen tasks tune columns */
  body.mrt-desktop .mrt-list{
    display:grid !important;
    grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
    gap:20px !important;
    align-items:start;
  }
}
```

- [ ] **Step 4b: Hook the shared App shell (the width authority).** In `App()`, add `className: "mrt-shell"` to the main shell wrapper — the `React.createElement("div", { style: { maxWidth: 480, margin: "0 auto", minHeight: "100vh" } }, ...)` that returns the whole app (~line 14038) — and to the near-identical auth-loading skeleton wrapper (~line 13960). Add `className` as a new key beside the existing `style` (pure key addition, no paren change). Locate both with `grep -n "maxWidth: 480" index.html` and confirm each is the `margin: "0 auto"` + `minHeight: "100vh"` shell (NOT a nav/inner element). Parse-check after.

- [ ] **Step 5: Hook the Contact screen column.** In `ContactPage` (~line 12893), find its primary centered column — the `React.createElement("div", { style: { ... maxWidth: <n> ... } }, ...)` that wraps the form content — and add `className: "mrt-col"` to that props object (keep the existing `style`). Example transform:

```js
// before
React.createElement("div", { style: { maxWidth: 480, margin: "0 auto", ... } },
// after
React.createElement("div", { className: "mrt-col", style: { maxWidth: 480, margin: "0 auto", ... } },
```

- [ ] **Step 6: Parse-check.** Same command as Step 3 → `parse OK`.

- [ ] **Step 7: Visual verification (three-way).** `python3 -m http.server 8000`; open `http://localhost:8000/#/contact`.
  - 1280px + `DESKTOP_MODE=true`: Contact form column is wider (~720px), centered, framed on cream; no horizontal scrollbar.
  - 390px (or `?desktop=0`): identical to baseline single column.
  - Set `DESKTOP_MODE=false`, reload at 1280px: renders like today (narrow column). Restore to `true`.

- [ ] **Step 8: Sync www + commit.**

```bash
cp index.html www/index.html
git add index.html www/index.html docs/superpowers/plans/2026-07-06-desktop-optimization.md
git commit -m "feat(desktop): toggle infra + base desktop CSS layer; widen Contact column"
```

---

### Task 2: Widen the remaining single-column screens

Adds the `mrt-col` hook to every screen that should stay single-column but wider on desktop. No reflow, no wrappers — pure `className` additions (paren-safe).

**Files:**
- Modify: `index.html` — the primary centered column of each: `LoginPage` (~776), `RatingPage` (~1299), `RequestListingPage` "List Home" (~11303), `RequestATourInlineForm` / tour-signup (~9169), `SponsorSignupPage` (~13150), `NotInterestedPage` (~5491).
- Sync: `www/index.html`.

**Interfaces:**
- Consumes: `mrt-col` class + `DESKTOP_MODE` from Task 1.

- [ ] **Step 1: Hook each screen's primary column.** For each component above, locate its outermost centered content column (the `createElement("div", {style:{... maxWidth ... margin:"0 auto" ...}}, ...)` directly inside the screen's full-height background) and add `className: "mrt-col"` to that props object. If a screen already has a `className` on that div (e.g. a `fade-in`), append: `className: "fade-in mrt-col"`. Do NOT add it to inner cards — only the one primary column per screen.

Locate each with, e.g.:
```bash
awk 'NR>=1299 && NR<=2079' index.html | grep -nE "maxWidth|margin: ?.0 auto|className"   # RatingPage
```

- [ ] **Step 2: Parse-check after each edit** (command from Task 1 Step 3) → `parse OK`.

- [ ] **Step 3: Visual verification.** Serve; visit each route and do the three-way check:
  - Login `#/` (logged out), Rating (open a tour → rate a listing), List Home `#/request`, Tour Sign Up `#/tour-signup`, Sponsor `#/sponsor-signup`, Not-Interested `#/not-interested`.
  - Desktop: each is a wider (~720px) centered column, comfortable, no overflow.
  - Mobile / `?desktop=0`: identical to baseline.

- [ ] **Step 4: Sync www + commit.**

```bash
cp index.html www/index.html
git add index.html www/index.html
git commit -m "feat(desktop): widen single-column screens (login, rating, public forms)"
```

---

### Task 3: Dashboard tour list → responsive grid

Reflows the tour cards into a multi-column grid on desktop using the `display:contents` wrapper convention.

**Files:**
- Modify: `index.html` — `ToursDashboard` (~9613): main column (`maxWidth: 420`, ~line 9748) and the `filtered.map(tour => {...})` render (~line 10437).
- Sync: `www/index.html`.

**Interfaces:**
- Consumes: `mrt-col`, `mrt-list` convention from Task 1.
- Produces: modifier class `mrt-list-tours` (grid tuned for tour cards).

- [ ] **Step 1: Widen the dashboard column.** Add `className: "mrt-col"` to the main dashboard column props (the `maxWidth: 420` div at ~line 9748; append if a className already exists). But the tour grid should be wider than a reading column — so ALSO add a dashboard-specific override in Step 4 that lets it exceed 720px.

- [ ] **Step 2: Wrap the tour-card map in a layout-transparent grid wrapper.** The cards are produced by `filtered.map(tour => { ... return React.createElement("div", { key: tour.id, className: "card-hover", ... }); })` (~line 10437). Wrap that entire `.map(...)` expression in a new div:

```js
// before:  ..., filtered.map(tour => { ...; return React.createElement("div", {...}); }))
// after:   ..., React.createElement("div", { className: "mrt-list mrt-list-tours" }, filtered.map(tour => { ...; return React.createElement("div", {...}); })))
```

Add exactly one `React.createElement("div", { className: "mrt-list mrt-list-tours" }, ` before `filtered.map` and one extra `)` after the map's closing `)`. Recount parens.

- [ ] **Step 3: Parse-check** → `parse OK`. (If it fails, the wrapper paren balance is off — fix before proceeding.)

- [ ] **Step 4: Add the dashboard grid CSS.** Append inside the existing `@media (min-width:1024px){ body.mrt-desktop ... }` block (add new rules; do not alter Task 1 rules):

```css
  body.mrt-desktop .mrt-dash-col{ max-width:1120px !important; }
  body.mrt-desktop .mrt-list-tours{
    grid-template-columns:repeat(auto-fill,minmax(340px,1fr)) !important;
    gap:22px !important;
  }
```

Then change the dashboard column class from Step 1 to `className: "mrt-col mrt-dash-col"` so the grid gets the wider measure (the `.mrt-dash-col` override beats the 720px `.mrt-col` rule).

- [ ] **Step 5: Visual verification (three-way).** Seed the fixture (harness section) so ≥3 tours show; open `http://localhost:8000/#/`.
  - Desktop 1280px: tour cards form a 2–3 column grid, even gaps, aligned tops; clicking a card still opens the tour (`#/tour/<id>`).
  - 390px / `?desktop=0`: identical single column, same vertical spacing as baseline (the `display:contents` wrapper is invisible).
  - `DESKTOP_MODE=false` at 1280px: single column like today.

- [ ] **Step 6: Sync www + commit.**

```bash
cp index.html www/index.html
git add index.html www/index.html
git commit -m "feat(desktop): dashboard tour list reflows to responsive grid"
```

---

### Task 4: Tour detail listings → 2-column grid

Reflows the guest-facing listing cards in `TourDetailPage`; header/summary stay full-width above.

**Files:**
- Modify: `index.html` — `TourDetailPage` (~6013): main column (`maxWidth: 480`, ~6632) and the guest listing-card `.map` render.
- Sync: `www/index.html`.

**Interfaces:**
- Consumes: `mrt-col`, `mrt-list` convention.
- Produces: modifier class `mrt-list-listings`.

- [ ] **Step 1: Locate the guest listing-card map.** The sorted listings are `const sorted = [...(tour.listings || [])].sort((a,b)=>a.order-b.order)` (~line 6624) and rendered via a `.map`. Find the render map (not the admin/reorder map):

```bash
awk 'NR>=6624 && NR<=7560' index.html | grep -nE "sorted\.map|\.map\(l |\.map\(listing|\.map\(\(l"
```

Confirm it returns the per-listing card `createElement("div", {...})`.

- [ ] **Step 2: Widen the tour-detail column.** Add `className: "mrt-col mrt-detail-col"` to the main column props (`maxWidth: 480` at ~6632; append if a className exists).

- [ ] **Step 3: Wrap the listing-card map** in `React.createElement("div", { className: "mrt-list mrt-list-listings" }, <the .map expression> )` — one opening wrapper before the map, one extra `)` after. Recount parens.

- [ ] **Step 4: Parse-check** → `parse OK`.

- [ ] **Step 5: Add the tour-detail grid CSS** inside the `@media` block:

```css
  body.mrt-desktop .mrt-detail-col{ max-width:1000px !important; }
  body.mrt-desktop .mrt-list-listings{
    grid-template-columns:repeat(auto-fill,minmax(360px,1fr)) !important;
    gap:20px !important;
  }
```

- [ ] **Step 6: Visual verification (three-way).** Seed fixture; open `http://localhost:8000/#/tour/t1` (3 listings).
  - Desktop: header/summary full-width on top; listing cards in a 2-column grid below; tap-to-rate still navigates to the rating flow; Directions/other buttons intact.
  - 390px / `?desktop=0`: identical single column.
  - `DESKTOP_MODE=false`: like today.

- [ ] **Step 7: Sync www + commit.**

```bash
cp index.html www/index.html
git add index.html www/index.html
git commit -m "feat(desktop): tour detail listings reflow to 2-column grid"
```

---

### Task 5: Rankings + Summary → widen and reflow

**Files:**
- Modify: `index.html` — `RankingPage` (~2079) and `SummaryDashboard` (~2250): primary columns and, where they render a list/grid of ranked items or stat cards, apply the wrapper convention.
- Sync: `www/index.html`.

**Interfaces:** Consumes `mrt-col`, `mrt-list` convention. Produces `mrt-list-ranking`, `mrt-list-summary` as needed.

- [ ] **Step 1: Widen both columns.** Add `className: "mrt-col"` to the primary centered column of `RankingPage` and of `SummaryDashboard`. Locate with:

```bash
awk 'NR>=2079 && NR<=2250' index.html | grep -nE "maxWidth|margin: ?.0 auto|className"   # RankingPage
awk 'NR>=2250 && NR<=2414' index.html | grep -nE "maxWidth|margin: ?.0 auto|className"   # SummaryDashboard
```

- [ ] **Step 2: (If a natural card/stat list exists) wrap it** using the `mrt-list mrt-list-summary` (or `-ranking`) convention exactly as in Task 3 Step 2. If a screen is a single narrow reading layout with no repeating cards, skip the wrapper for it and rely on `mrt-col` widening only. Recount parens; parse-check.

- [ ] **Step 3: Add CSS** (only if a wrapper was added), inside the `@media` block, e.g.:

```css
  body.mrt-desktop .mrt-list-summary{
    grid-template-columns:repeat(auto-fill,minmax(280px,1fr)) !important;
    gap:18px !important;
  }
```

- [ ] **Step 4: Parse-check** → `parse OK`.

- [ ] **Step 5: Visual verification (three-way).** Seed fixture; from a tour open Rankings and Summary (via the tour detail's ranking/summary subpages).
  - Desktop: wider, readable, any card set reflows cleanly; numbers/stars intact.
  - 390px / `?desktop=0`: identical.
  - `DESKTOP_MODE=false`: like today.

- [ ] **Step 6: Sync www + commit.**

```bash
cp index.html www/index.html
git add index.html www/index.html
git commit -m "feat(desktop): rankings + summary widen/reflow on desktop"
```

---

### Task 6: Admin screens → full-width lists/grids

Sponsors manager, Team, and Requests (listing + tour) — the biggest desktop win. Same controls, same order.

**Files:**
- Modify: `index.html` —
  - `SponsorsPage` (~8733): main column + `sponsors.map((sp, idx) => ...)` (~9046).
  - `TeamPage` (~10660): main column + `(subAdmins || []).map(u => ...)` (~11100).
  - `ListingRequestsAdmin` (~12073): main column + listing map `visibleRequests.map(req => {` (~12580) and tour-request map `(tourRequests || []).filter(...).map(req => ...)` (~12414).
  - `AddListingForm` (~3867): keep single-column (form) — apply `mrt-col` widening only, no grid.
- Sync: `www/index.html`.

**Interfaces:** Consumes `mrt-col`, `mrt-list` convention. Produces `mrt-list-sponsors`, `mrt-list-team`, `mrt-list-requests`.

- [ ] **Step 1: Widen each admin column.** Add `className: "mrt-col mrt-admin-col"` to the primary column of `SponsorsPage`, `TeamPage`, `ListingRequestsAdmin`, and `AddListingForm` (append to existing className if present).

- [ ] **Step 2: Wrap the admin list maps** (Sponsors, Team, both Requests maps) each in `React.createElement("div", { className: "mrt-list mrt-list-<name>" }, <map> )` per the Task 3 convention. `AddListingForm` gets NO wrapper (stays single column). Recount parens after each wrap.

- [ ] **Step 3: Parse-check after each wrap** → `parse OK`.

- [ ] **Step 4: Add admin CSS** inside the `@media` block:

```css
  body.mrt-desktop .mrt-admin-col{ max-width:1080px !important; }
  body.mrt-desktop .mrt-list-sponsors,
  body.mrt-desktop .mrt-list-team,
  body.mrt-desktop .mrt-list-requests{
    grid-template-columns:repeat(auto-fill,minmax(320px,1fr)) !important;
    gap:18px !important;
  }
```

- [ ] **Step 5: Visual verification (three-way).** Log in as admin (Firebase not available locally → if login is blocked offline, verify these screens against the dev preview `https://marketready-tours-demo.vercel.app` with `?desktop=1`/`?desktop=0`, admin `marketreadytours@gmail.com` / `demo1234`). For each admin screen:
  - Desktop: rows/cards use full width as a grid; all buttons (edit/delete/approve/mark-paid) work; nothing overflows.
  - Mobile / `?desktop=0`: identical single column.
  - `AddListingForm`: wider single column, not gridded.

- [ ] **Step 6: Sync www + commit.**

```bash
cp index.html www/index.html
git add index.html www/index.html
git commit -m "feat(desktop): admin screens (sponsors/team/requests) reflow; widen add-listing"
```

---

### Task 7: Full sweep, off-switch proof, and polish

Confirms the guarantees hold globally and tunes any rough edges found.

**Files:**
- Modify: `index.html` (CSS tweaks only, if needed).
- Sync: `www/index.html`.

- [ ] **Step 1: Off-switch proof.** Set `DESKTOP_MODE = false`. Serve; at 1280px walk every screen (dashboard, tour detail, rating, rankings, summary, all forms, all admin). Each must render exactly like the pre-project baseline (compare to `git stash` of the original if unsure). Restore `DESKTOP_MODE = true`.

- [ ] **Step 2: Mobile-parity proof.** At 390px, walk every screen with `DESKTOP_MODE = true`. Each must be identical to baseline (the layer is fully gated out below 1024px). Confirm no horizontal scrollbars anywhere.

- [ ] **Step 3: URL-override proof.** At 1280px, append `?desktop=0` to a couple of routes → mobile layout; `?desktop=1` → desktop layout. Confirms Braydon's live A/B works.

- [ ] **Step 4: Desktop polish pass.** At 1280px and 1680px, scan every screen for: orphaned wide elements, off-center content, oversized hero/photo blocks, modals that look lost when centered. Fix only via CSS inside the `@media` block (e.g. cap a hero image width, center a stray element). No mobile-affecting edits.

- [ ] **Step 5: Parse-check + final drift check.**

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"` → `parse OK`
Run: `cp index.html www/index.html && diff -q index.html www/index.html && echo "in sync"` → `in sync`

- [ ] **Step 6: Commit.**

```bash
git add index.html www/index.html
git commit -m "feat(desktop): final sweep — off-switch + mobile-parity verified, desktop polish"
```

---

## Self-Review

**Spec coverage:**
- Toggle constant + body class + `?desktop` override → Task 1. ✓
- Double-gated CSS (`@media` + `body.mrt-desktop`) → Task 1 base CSS, all screen tasks append inside it. ✓
- Mobile byte-for-byte unchanged → `display:contents` wrapper convention (Task 1) + off/parity proofs (Task 7). ✓
- Widen single-column screens (forms, rating, login) → Tasks 1, 2. ✓
- Reflow dashboard / tour detail / rankings+summary → Tasks 3, 4, 5. ✓
- Admin reflow (sponsors, team, requests, add-listing) → Task 6. ✓
- Keep forms/rating/login single-column → Tasks 1, 2 (no wrappers). ✓
- Root/www sync + parse-check → every task + Task 7. ✓
- Easy off (constant) + live A/B (URL) → Task 1 + Task 7 proofs. ✓

**Placeholder scan:** All CSS, JS, className strings, and commands are given verbatim. Anchors that must be located at execution time (because line numbers drift as the file is edited) are paired with exact `awk`/`grep` commands and the exact edit to make. No "TBD"/"handle edge cases".

**Type/name consistency:** Class names are consistent throughout — `mrt-desktop` (body), `mrt-col` (widen), `mrt-list` + modifiers `mrt-list-tours` / `mrt-list-listings` / `mrt-list-summary` / `mrt-list-ranking` / `mrt-list-sponsors` / `mrt-list-team` / `mrt-list-requests`, and column-width overrides `mrt-dash-col` / `mrt-detail-col` / `mrt-admin-col`. Constant `DESKTOP_MODE` used identically in Task 1 Steps 1–2 and Task 7 proofs.
