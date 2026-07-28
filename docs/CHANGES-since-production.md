# Changes since production (marketreadytours.com)

**Generated:** 2026-07-28

## What "production" is, exactly

| | |
|---|---|
| Live site | https://marketreadytours.com (GitHub Pages → Cloudflare) |
| Prod code | `origin/main` @ `ac1eb41` — **verified byte-identical** to the live HTML (sha1 `c026b73c…`, 233,197 bytes) |
| Our branch | `design-refresh` @ `eda9a20` |
| Common ancestor | `09aed1b` — 2026-05-20 |
| Our work not in prod | **92 commits** (2026-06-24 → 2026-07-17) |
| Prod work not in ours | **21 commits** (2026-07-14 → 2026-07-27) |

> ⚠️ **The two have diverged in both directions.** Braydon has kept shipping to prod since we
> branched. Our branch does not contain his last 21 commits, and prod does not contain any of
> our 92. This is not a fast-forward — see "Divergence" at the bottom before planning a merge.

---

## Our 92 changes, grouped

### 1. Shared Firebase backend — everyone on a tour sees the same data (2026-06-24)
Previously ratings and favorites lived in each person's browser (localStorage), so an admin
never saw what attendees submitted.

- Guest ratings persist to a shared `mrt_ratings` path
- Guest favorites persist to a shared `mrt_favorites` path
- Shared ratings/favorites merge into the tours array on read, so all readers see the same data
- Merge also derives the flat per-tour average, so "rated" counts and the Rankings page reflect shared data
- Stable anonymous user key, so a guest keeps their identity across submissions
- Public sponsor signups persist to a pending `mrt_sponsor_signups` queue
- Admin can review and promote a pending sponsor signup once marked paid
- Only **paid** sponsors are visible on the public tour page
- Per-tour writes strip shared fields, so saving a tour can't clobber shared ratings

### 2. Security hardening (2026-06-24)
- Realtime Database + Storage rules rewritten: **default-deny at the root**, every path explicitly scoped
- Roles locked to super-admin only — closed a self-privilege-escalation hole where anyone could grant themselves `role: "super"`
- Anonymous data-wipe vector closed (`mrt_tours` write now requires auth)
- Rules for guest ratings / favorites / sponsor signups: create-only for anonymous, no overwrite or delete
- Content Security Policy + security headers
- XSS escaping on user-supplied values
- Subresource Integrity (SRI) on third-party scripts
- CI parse gate (`www/validate.js`) so a broken build can't be pushed

### 3. Isolated dev/preview environment (2026-06-24 → 06-25)
- Firebase emulator config + dev scripts for fully local work
- `*.vercel.app` previews auto-use a **separate `marketready-tours-dev` Firebase project**
- Seed scripts for both the emulator and the dev project
- Emails and SMS suppressed on localhost *and* dev previews, so demos never message real people

### 4. Icon system + readability (2026-06-25 → 06-26)
- Emoji buttons replaced with Lucide line icons across dashboard, tour detail, rating flow, rankings, summary, public forms, login, and all admin screens
- Accessibility pass for older users: darker secondary text, larger base size (16.5px / 1.5 line-height), heavier weights
- Loaded real 800/900 font weights (previously faux-bold)
- "TOUR LEAD" badge contrast fixed (was low-contrast white on gold)
- Tour Detail stat line rebuilt as a clean two-row layout

### 5. Desktop optimization (2026-07-06)
The app was capped at 480px wide — a phone layout stretched onto a desktop monitor.

- Double-gated desktop CSS layer (easy to switch off)
- Global 480 cap lifted on the app shell
- Single-column screens (login, rating, public forms) widen to 720
- Dashboard tour list reflows to a responsive grid
- Tour detail listings reflow to a 2-column grid
- Rankings widen; Summary becomes a 2-column grid
- Admin screens (sponsors / team / requests) reflow to grids; Add Listing widened

### 6. "Quiet Luxury" visual refresh — P1–P10 (2026-07-07)
Full reskin to a navy / ink / cream / gold palette with Fraunces + Hanken Grotesk type.
Same workflow, same screens — look and feel only.

- **P1** Design tokens + component kit
- **P2** Per-tour accent foundation — tour color tamed to a 10px dot + left spine instead of filling whole cards and buttons
- **P3** Dashboard
- **P4** Tour Detail (smoked-glass price, spec chips, Tour Lead card)
- **P5** Rating flow (OTP-style code gate, navy progress, gold star rows)
- **P6** Rankings (gold #1 medallion, neutral rank rows)
- **P7** Summary (gold overall score, 2-column category bars, lowest category flagged)
- **P8** Team + Requests, then all modals (unified paper-sheet pattern, six-swatch accent picker)
- **P9** Public forms + Login (masthead, grouped fields, gold LEAD sponsor tier)
- **P10** Chrome sweep — remaining color bands tamed; sync pill emoji → styled dots

*Transactional emails were deliberately left untouched throughout.*

### 7. Mock-matching refinements (2026-07-08)
- Dashboard: editorial "Your tours" headline, Upcoming/Past segmented toggle, tighter cards, uniform thumbnails
- Rating: "STOP N of M" (1-indexed), slim home strip, greyed unrated categories, single note field, "Submit & go to next stop"
- Tour Detail: "THE STOPS" eyebrow, per-listing rating badge / Not-rated pill, "PRESENTING SPONSOR" + Contact sponsor
- Header nav rows wrap instead of scrolling, so content is no longer cut off when zoomed

### 8. Navigation + layout unification (2026-07-09 → 07-10)
- **One 1200px content well** across every app page — content no longer jumps between screens
- **Persistent global top nav bar** on desktop (logo + tagline + public-page links), replacing six per-page logos that each sat at a different size and position
- Public pages (Tours / Sponsor / Tour Sign Up / List Home / Contact) reachable on desktop — previously only in the mobile tab bar
- One primary nav per breakpoint: mobile = bottom tab bar, desktop = top nav (fixed a mobile nav leak where both showed at once)
- Full-bleed page headers, made scrollbar-immune (a `vw`-based approach left a right-edge gutter in real browsers)
- Whole dashboard tour card is clickable
- Deep-link routing fixed — refreshing on `#/sponsor-signup`, `#/contact`, `#/team`, `#/requests-admin` no longer dumps you on the dashboard
- Mobile: logo shown only on the dashboard, dropped from internal headers

### 9. Reliability (2026-07-10 → 07-13)
- **REST fallback** for tours/data when the realtime websocket is blocked or stuck (corporate wifi, some carriers)
- Dashboard shows "Loading tours…" while Firebase connects, instead of falsely saying "No tours scheduled"
- Subtle staggered fade-in for tour cards on first load
- Google Maps: clean "Map preview unavailable" placeholder on auth failure, replacing Google's gray "Oops" overlay

### 10. Full audit + 20 bug fixes (2026-07-16 → 07-17)
A complete audit (live Firebase probe + desktop/mobile walkthrough + code review) found 22 issues.
20 were fixed in commit `b28eb73`, verified by a red/green Playwright suite (14/14 green).

**Critical**
- **C1** — the "List Home" form wrote to the **production database from every environment**, including local and preview. Now resolves the right database per environment.

**High**
- **H1** — deleting your last tour didn't persist; it came back on reload
- **H2** — public "Request a Tour" was never saved, so the admin Attendance tab stayed empty
- **H3** — sponsor signup saved the lead but never showed the confirmation screen
- **H4** — browser Back was broken on tour detail
- **H5** — a stale background poll survived admin login and could silently revert admin edits

**Medium**
- **M1** — contact form said "Message Sent" even when it failed
- **M2** — rating screen crashed on listings missing a numeric price or sqft
- **M3** — ghost-admin sessions failed writes silently
- **M4** — unsanitized user input in outgoing emails
- **M6** — logged-out deep link to `/team` or `/requests-admin` rendered a blank page

**Low**
- **L1** — duplicate header on every desktop public page
- **L2** — Requests admin page never set the URL hash
- **L3** — zero-indexed labels ("1 stops", "Stop #0")
- **L4** — favicon 404
- **L6** — tour preview wrote on every keystroke

**Deferred (still open)**
- **M5** — `mrt_tours` public-read exposes the tour access code and agent emails. Real fix is a `mrt_tours_private` split — a data-model change.
- **M7** — verify the send-email Cloud Function authenticates its caller (needs prod access to test)
- **L5** — no spam protection (captcha / rate-limit) on public intake forms — pre-launch item

### 11. Docs
- `HANDOFF.md` — canonical current-state handoff
- `CLAUDE.md` — production guardrail (nothing touches prod without Braydon's OK)
- `docs/HANDOFF-audit-2026-07-16.md` — full audit detail
- `docs/design/` — Quiet Luxury design tokens + refresh handoff
- Design specs and implementation plans for the Firebase backend and desktop work

---

## Divergence: what prod has that we don't

Braydon's 21 commits since we branched, none of which are on `design-refresh`:

- **2026-07-27** — multi-rater ratings with names, averages, and per-rater breakdown
- **2026-07-27** — attendee ratings and favorites persist via nested REST writes
- **2026-07-27** — "audited build"
- **2026-07-21** — remove Agent Branding button; orphaned tag fix
- **2026-07-21** — agent email + phone fields in AddListingForm (four attempts)
- **2026-07-20** — correct Google Maps API key; cache-busting headers; Places `sessionToken` fix
- **2026-07-15 → 07-16** — five rounds on Google Places autocomplete in the admin Add Listing modal
- **2026-07-14** — email routing, rating keys, invoice delivery, sendRoute recipients

### Functionality prod has that we don't

A component-level diff turns up only **three** things:

1. **Stripe Checkout — replacing Square invoicing.** Prod has a "Pay with Card" button that calls a
   `createCheckoutSession` Cloud Function on the prod Firebase project, and embeds a pay-online link
   in the sponsor invoice email. Prod contains **no Square code at all**; our branch still uses
   Square invoice links (`SQUARE_INVOICE_URL` / `SQUARE_LINKS`) and has **no Stripe**. This is a
   swap, not an addition — whichever direction we merge, one processor has to be chosen.
2. **Persistent rater identity** — `mrt_rater_id` + `mrt_rater_name` in localStorage. Prod remembers
   a rater's name between submissions and preloads their own previous scores for a listing so they
   can revise a rating. Ours asks for the name each time and doesn't preload.
3. **Version-based cache bust** — `APP_VERSION`; on load, if the stored version differs, every
   `mrt_`/`gat_` localStorage key is wiped, so a deploy can't leave stale client state behind.

### Functionality prod LOST in the 2026-07-14 rewrite

The 07-14 commit ("email routing, rating keys, branding button, invoice delivery") was not a fix —
it replaced `index.html` wholesale, 500 KB → 226 KB, and dropped feature areas that the shared
May ancestor had and our branch still has. Verified by keyword count against `09aed1b`:

| Feature | May (`09aed1b`) | Prod today | `design-refresh` |
|---|---|---|---|
| Email campaigns / Instantly | ✅ | ❌ | ✅ |
| CSV contact import | ✅ | ❌ | ✅ |
| Archive / Past tours | ✅ | ❌ | ✅ |
| Seller feedback report | ✅ | ❌ | ✅ |
| Tour reminders | ✅ | ❌ | ✅ |
| "Not interested" tracking | ✅ | ❌ | ✅ |

Prod's data model is also much flatter — it has no `mrt_ratings`, `mrt_favorites`,
`mrt_tour_requests`, `mrt_sponsor_signups`, `mrt_reminders` or `mrt_settings` paths, storing
ratings nested inside `mrt_tours` instead.

Some of this may have been deliberate — there were earlier commits neutralizing Instantly API
calls because they were failing. Worth confirming with Braydon which losses were intentional.

**Merge note:** the two branches are not textually compatible. Prod's `index.html` is 233 KB of
JSX compiled in the browser by Babel; ours is 557 KB of pre-compiled `React.createElement`. A
normal `git merge` will conflict on essentially the whole file. The realistic paths are to port
Braydon's 21 changes forward onto our branch by hand, or to re-apply our work onto his current
build — that decision should be made with him.
