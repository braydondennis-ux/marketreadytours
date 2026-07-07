# Handoff: MarketReady Tours — Visual Refinement (Direction A "Quiet Luxury")

_Source: Claude Design project cfa32c83-db6e-4d5b-a965-c08c0535eb15,
file `design_handoff_marketready_tours_refresh/README.md`. Tokens in `./design-tokens.css`._

## Overview
Refine the visual design of **MarketReady Tours** to a **premium, cohesive brokerage-tool feel**
while keeping the exact workflow, screen inventory, and brand identity. Nothing about the flow,
screen order, or meaning changes — look-and-feel elevation only, screen by screen, for
**mobile (~390px)** and **desktop (~1280px)**.

App name: **MarketReady Tours** (MarketReady alone = parent company). Wordmark:
`MARKET`(navy) `READY`(gold) `TOURS`(ink), tagline **TOUR · RATE · DECIDE**.

## About the design files
`MarketReady Refinement.dc.html` is a **design reference in HTML** (a canvas board stacking all 12
screens as labelled sections, each in a phone frame + browser frame). It is **NOT production code to
paste** — recreate the designs inside the existing codebase (`index.html`, compiled
`React.createElement`, no JSX; Lucide + Firebase + Google Fonts via CDN). Don't add a build step or
component framework. Ignore the phone/browser bezels — only recreate the screen content.
`design-tokens.css` is the real deliverable to install first. Fidelity: **high / pixel-accurate**.
Property photos in the mock are gradient placeholders — use the app's real listing images.

## The single most important rule — tame per-tour colors
Today each tour carries a full accent (black/green/red/orange **cards and buttons**), fragmenting the
UI. In the refresh each tour keeps an identity hue but it appears **only** as: a **10px dot** by the
tour name, a **3px (dashboard) / 5px (detail) left spine**, or a **soft tint**. Cards, buttons, text
stay navy/ink/cream everywhere. Pick the hue from the six `--tour-*` values
(navy/pine/clay/plum/teal/ochre). **Never fill a whole card or button with the tour color.**

## Icons
**Lucide line icons only — no emoji in UI chrome** (current app still leaks 🏠📅⏰⭐❤️; all must go).
Stroke ~1.9, round caps. Set: calendar, clock, map-pin, star, heart, users, shield, trophy,
bar-chart-3, arrow-right, arrow-left, chevron-down, check, plus (rotate 45° = close), share-2, route,
bed, bath, ruler, mail, home, key-round, pencil, sliders-horizontal, award, settings, search, inbox,
crown. Lucide already loads from jsdelivr (via the `LI()` helper).

## Component kit
- **Buttons** (`.mrt-btn`): navy = primary; ink = primary on cream/editorial; ghost = secondary
  (transparent, hair-2 border); gold = accent action only. sm = 10×14 / 13px.
- **Pills** (`.mrt-pill`, 7×10, r999) + **spec chips** (`.mrt-chip`, 6×9, r8, bg `#FBF9F4`) —
  stops/rated/fav and bd/ba/sqft/DOM. `$/sqft` chip uses navy chip colors.
- **Star row:** Lucide star, filled = gold, empty = hair-2 outline. 14 inline → 22–28 rating screen
  (keep ≥44px tap target).
- **Segmented control** (`.mrt-seg`): track `#EFE9DD`, active pill white (light) / gold (editorial).
- **Fields** (`.mrt-field`): hair-2 border, navy focus ring; grouped under eyebrow labels.
- **Tab bar:** translucent paper, single active tab navy, Lucide glyphs; labels
  Tours / Sponsor / Sign Up / List Home / Contact. Dark editorial variant: translucent ink, active gold.
- **Sponsor "Tour Lead" card:** navy→navy-2 gradient, 1px gold border, gold "TOUR LEAD" corner tab.
- **Rank medallion / #1 card:** gold gradient medallion; #1 card = gold-tinted bg + `--mrt-shadow-gold`;
  other ranks = calm neutral rows.

## Screens (12) — each maps 1:1 to an existing screen; recreate mobile + desktop
Responsive: reading/task screens cap ~560–720px centered; list screens reflow to 2–3-col grids
≥1024px; bottom tab bar is mobile-only.
1. **Dashboard** — light logo header + quiet ghost admin row (Team / Requests·badge / New Tour) +
   Calendar/Request/FAQ; "Upcoming · N tours" + Today&Future/Past segmented toggle; tour cards
   (dot + serif name, date·time meta, stops/rated/fav pills, thumbnail strip w/ #index, Open Tour);
   LIVE = pulsing red dot + "Live today". Desktop: 3-col grid; header actions → one top strip.
2. **Tour Detail** — header (dot + serif name, back, admin Share/Invite/Sponsors/Manage); summary meta
   (date·time·stops · rated · fav) + Route/Rankings/Summary; Tour Lead sponsor + regular sponsors;
   listing cards — photo w/ "Stop N" tag + heart + one Fraunces price on smoked-glass chip, serif
   address, spec chips, agent, Directions + Rate Home. Desktop: 2-col grid.
3. **Rating** — access-code gate first if locked (centered card, four code cells, Unlock, anonymity
   note); then focused single column: home strip (thumb + address + price), slim navy progress bar +
   "N/10", 10 category rows (Curb Appeal, Landscape, Cleanliness, Flooring, Paint, Showability, Price,
   Kitchen, Bedrooms, Windows) each label + 5-star tap row, optional note, sticky Submit. Single column
   on desktop.
4. **Rankings** — single ordered leaderboard; #1 = gold medallion + gold-tinted card + gold Fraunces
   score; others = neutral rank rows w/ avg or dashed "No ratings yet".
5. **Summary** — report emailed to listing agents. Per home: big gold Fraunces overall score + agent
   count, 10 category averages as bars in two columns (lowest category tints gold), agent notes as
   gold-ruled pull-quotes. Extra homes collapse to compact row (address + overall + mini sparkline).
   "Email to listing agents" / "Download PDF".
6. **Team** — super-admin on navy/gold lead card w/ gold crown chip; members as card grid (avatar
   initials, name, email, role pill, edit); dashed add-member row (email + role seg + add);
   permission-levels key (Super Admin / Admin / Editor / Viewer, glyph + one-line def).
7. **Requests** — admin inbox; segmented Listing reviews (n) / Attendance (n) + counts; Pending/
   Contacted/All filter; request cards (address, agent + brokerage + contact + specs) w/ Approve (navy)
   / Contact (ghost) / Deny (quiet red ghost); status gold "Pending" / muted "Contacted". Desktop: 2-col.
8. **Public forms & Login** — marketing masthead (logo + How it works / Sponsor / Contact / Login) +
   Fraunces headline; List a Home grouped "Your details" / "The property" w/ Google-autocomplete address
   + tour choice as accent chips; Sponsor signup w/ priced tiers (Presenting = gold "Lead"); Contact +
   reach-us card; Login = quiet centered "Admins only" card (email + password, inline Forgot).
9. **Route Map** — full-viewport Google Map; numbered pins in tour accent (start = gold); clean route;
   draggable order sheet w/ drive times + "Start navigation".
10. **Photo Gallery** — full-screen near-black viewer; translucent-glass chrome; "N / M" counter;
    thumbnail rail w/ gold-ring active thumb; prev/next.
11. **Modals** (New Tour / Add Listing / Tour Sponsors) — one pattern: paper sheet on dimmed ground,
    titled header + close (rotated plus), grouped fields, Cancel + primary footer. New Tour emoji/color
    picker → six-swatch accent picker. Sponsors: green "Paid" vs gold "Mark paid" (controls visibility).
12. **Persistent chrome** — top header, mobile bottom tab bar, toasts, offline banner, sync pill
    (Synced / Connecting / Local only) w/ success/muted tokens.

## Behavior (unchanged logic)
- Navigation: hash-based, no reload. Keep every route.
- Favorite: a single heart toggles filled(red)/outline (replaces the old badge + "Fav" + heart trio).
- Rating: tap star sets 1–5; progress + "N/10" live; Submit advances to next stop; locked tours need
  the 4-digit code first.
- Sponsor visibility: public sponsor appears only once admin marks Paid.
- Honor `prefers-reduced-motion`.

## Motion (CSS in design-tokens.css)
- `.mrt-press`: hover lift −3px + soft shadow (140ms); active translateY(−1px) scale(.99). Apply to
  tour/listing cards, primary buttons, route rows.
- `.mrt-live-dot`: 1.8s ring pulse. `.mrt-star-pop`: fire once per star on tap (.5s, scale .4→1.25→1).
- Everything else calm: 120–200ms fades; slide-up offline banner.

## Suggested implementation order
1. Install fonts + `design-tokens.css` vars; re-point ad-hoc colors to `--mrt-*`.
2. Replace all emoji chrome with Lucide.
3. Rebuild component kit (button/pill/chip/card/star-row/field/tab-bar) against tokens.
4. Roll screens in flow order: Dashboard → Tour Detail → Rating → Rankings → Summary → admin → public.
5. Apply the per-tour accent rule (dot + spine only) everywhere a tour is shown.
6. Layer motion + reduced-motion guard last.

Target file: `index.html` (mirror to `www/index.html`). **Never touch prod** (see repo `CLAUDE.md`).
