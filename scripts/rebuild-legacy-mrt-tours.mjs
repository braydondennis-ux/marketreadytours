// Rebuild the legacy `mrt_tours` array from the live `mrt_tours_private` records.
//
// WHY THIS EXISTS
//   `mrt_tours` is the node the pre-refresh build (cd6f980) reads. The refresh never writes
//   to it, so it froze at cutover: every tour edited since then exists only in
//   `mrt_tours_private`. That makes a rollback silently LOSSY — it would serve pre-cutover
//   data. This script regenerates `mrt_tours` from the current source of truth, so a rollback
//   serves live data.
//
//   It also lets us DELETE `mrt_tours` from production to close audit M5 (that node is
//   world-readable and holds 33 tour access codes, 131 agentEmail / 128 agentPhone fields and
//   642 distinct email addresses). With this script, rollback becomes:
//       node scripts/rebuild-legacy-mrt-tours.mjs --apply
//       git push --force origin cd6f980:main
//   instead of depending on a stale node sitting permanently exposed.
//
// ORDERING IS LOAD-BEARING
//   The legacy security rules write ratings to `mrt_tours/$tour_index/ratings` — indexed by
//   ARRAY POSITION, not tour id. Reordering the array would attach existing ratings to the
//   wrong tours. So the original order is taken from the backup snapshot and preserved; tours
//   created after that snapshot are appended.
//
// Requires: gcloud auth application-default login
//
// Usage:
//   node scripts/rebuild-legacy-mrt-tours.mjs                 # dry run, prints a diff
//   node scripts/rebuild-legacy-mrt-tours.mjs --apply         # writes mrt_tours
//   node scripts/rebuild-legacy-mrt-tours.mjs --order=<file>  # custom order snapshot

import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
// Point at a real FILE: resolve() strips the trailing slash, and createRequire then
// resolves from the parent directory rather than functions/node_modules.
const require = createRequire(resolve(repo, "functions", "package.json"));
const {initializeApp, applicationDefault} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");

const apply = process.argv.includes("--apply");
const orderArg = process.argv.find((a) => a.startsWith("--order="));
const orderFile = orderArg
  ? orderArg.slice("--order=".length)
  : resolve(repo, ".mrt-backups/production-2026-08-10-post-cutover/production-latest.json");

// Fields the refresh added that the legacy build neither reads nor expects.
const REFRESH_ONLY = new Set(["updatedAt", "version", "updatedBy"]);

function toLegacyShape(tour) {
  const out = {};
  for (const [k, v] of Object.entries(tour)) {
    if (REFRESH_ONLY.has(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

initializeApp({
  credential: applicationDefault(),
  projectId: "marketready-tours",
  databaseURL: "https://marketready-tours-default-rtdb.firebaseio.com",
});
const db = getDatabase();

const priv = (await db.ref("mrt_tours_private").get()).val() || {};
const live = (await db.ref("mrt_tours").get()).val();

// Canonical ordering: the array positions recorded in the snapshot.
let order = [];
try {
  const snap = JSON.parse(await readFile(orderFile, "utf8"));
  order = (snap.mrt_tours || []).map((t) => (t && t.id != null ? String(t.id) : null));
} catch (e) {
  console.warn(`Could not read order snapshot (${orderFile}); falling back to live order.`);
  order = Array.isArray(live) ? live.map((t) => (t && t.id != null ? String(t.id) : null)) : [];
}

const rebuilt = [];
const used = new Set();
for (const id of order) {
  if (id != null && Object.hasOwn(priv, id)) {
    rebuilt.push(toLegacyShape(priv[id]));
    used.add(id);
  } else {
    // Tour deleted since the snapshot. Push null to hold the index so existing
    // ratings written against later indices do not shift onto the wrong tour.
    rebuilt.push(null);
  }
}
const appended = Object.keys(priv).filter((id) => !used.has(id)).sort();
for (const id of appended) rebuilt.push(toLegacyShape(priv[id]));

const liveCount = Array.isArray(live) ? live.filter(Boolean).length : (live ? Object.keys(live).length : 0);
console.log("=== rebuild legacy mrt_tours ===");
console.log("  source (mrt_tours_private) :", Object.keys(priv).length, "tours");
console.log("  currently in mrt_tours     :", liveCount, live === null ? "(node absent)" : "");
console.log("  rebuilt array length       :", rebuilt.length,
  `(${rebuilt.filter(Boolean).length} real, ${rebuilt.filter((t) => !t).length} tombstoned)`);
console.log("  preserved from snapshot    :", used.size);
console.log("  appended (created since)   :", appended.length, appended.length ? `→ ${appended.join(", ")}` : "");

if (!apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to write mrt_tours.");
  await db.goOffline();
  process.exit(0);
}

await db.ref("mrt_tours").set(rebuilt);
const after = (await db.ref("mrt_tours").get()).val();
console.log("\nWROTE mrt_tours —", (after || []).filter(Boolean).length, "tours now present.");
console.log("Rollback is now safe: git push --force origin cd6f980:main");
await db.goOffline();
process.exit(0);
