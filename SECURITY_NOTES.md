# MarketReady Tours — Security Hardening (Phase 0)

Status of the audit's Phase 0 ("stop-the-bleeding"). **No production deployments were made.** Code/config
changes are staged in the working tree and running on a local preview only.

## Live findings (verified against the production Firebase, read-only)

The RTDB is **not** wide-open test mode — most paths are already locked. Confirmed unauthenticated reads:

| Path | Anon read | Notes |
|------|-----------|-------|
| `mrt_tours` | 🔴 PUBLIC | Leaks embedded `campaignContacts`, notes, ratings, and per-tour access `code` |
| `admins` | 🔴 PUBLIC | Leaks every admin email + role |
| `mrt_tour_previews` | 🟡 PUBLIC | Intentional (public cards) |
| `mrt_subadmins`, `mrt_tour_requests`, `mrt_listing_requests`, `mrt_settings`, `mrt_reminders`, `mrt_not_interested` | 🟢 denied | Client PII + the Instantly API key are **not** exposed |

**Not yet verified (needs console):** whether anonymous *writes* are allowed to `mrt_tours` / `admins`
(the data-wipe and self-escalation vectors). The write probe was intentionally not run against prod.
Pull the current rules from the console to confirm — the drafted rules below close both regardless.

## Changes made in this pass

1. **Stored XSS in the calendar view (fixed)** — `index.html` + `www/index.html`. Tour-derived
   `name`/`emoji`/`color`/`id` were interpolated raw into `innerHTML`. Added `esc()` (HTML/attribute
   escaping) and `jsId()` (id sanitised for the inline `onclick`) inside the calendar `render()`.
2. **Subresource Integrity (added)** — `integrity="sha384-…"` + `crossorigin="anonymous"` on all
   cdnjs/gstatic `<script>` tags in both files (React, ReactDOM, Firebase ×4, qrcodejs, lucide).
   Google Maps has no SRI support and is left as-is. Hashes computed from the live CDN bytes; both
   CDNs send `access-control-allow-origin: *`, so loading is unaffected.
3. **Security headers (added)** — `vercel.json` now sets `X-Frame-Options: DENY` (anti-clickjacking),
   `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security`,
   `Permissions-Policy`, and a `Content-Security-Policy`. The CSP keeps `'unsafe-inline'` for scripts
   because the app is one big inline block (no nonce possible in a static file) — tighten this during
   the eventual rebuild. **Verify the CSP against a real session before production** (connect-src must
   cover Firebase + all email/SMS/payment endpoints; the current list is scoped to what the app uses).
4. **Firebase rules drafted (NOT deployed)** — `database.rules.json`, `storage.rules`, `firebase.json`,
   `.firebaserc`. They preserve the guest flow (public read on `mrt_tours`/`mrt_tour_previews`) while:
   - locking `admins` / `mrt_subadmins` / `mrt_settings` writes to the super-admin,
   - requiring auth to write `mrt_tours` (kills anonymous wipe),
   - allowing anonymous **create-only** on the public intake paths (`mrt_listing_requests`,
     `mrt_tour_requests`, `mrt_not_interested`) so public submissions keep working.

### To deploy the rules (when ready — this IS a production change)
```
npm i -g firebase-tools      # not installed in this repo's env
firebase login
firebase deploy --only database,storage
```
Or paste `database.rules.json` into Firebase console → Realtime Database → Rules, and `storage.rules`
into Storage → Rules. **Review `storage.rules` first** — the live bucket allows anonymous object
listing; the draft scopes reads to the known image prefixes but should be validated against real uploads.

## Known residual / not addressed in this pass (next phases)
- `mrt_tours` read is still public → split sensitive fields into `mrt_tours_private/<id>` (Phase 1).
- **F1 — guest ratings never reach Firebase** (biggest functional bug): ratings are written into the
  admin-only bulk `tours` write path. Needs a granular guest-writable ratings path like `mrt_not_interested`.
- **Two-file drift** (root=Square / www=Stripe) and the dead `build.js` pipeline — single source of truth.
- Open email/SMS relays (`sendemail-…run.app`, AT&T SMS gateway) need auth + rate limiting (server-side).
- Restrict the Google Maps API key by HTTP referrer in GCP.
