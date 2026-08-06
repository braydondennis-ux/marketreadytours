import assert from "node:assert/strict";
import crypto from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {buildProductionCutover} from "./prepare-production-cutover.mjs";
import {
  assertProductionAssetApproval,
  PRODUCTION_APPROVAL,
} from "./upload-production-cutover-assets.mjs";
import {assertProductionAppCheckApproval} from "./configure-production-appcheck.mjs";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionAdminApproval,
  legacyAdminEmail,
  migratedAdminRole,
} = require("../functions/scripts/migrate-production-admins.js");

function productionFixture() {
  return {
    mrt_tours: [{
      id: "tour-1",
      name: "Production Tour",
      date: "2026-08-08",
      time: "10:00 AM",
      listings: [{id: 1, address: "1 Main St", photos: [], order: 0}],
      sponsors: [{id: "sponsor-1", name: "Paid Sponsor", paid: true}],
      ratingSubmissions: {1: [{price: 4}]},
    }],
    admins: {admin: {role: "super"}},
    mrt_campaigns: {campaign: {status: "complete"}},
  };
}

test("production cutover contains only additive refresh roots", () => {
  const production = productionFixture();
  const {payload, report} = buildProductionCutover({
    production,
    sourceSha256: "source-hash",
    snapshotAt: "2026-08-04T00:00:00.000Z",
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "mrt_ratings_private",
    "mrt_ratings_public",
    "mrt_tours_private",
    "mrt_tours_public",
  ]);
  assert.equal(payload.mrt_tours, undefined);
  assert.equal(payload.admins, undefined);
  assert.equal(payload.mrt_campaigns, undefined);
  assert.equal(report.legacyMrtToursIsArray, true);
  assert.equal(report.mode, "additive-production-cutover");
});

test("production cutover replaces embedded images only through the uploaded asset map", () => {
  const production = productionFixture();
  const embedded = "data:image/png;base64,aGVsbG8=";
  production.mrt_tours[0].listings[0].photos = [embedded];
  const hash = crypto.createHash("sha256").update(embedded).digest("hex");
  const url = "https://firebasestorage.googleapis.com/v0/b/marketready-tours.firebasestorage.app/o/photo.png?alt=media";

  assert.throws(
    () => buildProductionCutover({production}),
    /Embedded production image is missing from the demo asset map/,
  );

  const {payload, report} = buildProductionCutover({
    production,
    assetUrls: {[hash]: url},
  });
  assert.equal(payload.mrt_tours_private["tour-1"].listings[0].photos[0], url);
  assert.equal(report.embeddedImagesReplaced, 1);
  assert.equal(report.assetMapEntryCount, 1);
});

test("production cutover refuses a changed legacy data shape", () => {
  assert.throws(
    () => buildProductionCutover({production: {mrt_tours: {"tour-1": {id: "tour-1"}}}}),
    /legacy mrt_tours is not an array/,
  );
});

test("production asset writes require the exact project and Braydon approval", () => {
  assert.throws(
    () => assertProductionAssetApproval({project: "marketready-tours-dev", approval: PRODUCTION_APPROVAL}),
    /all other destinations are refused/,
  );
  assert.throws(
    () => assertProductionAssetApproval({project: "marketready-tours", approval: "not-approved"}),
    /Explicit Braydon production-cutover approval is required/,
  );
  assert.doesNotThrow(() => assertProductionAssetApproval({
    project: "marketready-tours",
    approval: PRODUCTION_APPROVAL,
  }));
});

test("production admin migration is dry-run safe and apply-gated", () => {
  assert.doesNotThrow(() => assertProductionAdminApproval({
    project: "marketready-tours",
    apply: false,
    approval: "",
  }));
  assert.throws(
    () => assertProductionAdminApproval({
      project: "marketready-tours",
      apply: true,
      approval: "",
    }),
    /Explicit Braydon production-cutover approval is required/,
  );
  assert.equal(legacyAdminEmail("admin@example,com", {}), "admin@example.com");
  assert.equal(migratedAdminRole({role: "super"}), "super");
  assert.equal(migratedAdminRole({role: "sub"}), "admin");
});

test("production App Check setup is dry-run safe and apply-gated", () => {
  assert.doesNotThrow(() => assertProductionAppCheckApproval({
    project: "marketready-tours",
    apply: false,
    approval: "",
  }));
  assert.throws(
    () => assertProductionAppCheckApproval({
      project: "marketready-tours",
      apply: true,
      approval: "",
    }),
    /Explicit Braydon production-cutover approval is required/,
  );
  assert.throws(
    () => assertProductionAppCheckApproval({
      project: "marketready-tours-dev",
      apply: false,
      approval: "",
    }),
    /all other projects are refused/,
  );
});

test("transitional rules preserve legacy rollback paths and expose refresh projections", async () => {
  const rules = JSON.parse(await readFile(
    new URL("../database.rules.transition.json", import.meta.url),
    "utf8",
  )).rules;

  assert.equal(rules[".read"], false);
  assert.equal(rules.mrt_tours[".read"], true);
  assert.equal(rules.mrt_tours[".write"], "auth != null");
  assert.equal(rules.mrt_tour_previews[".read"], true);
  assert.equal(rules.mrt_listing_requests[".write"], "auth != null");
  assert.equal(rules.mrt_tours_public[".read"], true);
  assert.equal(rules.mrt_tours_public[".write"], false);
  assert.match(rules.mrt_tours_private[".read"], /mrtRole/);
  assert.equal(rules.mrt_tours_private[".write"], false);
  assert.equal(rules.mrt_ratings_public[".read"], true);
  assert.equal(rules.mrt_idempotency[".read"], false);
});
