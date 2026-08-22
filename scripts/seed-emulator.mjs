#!/usr/bin/env node

// Local emulator only. This script cannot resolve a remote database URL and refuses to run
// unless both Auth and Database emulator hosts are present.
import {createRequire} from "node:module";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(authHost) || !/^(127\.0\.0\.1|localhost):\d+$/.test(databaseHost)) {
  throw new Error("Seeder targets must be local emulator hosts.");
}
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
process.env.FIREBASE_DATABASE_EMULATOR_HOST = databaseHost;

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp, deleteApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {publicTourProjection, localYmd} = require("../functions/lib/domain");

const projectId = "mrt-local-audit";
const adminApp = initializeApp({
  projectId,
  databaseURL: `http://${databaseHost}?ns=${projectId}`,
});

const auth = getAuth();
const db = getDatabase();

async function ensureAdmin({email, password, name, role}) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    user = await auth.updateUser(user.uid, {password, displayName: name, disabled: false});
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({email, password, displayName: name, emailVerified: true});
  }
  await auth.setCustomUserClaims(user.uid, {mrtRole: role});
  return {uid: user.uid, email, name, role, active: true};
}

const superAdmin = await ensureAdmin({
  email: "super@example.com",
  password: "test1234",
  name: "Super Admin",
  role: "super",
});
const admin = await ensureAdmin({
  email: "admin@example.com",
  password: "test1234",
  name: "Tour Admin",
  role: "admin",
});

const listing = (id, address, order) => ({
  id,
  order,
  address,
  city: "Phoenix, AZ 85001",
  beds: 3,
  baths: 2,
  sqft: 1800,
  dom: 12,
  price: 450000,
  agent: "Test Agent",
  agentEmail: "agent@example.com",
  photos: [],
});

const tours = [
  {
    id: "tour-demo-1",
    name: "Demo North Tour",
    emoji: "🏡",
    color: "#0D0D0D",
    code: "1234",
    // Always ~30 days out. A hardcoded date silently rots the CI suite: launchCampaign
    // requires >=2 days of lead time and submitIntake rejects a tour whose date has passed,
    // so a fixed date fails the campaign gate the day before it and the intake gate after it.
    date: localYmd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    time: "10:00 AM",
    listings: [listing("listing-1", "100 Demo St", 1), listing("listing-2", "200 Demo Ave", 2)],
    sponsors: [
      {id: "sponsor-paid", name: "Paid Lender Co", email: "paid@example.com", paid: true},
      {id: "sponsor-unpaid", name: "Pending Title Co", email: "pending@example.com", paid: false},
    ],
    campaignContacts: [],
    version: 1,
    createdAt: Date.now(),
    createdBy: superAdmin.uid,
  },
];

const updates = {
  [`admins/${superAdmin.uid}`]: superAdmin,
  [`admins/${admin.uid}`]: admin,
};
for (const tour of tours) {
  updates[`mrt_tours_private/${tour.id}`] = tour;
  updates[`mrt_tours_public/${tour.id}`] = publicTourProjection(tour);
}
await db.ref().update(updates);

console.log("Seeded local emulators.");
console.log("  super@example.com / test1234");
console.log("  admin@example.com / test1234");
console.log("  tour code: 1234");
await deleteApp(adminApp);
