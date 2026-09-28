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
// Landing page imagery (resized copies of photos from past tours).
await cp(resolve(root, "assets/landing"), resolve(out, "assets/landing"), {recursive: true});
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

// The app sits at /app/ in maintenance and landing modes. It references manifest.json, sw.js
// and icons/ RELATIVELY, so they must sit beside it there or they 404 and service-worker
// registration fails.
async function writeAppAtSubpath() {
  await mkdir(resolve(out, "app", "icons"), {recursive: true});
  await writeFile(resolve(out, "app", "index.html"), builtHtml);
  for (const file of ["manifest.json", "privacy-policy.html", "offline.html", "sw.js"]) {
    await cp(resolve(root, file), resolve(out, "app", file));
  }
  for (const file of ["app-icon-192.png", "app-icon-512.png"]) {
    await cp(resolve(root, "assets/icons", file), resolve(out, "app", "icons", file));
  }
}

// The landing page links into the app, so it needs to know where the app is.
const landingHtml = await readFile(resolve(root, "landing.html"), "utf8");
const landingFor = appBase => landingHtml.replaceAll("__MRT_APP_BASE__", appBase);

// Maintenance mode: the public root serves maintenance.html and the real app moves to
// /app/. The app is a static bundle, so /app/ is obscurity, NOT access control — put
// Cloudflare Access in front if genuine protection is needed. Flip MRT_MAINTENANCE to
// "0" in .github/workflows/pages.yml to go live again.
if (process.env.MRT_MAINTENANCE === "1") {
  await writeAppAtSubpath();
  await writeFile(resolve(out, "landing.html"), landingFor("app/"));
  await cp(resolve(root, "maintenance.html"), resolve(out, "index.html"));
  console.log("Built static web bundle in www/ — MAINTENANCE MODE (app at /app/)");
} else if (process.env.MRT_LANDING === "1") {
  // Landing mode (the public website): the landing page is the front door at / and the app
  // lives at /app/. The landing page forwards every #/ link to the app, so invite, opt-out
  // and payment links sent before the switch keep working. Only pages.yml sets this; local,
  // Vercel and Capacitor (iOS, webDir "www") builds keep the app at the root.
  await writeAppAtSubpath();
  await writeFile(resolve(out, "index.html"), landingFor("app/"));
  await writeFile(resolve(out, "landing.html"), landingFor("app/"));
  console.log("Built static web bundle in www/ — LANDING MODE (landing at /, app at /app/)");
} else {
  await writeFile(resolve(out, "index.html"), builtHtml);
  await writeFile(resolve(out, "landing.html"), landingFor("./"));
  // Since 2026-09-26 the app has emailed links under /app/ (they are built from
  // location.pathname). The website build keeps /app/ serving even with the landing page
  // off, so switching MRT_LANDING back to "0" cannot break a link already in someone's inbox.
  if (process.env.MRT_PUBLISH_APP_SUBPATH === "1") await writeAppAtSubpath();
  console.log("Built static web bundle in www/" + (process.env.MRT_PUBLISH_APP_SUBPATH === "1" ? " (app also at /app/)" : ""));
}
