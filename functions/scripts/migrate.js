"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {initializeApp, applicationDefault} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {publicTourProjection, normalizeEmail, ratingAggregate} = require("../lib/domain");

const args = new Set(process.argv.slice(2));
const projectArg = process.argv.find((arg) => arg.startsWith("--project="));
const projectId = projectArg ? projectArg.split("=").slice(1).join("=") : "";
const apply = args.has("--apply");
const emulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);

if (!projectId) throw new Error("Pass --project=<project-id>.");
if (!emulator && projectId !== "marketready-tours-dev") {
  throw new Error(`Refusing to migrate non-dev project: ${projectId}`);
}
if (projectId === "marketready-tours" && !emulator) {
  throw new Error("Production migration is permanently blocked in this script.");
}

const databaseURL = emulator
  ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}`
  : "https://marketready-tours-dev-default-rtdb.firebaseio.com";

initializeApp({
  credential: emulator ? undefined : applicationDefault(),
  projectId,
  databaseURL,
});

const db = getDatabase();
const auth = getAuth();
const snapshot = await db.ref().get();
const source = snapshot.val() || {};
const timestamp = new Date().toISOString().replaceAll(":", "-");
const backupDir = path.resolve(__dirname, "../../.mrt-backups");
await fs.mkdir(backupDir, {recursive: true});
const backupPath = path.join(backupDir, `${projectId}-${timestamp}.json`);
await fs.writeFile(backupPath, JSON.stringify(source, null, 2));

const rawTourEntries = Array.isArray(source.mrt_tours)
  ? source.mrt_tours.map((tour, index) => [String(index), tour])
  : Object.entries(source.mrt_tours || {});
const rawTours = rawTourEntries
  .map(([key, tour]) => tour && typeof tour === "object" ? {...tour, id: tour.id || key} : null)
  .filter(Boolean);
const updates = {};

for (const rawTour of rawTours) {
  if (!rawTour?.id) continue;
  const tour = {
    ...rawTour,
    version: Number(rawTour.version || 1),
    updatedAt: Number(rawTour.updatedAt || Date.now()),
  };
  updates[`mrt_tours_private/${tour.id}`] = tour;
  updates[`mrt_tours_public/${tour.id}`] = publicTourProjection(tour);
}

for (const [tourId, byListing] of Object.entries(source.mrt_ratings || {})) {
  for (const [listingId, submissions] of Object.entries(byListing || {})) {
    const migratedRatings = {};
    for (const [submissionId, rating] of Object.entries(submissions || {})) {
      const legacyUid = `legacy_${crypto
        .createHash("sha256")
        .update(`${tourId}:${listingId}:${submissionId}`)
        .digest("hex")
        .slice(0, 24)}`;
      updates[`mrt_ratings_private/${tourId}/${listingId}/${legacyUid}`] = {
        ...rating,
        migratedFrom: submissionId,
      };
      migratedRatings[legacyUid] = rating;
    }
    updates[`mrt_ratings_public/${tourId}/${listingId}`] = {
      ...ratingAggregate(migratedRatings),
      updatedAt: Date.now(),
    };
  }
}

for (const [legacyKey, legacyAdmin] of Object.entries(source.admins || {})) {
  const decodedLegacyEmail = legacyKey.includes("@") ? legacyKey.replaceAll(",", ".") : "";
  const email = normalizeEmail(legacyAdmin?.email || decodedLegacyEmail);
  if (!email) continue;
  try {
    const user = await auth.getUserByEmail(email);
    const role = legacyAdmin.role === "super" ? "super" : "admin";
    updates[`admins/${user.uid}`] = {
      uid: user.uid,
      email,
      name: legacyAdmin.name || user.displayName || email.split("@")[0],
      role,
      active: true,
      migratedAt: Date.now(),
    };
    if (apply) await auth.setCustomUserClaims(user.uid, {mrtRole: role});
  } catch (error) {
    console.warn(`Skipping admin without an Auth user: ${email} (${error.code || error.message})`);
  }
}

const checksum = crypto
  .createHash("sha256")
  .update(JSON.stringify(updates))
  .digest("hex");

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  projectId,
  emulator,
  backupPath,
  tourCount: rawTours.length,
  updateCount: Object.keys(updates).length,
  checksum,
}, null, 2));

if (apply) {
  await db.ref().update(updates);
  await db.ref("mrt_migrations/private-public-v1").set({
    appliedAt: Date.now(),
    projectId,
    checksum,
    sourceTourCount: rawTours.length,
  });
  console.log("Migration applied. Legacy nodes were retained for rollback.");
} else {
  console.log("Dry run only. Re-run with --apply after reviewing the backup and summary.");
}
