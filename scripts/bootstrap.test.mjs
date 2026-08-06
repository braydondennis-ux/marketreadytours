import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("public rendering is not blocked by anonymous Firebase authentication", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const authStart = source.indexOf("// Listen for Firebase Auth state changes.");
  const authEnd = source.indexOf("const handleLogout", authStart);
  const authEffect = source.slice(authStart, authEnd);
  const noUserBranch = authEffect.slice(authEffect.indexOf("} else {"));

  assert.ok(authStart >= 0 && authEnd > authStart, "Firebase Auth bootstrap effect is present");
  assert.match(authEffect, /setTimeout\(finishAuthLoading, 5000\)/);
  assert.ok(
    noUserBranch.indexOf("finishAuthLoading();") < noUserBranch.indexOf("_fbAuth.signInAnonymously()"),
    "the public shell renders before anonymous authentication begins",
  );
  assert.doesNotMatch(noUserBranch, /await\s+_fbAuth\.signInAnonymously\(\)/);
});

test("tour loading falls back when the Firebase realtime read never settles", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const helperMatch = source.match(/const mrtWithTimeout = ([\s\S]*?);\n\/\* ── OFFLINE BANNER/);

  assert.ok(helperMatch, "Firebase promise timeout helper is present");
  const withTimeout = new Function("return (" + helperMatch[1] + ")")();
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "Firebase realtime read"),
    /Firebase realtime read timed out/,
  );

  const syncStart = source.indexOf("// Firebase sync — real-time for admins, polling for regular users");
  const syncEnd = source.indexOf("// Debounced write to Firebase", syncStart);
  const syncEffect = source.slice(syncStart, syncEnd);

  assert.match(syncEffect, /mrtWithTimeout\(sdkLoad, 3500, "Firebase realtime read"\)/);
  assert.match(syncEffect, /const _dbBase = \(!window\._MRT_LOCAL/);
  assert.doesNotMatch(syncEffect, /const _dbBase = \(!MRT_SECURE_BACKEND/);
  assert.match(syncEffect, /headers\["X-Firebase-AppCheck"\] = appCheckToken\.token/);
  assert.match(syncEffect, /setFbLoadError\(true\)/);
  assert.match(source, /onRetryTours: \(\) => setFbLoadAttempt\(attempt => attempt \+ 1\)/);
});

test("the Past tab includes completed legacy tours without an archived flag", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(
    source,
    /const pastTours = tours\.filter\(t => !!t\.archived \|\| !!t\.date && t\.date < todayStr\)/,
  );
  assert.match(source, /showArchived\s*\? pastTours/);
});

test("every hosted build initializes App Check and targets its selected Firebase project", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(source, /if \(!window\._MRT_LOCAL\) \{[\s\S]*?_fbAppCheck\.activate\(appCheckSiteKey, true\)/);
  assert.match(source, /MRT_APP_CHECK_SITE_KEY is required for a hosted build/);
  assert.match(source, /new firebase\.appCheck\.ReCaptchaEnterpriseProvider\(appCheckSiteKey\)/);
  assert.match(
    source,
    /"https:\/\/us-central1-" \+ _fbConfig\.projectId \+ "\.cloudfunctions\.net\/" \+ name/,
  );
});

test("Functions deploys are restricted to the two MarketReady projects", async () => {
  const source = await readFile(new URL("../functions/index.js", import.meta.url), "utf8");

  assert.match(source, /"marketready-tours-dev": "firebase-adminsdk-fbsvc@marketready-tours-dev/);
  assert.match(source, /"marketready-tours": "191980265978-compute@developer\.gserviceaccount\.com"/);
  assert.match(source, /Object\.hasOwn\(REMOTE_PROJECT_SERVICE_ACCOUNTS, current\)/);
});

test("Square Sandbox invoicing cannot be exposed on production", async () => {
  const [clientSource, functionSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  ]);

  assert.match(
    clientSource,
    /const MRT_SQUARE_SANDBOX = MRT_SECURE_BACKEND && \(window\._MRT_LOCAL \|\| _USE_DEV\)/,
  );
  assert.match(
    clientSource,
    /\(sp\.email \|\| sp\.phone\) && !sponsorPaid && MRT_SPONSOR_PAYMENT_ACTIONS/,
  );
  assert.match(clientSource, /MRT_MANUAL_PAYMENTS \? "Send Invoice"/);
  assert.match(
    functionSource,
    /return isEmulator \|\| projectId\(\) === "marketready-tours-dev"/,
  );
  assert.match(
    functionSource,
    /Sponsor invoicing is disabled until the production Square integration is configured/,
  );
});

test("production account setup uses Firebase Auth reset delivery", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(source, /if \(MRT_SECURE_BACKEND && _USE_DEV\) \{\s*await mrtCall\("requestAdminPasswordReset"/);
  assert.match(source, /if \(!_USE_DEV && _fbAuth\) await _fbAuth\.sendPasswordResetEmail\(admin\.email\)/);
  assert.match(source, /if \(MRT_SECURE_BACKEND && _USE_DEV\) \{\s*await mrtCall\("sendAdminPasswordReset"/);
});

test("production preserves secure manual sponsor payment operations", async () => {
  const [clientSource, functionSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /const MRT_MANUAL_PAYMENTS = MRT_SECURE_BACKEND && !window\._MRT_LOCAL && !_USE_DEV/);
  assert.match(clientSource, /await mrtCall\("markSponsorPaid"/);
  assert.match(clientSource, /Venmo: @MarketReadyTours/);
  assert.match(clientSource, /Zelle: payments@marketreadytours\.com/);
  assert.match(clientSource, /Text Invoice/);
  assert.match(functionSource, /exports\.markSponsorPaid = onCall/);
  assert.match(functionSource, /paymentMethod: paid \? "manual" : null/);
  assert.match(functionSource, /MRT_ALLOW_LIVE_TRANSACTIONAL_EMAIL/);
  assert.match(functionSource, /MRT_ALLOW_LIVE_INSTANTLY/);
});
