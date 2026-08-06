import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {Agent, fetch as undiciFetch} from "undici";

const require = createRequire(import.meta.url);
const firebaseAuth = require("firebase-tools/lib/auth");
const firebaseApi = require("firebase-tools/lib/apiv2");

const DESTINATION_PROJECT = "marketready-tours-dev";
const DESTINATION_BUCKET = "marketready-tours-dev.firebasestorage.app";
const dispatcher = new Agent({connect: {timeout: 60000}});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

function extensionFor(mimeType) {
  return ({
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  })[mimeType] || "bin";
}

function collectEmbeddedImages(value, jsonPath = "$", assets = new Map()) {
  if (typeof value === "string" && value.startsWith("data:image/")) {
    const match = /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(value);
    if (!match) throw new Error(`Unsupported embedded image at ${jsonPath}`);
    const bytes = Buffer.from(match[2], "base64");
    const hash = sha256(value);
    const existing = assets.get(hash) || {
      hash,
      mimeType: match[1].toLowerCase(),
      bytes,
      locations: [],
    };
    existing.locations.push(jsonPath);
    assets.set(hash, existing);
    return assets;
  }
  if (!value || typeof value !== "object") return assets;
  for (const [key, child] of Object.entries(value)) {
    collectEmbeddedImages(child, `${jsonPath}.${key}`, assets);
  }
  return assets;
}

async function accessToken() {
  const account = firebaseAuth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI is not logged in");
  firebaseAuth.setActiveAccount({}, account);
  const token = await firebaseApi.getAccessToken();
  if (!token) throw new Error("Firebase CLI did not return an access token");
  return token;
}

async function storageRequest(url, token, options = {}) {
  const {timeoutMs = 60000, ...requestOptions} = options;
  const response = await undiciFetch(url, {
    ...requestOptions,
    dispatcher,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(requestOptions.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response;
}

function downloadUrl(bucket, objectName, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}` +
    `/o/${encodeURIComponent(objectName)}?alt=media&token=${encodeURIComponent(token)}`;
}

async function uploadAsset(asset, {accessToken, sourceSha256, destinationBucket}) {
  const objectName = `snapshot-assets/${sourceSha256.slice(0, 16)}/${asset.hash}.${extensionFor(asset.mimeType)}`;
  const metadataUrl = `https://www.googleapis.com/storage/v1/b/${encodeURIComponent(destinationBucket)}` +
    `/o/${encodeURIComponent(objectName)}`;
  const existing = await storageRequest(metadataUrl, accessToken);
  if (existing.ok) {
    const metadata = await existing.json();
    const existingToken = String(metadata.metadata?.firebaseStorageDownloadTokens || "")
      .split(",").map((value) => value.trim()).find(Boolean);
    if (existingToken) {
      return {
        objectName,
        url: downloadUrl(destinationBucket, objectName, existingToken),
        reused: true,
      };
    }
  } else if (existing.status !== 404) {
    throw new Error(`Could not inspect snapshot Storage object (${existing.status})`);
  }

  const downloadToken = crypto.randomUUID();
  const startUrl = `https://www.googleapis.com/upload/storage/v1/b/${encodeURIComponent(destinationBucket)}` +
    `/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`;
  const start = await storageRequest(startUrl, accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Upload-Content-Type": asset.mimeType,
    },
    body: JSON.stringify({
      name: objectName,
      contentType: asset.mimeType,
      cacheControl: "public,max-age=31536000,immutable",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        mrtSnapshotSource: sourceSha256,
      },
    }),
  });
  if (!start.ok || !start.headers.get("location")) {
    throw new Error(`Could not start snapshot Storage upload (${start.status})`);
  }
  const uploadUrl = start.headers.get("location");
  const chunkSize = 256 * 1024;
  let uploaded = null;
  for (let offset = 0; offset < asset.bytes.length; offset += chunkSize) {
    const endExclusive = Math.min(offset + chunkSize, asset.bytes.length);
    const chunk = asset.bytes.subarray(offset, endExclusive);
    uploaded = await storageRequest(uploadUrl, accessToken, {
      method: "PUT",
      redirect: "manual",
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${endExclusive - 1}/${asset.bytes.length}`,
      },
      body: chunk,
      timeoutMs: 90000,
    });
    const isLast = endExclusive === asset.bytes.length;
    if ((!isLast && uploaded.status !== 308) || (isLast && !uploaded.ok)) {
      throw new Error(`Snapshot Storage chunk upload failed (${uploaded.status})`);
    }
  }
  return {
    objectName,
    url: downloadUrl(destinationBucket, objectName, downloadToken),
    reused: false,
  };
}

export async function uploadSnapshotAssets({
  sourcePath,
  outputPath,
  sourceProject,
  destinationProject,
  destinationBucket,
}) {
  if (![sourcePath, outputPath, sourceProject, destinationProject, destinationBucket].every(Boolean)) {
    throw new Error("Snapshot asset upload configuration is incomplete");
  }
  const sourceBytes = await fs.readFile(sourcePath);
  const sourceSha256 = sha256(sourceBytes);
  const source = JSON.parse(sourceBytes);
  const assets = [...collectEmbeddedImages(source.mrt_tours).values()];
  const token = await accessToken();
  const uploadedAssets = {};
  let reusedCount = 0;
  for (const [index, asset] of assets.entries()) {
    const uploaded = await uploadAsset(asset, {
      accessToken: token,
      sourceSha256,
      destinationBucket,
    });
    if (uploaded.reused) reusedCount += 1;
    uploadedAssets[asset.hash] = {
      mimeType: asset.mimeType,
      bytes: asset.bytes.length,
      locations: asset.locations,
      objectName: uploaded.objectName,
      url: uploaded.url,
    };
    console.log(JSON.stringify({asset: index + 1, total: assets.length, bytes: asset.bytes.length}));
  }
  const manifest = {
    sourceProject,
    destinationProject,
    destinationBucket,
    sourceSha256,
    assetCount: assets.length,
    reusedCount,
    uploadedCount: assets.length - reusedCount,
    assets: uploadedAssets,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o600});
  console.log(JSON.stringify({
    sourceProject: manifest.sourceProject,
    destinationProject: manifest.destinationProject,
    assetCount: manifest.assetCount,
    reusedCount: manifest.reusedCount,
    uploadedCount: manifest.uploadedCount,
  }, null, 2));
  return manifest;
}

async function main() {
  const sourceValue = argValue("source");
  const outputValue = argValue("output");
  if (!sourceValue || !outputValue) {
    throw new Error(
      "Usage: node scripts/upload-demo-snapshot-assets.mjs --source=<prod.json> --output=<map.json>",
    );
  }
  const sourcePath = path.resolve(sourceValue);
  const outputPath = path.resolve(outputValue);
  if (argValue("project") !== DESTINATION_PROJECT) {
    throw new Error(`Pass --project=${DESTINATION_PROJECT}; all other destinations are refused`);
  }
  await uploadSnapshotAssets({
    sourcePath,
    outputPath,
    sourceProject: "marketready-tours",
    destinationProject: DESTINATION_PROJECT,
    destinationBucket: DESTINATION_BUCKET,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
