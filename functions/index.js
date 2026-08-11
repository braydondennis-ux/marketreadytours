"use strict";

const crypto = require("node:crypto");
const {initializeApp, getApps} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {getStorage} = require("firebase-admin/storage");
const {logger} = require("firebase-functions");
const {defineSecret} = require("firebase-functions/params");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {
  APP_TIME_ZONE,
  RATING_KEYS,
  campaignOffsetsBeforeTour,
  cleanText,
  escapeHtml,
  isValidEmail,
  localYmd,
  normalizeEmail,
  phoenixDateTimeMs,
  publicTourProjection,
  ratingAggregate,
  stableHash,
  validateRating,
} = require("./lib/domain");
const {
  createSquareSandboxInvoice,
  sponsorPlanDetails,
} = require("./lib/square");

if (!getApps().length) initializeApp();

const REGION = "us-central1";
const REMOTE_PROJECT_SERVICE_ACCOUNTS = Object.freeze({
  "marketready-tours-dev": "firebase-adminsdk-fbsvc@marketready-tours-dev.iam.gserviceaccount.com",
  "marketready-tours": "191980265978-compute@developer.gserviceaccount.com",
});
const configuredProject = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
setGlobalOptions({
  ...(REMOTE_PROJECT_SERVICE_ACCOUNTS[configuredProject]
    ? {serviceAccount: REMOTE_PROJECT_SERVICE_ACCOUNTS[configuredProject]}
    : {}),
});
const INSTANTLY_WEBHOOK_SECRET = defineSecret("MRT_INSTANTLY_WEBHOOK_SECRET");
const SQUARE_WEBHOOK_SECRET = defineSecret("MRT_SQUARE_WEBHOOK_SECRET");
const SQUARE_WEBHOOK_URL = defineSecret("MRT_SQUARE_WEBHOOK_URL");
const SQUARE_ACCESS_TOKEN = defineSecret("MRT_SQUARE_ACCESS_TOKEN");
const SQUARE_LOCATION_ID = defineSecret("MRT_SQUARE_LOCATION_ID");
const runtimeParam = (name) => ({value: () => process.env[name] || ""});
const INSTANTLY_API_KEY = runtimeParam("MRT_INSTANTLY_API_KEY");
const OUTBOUND_ALLOWLIST = runtimeParam("MRT_OUTBOUND_ALLOWLIST");
const TRANSACTIONAL_EMAIL_URL = runtimeParam("MRT_TRANSACTIONAL_EMAIL_URL");
const SIGNING_SECRET = runtimeParam("MRT_SIGNING_SECRET");

const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
const callableOptions = {
  region: REGION,
  // HTTPS callables must be reachable at Cloud Run before Firebase Auth and App Check
  // can enforce application-level access inside the callable protocol.
  invoker: "public",
  enforceAppCheck: !isEmulator,
  cors: true,
};

function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
}

function assertSafeProject() {
  const current = projectId();
  if (isEmulator) return;
  if (!Object.hasOwn(REMOTE_PROJECT_SERVICE_ACCOUNTS, current)) {
    logger.error("Blocked MarketReady mutation outside an approved project", {projectId: current});
    throw new HttpsError(
      "failed-precondition",
      "This build is restricted to an approved MarketReady project.",
    );
  }
}

function assertAuthenticated(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Authentication is required.");
  return request.auth.uid;
}

function assertAdmin(request, superOnly = false) {
  const uid = assertAuthenticated(request);
  const role = request.auth.token?.mrtRole;
  if (!["super", "admin"].includes(role) || (superOnly && role !== "super")) {
    throw new HttpsError("permission-denied", "Administrative access is required.");
  }
  return {uid, role};
}

function assertRequestId(value) {
  const requestId = cleanText(value, 128, "requestId", true);
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "requestId contains unsupported characters.");
  }
  return requestId;
}

function publicError(error, fallback = "The request could not be completed.") {
  if (error instanceof HttpsError) return error;
  logger.error(fallback, error);
  return new HttpsError("internal", fallback);
}

async function idempotent(scope, uid, requestIdValue, work) {
  const requestId = assertRequestId(requestIdValue);
  const key = stableHash(`${scope}:${uid}:${requestId}`).slice(0, 48);
  const ref = getDatabase().ref(`mrt_idempotency/${scope}/${key}`);
  const claim = await ref.transaction((current) => {
    if (current) return;
    return {status: "processing", owner: uid, startedAt: Date.now()};
  });
  if (!claim.committed) {
    const existing = claim.snapshot.val();
    if (existing?.status === "complete") return existing.response;
    throw new HttpsError("aborted", "This request is already being processed.");
  }
  try {
    const response = await work(requestId);
    await ref.set({
      status: "complete",
      owner: uid,
      completedAt: Date.now(),
      response: response == null ? {ok: true} : response,
    });
    return response;
  } catch (error) {
    await ref.remove().catch(() => {});
    throw error;
  }
}

function clientIp(request) {
  const raw =
    request.rawRequest?.headers?.["x-forwarded-for"] ||
    request.rawRequest?.ip ||
    "unknown";
  return String(raw).split(",")[0].trim();
}

async function enforceRateLimit(scope, request, max = 10, windowMs = 60 * 60 * 1000) {
  const subject = request.auth?.uid || stableHash(clientIp(request), "mrt-rate-limit");
  const ref = getDatabase().ref(`mrt_rate_limits/${scope}/${subject}`);
  const now = Date.now();
  const result = await ref.transaction((current) => {
    const value = current || {count: 0, windowStartedAt: now};
    if (now - Number(value.windowStartedAt || 0) >= windowMs) {
      return {count: 1, windowStartedAt: now, updatedAt: now};
    }
    if (Number(value.count || 0) >= max) return;
    return {...value, count: Number(value.count || 0) + 1, updatedAt: now};
  });
  if (!result.committed) {
    throw new HttpsError("resource-exhausted", "Too many requests. Please try again later.");
  }
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secretAllowlist() {
  try {
    return new Set(
      OUTBOUND_ALLOWLIST.value()
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/**
 * True when outbound mail may go to any address.
 *
 * The allowlist is an explicit set of addresses, which is the right safety net for dev but
 * cannot work in production: real recipients are agents and sponsors who cannot be
 * enumerated ahead of time, so every genuine send would throw. Setting
 * MRT_OUTBOUND_ALLOWLIST to "*" opts a project out of the restriction. Any other value
 * (including empty) keeps the strict allowlist, so dev stays fenced by default.
 */
function allowlistIsUnrestricted() {
  try {
    return OUTBOUND_ALLOWLIST.value().trim() === "*";
  } catch {
    return false;
  }
}

function legacyOutboundIsLive() {
  return process.env.MRT_ALLOW_LIVE_OUTBOUND === "true";
}

function transactionalEmailIsLive() {
  return !isEmulator && (
    process.env.MRT_ALLOW_LIVE_TRANSACTIONAL_EMAIL === "true" || legacyOutboundIsLive()
  );
}

function instantlyIsLive() {
  return !isEmulator && (
    process.env.MRT_ALLOW_LIVE_INSTANTLY === "true" || legacyOutboundIsLive()
  );
}

function squareSandboxIsEnabled() {
  return isEmulator || projectId() === "marketready-tours-dev";
}

async function sendTransactionalEmail({to, subject, text, html}) {
  const recipient = normalizeEmail(to);
  if (!isValidEmail(recipient)) throw new Error("Invalid email recipient");
  if (!transactionalEmailIsLive()) {
    logger.info("Mock transactional email", {to: recipient, subject});
    return {ok: true, mocked: true};
  }
  if (!allowlistIsUnrestricted() && !secretAllowlist().has(recipient)) {
    throw new Error("Recipient is not on the dev outbound allowlist");
  }
  const url = TRANSACTIONAL_EMAIL_URL.value();
  if (!url) throw new Error("Transactional email service is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({to: recipient, subject, message: text, html}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Transactional email failed (${response.status})`);
  return {ok: true, mocked: false};
}

function normalizeTourForWrite(raw, uid, previous = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "tour must be an object.");
  }
  const id = cleanText(raw.id, 128, "tour id", true);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new HttpsError("invalid-argument", "tour id contains unsupported characters.");
  }
  const listings = Array.isArray(raw.listings) ? raw.listings : [];
  const listingIds = new Set();
  for (const listing of listings) {
    const listingId = cleanText(listing?.id, 128, "listing id", true);
    if (listingIds.has(listingId)) {
      throw new HttpsError("invalid-argument", "listing ids must be unique.");
    }
    listingIds.add(listingId);
    if (listing.agentEmail && !isValidEmail(listing.agentEmail)) {
      throw new HttpsError("invalid-argument", `Invalid agent email for ${listingId}.`);
    }
  }
  const now = Date.now();
  const next = {
    ...raw,
    id,
    listings,
    createdAt: Number(previous?.createdAt) || now,
    createdBy: previous?.createdBy || uid,
    updatedAt: now,
    updatedBy: uid,
    version: Number(previous?.version || 0) + 1,
  };
  delete next.ratings;
  delete next.ratingSubmissions;
  delete next.favorites;
  // Validate the materialized view before the private transaction commits so a malformed
  // public asset cannot leave private/public tour records at different versions.
  publicTourProjection(next);
  return next;
}

exports.verifyTourCode = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const uid = assertAuthenticated(request);
  await enforceRateLimit("verifyTourCode", request, 20, 60 * 60 * 1000);
  const tourId = cleanText(request.data?.tourId, 128, "tourId", true);
  const code = cleanText(request.data?.code, 32, "code", true);
  const tour = (await getDatabase().ref(`mrt_tours_private/${tourId}`).get()).val();
  if (!tour || !timingSafeTextEqual(tour.code, code)) {
    throw new HttpsError("permission-denied", "The tour code is incorrect.");
  }
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const grantId = crypto.randomUUID();
  await getDatabase().ref(`mrt_rating_grants/${uid}/${tourId}`).set({
    grantId,
    expiresAt,
    createdAt: Date.now(),
  });
  return {grantId, expiresAt};
});

exports.submitRating = onCall(
  {
    ...callableOptions,
  },
  async (request) => {
  assertSafeProject();
  const uid = assertAuthenticated(request);
  await enforceRateLimit("submitRating", request, 60, 24 * 60 * 60 * 1000);
  return idempotent("submitRating", uid, request.data?.requestId, async () => {
    const tourId = cleanText(request.data?.tourId, 128, "tourId", true);
    const listingId = cleanText(request.data?.listingId, 128, "listingId", true);
    const grantId = cleanText(request.data?.grantId, 128, "grantId", true);
    const [grantSnapshot, tourSnapshot] = await Promise.all([
      getDatabase().ref(`mrt_rating_grants/${uid}/${tourId}`).get(),
      getDatabase().ref(`mrt_tours_private/${tourId}`).get(),
    ]);
    const grant = grantSnapshot.val();
    const tour = tourSnapshot.val();
    if (
      !grant ||
      grant.grantId !== grantId ||
      Number(grant.expiresAt || 0) <= Date.now()
    ) {
      throw new HttpsError("permission-denied", "Tour access has expired. Enter the code again.");
    }
    if (!tour?.listings?.some((listing) => listing?.id === listingId)) {
      throw new HttpsError("not-found", "The selected listing does not exist.");
    }
    let rating;
    try {
      rating = validateRating(request.data?.rating);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }
    const tempPhotoIds = Array.isArray(request.data?.tempPhotoIds)
      ? request.data.tempPhotoIds
          .map((value) => cleanText(value, 128, "photo id"))
          .filter((value) => /^[a-zA-Z0-9_-]+$/.test(value))
          .slice(0, 5)
      : [];
    const submittedAt = Date.now();
    const photoPaths = [];
    if (tempPhotoIds.length) {
      const bucket = getStorage().bucket();
      for (const photoId of tempPhotoIds) {
        const sourcePath = `mrt_upload_temp/${uid}/${photoId}`;
        const destinationPath = `mrt_rating_photos/${tourId}/${listingId}/${uid}/${photoId}`;
        const [exists] = await bucket.file(sourcePath).exists();
        if (!exists) throw new HttpsError("failed-precondition", "An uploaded photo is missing.");
        await bucket.file(sourcePath).copy(bucket.file(destinationPath));
        await bucket.file(sourcePath).delete().catch(() => {});
        photoPaths.push(destinationPath);
      }
    }
    const privateRef = getDatabase().ref(
      `mrt_ratings_private/${tourId}/${listingId}/${uid}`,
    );
    await privateRef.set({...rating, photoPaths, submittedAt, updatedAt: submittedAt});
    const listingRatings = (
      await getDatabase().ref(`mrt_ratings_private/${tourId}/${listingId}`).get()
    ).val();
    const aggregate = ratingAggregate(listingRatings);
    await getDatabase().ref(`mrt_ratings_public/${tourId}/${listingId}`).set({
      ...aggregate,
      updatedAt: submittedAt,
    });
    const listing = tour.listings.find((entry) => entry?.id === listingId);
    let notificationStatus = "not_requested";
    if (isValidEmail(listing?.agentEmail)) {
      try {
        await sendTransactionalEmail({
          to: listing.agentEmail,
          subject: `New rating — ${listing.address} (${tour.name})`,
          text: `A new rating was submitted for ${listing.address}. Open MarketReady Tours to view the private feedback.`,
          html: `<p>A new rating was submitted for <strong>${escapeHtml(listing.address)}</strong>.</p><p>Open MarketReady Tours to view the private feedback.</p>`,
        });
        notificationStatus = "sent";
      } catch (error) {
        notificationStatus = "failed";
        logger.error("Rating notification failed", {tourId, listingId, error});
      }
    }
    return {ok: true, updatedAt: submittedAt, aggregate, notificationStatus};
  });
  },
);

exports.submitIntake = onCall(
  {
    ...callableOptions,
  },
  async (request) => {
  assertSafeProject();
  const uid = assertAuthenticated(request);
  await enforceRateLimit("submitIntake", request, 20, 24 * 60 * 60 * 1000);
  return idempotent("submitIntake", uid, request.data?.requestId, async () => {
    const type = cleanText(request.data?.type, 40, "type", true);
    if (!["listing", "tour", "sponsor", "contact"].includes(type)) {
      throw new HttpsError("invalid-argument", "Unsupported intake type.");
    }
    const payload = request.data?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new HttpsError("invalid-argument", "payload must be an object.");
    }
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 100000) {
      throw new HttpsError("invalid-argument", "The submitted form is too large.");
    }
    if (payload.website) {
      // Honeypot submissions receive a neutral response without storing or notifying.
      return {ok: true, accepted: true};
    }
    const email = normalizeEmail(payload.email || payload.agentEmail);
    if (!isValidEmail(email)) {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }
    const name = cleanText(payload.name || payload.agentName, 160, "name", true);
    const id = crypto.randomUUID();
    const record = {
      ...payload,
      id,
      name,
      email,
      status: "pending",
      submittedAt: Date.now(),
      submittedBy: uid,
    };
    if (type === "sponsor") {
      const plan = sponsorPlanDetails(payload.paymentPlan || payload.plan);
      const tourId = cleanText(payload.tourId, 128, "tourId", true);
      const tour = (await getDatabase().ref(`mrt_tours_private/${tourId}`).get()).val();
      if (!tour || tour.archived === true || tour.date < localYmd()) {
        throw new HttpsError("failed-precondition", "That tour is no longer open.");
      }
      record.tourId = tourId;
      record.tourName = tour.name;
      record.paymentPlan = plan.key;
      delete record.plan;
      record.paid = false;
      record.paymentStatus = "pending";
    }
    delete record.website;
    const tempPhotoIds = Array.isArray(payload.tempPhotoIds)
      ? payload.tempPhotoIds
          .map((value) => cleanText(value, 128, "photo id"))
          .filter((value) => /^[a-zA-Z0-9_-]+$/.test(value))
          .slice(0, 3)
      : [];
    delete record.tempPhotoIds;
    delete record.photos;
    if (type === "listing" && tempPhotoIds.length) {
      const bucket = getStorage().bucket();
      const photoUrls = [];
      for (const photoId of tempPhotoIds) {
        const sourcePath = `mrt_upload_temp/${uid}/${photoId}`;
        const destinationPath = `mrt_listing_photos/${id}/${photoId}`;
        const [exists] = await bucket.file(sourcePath).exists();
        if (!exists) throw new HttpsError("failed-precondition", "An uploaded photo is missing.");
        const downloadToken = crypto.randomUUID();
        await bucket.file(sourcePath).copy(bucket.file(destinationPath), {
          metadata: {metadata: {firebaseStorageDownloadTokens: downloadToken}},
        });
        await bucket.file(sourcePath).delete().catch(() => {});
        photoUrls.push(
          `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
          `/o/${encodeURIComponent(destinationPath)}?alt=media&token=${downloadToken}`,
        );
      }
      record.photos = photoUrls;
    }
    const pathByType = {
      listing: "mrt_listing_requests",
      tour: "mrt_tour_requests",
      sponsor: "mrt_sponsor_signups",
      contact: "mrt_contact_requests",
    };
    await getDatabase().ref(`${pathByType[type]}/${id}`).set(record);
    let notificationStatus = "mocked";
    try {
      await sendTransactionalEmail({
        to: email,
        subject: "We received your MarketReady Tours request",
        text: `Hi ${name},\n\nYour ${type} request has been received. We will follow up shortly.`,
        html: `<p>Hi ${escapeHtml(name)},</p><p>Your ${escapeHtml(type)} request has been received. We will follow up shortly.</p>`,
      });
      notificationStatus = transactionalEmailIsLive() ? "sent" : "mocked";
    } catch (error) {
      notificationStatus = "failed";
      logger.error("Intake confirmation failed", {type, id, error});
    }
    return {ok: true, accepted: true, id, notificationStatus};
  });
  },
);

exports.saveTour = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request);
  return idempotent("saveTour", uid, request.data?.requestId, async () => {
    const raw = request.data?.tour;
    const tourId = cleanText(raw?.id, 128, "tour id", true);
    const expectedVersion = Number(request.data?.expectedVersion || 0);
    const ref = getDatabase().ref(`mrt_tours_private/${tourId}`);
    let next;
    const transaction = await ref.transaction((current) => {
      if (current && Number(current.version || 0) !== expectedVersion) return;
      next = normalizeTourForWrite(raw, uid, current);
      return next;
    });
    if (!transaction.committed) {
      throw new HttpsError("aborted", "This tour changed elsewhere. Reload and try again.");
    }
    try {
      await getDatabase().ref(`mrt_tours_public/${tourId}`).set(publicTourProjection(next));
    } catch (error) {
      logger.error("Failed to materialize public tour projection", {tourId, error});
      throw new HttpsError("internal", "The tour saved but its public view could not be updated.");
    }
    return {ok: true, tour: next, version: next.version};
  });
});

exports.deleteTour = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request, true);
  return idempotent("deleteTour", uid, request.data?.requestId, async () => {
    const tourId = cleanText(request.data?.tourId, 128, "tourId", true);
    const expectedVersion = Number(request.data?.expectedVersion || 0);
    const privateRef = getDatabase().ref(`mrt_tours_private/${tourId}`);
    const current = (await privateRef.get()).val();
    if (!current) return {ok: true, deleted: false};
    if (Number(current.version || 0) !== expectedVersion) {
      throw new HttpsError("aborted", "This tour changed elsewhere. Reload and try again.");
    }
    await getDatabase().ref().update({
      [`mrt_tours_private/${tourId}`]: null,
      [`mrt_tours_public/${tourId}`]: null,
      [`mrt_ratings_private/${tourId}`]: null,
      [`mrt_ratings_public/${tourId}`]: null,
      [`mrt_campaigns/${tourId}`]: null,
    });
    return {ok: true, deleted: true};
  });
});

exports.createAdmin = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    const {uid} = assertAdmin(request, true);
    return idempotent("createAdmin", uid, request.data?.requestId, async () => {
      const email = normalizeEmail(request.data?.email);
      const name = cleanText(request.data?.name, 160, "name", true);
      const role = request.data?.role === "super" ? "super" : "admin";
      if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "Email is invalid.");
      let user;
      try {
        user = await getAuth().getUserByEmail(email);
        user = await getAuth().updateUser(user.uid, {disabled: false, displayName: name});
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
        // A user created WITHOUT a password has no password provider, and a password
        // RESET link for such an account fails with "expired or has already been used" —
        // which is what made every admin invitation unusable (audit 2026-08-10, reproduced
        // three times). Setting an unguessable initial password creates the provider so the
        // reset link below actually works. Nobody ever learns this value: it is random,
        // never returned, never logged, and immediately superseded when the invitee sets
        // their own password.
        user = await getAuth().createUser({
          email,
          displayName: name,
          emailVerified: false,
          password: crypto.randomBytes(32).toString("base64url"),
        });
      }
      await getAuth().setCustomUserClaims(user.uid, {mrtRole: role});
      await getAuth().revokeRefreshTokens(user.uid);
      await getDatabase().ref(`admins/${user.uid}`).set({
        uid: user.uid,
        email,
        name,
        role,
        active: true,
        updatedAt: Date.now(),
        updatedBy: uid,
      });
      const resetLink = await getAuth().generatePasswordResetLink(email);
      await sendTransactionalEmail({
        to: email,
        subject: "Set up your MarketReady Tours account",
        text: `Set your password: ${resetLink}`,
        html: `<p>Hello ${escapeHtml(name)},</p><p><a href="${escapeHtml(resetLink)}">Set your password</a></p>`,
      });
      return {ok: true, admin: {uid: user.uid, email, name, role, active: true}};
    });
  },
);

exports.updateAdmin = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request, true);
  return idempotent("updateAdmin", uid, request.data?.requestId, async () => {
    const targetUid = cleanText(request.data?.uid, 128, "uid", true);
    const snapshot = await getDatabase().ref(`admins/${targetUid}`).get();
    const existing = snapshot.val();
    if (!existing) throw new HttpsError("not-found", "Admin was not found.");
    const name = cleanText(request.data?.name || existing.name, 160, "name", true);
    const role = request.data?.role === "super" ? "super" : "admin";
    await getAuth().updateUser(targetUid, {displayName: name});
    await getAuth().setCustomUserClaims(targetUid, {mrtRole: role});
    await getAuth().revokeRefreshTokens(targetUid);
    const next = {...existing, name, role, active: true, updatedAt: Date.now(), updatedBy: uid};
    await getDatabase().ref(`admins/${targetUid}`).set(next);
    return {ok: true, admin: next};
  });
});

exports.disableAdmin = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request, true);
  return idempotent("disableAdmin", uid, request.data?.requestId, async () => {
    const targetUid = cleanText(request.data?.uid, 128, "uid", true);
    if (targetUid === uid) {
      throw new HttpsError("failed-precondition", "You cannot disable your own account.");
    }
    await getAuth().updateUser(targetUid, {disabled: true});
    await getAuth().setCustomUserClaims(targetUid, {});
    await getAuth().revokeRefreshTokens(targetUid);
    await getDatabase().ref(`admins/${targetUid}`).update({
      active: false,
      disabledAt: Date.now(),
      updatedAt: Date.now(),
      updatedBy: uid,
    });
    return {ok: true};
  });
});

exports.sendAdminPasswordReset = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    const {uid} = assertAdmin(request, true);
    return idempotent("sendAdminPasswordReset", uid, request.data?.requestId, async () => {
      const targetUid = cleanText(request.data?.uid, 128, "uid", true);
      const admin = (await getDatabase().ref(`admins/${targetUid}`).get()).val();
      if (!admin?.active || !isValidEmail(admin.email)) {
        throw new HttpsError("not-found", "Active admin account was not found.");
      }
      const resetLink = await getAuth().generatePasswordResetLink(admin.email);
      await sendTransactionalEmail({
        to: admin.email,
        subject: "Reset your MarketReady Tours password",
        text: `Reset your password: ${resetLink}`,
        html: `<p><a href="${escapeHtml(resetLink)}">Reset your MarketReady Tours password</a></p>`,
      });
      return {ok: true};
    });
  },
);

exports.requestAdminPasswordReset = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    assertAuthenticated(request);
    await enforceRateLimit("requestAdminPasswordReset", request, 5, 60 * 60 * 1000);
    const email = normalizeEmail(request.data?.email);
    if (!isValidEmail(email)) {
      throw new HttpsError("invalid-argument", "Enter a valid email address.");
    }
    try {
      const user = await getAuth().getUserByEmail(email);
      const admin = (await getDatabase().ref(`admins/${user.uid}`).get()).val();
      if (admin?.active && ["super", "admin"].includes(admin.role)) {
        const resetLink = await getAuth().generatePasswordResetLink(email);
        await sendTransactionalEmail({
          to: email,
          subject: "Reset your MarketReady Tours password",
          text: `Reset your password: ${resetLink}`,
          html: `<p><a href="${escapeHtml(resetLink)}">Reset your MarketReady Tours password</a></p>`,
        });
      }
    } catch (error) {
      // Always return the same response to avoid disclosing whether an admin account exists.
      logger.info("Password reset request completed without delivery", {email, code: error?.code});
    }
    return {ok: true};
  },
);

exports.sendAdminEmail = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    const {uid} = assertAdmin(request);
    await enforceRateLimit("sendAdminEmail", request, 200, 24 * 60 * 60 * 1000);
    return idempotent("sendAdminEmail", uid, request.data?.requestId, async () => {
      const to = normalizeEmail(request.data?.to);
      const subject = cleanText(request.data?.subject, 300, "subject", true);
      const text = cleanText(request.data?.text, 30000, "text", true);
      if (!isValidEmail(to)) throw new HttpsError("invalid-argument", "Recipient is invalid.");
      // The legacy client still builds rich HTML from mixed admin/public data. Until templates
      // move server-side, render client-requested messages as escaped text so no submitted value
      // can become executable email markup.
      const html = `<div style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>`;
      const result = await sendTransactionalEmail({to, subject, text, html});
      return {ok: true, mocked: result.mocked === true};
    });
  },
);

function validListingForApproval(requestRecord, listingId) {
  const email = normalizeEmail(requestRecord.agentEmail || requestRecord.email);
  if (!isValidEmail(email)) {
    throw new HttpsError("invalid-argument", "The listing request has an invalid agent email.");
  }
  return {
    ...requestRecord,
    id: listingId,
    agentEmail: email,
    agent: cleanText(
      requestRecord.agent || requestRecord.agentName,
      160,
      "agent name",
      true,
    ),
    address: cleanText(requestRecord.address, 300, "address", true),
    order: Number(requestRecord.order || 0),
  };
}

async function createReminderJobs({tour, listing, requestId, createdBy}) {
  const tourStart = phoenixDateTimeMs(tour.date, tour.time);
  const now = Date.now();
  const updates = {};
  for (const hoursAhead of [48, 24]) {
    const sendAt = tourStart - hoursAhead * 60 * 60 * 1000;
    if (sendAt <= now) continue;
    const id = stableHash(`${requestId}:${hoursAhead}`).slice(0, 40);
    updates[`mrt_reminders/${id}`] = {
      id,
      status: "pending",
      attempts: 0,
      nextAttemptAt: sendAt,
      sendAt,
      expiresAt: tourStart,
      hoursAhead,
      tourId: tour.id,
      tourName: tour.name,
      tourDate: tour.date,
      tourTime: tour.time,
      listingId: listing.id,
      address: listing.address,
      agentName: listing.agent,
      agentEmail: listing.agentEmail,
      createdAt: now,
      createdBy,
    };
  }
  return updates;
}

exports.approveListingRequest = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    const {uid} = assertAdmin(request);
    return idempotent("approveListingRequest", uid, request.data?.requestId, async (requestId) => {
      const requestIdToApprove = cleanText(request.data?.listingRequestId, 128, "listingRequestId", true);
      const requestRef = getDatabase().ref(`mrt_listing_requests/${requestIdToApprove}`);
      const initialRequest = (await requestRef.get()).val();
      if (!initialRequest) throw new HttpsError("not-found", "Listing request was not found.");
      if (initialRequest.status === "approved") {
        return {ok: true, alreadyApproved: true, listingId: initialRequest.listingId};
      }
      if (initialRequest.status !== "pending") {
        throw new HttpsError("aborted", "This listing request is already being reviewed.");
      }
      const claimStartedAt = Date.now();
      let requestTransactionAttempts = 0;
      const requestClaim = await requestRef.transaction((current) => {
        requestTransactionAttempts += 1;
        // RTDB transactions may invoke the first local callback with null before reconciling
        // the server value. Seed only that first attempt from the just-read snapshot; a
        // subsequent null means the request was concurrently deleted and must abort.
        if (current === null && requestTransactionAttempts === 1) current = initialRequest;
        if (!current || current.status !== "pending") return;
        return {
          ...current,
          status: "approving",
          approvalToken: requestId,
          approvalStartedAt: claimStartedAt,
        };
      });
      if (!requestClaim.committed) {
        const current = requestClaim.snapshot.val();
        if (!current) throw new HttpsError("not-found", "Listing request was not found.");
        if (current.status === "approved") {
          return {ok: true, alreadyApproved: true, listingId: current.listingId};
        }
        throw new HttpsError("aborted", "This listing request is already being reviewed.");
      }

      const requestRecord = requestClaim.snapshot.val();
      try {
        const tourId = cleanText(requestRecord.tourId, 128, "tourId", true);
        const tourRef = getDatabase().ref(`mrt_tours_private/${tourId}`);
        const initialTourSnapshot = await tourRef.get();
        if (!initialTourSnapshot.exists()) {
          throw new HttpsError("not-found", "The selected tour was not found.");
        }
        const initialTour = initialTourSnapshot.val();
        const listingId = `listing_${stableHash(requestIdToApprove).slice(0, 20)}`;
        const listing = validListingForApproval(requestRecord, listingId);
        let nextTour;
        let alreadyInTour = false;
        let atCapacity = false;
        let tourTransactionAttempts = 0;
        const tourTransaction = await tourRef.transaction((current) => {
          tourTransactionAttempts += 1;
          alreadyInTour = false;
          atCapacity = false;
          if (current === null && tourTransactionAttempts === 1) current = initialTour;
          if (!current) return;
          const listings = Array.isArray(current.listings) ? current.listings : [];
          if (listings.some((entry) => entry?.id === listingId)) {
            alreadyInTour = true;
            nextTour = current;
            return current;
          }
          const maxListings = Math.max(1, Number(current.maxListings) || 8);
          if (listings.length >= maxListings) {
            atCapacity = true;
            return;
          }
          nextTour = {
            ...current,
            listings: [...listings, {...listing, order: listings.length + 1}],
            version: Number(current.version || 0) + 1,
            updatedAt: Date.now(),
            updatedBy: uid,
          };
          return nextTour;
        });
        if (!tourTransaction.committed) {
          if (atCapacity) {
            throw new HttpsError("resource-exhausted", "The selected tour is at capacity.");
          }
          throw new HttpsError("not-found", "The selected tour was not found.");
        }
        nextTour = tourTransaction.snapshot.val();
        const reminderUpdates = alreadyInTour
          ? {}
          : await createReminderJobs({
              tour: nextTour,
              listing,
              requestId,
              createdBy: uid,
            });
        const now = Date.now();
        await getDatabase().ref().update({
          [`mrt_tours_public/${tourId}`]: publicTourProjection(nextTour),
          [`mrt_listing_requests/${requestIdToApprove}/status`]: "approved",
          [`mrt_listing_requests/${requestIdToApprove}/listingId`]: listingId,
          [`mrt_listing_requests/${requestIdToApprove}/reviewedAt`]: now,
          [`mrt_listing_requests/${requestIdToApprove}/reviewedBy`]: uid,
          [`mrt_listing_requests/${requestIdToApprove}/approvalToken`]: null,
          [`mrt_listing_requests/${requestIdToApprove}/approvalStartedAt`]: null,
          ...reminderUpdates,
        });
        const tour = nextTour;
        let notificationStatus = "mocked";
        try {
          await sendTransactionalEmail({
            to: listing.agentEmail,
            subject: `Your listing is approved — ${tour.name}`,
            text: `${listing.address} has been approved for ${tour.name} on ${tour.date} at ${tour.time}.`,
            html: `<p><strong>${escapeHtml(listing.address)}</strong> has been approved for ${escapeHtml(tour.name)}.</p><p>${escapeHtml(tour.date)} at ${escapeHtml(tour.time)}</p>`,
          });
          notificationStatus = transactionalEmailIsLive() ? "sent" : "mocked";
        } catch (error) {
          notificationStatus = "failed";
          logger.error("Listing approval notification failed", {requestIdToApprove, error});
        }
        return {ok: true, listingId, version: nextTour.version, notificationStatus};
      } catch (error) {
        await requestRef.transaction((current) => {
          if (current?.status !== "approving" || current.approvalToken !== requestId) {
            return;
          }
          const restored = {...current, status: "pending"};
          delete restored.approvalToken;
          delete restored.approvalStartedAt;
          return restored;
        }).catch(() => {});
        throw error;
      }
    });
  },
);

exports.denyListingRequest = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    const {uid} = assertAdmin(request);
    return idempotent("denyListingRequest", uid, request.data?.requestId, async () => {
      const listingRequestId = cleanText(
        request.data?.listingRequestId,
        128,
        "listingRequestId",
        true,
      );
      const denialReason = cleanText(request.data?.denialReason || "", 1000, "denialReason");
      const ref = getDatabase().ref(`mrt_listing_requests/${listingRequestId}`);
      const record = (await ref.get()).val();
      if (!record) throw new HttpsError("not-found", "Listing request was not found.");
      if (record.status === "approved") {
        throw new HttpsError("failed-precondition", "An approved request cannot be denied.");
      }
      if (record.status === "denied") return {ok: true, alreadyDenied: true};
      const now = Date.now();
      await ref.update({
        status: "denied",
        denialReason,
        reviewedAt: now,
        reviewedBy: uid,
      });
      let notificationStatus = "mocked";
      const recipient = normalizeEmail(record.agentEmail || record.email);
      if (isValidEmail(recipient)) {
        try {
          await sendTransactionalEmail({
            to: recipient,
            subject: "Your listing request — MarketReady Tours",
            text: `Your listing request was not selected for this tour.${denialReason ? ` ${denialReason}` : ""}`,
            html: `<p>Your listing request was not selected for this tour.</p>${denialReason ? `<p>${escapeHtml(denialReason)}</p>` : ""}`,
          });
          notificationStatus = transactionalEmailIsLive() ? "sent" : "mocked";
        } catch (error) {
          notificationStatus = "failed";
          logger.error("Listing denial notification failed", {listingRequestId, error});
        }
      }
      return {ok: true, reviewedAt: now, notificationStatus};
    });
  },
);

function daysBetweenYmd(fromYmd, toYmd) {
  const from = Date.parse(`${fromYmd}T12:00:00Z`);
  const to = Date.parse(`${toYmd}T12:00:00Z`);
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function optOutToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = stableHash(encoded, SIGNING_SECRET.value());
  return `${encoded}.${signature}`;
}

function parseOptOutToken(token) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) throw new HttpsError("invalid-argument", "Opt-out link is invalid.");
  const expected = stableHash(encoded, SIGNING_SECRET.value());
  if (!timingSafeTextEqual(expected, signature)) {
    throw new HttpsError("permission-denied", "Opt-out link is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new HttpsError("invalid-argument", "Opt-out link is invalid.");
  }
  if (Number(payload.exp || 0) < Date.now()) {
    throw new HttpsError("deadline-exceeded", "Opt-out link has expired.");
  }
  return payload;
}

async function instantlyRequest(path, {method = "GET", body} = {}) {
  if (!instantlyIsLive()) {
    logger.info("Mock Instantly request", {path, method});
    return {id: `mock-${crypto.randomUUID()}`, mocked: true};
  }
  const apiKey = INSTANTLY_API_KEY.value();
  if (!apiKey) throw new Error("Instantly is not configured");
  const response = await fetch(`https://api.instantly.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Instantly request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return response.status === 204 ? {} : response.json();
}

exports.launchCampaign = onCall(
  callableOptions,
  async (request) => {
    assertSafeProject();
    const {uid} = assertAdmin(request);
    return idempotent("launchCampaign", uid, request.data?.requestId, async () => {
      const tourId = cleanText(request.data?.tourId, 128, "tourId", true);
      const tour = (await getDatabase().ref(`mrt_tours_private/${tourId}`).get()).val();
      if (!tour) throw new HttpsError("not-found", "Tour was not found.");
      const daysUntil = daysBetweenYmd(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: APP_TIME_ZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        tour.date,
      );
      let offsets;
      try {
        offsets = campaignOffsetsBeforeTour(daysUntil);
      } catch (error) {
        throw new HttpsError("failed-precondition", error.message);
      }
      const selectedIds = new Set(
        Array.isArray(request.data?.contactIds) ? request.data.contactIds.map(String) : [],
      );
      const contacts = (Array.isArray(tour.campaignContacts) ? tour.campaignContacts : [])
        .filter((contact) => !selectedIds.size || selectedIds.has(String(contact.id)))
        .filter((contact) => contact.status === "pending" && isValidEmail(contact.email));
      if (!contacts.length) throw new HttpsError("failed-precondition", "No pending contacts.");
      if (instantlyIsLive()) {
        const allowlist = secretAllowlist();
        const blocked = allowlistIsUnrestricted()
          ? null
          : contacts.find((contact) => !allowlist.has(normalizeEmail(contact.email)));
        if (blocked) {
          throw new HttpsError(
            "failed-precondition",
            "Dev live sending is restricted to allowlisted recipients.",
          );
        }
      }
      const templates = Array.isArray(request.data?.templates)
        ? request.data.templates.slice(0, 5)
        : Array.isArray(tour.campaignEmails) ? tour.campaignEmails : [];
      const steps = offsets.map((offset, index) => {
        const nextOffset = offsets[index + 1];
        const template = templates[index] || templates[templates.length - 1] || {};
        const body = cleanText(
          template.body || `Join the ${tour.name} tour.`,
          20000,
          "body",
        ).replaceAll("{{propertyAddress}}", "{{mrt_property_address}}");
        if (!body.includes("{{mrt_opt_out_token}}")) {
          throw new HttpsError(
            "failed-precondition",
            "Campaign templates must contain the signed opt-out link. Re-save the templates.",
          );
        }
        return {
          type: "email",
          delay: nextOffset == null ? 0 : nextOffset - offset,
          delay_unit: "days",
          variants: [{
            subject: cleanText(template.subject || `You're invited to ${tour.name}`, 300, "subject"),
            body,
          }],
        };
      });
      const campaign = await instantlyRequest("/api/v2/campaigns", {
        method: "POST",
        body: {
          name: `MRT ${tour.id} ${tour.date}`,
          campaign_schedule: {
            start_date: new Intl.DateTimeFormat("en-CA", {
              timeZone: APP_TIME_ZONE,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
            end_date: new Date(Date.parse(`${tour.date}T12:00:00Z`) - 86400000)
              .toISOString()
              .slice(0, 10),
            schedules: [{
              name: "Phoenix daytime",
              timing: {from: "09:00", to: "17:00"},
              days: {"0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true},
              timezone: APP_TIME_ZONE,
            }],
          },
          sequences: [{steps}],
          stop_on_reply: true,
          insert_unsubscribe_header: true,
          open_tracking: false,
          link_tracking: false,
        },
      });
      const campaignId = campaign.id;
      const leads = contacts.map((contact) => {
        const email = normalizeEmail(contact.email);
        const token = optOutToken({
          tourId,
          email,
          exp: Date.now() + 180 * 24 * 60 * 60 * 1000,
        });
        return {
          email,
          first_name: cleanText(contact.firstName || contact.name, 100, "first name"),
          last_name: cleanText(contact.lastName, 100, "last name"),
          phone: cleanText(contact.phone, 40, "phone"),
          custom_variables: {
            mrt_tour_id: tourId,
            mrt_contact_id: String(contact.id || ""),
            mrt_property_address: cleanText(contact.address, 300, "address"),
            mrt_opt_out_token: token,
          },
        };
      });
      await instantlyRequest("/api/v2/leads/add", {
        method: "POST",
        body: {campaign_id: campaignId, leads, skip_if_in_campaign: true},
      });
      await instantlyRequest(`/api/v2/campaigns/${encodeURIComponent(campaignId)}/activate`, {
        method: "POST",
      });
      const now = Date.now();
      await getDatabase().ref(`mrt_campaigns/${tourId}`).set({
        campaignId,
        status: campaign.mocked ? "mocked" : "active",
        offsets,
        contactCount: leads.length,
        createdAt: now,
        createdBy: uid,
      });
      const nextContacts = (tour.campaignContacts || []).map((contact) =>
        contacts.some((selected) => selected.id === contact.id)
          ? {...contact, status: "invited", invitedAt: now, campaignId}
          : contact,
      );
      await getDatabase().ref(`mrt_tours_private/${tourId}/campaignContacts`).set(nextContacts);
      return {ok: true, campaignId, mocked: campaign.mocked === true, contactCount: leads.length};
    });
  },
);

exports.optOut = onCall(
  {...callableOptions, enforceAppCheck: false},
  async (request) => {
    assertSafeProject();
    await enforceRateLimit("optOut", request, 20, 24 * 60 * 60 * 1000);
    const payload = parseOptOutToken(request.data?.token);
    const email = normalizeEmail(payload.email);
    if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "Email is invalid.");
    const suppressionKey = stableHash(email).slice(0, 48);
    const now = Date.now();
    await getDatabase().ref(`mrt_suppressions/${suppressionKey}`).set({
      email,
      reason: "not_interested",
      tourId: payload.tourId || null,
      createdAt: now,
    });
    const tourRef = getDatabase().ref(`mrt_tours_private/${payload.tourId}`);
    const tour = (await tourRef.get()).val();
    if (tour?.campaignContacts) {
      const contacts = tour.campaignContacts.map((contact) =>
        normalizeEmail(contact.email) === email
          ? {...contact, status: "not_interested", optedOutAt: now}
          : contact,
      );
      await tourRef.child("campaignContacts").set(contacts);
    }
    const campaignId = tour?.campaignContacts?.find(
      (contact) => normalizeEmail(contact.email) === email,
    )?.campaignId;
    if (campaignId) {
      await instantlyRequest("/api/v2/leads", {
        method: "DELETE",
        body: {campaign_id: campaignId, emails: [email]},
      }).catch((error) => logger.error("Failed to remove opted-out Instantly lead", error));
    }
    return {ok: true};
  },
);

exports.updateIntakeStatus = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request);
  return idempotent("updateIntakeStatus", uid, request.data?.requestId, async () => {
    const intakeType = cleanText(request.data?.intakeType, 40, "intakeType", true);
    const intakeId = cleanText(request.data?.intakeId, 128, "intakeId", true);
    const status = cleanText(request.data?.status, 40, "status", true);
    const paths = {
      tour: "mrt_tour_requests",
      contact: "mrt_contact_requests",
    };
    if (!paths[intakeType] || !["pending", "contacted", "closed"].includes(status)) {
      throw new HttpsError("invalid-argument", "Unsupported intake status update.");
    }
    const ref = getDatabase().ref(`${paths[intakeType]}/${intakeId}`);
    if (!(await ref.get()).exists()) throw new HttpsError("not-found", "Request was not found.");
    const now = Date.now();
    await ref.update({status, updatedAt: now, updatedBy: uid});
    return {ok: true, status, updatedAt: now};
  });
});

exports.deleteIntake = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request, true);
  return idempotent("deleteIntake", uid, request.data?.requestId, async () => {
    const intakeType = cleanText(request.data?.intakeType, 40, "intakeType", true);
    const intakeId = cleanText(request.data?.intakeId, 128, "intakeId", true);
    const paths = {tour: "mrt_tour_requests", contact: "mrt_contact_requests"};
    if (!paths[intakeType]) throw new HttpsError("invalid-argument", "Unsupported intake type.");
    await getDatabase().ref(`${paths[intakeType]}/${intakeId}`).remove();
    return {ok: true};
  });
});

exports.approveSponsorSignup = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request);
  return idempotent("approveSponsorSignup", uid, request.data?.requestId, async () => {
    const signupId = cleanText(request.data?.signupId, 128, "signupId", true);
    const signupRef = getDatabase().ref(`mrt_sponsor_signups/${signupId}`);
    const signup = (await signupRef.get()).val();
    if (!signup) throw new HttpsError("not-found", "Sponsor signup was not found.");
    if (signup.status === "approved" && signup.sponsorId) {
      return {ok: true, alreadyApproved: true, sponsorId: signup.sponsorId};
    }
    const tourId = cleanText(signup.tourId, 128, "tourId", true);
    const tourRef = getDatabase().ref(`mrt_tours_private/${tourId}`);
    const tour = (await tourRef.get()).val();
    if (!tour) throw new HttpsError("not-found", "Tour was not found.");
    const sponsorId = `sponsor_${stableHash(signupId).slice(0, 20)}`;
    const sponsor = {
      ...signup,
      id: sponsorId,
      signupId,
      paid: false,
      paymentStatus: "pending",
      approvedAt: Date.now(),
      approvedBy: uid,
    };
    delete sponsor.status;
    delete sponsor.submittedBy;
    const existingSponsors = Array.isArray(tour.sponsors) ? tour.sponsors : [];
    const sponsors = existingSponsors.some((entry) => entry.id === sponsorId)
      ? existingSponsors
      : [...existingSponsors, sponsor];
    const nextTour = {
      ...tour,
      sponsors,
      version: Number(tour.version || 0) + 1,
      updatedAt: Date.now(),
      updatedBy: uid,
    };
    await getDatabase().ref().update({
      [`mrt_tours_private/${tourId}`]: nextTour,
      [`mrt_tours_public/${tourId}`]: publicTourProjection(nextTour),
      [`mrt_sponsor_signups/${signupId}/status`]: "approved",
      [`mrt_sponsor_signups/${signupId}/sponsorId`]: sponsorId,
      [`mrt_sponsor_signups/${signupId}/reviewedAt`]: Date.now(),
      [`mrt_sponsor_signups/${signupId}/reviewedBy`]: uid,
    });
    return {ok: true, sponsorId, sponsor, version: nextTour.version};
  });
});

exports.markSponsorPaid = onCall(callableOptions, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request);
  return idempotent("markSponsorPaid", uid, request.data?.requestId, async () => {
    const tourId = cleanText(request.data?.tourId, 128, "tourId", true);
    const sponsorId = cleanText(request.data?.sponsorId, 128, "sponsorId", true);
    const paid = request.data?.paid === true;
    const tourRef = getDatabase().ref(`mrt_tours_private/${tourId}`);
    const tour = (await tourRef.get()).val();
    if (!tour) throw new HttpsError("not-found", "Tour was not found.");
    const sponsors = Array.isArray(tour.sponsors) ? tour.sponsors : [];
    const sponsorIndex = sponsors.findIndex((entry) => String(entry?.id) === sponsorId);
    if (sponsorIndex < 0) throw new HttpsError("not-found", "Sponsor was not found.");
    const now = Date.now();
    const sponsor = {
      ...sponsors[sponsorIndex],
      paid,
      paymentStatus: paid ? "paid" : "pending",
      paymentMethod: paid ? "manual" : null,
      paidAt: paid ? now : null,
      paidBy: paid ? uid : null,
    };
    const nextSponsors = sponsors.map((entry, index) => index === sponsorIndex ? sponsor : entry);
    const nextTour = {
      ...tour,
      sponsors: nextSponsors,
      version: Number(tour.version || 0) + 1,
      updatedAt: now,
      updatedBy: uid,
    };
    const updates = {
      [`mrt_tours_private/${tourId}`]: nextTour,
      [`mrt_tours_public/${tourId}`]: publicTourProjection(nextTour),
    };
    if (sponsor.signupId) {
      updates[`mrt_sponsor_signups/${sponsor.signupId}/paymentStatus`] = sponsor.paymentStatus;
      updates[`mrt_sponsor_signups/${sponsor.signupId}/paid`] = paid;
      updates[`mrt_sponsor_signups/${sponsor.signupId}/paymentMethod`] = sponsor.paymentMethod;
      updates[`mrt_sponsor_signups/${sponsor.signupId}/paidAt`] = sponsor.paidAt;
      updates[`mrt_sponsor_signups/${sponsor.signupId}/paidBy`] = sponsor.paidBy;
      updates[`mrt_sponsor_signups/${sponsor.signupId}/updatedAt`] = now;
    }
    await getDatabase().ref().update(updates);
    return {ok: true, paid, sponsor, version: nextTour.version};
  });
});

exports.createSponsorInvoice = onCall({
  ...callableOptions,
  secrets: [SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID],
}, async (request) => {
  assertSafeProject();
  const {uid} = assertAdmin(request);
  if (!squareSandboxIsEnabled()) {
    throw new HttpsError(
      "failed-precondition",
      "Sponsor invoicing is disabled until the production Square integration is configured.",
    );
  }
  return idempotent("createSponsorInvoice", uid, request.data?.requestId, async () => {
    const signupId = cleanText(request.data?.signupId, 128, "signupId", true);
    const signupRef = getDatabase().ref(`mrt_sponsor_signups/${signupId}`);
    const signup = (await signupRef.get()).val();
    if (!signup) throw new HttpsError("not-found", "Sponsor signup was not found.");
    if (signup.status !== "approved" || !signup.sponsorId) {
      throw new HttpsError("failed-precondition", "Approve the sponsor before invoicing.");
    }
    if (signup.invoiceId) {
      const existing = (await getDatabase().ref(`mrt_invoices/${signup.invoiceId}`).get()).val();
      if (existing) {
        return {
          ok: true,
          invoiceId: existing.invoiceId,
          paymentUrl: existing.paymentUrl || "",
          amountCents: Number(existing.amountCents) || 0,
          currency: existing.currency || "USD",
          dueDate: existing.dueDate || "",
          mocked: existing.mocked === true,
          alreadyCreated: true,
        };
      }
    }
    const tourId = cleanText(signup.tourId, 128, "tourId", true);
    const tourRef = getDatabase().ref(`mrt_tours_private/${tourId}`);
    const tour = (await tourRef.get()).val();
    if (!tour) throw new HttpsError("not-found", "Tour was not found.");
    const plan = sponsorPlanDetails(signup.paymentPlan || signup.plan);
    const dueDate = localYmd(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    let created;
    if (isEmulator) {
      created = {
        invoiceId: `dev-${crypto.randomUUID()}`,
        orderId: `dev-order-${crypto.randomUUID()}`,
        customerId: `dev-customer-${crypto.randomUUID()}`,
        paymentUrl: "",
        providerStatus: "UNPAID",
        amountCents: plan.amountCents,
        currency: "USD",
        plan: plan.key,
        planLabel: plan.label,
        dueDate,
        mocked: true,
      };
    } else {
      const accessToken = SQUARE_ACCESS_TOKEN.value();
      const locationId = SQUARE_LOCATION_ID.value();
      if (!accessToken || !locationId) {
        throw new HttpsError(
          "failed-precondition",
          "Square Sandbox credentials are not configured.",
        );
      }
      try {
        created = await createSquareSandboxInvoice({
          accessToken,
          locationId,
          signup: {...signup, id: signupId},
          tour,
          dueDate,
        });
      } catch (error) {
        logger.error("Square Sandbox invoice creation failed", {
          signupId,
          tourId,
          status: error.status || null,
          codes: error.codes || [],
        });
        throw new HttpsError(
          "failed-precondition",
          "Square Sandbox could not create the invoice. Check its credentials and location.",
        );
      }
    }

    const invoiceRecord = {
      ...created,
      signupId,
      sponsorId: signup.sponsorId,
      tourId,
      status: "invoiced",
      environment: isEmulator ? "emulator" : "sandbox",
      mocked: created.mocked === true,
      createdAt: Date.now(),
      createdBy: uid,
    };
    const sponsors = (tour.sponsors || []).map((sponsor) =>
      sponsor.id === signup.sponsorId
        ? {
            ...sponsor,
            paid: false,
            paymentStatus: "invoiced",
            invoiceId: created.invoiceId,
          }
        : sponsor,
    );
    const nextTour = {
      ...tour,
      sponsors,
      version: Number(tour.version || 0) + 1,
      updatedAt: Date.now(),
      updatedBy: uid,
    };
    await getDatabase().ref().update({
      [`mrt_invoices/${created.invoiceId}`]: invoiceRecord,
      [`mrt_sponsor_signups/${signupId}/paymentStatus`]: "invoiced",
      [`mrt_sponsor_signups/${signupId}/invoiceId`]: created.invoiceId,
      [`mrt_sponsor_signups/${signupId}/paymentUrl`]: created.paymentUrl || null,
      [`mrt_sponsor_signups/${signupId}/updatedAt`]: Date.now(),
      [`mrt_tours_private/${tourId}`]: nextTour,
      [`mrt_tours_public/${tourId}`]: publicTourProjection(nextTour),
    });
    return {
      ok: true,
      invoiceId: created.invoiceId,
      paymentUrl: created.paymentUrl || "",
      amountCents: created.amountCents,
      currency: created.currency,
      dueDate: created.dueDate,
      mocked: created.mocked === true,
      alreadyCreated: false,
    };
  });
});

async function processDueReminders() {
  assertSafeProject();
  const now = Date.now();
  const snapshot = await getDatabase()
    .ref("mrt_reminders")
    .orderByChild("nextAttemptAt")
    .endAt(now)
    .limitToFirst(100)
    .get();
  const reminders = snapshot.val() || {};
  for (const [id, reminder] of Object.entries(reminders)) {
    if (!reminder || !["pending", "failed"].includes(reminder.status)) continue;
    if (Number(reminder.expiresAt || 0) <= now) {
      await getDatabase().ref(`mrt_reminders/${id}`).update({status: "expired", updatedAt: now});
      continue;
    }
    const ref = getDatabase().ref(`mrt_reminders/${id}`);
    const claim = await ref.transaction((current) => {
      if (
        !current ||
        !["pending", "failed"].includes(current.status) ||
        Number(current.nextAttemptAt || 0) > now
      ) {
        return;
      }
      return {...current, status: "processing", claimedAt: now, updatedAt: now};
    });
    if (!claim.committed) continue;
    const claimed = claim.snapshot.val();
    try {
      await sendTransactionalEmail({
        to: claimed.agentEmail,
        subject: `${claimed.hoursAhead} hour reminder — ${claimed.tourName}`,
        text: `${claimed.tourName} is coming up. Your listing: ${claimed.address}`,
        html: `<p>Hello ${escapeHtml(claimed.agentName)},</p><p><strong>${escapeHtml(claimed.tourName)}</strong> is coming up.</p><p>${escapeHtml(claimed.address)}</p>`,
      });
      await ref.update({status: "sent", sentAt: Date.now(), updatedAt: Date.now()});
    } catch (error) {
      const attempts = Number(claimed.attempts || 0) + 1;
      await ref.update({
        status: attempts >= 5 ? "dead" : "failed",
        attempts,
        lastError: cleanText(error.message, 500, "error"),
        nextAttemptAt: Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000,
        updatedAt: Date.now(),
      });
    }
  }
}

exports.processReminders = onSchedule(
  {
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: APP_TIME_ZONE,
  },
  processDueReminders,
);

exports.processRemindersNow = onCall(
  {
    ...callableOptions,
  },
  async (request) => {
    assertAdmin(request);
    await processDueReminders();
    return {ok: true};
  },
);

function verifySquareWebhook(rawBody, signature, secret, notificationUrl) {
  if (!signature || !secret || !notificationUrl) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(notificationUrl, "utf8"), Buffer.from(rawBody)]))
    .digest("base64");
  return timingSafeTextEqual(expected, signature);
}

function verifyStaticWebhookSecret(provided, secret) {
  if (!provided || !secret) return false;
  return timingSafeTextEqual(provided, secret);
}

function webhookFailure(response, error, provider) {
  if (error instanceof HttpsError && error.code === "failed-precondition") {
    response.status(503).send("disabled");
    return;
  }
  logger.error(`${provider} webhook failed`, error);
  response.status(500).send("failed");
}

exports.instantlyWebhook = onRequest(
  {region: REGION, secrets: [INSTANTLY_WEBHOOK_SECRET]},
  async (request, response) => {
    try {
      assertSafeProject();
      // Instantly supports configured custom delivery headers. Configure this exact header
      // on the subscription; do not place the secret in the webhook URL.
      const providedSecret = request.get("x-mrt-webhook-secret");
      if (!verifyStaticWebhookSecret(providedSecret, INSTANTLY_WEBHOOK_SECRET.value())) {
        response.status(401).send("invalid signature");
        return;
      }
      const event = request.body || {};
      const eventId = cleanText(event.id || request.get("x-event-id"), 160, "event id", true);
      const eventRef = getDatabase().ref(`mrt_webhook_events/instantly/${eventId}`);
      const claim = await eventRef.transaction((current) =>
        current ? undefined : {receivedAt: Date.now(), eventType: event.event_type || "unknown"},
      );
      if (!claim.committed) {
        response.status(204).send();
        return;
      }
      const email = normalizeEmail(event.lead_email);
      const tourId = cleanText(event.mrt_tour_id || event.payload?.mrt_tour_id, 128, "tour id");
      if (["lead_unsubscribed", "lead_not_interested"].includes(event.event_type) && email) {
        const suppressionKey = stableHash(email).slice(0, 48);
        await getDatabase().ref(`mrt_suppressions/${suppressionKey}`).set({
          email,
          tourId: tourId || null,
          reason: event.event_type,
          createdAt: Date.now(),
        });
      }
      if (tourId && email) {
        const tourRef = getDatabase().ref(`mrt_tours_private/${tourId}/campaignContacts`);
        const contacts = (await tourRef.get()).val();
        if (Array.isArray(contacts)) {
          const statusMap = {
            email_sent: "invited",
            email_bounced: "bounced",
            lead_unsubscribed: "not_interested",
            lead_not_interested: "not_interested",
            reply_received: "replied",
          };
          const status = statusMap[event.event_type];
          if (status) {
            await tourRef.set(
              contacts.map((contact) =>
                normalizeEmail(contact.email) === email
                  ? {...contact, status, statusUpdatedAt: Date.now()}
                  : contact,
              ),
            );
          }
        }
      }
      await eventRef.update({processedAt: Date.now()});
      response.status(204).send();
    } catch (error) {
      webhookFailure(response, error, "Instantly");
    }
  },
);

exports.squareWebhook = onRequest(
  {region: REGION, secrets: [SQUARE_WEBHOOK_SECRET, SQUARE_WEBHOOK_URL]},
  async (request, response) => {
    try {
      assertSafeProject();
      const signature = request.get("x-square-hmacsha256-signature");
      if (!verifySquareWebhook(
        request.rawBody,
        signature,
        SQUARE_WEBHOOK_SECRET.value(),
        SQUARE_WEBHOOK_URL.value(),
      )) {
        response.status(401).send("invalid signature");
        return;
      }
      const event = request.body || {};
      const eventId = cleanText(event.event_id || event.id, 160, "event id", true);
      const eventRef = getDatabase().ref(`mrt_webhook_events/square/${eventId}`);
      const claim = await eventRef.transaction((current) =>
        current ? undefined : {receivedAt: Date.now(), type: event.type || "unknown"},
      );
      if (!claim.committed) {
        response.status(204).send();
        return;
      }
      const providerInvoice = event.data?.object?.invoice || {};
      const invoiceId = cleanText(
        providerInvoice.id || event.data?.id || event.invoice_id,
        160,
        "invoice id",
        true,
      );
      const invoiceRef = getDatabase().ref(`mrt_invoices/${invoiceId}`);
      const invoice = (await invoiceRef.get()).val();
      if (!invoice) throw new Error("Unknown invoice");
      const providerStatus = cleanText(providerInvoice.status, 40, "provider status");
      const paymentStatus =
        event.type === "invoice.payment_made" && providerStatus === "PAID"
          ? "paid"
          : event.type === "invoice.payment_made"
            ? "partially_paid"
            : ["invoice.refunded", "refund.updated"].includes(event.type)
              ? "refunded"
              : null;
      if (paymentStatus) {
        await invoiceRef.update({
          status: paymentStatus,
          providerStatus: providerStatus || null,
          updatedAt: Date.now(),
        });
        await getDatabase().ref(`mrt_sponsor_signups/${invoice.signupId}`).update({
          paymentStatus,
          paid: paymentStatus === "paid",
          updatedAt: Date.now(),
        });
        if (invoice.tourId) {
          const tourRef = getDatabase().ref(`mrt_tours_private/${invoice.tourId}`);
          const tour = (await tourRef.get()).val();
          if (tour) {
            const sponsors = (tour.sponsors || []).map((sponsor) =>
              sponsor.signupId === invoice.signupId
                ? {...sponsor, paymentStatus, paid: paymentStatus === "paid"}
                : sponsor,
            );
            const next = {...tour, sponsors, version: Number(tour.version || 0) + 1, updatedAt: Date.now()};
            await tourRef.set(next);
            await getDatabase().ref(`mrt_tours_public/${invoice.tourId}`).set(publicTourProjection(next));
          }
        }
      }
      await eventRef.update({processedAt: Date.now()});
      response.status(204).send();
    } catch (error) {
      webhookFailure(response, error, "Square");
    }
  },
);
