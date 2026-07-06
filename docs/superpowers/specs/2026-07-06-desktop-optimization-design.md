# MarketReady Tours — Desktop Optimization (Design Spec)

**Date:** 2026-07-06
**Status:** Approved design, pre-implementation
**Author:** Erik (with Claude)

## Problem

The entire app is a single-file React app (`index.html`, ~14k lines of compiled
`React.createElement`) that was built **mobile-first with zero responsiveness**:
there are **no `@media` queries anywhere** in the file. Every screen renders its
own `minHeight:100vh` cream background with an inner **centered column**
(`maxWidth: 480`/`440`/`420`). On a laptop or desktop monitor, that narrow column
floats in a large expanse of empty cream — the app is usable but looks and
functions like a phone screen stretched onto a big display, wasting most of the
viewport.

Braydon has not committed to a desktop version yet, so whatever we build must be
**trivially reversible** and must not risk the mobile/iOS experience that is
already live.

## Goals

- On large viewports, the app uses the available width intentionally: dense
  screens breathe and reflow into grids; focused screens (forms, rating) widen
  and sit in a branded backdrop instead of empty cream.
- **The mobile experience is byte-for-byte unchanged.** No mobile user (phone,
  portrait tablet, or the Capacitor iOS app) sees a single changed pixel.
- **The same workflow, navigation, screen order, and controls** — a user
  familiar with the mobile app recognizes every screen in the same place and
  transitions cleanly. No new nav paradigms (no persistent side-nav, no two-pane).
- **Easy to switch off**: one constant reverts the entire desktop layer globally;
  a URL param lets Braydon A/B the two versions live without a redeploy.
- Both the **guest-facing flow** and the **admin screens** are covered.

## Non-goals (YAGNI for this pass)

- No persistent global chrome (top/side nav bar), no two-pane master/detail, no
  route/URL changes — those change the workflow and are explicitly out.
- No changes to the `React.createElement` app logic beyond (a) a `DESKTOP_MODE`
  toggle, (b) a one-line body-class effect, and (c) additive `className` hooks on
  a small set of containers. No behavior, state, data, or Firebase changes.
- No touching mobile layout, no changing the existing `maxWidth`/inline styles for
  the < 1024px case.
- No new fonts, colors, or brand system — reuse the existing `B` palette and
  Fraunces/Hanken Grotesk typography.

## Approach

All desktop styling is **additive CSS living in the single existing `<style>`
block**, gated two ways so it is inert unless explicitly active:

1. **Viewport gate** — every rule lives inside `@media (min-width: 1024px)`. Below
   1024px nothing changes, ever. Phones and portrait tablets keep the exact
   current app. The Capacitor iOS app runs at phone width, so it is automatically
   excluded.
2. **Class gate** — every rule is additionally scoped to `body.mrt-desktop`. A
   single constant controls whether that class is applied.

### The switch

```js
// near the top of the script, by the B palette
const DESKTOP_MODE = true;   // <- flip to false to fully disable desktop layer
```

On mount, `App` runs a one-line effect that resolves the active state and toggles
the class:

```js
useEffect(() => {
  const q = new URLSearchParams(location.search).get("desktop");
  const on = q === "1" ? true : q === "0" ? false : DESKTOP_MODE;
  document.body.classList.toggle("mrt-desktop", on);
}, []);
```

Result:
- `DESKTOP_MODE = false` → class never applied → whole layer inert → today's app
  at every width. **One-line global revert.**
- `?desktop=0` / `?desktop=1` → per-visit override for live A/B comparison, no
  redeploy needed.
- Any viewport < 1024px → layer inert regardless of the above.

### Why `!important`

The reflow rules must override inline styles (e.g. `style={{display:"flex"}}`) on
compiled elements. An author `!important` declaration in the stylesheet beats a
non-important inline style, so the desktop rules use `!important`. This is
scoped-loud CSS by necessity; it is contained entirely within the double-gated
block, so it cannot leak to mobile.

### className hooks

The compiled elements are almost all inline-styled with no class names. To let CSS
target the right containers, we add a small set of **stable, additive `className`
props** to key containers (the column wrapper, the card-list container per screen).
These are inert strings with no effect unless the double-gated CSS matches them.
Each addition is a surgical edit to a `createElement` call and must preserve paren
balance (run the parse-check after each).

## What the desktop layer does, screen by screen

**Global (all screens):** widen the centered column from ~480px to a comfortable
desktop measure; place content on a subtle branded backdrop rather than empty
cream; generous padding/margins.

**Reflow to multi-column (dense screens — helps, doesn't confuse):**
- **Dashboard tour list** — same tour cards, laid out as a responsive 2–3 column
  grid instead of one tall column.
- **Tour detail listings** — listings reflow to a 2-column grid; the tour
  header/summary stays full-width above. Tap-to-rate flow unchanged.
- **Rankings / summary** — widen, 2-column where it reads well.
- **Admin screens** (Sponsors manager, Team, Requests, Add Listing) — the largest
  win: list rows/cards use full width and become grids. Same controls, same order.

**Kept single-column (widened + framed only — multi-column would confuse a focused
task):**
- Public forms: List Home, Tour Sign Up, Sponsor signup, Contact.
- Rating flow, login, and modals (widened/centered modestly).

## Constraints / gotchas (from HANDOFF)

- **Root vs `www` drift:** after editing root `index.html`, `cp index.html
  www/index.html` before committing/deploying.
- **Parse-check after every edit** to the script region:
  `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"`
- CI gate `www/validate.js` runs an authoritative `new Function` parse check on push.
- Edit-tool gotchas: type literal emoji in `old_string`; the `·` (`\xB7`) escape
  won't match — edit around it.

## Verification

For each reflowed screen, verify in a browser (static `npm run serve` on :8080,
Playwright/`browser_navigate` works on the static server) at a desktop width
(≥1280px), comparing against the mobile baseline:
1. Desktop: content uses the width, grids reflow, nothing overlaps/overflows.
2. Resize to < 1024px (or `?desktop=0`): screen is pixel-identical to today.
3. `DESKTOP_MODE = false`: entire app reverts to today at all widths.
4. Parse-check passes; root and `www/index.html` in sync.

## Rollback

- Global: set `DESKTOP_MODE = false` (one line) and redeploy — additive, no data
  or logic touched.
- Full: revert the branch's desktop commits. All changes are additive CSS +
  className props + one toggle; nothing existing is removed or rewritten.
