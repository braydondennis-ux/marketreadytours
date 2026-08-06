# Blue-green production cutover

Status as of 2026-08-06: the secure backend and additive public/private projections have been
prepared in production, but the refreshed frontend has not been promoted. The live domain still
serves the legacy `main` build through Cloudflare and GitHub Pages. Nineteen production callables
remain blocked by Cloud Run IAM until their services allow unauthenticated invocation; Firebase
Auth, App Check, claims, validation, and rate limits remain the application security boundary.

## Environment map

| Role | Web | Firebase project | State |
| --- | --- | --- | --- |
| Existing production | `https://marketreadytours.com` (Cloudflare → GitHub Pages) | `marketready-tours` | Legacy frontend; source of truth |
| New demo candidate | `https://mrt-refresh.vercel.app` | `marketready-tours-dev` | Vercel preview with an isolated production-derived snapshot |

Always pass an explicit Firebase project ID. The repository's default Firebase alias points at production and must not be relied upon during demo work.

## Rehearsal snapshot

- Source backup: 35 tours, 92 listings, and 45 sponsorship records.
- Demo public projection: 35 tours and 7 paid sponsorships.
- The 38 unpaid sponsorships exist only in the private demo data and are not publicly readable.
- Four legacy favorites and 14 legacy rating submissions were retained in private, normalized data.
- Seventeen embedded images were copied to isolated demo Storage objects and their references were rewritten.
- Demo administrators and demo Authentication users were preserved. Production Authentication users were not copied.
- Outbound email is disabled unless `MRT_ALLOW_LIVE_OUTBOUND` is explicitly set to `true`.
- Square is preview/emulator-only. Production intentionally uses manual Venmo, Zelle, or check
  invoices with the secure admin mark-paid/unpaid workflow; Square credentials are not a launch
  requirement. Stripe is not a production payment path.

The ignored local backup directory contains pre-import production and demo database exports, the generated candidate, the asset manifest, and the post-import export. Keep it until the production cutover and rollback window are complete.

## Verification completed

- Candidate and post-import demo data are semantically identical after Firebase's removal of empty values.
- The public projection contains no private fields and no unpaid sponsorships.
- Database and Storage rules tests pass.
- End-to-end emulator workflow tests pass for rating, intake, approval, campaign, opt-out, payment, and refund behavior.
- Static build and validation pass.
- The new demo homepage and a tour detail page render correctly in Chrome.
- Both old production and new demo URLs return HTTP 200.

## Stakeholder comparison checklist

Braydon should compare the two URLs without entering new production data in the demo:

1. Confirm the tour list, dates, listings, ordering, images, and contact information.
2. Open several past and upcoming tours and compare listing details.
3. Confirm paid sponsors appear where expected and unpaid sponsors do not appear publicly.
4. Sign in with a demo administrator account and verify tour, listing, sponsor, campaign, and settings screens.
5. Verify mobile and desktop layouts.
6. Record any demo changes made during review; they are not automatically synchronized back to production.

## Final cutover gates

Do not switch the production domain until all of these are complete:

1. Braydon gives explicit approval of the demo candidate.
2. Required production App Check and transactional-email configuration is verified. Instantly,
   reminders, Square, and Stripe remain disabled unless separately approved.
3. A maintenance window is announced and production writes are paused.
4. Fresh production database, Authentication, and Storage backups are captured.
5. A final delta migration is rehearsed and reconciled by counts and sampled records.
6. The new backend is deployed to the production Firebase project with explicit project targeting,
   and all 19 callable Cloud Run services pass the unauthenticated-invoker reachability check.
7. Authenticated/App-Check smoke tests pass against the production backend before the domain switch.
8. The Vercel production deployment is promoted and the Cloudflare/DNS route is intentionally
   switched from GitHub Pages, then smoke-tested and monitored.

## Rollback rule

Keep the old production deployment and the final backups intact. If a cutover smoke test fails, return the domain to the old deployment and restore only from the verified final backup if the production database was changed. Do not make the current demo Firebase project the long-term production database; deploy the approved code and migrated schema to the existing production project so its identity, Authentication users, integrations, and audit history remain stable.
