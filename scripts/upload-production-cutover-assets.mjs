import path from "node:path";
import {pathToFileURL} from "node:url";
import {uploadSnapshotAssets} from "./upload-demo-snapshot-assets.mjs";

const PRODUCTION_PROJECT = "marketready-tours";
const PRODUCTION_BUCKET = "marketready-tours.firebasestorage.app";
export const PRODUCTION_APPROVAL = "BRAYDON_APPROVED_MARKETREADY_PRODUCTION_CUTOVER";

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

export function assertProductionAssetApproval({project, approval}) {
  if (project !== PRODUCTION_PROJECT) {
    throw new Error(`Pass --project=${PRODUCTION_PROJECT}; all other destinations are refused`);
  }
  if (approval !== PRODUCTION_APPROVAL) {
    throw new Error("Explicit Braydon production-cutover approval is required");
  }
}

async function main() {
  const sourceValue = argValue("source");
  const outputValue = argValue("output");
  if (!sourceValue || !outputValue) {
    throw new Error(
      "Usage: node scripts/upload-production-cutover-assets.mjs " +
      "--source=<prod.json> --output=<map.json> --project=marketready-tours " +
      `--approval=${PRODUCTION_APPROVAL}`,
    );
  }
  assertProductionAssetApproval({
    project: argValue("project"),
    approval: argValue("approval"),
  });
  await uploadSnapshotAssets({
    sourcePath: path.resolve(sourceValue),
    outputPath: path.resolve(outputValue),
    sourceProject: PRODUCTION_PROJECT,
    destinationProject: PRODUCTION_PROJECT,
    destinationBucket: PRODUCTION_BUCKET,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
