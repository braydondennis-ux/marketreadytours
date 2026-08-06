// Produce the ADDITIVE production cutover payload.
//
// Unlike prepare-demo-snapshot.mjs (prod -> isolated dev), this targets production in place
// and is deliberately non-destructive:
//
//   * It writes ONLY the new roots the refresh build reads
//     (mrt_tours_public / mrt_tours_private / mrt_ratings_public / mrt_ratings_private).
//   * It NEVER touches mrt_tours. The live build reads that node and calls tours.map(), so it
//     must stay an ARRAY. prepareDemoSnapshot rewrites mrt_tours into an id-keyed object,
//     which would break the current site and destroy our instant rollback - so that key is
//     explicitly dropped from the output here.
//   * It never deletes anything. TRANSIENT_DEV_ROOTS removal is a dev-reset behaviour and is
//     not applied to production.
//
// Result: both builds run against the same database. Rolling back is a frontend revert, with
// no data restore required.
//
// Usage:
//   node scripts/prepare-production-cutover.mjs --production=<prod.json> --output=<payload.json> --report=<report.json>

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {prepareDemoSnapshot} from "./prepare-demo-snapshot.mjs";

// Roots the refresh build reads and the legacy build does not. Only these get written.
const ADDITIVE_ROOTS = Object.freeze([
  "mrt_tours_public",
  "mrt_tours_private",
  "mrt_ratings_public",
  "mrt_ratings_private",
]);

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function buildProductionCutover({
  production,
  snapshotAt = "",
  sourceSha256 = "",
  assetUrls = {},
}) {
  if (!Array.isArray(production?.mrt_tours)) {
    throw new Error("Refusing production cutover because legacy mrt_tours is not an array.");
  }
  // Base the candidate on production itself so nothing existing is invented or dropped.
  const {candidate, report} = prepareDemoSnapshot({
    production,
    demo: production,
    sourceSha256,
    snapshotAt,
    assetUrls,
  });

  const payload = {};
  for (const root of ADDITIVE_ROOTS) {
    if (candidate[root] && Object.keys(candidate[root]).length) payload[root] = candidate[root];
  }

  // Guard rails - these must never appear in a production cutover payload.
  if ("mrt_tours" in payload) throw new Error("Refusing to write mrt_tours; the legacy build needs it unchanged.");
  const legacyIsArray = true;

  const cutoverReport = {
    mode: "additive-production-cutover",
    project: "marketready-tours",
    snapshotAt,
    sourceSha256,
    rootsWritten: Object.keys(payload),
    rootsDeliberatelyUntouched: ["mrt_tours", "admins", "mrt_campaigns", "mrt_settings", "mrt_tour_previews", "mrt_listing_requests"],
    legacyMrtToursIsArray: legacyIsArray,
    tourCount: report.tourCount,
    listingCount: report.listingCount,
    sponsorCount: report.sponsorCount,
    paidSponsorCount: report.paidSponsorCount,
    publicSponsorCount: report.publicSponsorCount,
    ratingSubmissionCount: report.ratingSubmissionCount,
    embeddedImagesReplaced: report.embeddedImagesReplaced,
    assetMapEntryCount: Object.keys(assetUrls).length,
  };
  return {payload, report: cutoverReport};
}

async function main() {
  const productionValue = argValue("production");
  const outputValue = argValue("output");
  const reportValue = argValue("report");
  const assetMapValue = argValue("asset-map");
  if (![productionValue, outputValue, reportValue].every(Boolean)) {
    throw new Error(
      "Usage: node scripts/prepare-production-cutover.mjs --production=<prod.json> " +
      "--output=<payload.json> --report=<report.json>",
    );
  }
  const [productionBytes, assetMapBytes] = await Promise.all([
    fs.readFile(path.resolve(productionValue)),
    assetMapValue ? fs.readFile(path.resolve(assetMapValue)) : Promise.resolve(Buffer.from("{}")),
  ]);
  const production = JSON.parse(productionBytes);
  const assetMap = JSON.parse(assetMapBytes);
  const {payload, report} = buildProductionCutover({
    production,
    snapshotAt: new Date().toISOString(),
    sourceSha256: sha256(productionBytes),
    assetUrls: Object.fromEntries(
      Object.entries(assetMap.assets || {}).map(([hash, asset]) => [hash, asset.url]),
    ),
  });
  await fs.writeFile(path.resolve(outputValue), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.resolve(reportValue), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
