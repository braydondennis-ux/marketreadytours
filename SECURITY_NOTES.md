# MarketReady Tours — Security Status

_Updated 2026-08-13. **These controls are deployed and live in production.** The previous
version of this file said they were not; that was true until the 2026-08-10 cutover._

## Open exposure — read this first

**Legacy `mrt_tours` is world-readable.** An unauthenticated request returns 38 unpaid sponsors
with name/email/phone, 33 tour access codes, and 84 distinct agent emails (re-measured
2026-08-13).

This is a **known, deliberate trade-off**, not a defect — it is the price of keeping rollback
available, and the reasoning is recorded in a `"//"` comment inside
`database.rules.transition.json`. The rollback target `cd6f980` performs no authentication at
all, so requiring auth on this node would make a rolled-back site load nothing.
`scripts/production-cutover.test.mjs:150` asserts the permissive rule on purpose.

**Do not "fix" this by tightening the rule.** The fix is to delete the node when the rollback
window closes. New data is unaffected — the exposure is the frozen pre-cutover copy. Detail,
including the two-rules-files trap, in `docs/TODO.md` item 1 (audit item M5).

## Implemented

- Canonical mutations run through authenticated Firebase Functions.
- Functions hard-block every project except `marketready-tours` and `marketready-tours-dev`.
- Admin authorization uses UID-scoped custom claims, not email keys or session storage.
- Anonymous Auth gives public users stable ownership for favorites, grants, ratings, uploads.
- Public/private tour and rating records are split. Public projections omit codes, contact data,
  campaign contacts, notes, raw feedback, and **unpaid sponsors** — `publicSponsor()` returns
  `null` for an unpaid sponsor, so the guarantee lives in the server projection, not the UI.
  Verified against live data 2026-08-13: a tour with 3 sponsors publishes only the 2 paid ones.
- Realtime Database and Storage default-deny Rules have emulator coverage. Verified live:
  `mrt_tours_private`, `mrt_sponsors`, `mrt_contact_requests`, and `mrt_listing_requests` all
  return 401 to an unauthenticated reader.
- Rating access requires a short-lived server grant derived from the tour code.
- Public intake has validation, a honeypot, per-user/IP rate limiting, idempotency, payload caps.
- Outbound email, Instantly, reminders, invoice creation, and payment state are server-owned.
- Opt-outs use expiring signed tokens; the email address is not accepted as authority.
- Sponsor payment status is set by a signature-checked webhook, not a UI toggle. Clover's
  signature is HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``.
- App Check is **enforced** on remote callables (`enforceAppCheck: !isEmulator`). Verified
  2026-08-12: an unattested caller gets `UNAUTHENTICATED`, and the request never reaches
  handler code.
- Account email links are single-use and short-lived, and exactly one sender issues each one —
  two senders would mean two oobCodes, and Firebase invalidates the earlier.
- Generated dependencies and `www/` are not version-controlled.

## Secrets

Held in Google Secret Manager, bound to functions at deploy time. Never in source, never pasted
into chat — set them with `firebase functions:secrets:set`.

`MRT_RESEND_API_KEY` (send-only, so it cannot list past messages), `CLOVER_API_TOKEN`,
`CLOVER_MERCHANT_ID`, `CLOVER_WEBHOOK_SECRET`, `MRT_SIGNING_SECRET`, plus the Square Sandbox
values described in `docs/SQUARE-SANDBOX.md`.

`MRT_RESEND_API_KEY` is declared on `callableOptions`, so every callable carries it. Ten call
sites reach `sendTransactionalEmail`, and a missing secret only surfaces at send time.

## Configuration notes

- **API keys are referrer-restricted.** The browser key's allowlist must include
  `marketready-tours.firebaseapp.com`, or the Auth action page 403s and password reset links
  fail with "expired or already used" — a message that describes neither cause. This cost four
  wrong hypotheses in 2026-08. Any server-side call using that key must send a matching
  `Referer` header.
- Keep Maps keys restricted to the intended referrers and APIs.
- Add Apple App Attest/DeviceCheck for a production iOS release.
- SPF/DKIM/DMARC must resolve **DNS-only**. Firebase's DKIM records had never validated because
  `firebase1/2._domainkey` were Cloudflare-proxied and returned Cloudflare IPs.

## Accepted constraints

- The UI is a large compiled inline script, so the static-host CSP still requires inline script
  support. A source-level rebuild is the path to a nonce/hash-only CSP.
- GitHub Pages serves no security headers, so the CSP in `vercel.json` applies only to Vercel
  previews. Not a regression — production never had them. Close it with a Cloudflare Transform
  Rule.
- Callable validation errors surface as opaque `INTERNAL` 500s rather than naming the bad field.
  See `docs/TODO.md` item 3.
