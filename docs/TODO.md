# MarketReady Tours — open items

Running list of known work. Verified items note how they were confirmed, so nobody has to
re-derive it. Guardrail as always: nothing lands in production without Braydon's OK (CLAUDE.md).

---

## 🔴 1. Sponsorship must be gated on payment — including the underlying data

**Asked for 2026-07-28.** A sponsor's placement *and their details* must not be visible until
they've actually paid.

**Where it already works:** the public tour page filters on `sp.paid` in all four render
paths (`index.html` ~`:8527`, `:8533`, `:8726`, `:8740`), so an unpaid sponsor is not *shown*.
`mrt_tour_previews` is clean too — it only carries name/date/photo/colour/listing count.

**Where it does NOT work — the actual gap:** `mrt_tours` is world-readable
(`database.rules.json`: `"mrt_tours": { ".read": true }`) and unpaid sponsors are stored inside
`tour.sponsors[]`. Their details are therefore public to anyone who reads the database
directly, regardless of what the UI renders. Confirmed 2026-07-28 with an **unauthenticated**
request against the dev DB:

```
curl -s "https://<project>-default-rtdb.firebaseio.com/mrt_tours.json"
  → [UNPAID] Canyon Home Warranty | warranty@example.com | (480) 555-0133 | plan=full
```

Name, email, phone and payment plan of a sponsor who has not paid — readable by anyone with
the URL.

**Fix:** stop writing unpaid sponsors into the public node at all. Keep pending/unpaid sponsors
in a read-protected sibling (`mrt_tours_private/<tourId>/sponsors`, auth-only) and *promote* a
record into the public `mrt_tours` node only when payment is confirmed. Demotion on refund /
unmarking paid has to move it back.

This is the same data-model change as deferred audit item **M5** below — doing it once solves
both. Needs a migration for existing tours plus a rules update.

**Also confirm as part of this:** that an unpaid sponsor doesn't leak through any other
outbound surface — share/OG preview images, the tour route email, campaign emails, or the
seller report.

---

## 🟠 2. Harden the remaining realtime writes (19 sites)

RTDB writes go over the realtime socket and have no timeout, so a stalled socket leaves the
calling UI spinning forever with no error (this is what hung Sign In and Team Management).
`mrtDbSet()` exists and races the socket write against a REST write; it's applied to the three
`admins/` writes only. **19 other `_fb.ref(...)` write sites are still unprotected**, including
create/delete/archive tour, approve/deny requests, mark sponsor paid, and save listing edits.

Note that the "Synced" pill reflects `fbReady` (initial data loaded, possibly via the REST
fallback) and **not** socket health, so a dead socket looks healthy until you try to write.

---

## Deferred from the 2026-07-16 audit

Full detail in `HANDOFF-audit-2026-07-16.md`.

- **M5** — `mrt_tours` public-read also exposes each tour's access `code` and agent emails.
  Same `mrt_tours_private` split as item 1.
- **M7** — verify the send-email Cloud Function authenticates its caller. Needs prod access to
  test, so it's blocked on Braydon.
- **L5** — no spam protection (captcha / rate limit) on the public intake forms. Pre-launch.

---

## Known behaviour worth a decision (not bugs)

- **Favourites are global, not per-user.** `mergeSharedIntoTours` collapses a listing's
  favourites with `.some(Boolean)`, so a heart shows filled if *anyone* favourited it, and you
  cannot un-favourite someone else's. Fine if the heart means "the group liked this"; wrong if
  it's meant to be personal.
- **Buyer Est. / Seller Est.** were both hardcoded to the bare marketing homepage (still are in
  production). Greyed out and labelled "Work in progress" on our branch pending real
  destinations.
