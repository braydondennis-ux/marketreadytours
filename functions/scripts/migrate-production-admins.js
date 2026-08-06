"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {initializeApp, getApps} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const firebaseCliAuth = require("firebase-tools/lib/auth");
const firebaseCliApi = require("firebase-tools/lib/apiv2");
const {normalizeEmail} = require("../lib/domain");

const PRODUCTION_PROJECT = "marketready-tours";
const PRODUCTION_DATABASE_URL = "https://marketready-tours-default-rtdb.firebaseio.com";
const PRODUCTION_APPROVAL = "BRAYDON_APPROVED_MARKETREADY_PRODUCTION_CUTOVER";

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

function assertProductionAdminApproval({project, apply, approval}) {
  if (project !== PRODUCTION_PROJECT) {
    throw new Error(`Pass --project=${PRODUCTION_PROJECT}; all other destinations are refused`);
  }
  if (apply && approval !== PRODUCTION_APPROVAL) {
    throw new Error("Explicit Braydon production-cutover approval is required for --apply");
  }
}

function legacyAdminEmail(key, admin) {
  const decodedKey = key.includes("@") ? key.replaceAll(",", ".") : "";
  return normalizeEmail(admin?.email || decodedKey);
}

function migratedAdminRole(admin) {
  return admin?.role === "super" ? "super" : "admin";
}

function firebaseCliCredential() {
  return {
    async getAccessToken() {
      const account = firebaseCliAuth.getGlobalDefaultAccount();
      if (!account) throw new Error("Firebase CLI is not logged in");
      firebaseCliAuth.setActiveAccount({}, account);
      const accessToken = await firebaseCliApi.getAccessToken();
      if (!accessToken) throw new Error("Firebase CLI did not return an access token");
      return {access_token: accessToken, expires_in: 3600};
    },
  };
}

async function migrateProductionAdmins({sourcePath, project, apply, approval}) {
  assertProductionAdminApproval({project, apply, approval});
  const source = JSON.parse(await fs.readFile(path.resolve(sourcePath), "utf8"));
  if (!getApps().length) {
    initializeApp({
      credential: firebaseCliCredential(),
      projectId: PRODUCTION_PROJECT,
      databaseURL: PRODUCTION_DATABASE_URL,
    });
  }
  const auth = getAuth();
  const updates = {};
  const claimChanges = [];
  let unmatchedAuthUsers = 0;

  for (const [legacyKey, legacyAdmin] of Object.entries(source.admins || {})) {
    const email = legacyAdminEmail(legacyKey, legacyAdmin);
    if (!email) {
      unmatchedAuthUsers += 1;
      continue;
    }
    try {
      const user = await auth.getUserByEmail(email);
      const role = migratedAdminRole(legacyAdmin);
      updates[`admins/${user.uid}`] = {
        uid: user.uid,
        email,
        name: legacyAdmin.name || user.displayName || email.split("@")[0],
        role,
        active: true,
        migratedAt: Date.now(),
      };
      claimChanges.push({
        uid: user.uid,
        claims: {...(user.customClaims || {}), mrtRole: role},
      });
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      unmatchedAuthUsers += 1;
    }
  }

  if (apply) {
    for (const change of claimChanges) {
      await auth.setCustomUserClaims(change.uid, change.claims);
    }
    await getDatabase().ref().update(updates);
  }

  return {
    mode: apply ? "apply" : "dry-run",
    project,
    legacyAdminCount: Object.keys(source.admins || {}).length,
    matchedAuthUsers: claimChanges.length,
    unmatchedAuthUsers,
    uidAdminEntriesPrepared: Object.keys(updates).length,
    legacyAdminEntriesPreserved: true,
    existingCustomClaimsPreserved: true,
  };
}

async function main() {
  const sourcePath = argValue("source");
  const project = argValue("project");
  const apply = process.argv.includes("--apply");
  const approval = argValue("approval");
  if (!sourcePath) {
    throw new Error(
      "Usage: node functions/scripts/migrate-production-admins.js " +
      "--source=<prod.json> --project=marketready-tours [--apply " +
      `--approval=${PRODUCTION_APPROVAL}]`,
    );
  }
  const report = await migrateProductionAdmins({sourcePath, project, apply, approval});
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  PRODUCTION_APPROVAL,
  assertProductionAdminApproval,
  legacyAdminEmail,
  migratedAdminRole,
  migrateProductionAdmins,
};
