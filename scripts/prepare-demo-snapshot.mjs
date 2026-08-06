import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

const require = createRequire(import.meta.url);
const {publicTourProjection, ratingAggregate} = require("../functions/lib/domain");

const TRANSIENT_DEV_ROOTS = Object.freeze([
  "mrt_contact_requests",
  "mrt_favorites",
  "mrt_idempotency",
  "mrt_invoices",
  "mrt_rate_limits",
  "mrt_rating_grants",
  "mrt_ratings",
  "mrt_reminders",
  "mrt_sponsor_signups",
  "mrt_tour_requests",
  "mrt_webhook_events",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entries(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]).filter(([, item]) => item != null);
  }
  return Object.entries(isObject(value) ? value : {}).filter(([, item]) => item != null);
}

function assertFirebaseKey(value, label) {
  const key = String(value || "").trim();
  if (!key || /[.#$[\]/]/.test(key)) throw new Error(`${label} is not a safe Firebase key`);
  return key;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deterministicId(scope, ...parts) {
  return `${scope}_${sha256(parts.map((part) => stableJson(part)).join("\n")).slice(0, 24)}`;
}

function httpUrl(value, {allowEmpty = true} = {}) {
  const text = String(value || "").trim();
  if (!text && allowEmpty) return "";
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function replaceImage(value, assetUrls, stats) {
  const text = String(value || "");
  if (!text) return "";
  const direct = httpUrl(text);
  if (direct) return direct;
  if (text.startsWith("data:image/")) {
    const mapped = assetUrls[sha256(text)];
    if (!mapped) throw new Error("Embedded production image is missing from the demo asset map");
    stats.embeddedImagesReplaced += 1;
    return mapped;
  }
  stats.invalidImageValuesRemoved += 1;
  return "";
}

function keyedByListing(value, listings) {
  if (!Array.isArray(value)) return isObject(value) ? value : {};
  return Object.fromEntries(
    value
      .map((entry, index) => [listings[index]?.id, entry])
      .filter(([listingId, entry]) => listingId && entry != null),
  );
}

function normalizedTour(raw, sourceKey, assetUrls, stats) {
  if (!isObject(raw)) throw new Error(`Tour ${sourceKey} is not an object`);
  const id = assertFirebaseKey(raw.id || sourceKey, `Tour ${sourceKey} id`);
  const listings = entries(raw.listings).map(([listingKey, listing], index) => {
    if (!isObject(listing)) throw new Error(`Tour ${id} listing ${listingKey} is not an object`);
    const listingId = assertFirebaseKey(
      listing.id == null ? `legacy-listing-${index + 1}` : listing.id,
      `Tour ${id} listing id`,
    );
    return {
      ...listing,
      id: listingId,
      order: Number.isFinite(Number(listing.order)) ? Number(listing.order) : index,
      photos: entries(listing.photos).map(([, photo]) => replaceImage(photo, assetUrls, stats)).filter(Boolean),
    };
  });
  const sponsors = entries(raw.sponsors).map(([sponsorKey, sponsor]) => {
    if (!isObject(sponsor)) throw new Error(`Tour ${id} sponsor ${sponsorKey} is not an object`);
    const paid = sponsor.paid === true || sponsor.paymentStatus === "paid";
    const website = httpUrl(sponsor.website || sponsor.url || "");
    if ((sponsor.website || sponsor.url) && !website) stats.invalidSponsorWebsitesRemoved += 1;
    return {
      ...sponsor,
      id: assertFirebaseKey(
        sponsor.id || deterministicId("legacy-sponsor", id, sponsorKey, sponsor.name || ""),
        `Tour ${id} sponsor id`,
      ),
      website,
      url: website,
      logo: replaceImage(sponsor.logo, assetUrls, stats),
      headshot: replaceImage(sponsor.headshot, assetUrls, stats),
      paid,
      paymentStatus: paid ? "paid" : "unpaid",
    };
  });
  const parsedUpdatedAt = Date.parse(raw.lastModified || "");
  return {
    ...raw,
    id,
    listings,
    sponsors,
    ratings: keyedByListing(raw.ratings, listings),
    ratingSubmissions: keyedByListing(raw.ratingSubmissions, listings),
    favorites: keyedByListing(raw.favorites, listings),
    agentPhoto: replaceImage(raw.agentPhoto, assetUrls, stats),
    brokerageLogo: replaceImage(raw.brokerageLogo, assetUrls, stats),
    version: Math.max(1, Number(raw.version) || 1),
    updatedAt: Number(raw.updatedAt) || (Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : 1),
  };
}

function migrateRatings(tour) {
  const privateByListing = {};
  const publicByListing = {};
  const submissionRoots = isObject(tour.ratingSubmissions) ? tour.ratingSubmissions : {};

  for (const [listingIdRaw, rawSubmissions] of Object.entries(submissionRoots)) {
    const listingId = assertFirebaseKey(listingIdRaw, `Tour ${tour.id} rating listing id`);
    const migrated = {};
    for (const [submissionKey, submission] of entries(rawSubmissions)) {
      if (!isObject(submission)) continue;
      const uid = deterministicId("legacy", tour.id, listingId, submissionKey, submission);
      migrated[uid] = {
        ...submission,
        migratedFrom: String(submissionKey),
        migrationSource: "production-snapshot",
      };
    }
    if (Object.keys(migrated).length) {
      privateByListing[listingId] = migrated;
      publicByListing[listingId] = {
        ...ratingAggregate(migrated),
        updatedAt: tour.updatedAt,
      };
    }
  }

  for (const [listingIdRaw, averages] of Object.entries(tour.ratings || {})) {
    const listingId = assertFirebaseKey(listingIdRaw, `Tour ${tour.id} aggregate listing id`);
    if (publicByListing[listingId] || !isObject(averages)) continue;
    publicByListing[listingId] = {
      count: 0,
      averages: Object.fromEntries(
        Object.entries(averages)
          .filter(([, value]) => Number.isFinite(Number(value)))
          .map(([key, value]) => [key, Number(value)]),
      ),
      updatedAt: tour.updatedAt,
      legacyAggregateOnly: true,
    };
  }
  return {privateByListing, publicByListing};
}

export function prepareDemoSnapshot({
  production,
  demo,
  sourceSha256 = "",
  snapshotAt = "",
  assetUrls = {},
}) {
  if (!isObject(production) || !isObject(demo)) {
    throw new Error("Production and demo backups must be JSON objects");
  }
  const candidate = structuredClone(demo);
  for (const root of TRANSIENT_DEV_ROOTS) delete candidate[root];

  const privateTours = {};
  const publicTours = {};
  const legacyTours = {};
  const ratingsPrivate = {};
  const ratingsPublic = {};
  let listingCount = 0;
  let sponsorCount = 0;
  let paidSponsorCount = 0;
  let ratingSubmissionCount = 0;
  let legacyFavoriteCount = 0;
  const normalizationStats = {
    embeddedImagesReplaced: 0,
    invalidImageValuesRemoved: 0,
    invalidSponsorWebsitesRemoved: 0,
  };

  for (const [sourceKey, raw] of entries(production.mrt_tours)) {
    const tour = normalizedTour(raw, sourceKey, assetUrls, normalizationStats);
    if (privateTours[tour.id]) throw new Error(`Duplicate tour id: ${tour.id}`);
    privateTours[tour.id] = tour;
    publicTours[tour.id] = publicTourProjection(tour);
    legacyTours[tour.id] = tour;
    listingCount += tour.listings.length;
    sponsorCount += tour.sponsors.length;
    paidSponsorCount += tour.sponsors.filter((sponsor) => sponsor.paid === true).length;
    legacyFavoriteCount += Object.values(tour.favorites || {}).filter(Boolean).length;

    const migrated = migrateRatings(tour);
    if (Object.keys(migrated.privateByListing).length) {
      ratingsPrivate[tour.id] = migrated.privateByListing;
      ratingSubmissionCount += Object.values(migrated.privateByListing)
        .reduce((sum, byUid) => sum + Object.keys(byUid).length, 0);
    }
    if (Object.keys(migrated.publicByListing).length) {
      ratingsPublic[tour.id] = migrated.publicByListing;
    }
  }

  candidate.mrt_tours = legacyTours;
  candidate.mrt_tours_private = privateTours;
  candidate.mrt_tours_public = publicTours;
  if (Object.keys(ratingsPrivate).length) candidate.mrt_ratings_private = ratingsPrivate;
  if (Object.keys(ratingsPublic).length) candidate.mrt_ratings_public = ratingsPublic;
  candidate.mrt_tour_previews = structuredClone(production.mrt_tour_previews || {});
  candidate.mrt_listing_requests = structuredClone(production.mrt_listing_requests || {});
  candidate.mrt_campaigns = structuredClone(production.mrt_campaigns || {});
  candidate.mrt_settings = structuredClone(production.mrt_settings || {});
  candidate.mrt_snapshot_metadata = {
    sourceProject: "marketready-tours",
    destinationProject: "marketready-tours-dev",
    sourceSha256,
    snapshotAt,
    outboundDisabled: true,
    authUsersCopied: false,
  };

  const candidateJson = `${stableJson(candidate)}\n`;
  const report = {
    sourceProject: "marketready-tours",
    destinationProject: "marketready-tours-dev",
    sourceSha256,
    snapshotAt,
    candidateSha256: sha256(candidateJson),
    adminCountPreservedFromDemo: Object.keys(candidate.admins || {}).length,
    authUsersCopied: 0,
    tourCount: Object.keys(privateTours).length,
    listingCount,
    sponsorCount,
    paidSponsorCount,
    unpaidSponsorCount: sponsorCount - paidSponsorCount,
    publicSponsorCount: Object.values(publicTours)
      .reduce((sum, tour) => sum + (tour.sponsors || []).length, 0),
    ratingSubmissionCount,
    legacyFavoriteCountPreservedPrivately: legacyFavoriteCount,
    ...normalizationStats,
    productionStorageReferencesRemainAbsolute: true,
    transientDemoRootsRemoved: TRANSIENT_DEV_ROOTS,
  };
  return {candidate, candidateJson, report};
}

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

async function main() {
  const productionValue = argValue("production");
  const demoValue = argValue("demo");
  const outputValue = argValue("output");
  const reportValue = argValue("report");
  const assetMapValue = argValue("asset-map");
  if (![productionValue, demoValue, outputValue, reportValue].every(Boolean)) {
    throw new Error(
      "Usage: node scripts/prepare-demo-snapshot.mjs --production=<prod.json> " +
      "--demo=<dev.json> --output=<candidate.json> --report=<report.json>",
    );
  }
  const productionPath = path.resolve(productionValue);
  const demoPath = path.resolve(demoValue);
  const outputPath = path.resolve(outputValue);
  const reportPath = path.resolve(reportValue);
  const assetMapPath = assetMapValue ? path.resolve(assetMapValue) : "";
  const [productionBytes, demoBytes, productionStat, assetMapBytes] = await Promise.all([
    fs.readFile(productionPath),
    fs.readFile(demoPath),
    fs.stat(productionPath),
    assetMapPath ? fs.readFile(assetMapPath) : Promise.resolve(Buffer.from("{}")),
  ]);
  const assetMap = JSON.parse(assetMapBytes);
  const result = prepareDemoSnapshot({
    production: JSON.parse(productionBytes),
    demo: JSON.parse(demoBytes),
    sourceSha256: sha256(productionBytes),
    snapshotAt: productionStat.mtime.toISOString(),
    assetUrls: Object.fromEntries(
      Object.entries(assetMap.assets || {}).map(([hash, asset]) => [hash, asset.url]),
    ),
  });
  await fs.writeFile(outputPath, result.candidateJson, {mode: 0o600});
  await fs.writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, {mode: 0o600});
  console.log(JSON.stringify(result.report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
