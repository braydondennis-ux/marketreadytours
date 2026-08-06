# MarketReady Tours — Security Status

_Updated 2026-07-28. These controls have not been deployed to production._

## Implemented

- Canonical mutations run through authenticated Firebase Functions.
- Functions hard-block every remote project except `marketready-tours-dev`.
- Admin authorization uses UID-scoped custom claims, not email keys or session storage.
- Anonymous Auth gives public users stable ownership for favorites, grants, ratings, and uploads.
- Public/private tour and rating records are split; public projections omit codes, contact data,
  campaign contacts, notes, raw feedback, and unpaid sponsors.
- Realtime Database and Storage default-deny Rules have emulator coverage.
- Rating access requires a short-lived server grant derived from the tour code.
- Rating payloads require all ten integer scores in the 1–5 range.
- Public intake has validation, a honeypot, per-user/IP rate limiting, idempotency, and payload caps.
- Outbound email, Instantly, reminders, invoice creation, and payment state are server-owned.
- Dev outbound is mocked unless explicitly enabled and remains recipient-allowlisted.
- Opt-outs use expiring signed tokens; the email address is not accepted as authority.
- Sponsor payment status is updated by a signature-checked webhook, not a public/admin UI toggle.
- Demo invoice creation uses only Square Sandbox, derives amounts server-side, and accepts only
  hosted `squareupsandbox.com` payment URLs. Emulator invoice creation remains mocked.
- App Check is enforced on remote callable Functions; localhost uses the emulator.
- Generated dependencies and `www/` are no longer version-controlled.

## Deliberate production block

The live hostname still follows the legacy client path. The Functions guard does not permit the
production project, and the live client does not enable the secure backend. This prevents an
accidental partial rollout. Publishing the new Rules by themselves would break the live client.

## Configuration still required before any preview/live use

- Register the dev web app with Firebase App Check and provide `MRT_APP_CHECK_SITE_KEY`.
- Store Instantly, signing, transactional-email, and webhook keys in Functions secrets.
- Configure the Square Sandbox access token, location, webhook signature key, and exact webhook
  URL described in `docs/SQUARE-SANDBOX.md`.
- Keep Maps keys restricted to the intended referrers and APIs.
- Add Apple App Attest/DeviceCheck for a production iOS release.
- Monitor App Check metrics before enforcing it on additional Firebase products.

## Accepted constraints

- The UI remains a large compiled inline script and therefore the current static-host CSP still
  requires inline script support. A source-level rebuild is the path to a nonce/hash-only CSP.
- Legacy production integrations remain in the production-only fallback branch until an approved
  cutover. Local and isolated dev execution cannot call them.
- Migration retains legacy nodes for rollback; remove them only in a later, separately reviewed
  cleanup after the secure client has been stable.
