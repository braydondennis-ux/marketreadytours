"use strict";

const {initializeApp, applicationDefault} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {normalizeEmail, isValidEmail} = require("../lib/domain");

const projectArg = process.argv.find((arg) => arg.startsWith("--project="));
const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const nameArg = process.argv.find((arg) => arg.startsWith("--name="));
const projectId = projectArg ? projectArg.split("=").slice(1).join("=") : "";
const email = normalizeEmail(emailArg ? emailArg.split("=").slice(1).join("=") : "");
const name = nameArg ? nameArg.split("=").slice(1).join("=") : "MarketReady Super Admin";
const emulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

if (!projectId || !isValidEmail(email)) {
  throw new Error(
    "Usage: node bootstrap-admin.js --project=<dev-project> --email=<email> [--name=<name>]",
  );
}
if (!emulator && projectId !== "marketready-tours-dev") {
  throw new Error(`Refusing to bootstrap non-dev project: ${projectId}`);
}
if (projectId === "marketready-tours" && !emulator) {
  throw new Error("Production bootstrap is permanently blocked in this script.");
}

initializeApp({
  credential: emulator ? undefined : applicationDefault(),
  projectId,
  databaseURL: emulator
    ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}-default-rtdb`
    : "https://marketready-tours-dev-default-rtdb.firebaseio.com",
});

let user;
try {
  user = await getAuth().getUserByEmail(email);
} catch (error) {
  if (error.code !== "auth/user-not-found") throw error;
  user = await getAuth().createUser({email, displayName: name, emailVerified: true});
}
await getAuth().updateUser(user.uid, {disabled: false, displayName: name});
await getAuth().setCustomUserClaims(user.uid, {mrtRole: "super"});
await getAuth().revokeRefreshTokens(user.uid);
await getDatabase().ref(`admins/${user.uid}`).set({
  uid: user.uid,
  email,
  name,
  role: "super",
  active: true,
  updatedAt: Date.now(),
  bootstrap: true,
});
console.log(`Bootstrapped dev super admin ${email} (${user.uid}).`);
