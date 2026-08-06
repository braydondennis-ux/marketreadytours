#!/usr/bin/env node

import {cp, mkdir, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "www");

await mkdir(out, {recursive: true});
await mkdir(resolve(out, "icons"), {recursive: true});
for (const file of ["manifest.json", "privacy-policy.html", "offline.html", "sw.js"]) {
  await cp(resolve(root, file), resolve(out, file));
}
for (const file of ["app-icon-192.png", "app-icon-512.png"]) {
  await cp(resolve(root, "assets/icons", file), resolve(out, "icons", file));
}
const appCheckSiteKey = process.env.MRT_APP_CHECK_SITE_KEY || "";
const appCheckProvider = process.env.MRT_APP_CHECK_PROVIDER || "v3";
if (process.env.VERCEL === "1" && !appCheckSiteKey) {
  throw new Error("MRT_APP_CHECK_SITE_KEY is required for every Vercel build.");
}
if (!["v3", "enterprise"].includes(appCheckProvider)) {
  throw new Error("MRT_APP_CHECK_PROVIDER must be v3 or enterprise.");
}
const sourceHtml = await readFile(resolve(root, "index.html"), "utf8");
const builtHtml = sourceHtml.replaceAll(
  "__MRT_APP_CHECK_SITE_KEY__",
  appCheckSiteKey || "__MRT_APP_CHECK_SITE_KEY__",
).replaceAll("__MRT_APP_CHECK_PROVIDER__", appCheckProvider);
await writeFile(resolve(out, "index.html"), builtHtml);

console.log("Built static web bundle in www/");
