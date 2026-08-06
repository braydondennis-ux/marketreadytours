#!/usr/bin/env node

import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  get,
  ref,
  remove,
  set,
} from "firebase/database";
import {
  deleteObject,
  getBytes,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

const testEnv = await initializeTestEnvironment({
  projectId: "mrt-local-audit",
  database: {
    host: "127.0.0.1",
    port: 9000,
    rules: fs.readFileSync("database.rules.json", "utf8"),
  },
  storage: {
    host: "127.0.0.1",
    port: 9199,
    rules: fs.readFileSync("storage.rules", "utf8"),
  },
});

await testEnv.withSecurityRulesDisabled(async (context) => {
  await set(ref(context.database(), "mrt_tours_public/t1"), {
    id: "t1",
    name: "Public",
    date: "2026-08-04",
    listings: [],
    sponsors: [],
    version: 1,
  });
  await set(ref(context.database(), "mrt_tours_private/t1"), {
    id: "t1",
    name: "Private",
    code: "4821",
    listings: [],
    version: 1,
  });
  await set(ref(context.database(), "mrt_ratings_public/t1/l1"), {
    count: 1,
    averages: {price: 4},
  });
  await set(ref(context.database(), "mrt_ratings_private/t1/l1/guest-a"), {
    price: 4,
    raterName: "Private Person",
  });
  const listingAsset = storageRef(context.storage(), "mrt_listing_photos/t1/l1/photo.jpg");
  await uploadBytes(listingAsset, new Uint8Array([1, 2, 3]), {contentType: "image/jpeg"});
});

const anonymousDb = testEnv.unauthenticatedContext().database();
const outsiderDb = testEnv.authenticatedContext("outsider", {
  email: "outsider@example.com",
}).database();
const adminDb = testEnv.authenticatedContext("admin-a", {
  email: "admin@example.com",
  mrtRole: "admin",
}).database();
const guestADb = testEnv.authenticatedContext("guest-a").database();
const guestBDb = testEnv.authenticatedContext("guest-b").database();

test("public projection is readable but canonical tours are private", async () => {
  const publicSnapshot = await assertSucceeds(get(ref(anonymousDb, "mrt_tours_public/t1")));
  assert.equal(publicSnapshot.val().name, "Public");
  await assertFails(get(ref(anonymousDb, "mrt_tours_private/t1")));
  await assertFails(get(ref(outsiderDb, "mrt_tours_private/t1")));
  const privateSnapshot = await assertSucceeds(get(ref(adminDb, "mrt_tours_private/t1")));
  assert.equal(privateSnapshot.val().code, "4821");
});

test("no client, including an admin, can directly mutate canonical tours", async () => {
  await assertFails(set(ref(outsiderDb, "mrt_tours_private/t1/name"), "Owned"));
  await assertFails(set(ref(adminDb, "mrt_tours_private/t1/name"), "Bypass"));
  await assertFails(remove(ref(outsiderDb, "mrt_tours_public/t1")));
});

test("raw ratings are private and cannot be directly forged", async () => {
  await assertSucceeds(get(ref(anonymousDb, "mrt_ratings_public/t1/l1")));
  await assertFails(get(ref(anonymousDb, "mrt_ratings_private/t1/l1/guest-a")));
  await assertSucceeds(get(ref(guestADb, "mrt_ratings_private/t1/l1/guest-a")));
  await assertFails(get(ref(guestBDb, "mrt_ratings_private/t1/l1/guest-a")));
  await assertFails(set(ref(guestADb, "mrt_ratings_private/t1/l1/guest-a/price"), 999));
});

test("favorites are private and owned by the anonymous uid", async () => {
  await assertSucceeds(set(ref(guestADb, "mrt_favorites/guest-a/t1/l1"), true));
  assert.equal(
    (await assertSucceeds(get(ref(guestADb, "mrt_favorites/guest-a/t1/l1")))).val(),
    true,
  );
  await assertFails(get(ref(guestBDb, "mrt_favorites/guest-a/t1/l1")));
  await assertFails(set(ref(guestBDb, "mrt_favorites/guest-a/t1/l1"), true));
  await assertSucceeds(remove(ref(guestADb, "mrt_favorites/guest-a/t1/l1")));
});

test("temporary uploads are owner-only and admin assets support deletion", async () => {
  const guestAStorage = testEnv.authenticatedContext("guest-a").storage();
  const guestBStorage = testEnv.authenticatedContext("guest-b").storage();
  const adminStorage = testEnv.authenticatedContext("admin-a", {mrtRole: "admin"}).storage();
  const tempA = storageRef(guestAStorage, "mrt_upload_temp/guest-a/photo-a");
  await assertSucceeds(
    uploadBytes(tempA, new Uint8Array([1, 2, 3]), {contentType: "image/jpeg"}),
  );
  await assertFails(
    uploadBytes(
      storageRef(guestBStorage, "mrt_upload_temp/guest-a/photo-b"),
      new Uint8Array([1, 2, 3]),
      {contentType: "image/jpeg"},
    ),
  );
  await assertFails(
    getBytes(storageRef(guestBStorage, "mrt_upload_temp/guest-a/photo-a")),
  );
  await assertSucceeds(
    deleteObject(storageRef(adminStorage, "mrt_listing_photos/t1/l1/photo.jpg")),
  );
});

test.after(async () => {
  await testEnv.cleanup();
});
