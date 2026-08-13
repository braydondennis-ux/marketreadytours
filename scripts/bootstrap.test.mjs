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
  assert.match(source, /"aria-pressed": !showArchived/);
  assert.match(source, /"aria-pressed": showArchived/);
});

test("Safari-safe rankings do not depend on the entrance animation", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const rankingStart = source.indexOf("function RankingPage");
  const rankingEnd = source.indexOf("function SummaryDashboard", rankingStart);
  const rankingPage = source.slice(rankingStart, rankingEnd);

  assert.match(rankingPage, /className: "mrt-card mrt-press mrt-ranking-card"/);
  assert.doesNotMatch(rankingPage, /className: "fade-in mrt-card mrt-press"/);
});

/* Added 2026-08-13. Tour cards were invisible on mobile Safari — present in the accessibility
   tree, blank on screen, so the whole site looked empty to an iPhone visitor. Cause:
   `.mrt-fade-stagger` used `animation: fadeIn .5s ... both` together with an inline
   animationDelay of up to 0.9s. The backwards half of `both` paints the keyframe's `from`
   state (opacity:0) during that delay, so a card whose animation never ran stayed hidden
   permanently.

   This is the SECOND time this class of bug shipped — see the ranking-card test above. The
   rule is that content visibility must never depend on an animation having run. */
test("tour cards stay visible when the entrance animation does not run", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

  const stagger = source.match(/\.mrt-fade-stagger\{animation:[^}]*\}/);
  assert.ok(stagger, ".mrt-fade-stagger rule is present");

  // No fill-mode. `both`/`backwards` reintroduce the invisible-forever failure.
  assert.doesNotMatch(stagger[0], /\b(both|backwards)\b/);

  // No stagger delay: without backwards fill a delay makes cards blink from visible to hidden.
  assert.doesNotMatch(source, /animationDelay:/);

  // The keyframe itself may still start transparent — that is fine once nothing fills backwards.
  assert.match(source, /@keyframes fadeIn\{from\{opacity:0/);
});

test("admin sign-in and profile reads cannot remain pending forever", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(source, /mrtWithTimeout\(user\.getIdTokenResult\(true\), 8000, "Admin authorization"\)/);
  assert.match(source, /mrtWithTimeout\(_fb\.ref\("admins\/" \+ user\.uid\)\.once\("value"\), 5000, "Admin profile"\)/);
  assert.match(source, /mrtWithTimeout\([\s\S]*?_fbAuth\.signInWithEmailAndPassword[\s\S]*?12000,[\s\S]*?"Sign in"/);
});

/* Rewritten 2026-08-11. This previously asserted the success page must say "we'll follow up
   with payment instructions" and must NOT claim payment succeeded — correct while sponsorship
   was manual-only and nothing could confirm a payment.
   Clover Hosted Checkout now confirms payments, and #/payment-success is reached ONLY from
   Clover's success redirect (functions/index.js sets it as redirectUrls.success; no in-app
   navigation targets it). Telling someone who has just paid that we will follow up with
   payment instructions invites a double payment. The guard that still matters is that the
   page is reachable only after a real payment, which is asserted below. */
test("the payment success page is reached only from Clover and confirms payment", async () => {
  const [source, functionsSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  ]);

  // Only Clover's success redirect sends anyone to this route.
  assert.match(functionsSource, /success: "https:\/\/marketreadytours\.com\/#\/payment-success"/);
  assert.doesNotMatch(source, /hash = "\/payment-success"/);

  // And it tells them the payment is done, not that money is still owed.
  assert.match(source, /"Payment Received"/);
  assert.doesNotMatch(source, /payment instructions, and next steps/);

  // The cancel page still exists for abandoned checkouts.
  assert.match(source, /Sponsorship Not Completed/);
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
  /* What matters is that production takes the MANUAL branch rather than exposing Square
     sandbox invoicing — not the button's wording. Previously pinned to the exact string
     "Send Invoice", which broke when the label was clarified to distinguish it from the
     Clover payment link. Assert the guard, not the copy. */
  assert.match(clientSource, /MRT_MANUAL_PAYMENTS \? "[^"]*Invoice[^"]*"/);
  assert.match(
    functionSource,
    /return isEmulator \|\| projectId\(\) === "marketready-tours-dev"/,
  );
  assert.match(
    functionSource,
    /Sponsor invoicing is disabled until the production Square integration is configured/,
  );
});

/* Rewritten 2026-08-12. This previously asserted that PRODUCTION used Firebase Auth to
   deliver reset emails, with our own callables reserved for dev. That was right while our
   sender was consumer Gmail SMTP and inconsistently spam-filtered. Two things changed:
   Firebase LOCKED email template editing on this project ("Email template updates are
   currently unavailable"), so its emails can never be branded; and our sender is now Resend
   as noreply@marketreadytours.com, domain-authenticated with delivery logs.

   The property that actually matters is ONE SENDER PER ACTION. Two senders means two
   oobCodes, Firebase invalidates the earlier one, and the invitee receives two emails of
   which one is always dead — observed in production on 2026-08-11. */
test("exactly one sender handles each account email, and it is ours", async () => {
  const [source, functionsSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  ]);

  // Reset requests go through our callables in production, not only in dev.
  assert.match(source, /if \(MRT_SECURE_BACKEND\) \{\s*await mrtCall\("requestAdminPasswordReset"/);
  assert.match(source, /if \(MRT_SECURE_BACKEND\) \{\s*await mrtCall\("sendAdminPasswordReset"/);

  // The client must NOT also send after creating an admin — that was the double-send.
  assert.doesNotMatch(source, /sendPasswordResetEmail\(admin\.email\)/);

  // createAdmin owns setup delivery, and generates exactly one link to do it.
  const createAdmin = functionsSource.slice(
    functionsSource.indexOf("exports.createAdmin"),
    functionsSource.indexOf("exports.updateAdmin"),
  );
  assert.match(createAdmin, /generatePasswordResetLink/);
  assert.match(createAdmin, /Set up your MarketReady Tours account/);
  assert.equal(
    (createAdmin.match(/generatePasswordResetLink/g) || []).length, 1,
    "createAdmin must generate exactly one reset link — a second invalidates the first",
  );
});

/* Added 2026-08-13 after deleting a tour failed in production with an opaque INTERNAL 500.
   The confirm modal stores an id STRING (`setConfirmDelete(tour.id)`) and passes it to
   `persistDeleteTour`, which read `.id` off it — undefined on a string — so the callable got
   no tourId and threw. Both call sites looked correct in isolation; only the seam was wrong.
   Pin the seam: the modal keeps passing an id, and the handler keeps accepting one. */
test("deleting a tour survives the modal passing a bare id string", async () => {
  const [source, functionsSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  ]);

  // The modal stores an id, not the tour object.
  assert.match(source, /setConfirmDelete\(tour\.id\)/);

  // …so the handler must accept a string as well as an object.
  assert.match(source, /persistDeleteTour = async tourOrId/);
  assert.match(source, /typeof tourOrId === "string" \? tourOrId : tourOrId\?\.id/);

  // It must never send `.id` of a possibly-string argument again.
  const handler = source.slice(
    source.indexOf("const persistDeleteTour"),
    source.indexOf("const mergedTours"),
  );
  assert.doesNotMatch(handler, /tourId: tour\.id/);
  assert.doesNotMatch(handler, /Number\(tour\.version/);

  // The server still requires both fields, which is what made the mismatch fatal.
  const del = functionsSource.slice(
    functionsSource.indexOf("exports.deleteTour"),
    functionsSource.indexOf("exports.", functionsSource.indexOf("exports.deleteTour") + 10),
  );
  assert.match(del, /cleanText\(request\.data\?\.tourId, 128, "tourId", true\)/);
  assert.match(del, /expectedVersion/);
});

/* Added 2026-08-13 after an accessibility audit accidentally created a real tour in production.
   The tour card was role="button" tabIndex=0 while containing real <button> elements for
   Duplicate / Archive / Delete. Safari flattened that into one ambiguous control, so activating
   what looked like the card fired Duplicate. The accessible activator is the "Open Tour" button
   that already existed inside the card. */
test("the tour card is a container, not a control wrapping other controls", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

  const cardStart = source.indexOf('className: "mrt-card mrt-card--soft mrt-press"');
  assert.ok(cardStart > 0, "tour card element is present");
  const card = source.slice(cardStart, cardStart + 900);

  assert.doesNotMatch(card, /role: "button"/);
  assert.doesNotMatch(card, /tabIndex: 0/);
  assert.doesNotMatch(card, /onKeyDown/);

  // The real, focusable way into a tour must still exist.
  assert.match(source, /className: "btn-hover mrt-press mrt-tourcard-open"/);
  assert.match(source, /"Open Tour"/);
});

/* Added 2026-08-13. Duplicating a tour cloned its sponsors verbatim — same ids, and
   paid: true — so a sponsor who paid for one tour was published on two, and tourId+sponsorId
   stopped being unique for markSponsorPaid and the Clover webhook. It also cloned the access
   code, letting a copy unlock ratings on the original. */
test("duplicating a tour does not clone payments, sponsor ids, or the access code", async () => {
  const [source, functionsSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  ]);

  const dup = source.slice(source.indexOf('name:tour.name+" (Copy)"') - 900,
    source.indexOf('name:tour.name+" (Copy)"') + 300);
  assert.match(dup, /id:uid\("sp"\)/);
  assert.match(dup, /paid:false/);
  assert.match(dup, /paymentStatus:"unpaid"/);
  assert.match(dup, /code:String\(Math\.floor\(1000\+Math\.random\(\)\*9000\)\)/);

  /* The server is the real guarantee — the client is only being honest about intent. Payment
     fields must come from the stored record, never from the request. */
  assert.match(functionsSource, /function sanitizeSponsorPayments/);
  assert.match(functionsSource, /next\.sponsors = sanitizeSponsorPayments\(raw\.sponsors, previous\?\.sponsors\)/);
  const sanitize = functionsSource.slice(
    functionsSource.indexOf("function sanitizeSponsorPayments"),
    functionsSource.indexOf("function normalizeTourForWrite"),
  );
  assert.match(sanitize, /for \(const field of SPONSOR_PAYMENT_FIELDS\) delete next\[field\]/);
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
