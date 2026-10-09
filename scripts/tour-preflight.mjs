#!/usr/bin/env node
// Real-tour fixture, local emulators only. Never accepts a remote target or sends email.
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {initializeApp, deleteApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword} from "firebase/auth";
import {getDatabase, connectDatabaseEmulator, ref, get, set, remove} from "firebase/database";
import {getStorage, connectStorageEmulator, ref as sr, uploadBytes, getBytes} from "firebase/storage";

const [fixturePath, sourceId] = process.argv.slice(2);
assert.ok(fixturePath && sourceId, "Usage: node scripts/tour-preflight.mjs <private-tour-json> <tour-id>");
const source = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const original = source[sourceId] || source;
assert.equal(original.id, sourceId);
const stopCount = original.listings.length;
assert.ok(stopCount >= 1 && stopCount <= 8, "Expected a populated tour with no more than eight stops");
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {RATING_KEYS, publicTourProjection, localYmd} = require("../functions/lib/domain");
const {buildEvaluationEmail} = require("../functions/lib/evaluation-email");
const projectId = "mrt-local-audit";
const adminApp = admin.initializeApp({projectId, databaseURL: `http://127.0.0.1:9000?ns=${projectId}`, storageBucket: `${projectId}.appspot.com`}, "preflight");
const root = require("firebase-admin/database").getDatabase(adminApp).ref();
// The CLI loads rules into the default-rtdb namespace, while the app uses the project ID.
// Explicitly load the real production rules into the exact namespace under test.
const stripComments = value => Array.isArray(value) ? value.map(stripComments) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== "//").map(([k,v]) => [k, stripComments(v)])) : value;
const rules = JSON.stringify(stripComments(JSON.parse(fs.readFileSync(process.env.MRT_PREFLIGHT_RULES || "database.rules.transition.json", "utf8"))));
const ruleResponse = await fetch(`http://127.0.0.1:9000/.settings/rules.json?ns=${projectId}`, {
  method: "PUT", headers: {Authorization: "Bearer owner", "Content-Type": "application/json"}, body: rules,
});
assert.equal(ruleResponse.status, 200, await ruleResponse.text());

const id = "local-only-oct9-preflight";
const checks = [];
const apps = [];
const pass = label => {checks.push(label); console.log("PASS", label);};
const config = {apiKey: "mrt-local-emulator-key", projectId, databaseURL: `http://127.0.0.1:9000?ns=${projectId}`, storageBucket: `${projectId}.appspot.com`};
async function client(name, isAdmin = false) {
  const app = initializeApp(config, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  const db = getDatabase(app); connectDatabaseEmulator(db, "127.0.0.1", 9000);
  const storage = getStorage(app); connectStorageEmulator(storage, "127.0.0.1", 9199);
  if (isAdmin) await signInWithEmailAndPassword(auth, "super@example.com", "test1234");
  else await signInAnonymously(auth);
  return {auth, db, storage};
}
async function call(c, name, data, status = 200) {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/${name}`, {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${await c.auth.currentUser.getIdToken()}`},
    body: JSON.stringify({data: {requestId: crypto.randomUUID(), ...data}}), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  assert.equal(response.status, status, `${name}: ${JSON.stringify(body)}`);
  return body.result || body;
}
const read = async path => (await root.child(path).get()).val();
const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /email/i.test(k) ? "erik@marketreadysystems.ai" : /phone/i.test(k) ? "" : clean(v)])) : value;
let tour = {...clean(original), id, name: "LOCAL TEST: " + original.name, code: "4100", version: 1, campaignContacts: []};
delete tour.createdBy; delete tour.updatedBy;
await root.update({[`mrt_ratings_private/${id}`]:null,[`mrt_ratings_public/${id}`]:null,[`mrt_tours_private/${id}`]: tour, [`mrt_tours_public/${id}`]: publicTourProjection(tour)});
try {
  const owner = await client("preflight-admin", true);
  const attendee = await client("preflight-attendee");
  const outsider = await client("preflight-outsider");
  const visible = (await get(ref(attendee.db, `mrt_tours_public/${id}`))).val();
  assert.equal(visible.listings.length, stopCount); assert.equal(visible.code, undefined);
  await assert.rejects(get(ref(attendee.db, `mrt_tours_private/${id}`)));
  pass("Complete public projection loads; code and private tour remain protected");
  await call(attendee, "verifyTourCode", {tourId:id, code:"9999"}, 403);
  const grant = await call(attendee, "verifyTourCode", {tourId:id, code:tour.code});
  await call(outsider, "submitRating", {tourId:id, listingId:tour.listings[0].id, grantId:grant.grantId, rating:{}},403);
  pass("Correct access code unlocks; incorrect code and another user's grant are rejected");
  const favoritePath=`mrt_favorites/${attendee.auth.currentUser.uid}/${id}/${tour.listings[0].id}`;
  await set(ref(attendee.db,favoritePath),true);
  assert.equal((await get(ref(attendee.db,favoritePath))).val(),true);
  await remove(ref(attendee.db,favoritePath));
  assert.equal((await get(ref(attendee.db,favoritePath))).val(),null);
  pass("Favorites persist and can be removed (legacy live rules retain shared access)");
  const rating = Object.fromEntries(RATING_KEYS.map(k=>[k,4]));
  await call(attendee, "submitRating", {tourId:id, listingId:tour.listings[0].id, grantId:grant.grantId, rating:{...rating,price:6}},400);
  await call(attendee, "submitRating", {tourId:id, listingId:"missing", grantId:grant.grantId, rating},404);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
  const photoId="preflight-image"; const uid=attendee.auth.currentUser.uid;
  await uploadBytes(sr(attendee.storage,`mrt_upload_temp/${uid}/${photoId}`),png,{contentType:"image/png"});
  for (const [i,l] of tour.listings.entries()) {
    const data={tourId:id,listingId:l.id,grantId:grant.grantId,requestId:crypto.randomUUID(),
      rating:{...rating,curbAppeal:i%5+1,suggestions:`TEST ONLY property ${i+1}: <b>literal feedback</b>`,raterName:"PRIVATE TEST RATER",pricedRight:false,sugPrice:"$700,000"},
      tempPhotoIds:i===0?[photoId]:[]};
    const saved=await call(attendee,"submitRating",data); assert.equal(saved.ok,true);
    assert.deepEqual(await call(attendee,"submitRating",data),saved);
    const agg=await read(`mrt_ratings_public/${id}/${l.id}`); assert.equal(agg.count,1); assert.equal(agg.averages.curbAppeal,i%5+1);
  }
  pass("All property evaluations persist; retries do not duplicate them; every category and comment retained");
  const photoPath=`mrt_rating_photos/${id}/${tour.listings[0].id}/${uid}/${photoId}`;
  assert.ok((await getBytes(sr(attendee.storage,photoPath))).byteLength);
  assert.ok((await getBytes(sr(owner.storage,photoPath))).byteLength);
  await assert.rejects(getBytes(sr(outsider.storage,photoPath)));
  assert.equal((await require("firebase-admin/storage").getStorage(adminApp).bucket().file(`mrt_upload_temp/${uid}/${photoId}`).exists())[0],false);
  pass("Photo upload moves to private storage; submitting attendee/admin can read; other attendee cannot");
  await call(attendee,"submitRating",{tourId:id,listingId:tour.listings[1].id,grantId:grant.grantId,rating:{...rating,price:2,suggestions:"Updated test feedback"}});
  let agg=await read(`mrt_ratings_public/${id}/${tour.listings[1].id}`);assert.equal(agg.count,1);assert.equal(agg.averages.price,2);
  pass("Re-rating replaces the same attendee's evaluation without inflating counts");
  const others=await Promise.all(Array.from({length:6},(_,i)=>client(`preflight-concurrent-${i}`)));
  const grants=await Promise.all(others.map(c=>call(c,"verifyTourCode",{tourId:id,code:tour.code})));
  await Promise.all(others.map((c,i)=>call(c,"submitRating",{tourId:id,listingId:tour.listings[0].id,grantId:grants[i].grantId,rating:{...rating,price:i%5+1,suggestions:`Concurrent test ${i}`}})));
  const submitted=await read(`mrt_ratings_private/${id}/${tour.listings[0].id}`);
  agg=await read(`mrt_ratings_public/${id}/${tour.listings[0].id}`);
  assert.equal(Object.keys(submitted).length,7);assert.equal(agg.count,7);
  for(const key of RATING_KEYS){
    const expected=Math.round(Object.values(submitted).reduce((sum,r)=>sum+r[key],0)/7*10)/10;
    assert.equal(agg.averages[key],expected);
  }
  pass("Six concurrent attendees plus original evaluation remain saved and aggregate count is seven");
  await assert.rejects(get(ref(outsider.db,`mrt_ratings_private/${id}`)));
  await call(outsider,"sendAdminEmail",{reportType:"listing-summary",tourId:id,listingId:tour.listings[0].id},403);
  const adminRatings = (await get(ref(owner.db,"mrt_ratings_private"))).val();
  assert.equal(Object.keys(adminRatings[id][tour.listings[0].id]).length,7);
  pass("Admin summary subscription reads all evaluations; attendees cannot read others or send reports");
  await root.child(`mrt_rating_grants/${uid}/${id}/expiresAt`).set(Date.now()-1);
  await call(attendee,"submitRating",{tourId:id,listingId:tour.listings[0].id,grantId:grant.grantId,rating},403);
  const renewed=await call(attendee,"verifyTourCode",{tourId:id,code:tour.code});
  assert.notEqual(renewed.grantId,grant.grantId);
  pass("Expired access is rejected and entering the tour code renews access");
  for(const l of tour.listings){
    const ratings=await read(`mrt_ratings_private/${id}/${l.id}`);
    const email=buildEvaluationEmail({tour,listing:l,ratings});
    for(const r of Object.values(ratings))assert.ok(email.text.includes(r.suggestions));
    assert.ok(!email.html.includes("PRIVATE TEST RATER"));assert.ok(!email.html.includes("<b>literal feedback</b>"));
    for(const reportType of ["listing-summary","seller-report"]){
      const sent=await call(owner,"sendAdminEmail",{reportType,tourId:id,listingId:l.id});
      assert.equal(sent.mocked,true);assert.equal(sent.evaluationCount,Object.keys(ratings).length);
    }
  }
  pass("Both report types render every saved evaluation for every property; HTML escaped; sends mocked");
  let result=await call(owner,"saveTour",{tour:{...tour,listings:[...tour.listings].reverse().map((l,i)=>({...l,order:i+1})),name:tour.name+" edited"},expectedVersion:1});
  tour=result.tour;assert.equal(tour.version,2);
  await call(owner,"saveTour",{tour,expectedVersion:1},409);
  assert.equal((await read(`mrt_tours_public/${id}`)).version,2);
  pass("Edit/reorder saves publish; stale-version overwrite rejected without losing the saved tour");
  const extra={...tour.listings[0],id:"local-only-extra",address:"LOCAL TEST extra stop",order:stopCount+1};
  result=await call(owner,"saveTour",{tour:{...tour,listings:[...tour.listings,extra]},expectedVersion:tour.version});tour=result.tour;
  const skipped=await call(owner,"sendAdminEmail",{reportType:"listing-summary",tourId:id,listingId:extra.id});assert.equal(skipped.skipped,true);
  result=await call(owner,"saveTour",{tour:{...tour,listings:tour.listings.filter(l=>l.id!==extra.id)},expectedVersion:tour.version});tour=result.tour;
  assert.equal((await read(`mrt_tours_private/${id}`)).listings.length,stopCount);
  pass("Add/remove listing persists and empty evaluation reports are skipped");
  const future=localYmd(new Date(Date.now()+7*86400000));
  result=await call(owner,"saveTour",{tour:{...tour,date:future},expectedVersion:tour.version});tour=result.tour;
  let reminders=Object.values(await read("mrt_reminders")||{}).filter(r=>r.tourId===id);
  assert.equal(reminders.filter(r=>r.status==="pending").length,stopCount*2);
  pass("Rescheduling creates exactly two 48h/24h reminder records per listing");
  const deletion=await call(owner,"deleteTour",{tourId:id,expectedVersion:tour.version});assert.equal(deletion.deleted,true);
  for(const node of ["mrt_tours_private","mrt_tours_public","mrt_ratings_private","mrt_ratings_public"])assert.equal(await read(`${node}/${id}`),null);
  reminders=Object.values(await read("mrt_reminders")||{}).filter(r=>r.tourId===id);assert.ok(reminders.every(r=>r.status==="cancelled"));
  pass("Delete/cancel removes the local test tour and evaluations, and cancels unsent reminders");
  fs.writeFileSync("/tmp/mrt-oct9-preflight-results.json",JSON.stringify({sourceId,sourceVersion:original.version,stopCount,checks,completedAt:new Date().toISOString()},null,2));
} finally {
  await Promise.all(apps.map(deleteApp));await adminApp.delete();
}

process.exit(0);
