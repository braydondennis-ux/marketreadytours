#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  ref,
} from "firebase/database";

const projectId = "mrt-local-audit";
const app = initializeApp({
  apiKey: "mrt-local-emulator-key",
  authDomain: `${projectId}.firebaseapp.com`,
  databaseURL: `http://127.0.0.1:9000?ns=${projectId}`,
  projectId,
  storageBucket: `${projectId}.appspot.com`,
});
const auth = getAuth(app);
const db = getDatabase(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
connectDatabaseEmulator(db, "127.0.0.1", 9000);

const functionUrl = (name) =>
  `http://127.0.0.1:5001/${projectId}/us-central1/${name}`;
const requestId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

async function callable(name, data, expectedStatus = 200) {
  console.log(`  calling ${name}`);
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(functionUrl(name), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({data}),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(
    response.status,
    expectedStatus,
    `${name} returned ${response.status}: ${await response.clone().text()}`,
  );
  const body = await response.json();
  if (expectedStatus !== 200) return body;
  assert.ok(body.result, `${name} did not return a callable result`);
  return body.result;
}

console.log("Signing in anonymously");
await signInAnonymously(auth);
await callable("deleteTour", {tourId: "tour-demo-1", expectedVersion: 1, requestId: requestId("anonymous-delete")}, 403);
await callable("verifyTourCode", {tourId: "tour-demo-1", code: "0000"}, 403);
const grant = await callable("verifyTourCode", {tourId: "tour-demo-1", code: "1234"});
assert.ok(grant.grantId);

const scores = {
  curbAppeal: 5,
  landscape: 4,
  cleanliness: 5,
  flooring: 4,
  paint: 5,
  showability: 5,
  price: 4,
  kitchen: 5,
  bedrooms: 4,
  windows: 5,
};
await callable("submitRating", {
  tourId: "tour-demo-1",
  listingId: "listing-1",
  grantId: grant.grantId,
  rating: {...scores, suggestions: "Looks ready", pricedRight: true, raterName: "Emulator"},
  requestId: requestId("rating"),
});
await callable("submitRating", {
  tourId: "tour-demo-1",
  listingId: "listing-1",
  grantId: grant.grantId,
  rating: {...scores, curbAppeal: 4, suggestions: "Second save", pricedRight: true},
  requestId: requestId("rating"),
});
const aggregate = (await get(ref(db, "mrt_ratings_public/tour-demo-1/listing-1"))).val();
assert.equal(aggregate.count, 1, "one authenticated user must not inflate rating count");
assert.equal(aggregate.averages.curbAppeal, 4);
await callable("sendAdminEmail", {reportType: "listing-summary", tourId: "tour-demo-1",
  listingId: "listing-1", requestId: requestId("anonymous-report")}, 403);

const listingIntake = await callable("submitIntake", {
  type: "listing",
  payload: {
    name: "Listing Agent",
    email: "listing@example.com",
    agentName: "Listing Agent",
    agentEmail: "listing@example.com",
    tourId: "tour-demo-1",
    tourName: "Demo North Tour",
    address: "300 Workflow Way",
    city: "Phoenix, AZ",
    beds: 3,
    baths: 2,
    sqft: 1900,
    dom: 4,
    price: 525000,
    photos: [],
  },
  requestId: requestId("listing-intake"),
});
const sponsorIntake = await callable("submitIntake", {
  type: "sponsor",
  payload: {
    name: "Workflow Sponsor",
    email: "sponsor@example.com",
    contactName: "Sponsor Person",
    tourId: "tour-demo-1",
    paymentPlan: "half",
  },
  requestId: requestId("sponsor-intake"),
});

await signOut(auth);
await signInWithEmailAndPassword(auth, "super@example.com", "test1234");
await auth.currentUser.getIdToken(true);

const evaluationReportRequest = {reportType: "listing-summary", tourId: "tour-demo-1",
  listingId: "listing-1", requestId: requestId("evaluation-report"),
  // Caller-supplied content/recipient must not replace the saved listing and evaluations.
  to: "not-an-email", html: "<script>bad</script>", ratings: []};
const evaluationReport = await callable("sendAdminEmail", evaluationReportRequest);
assert.equal(evaluationReport.evaluationCount, 1);
assert.equal(evaluationReport.mocked, true);
assert.deepEqual(await callable("sendAdminEmail", evaluationReportRequest), evaluationReport);
await callable("sendAdminEmail", {...evaluationReportRequest, listingId: "missing", requestId: requestId("missing-report")}, 404);
await callable("sendAdminEmail", {...evaluationReportRequest, reportType: "unknown", requestId: requestId("invalid-report")}, 400);
const emptyReport = await callable("sendAdminEmail", {...evaluationReportRequest,
  listingId: "listing-2", requestId: requestId("empty-report")});
assert.equal(emptyReport.skipped, true, "a property without evaluations must not send an empty report");
const sellerReport = await callable("sendAdminEmail", {...evaluationReportRequest,
  reportType: "seller-report", requestId: requestId("seller-report")});
assert.equal(sellerReport.evaluationCount, 1);
assert.equal(sellerReport.mocked, true);

await callable("approveListingRequest", {
  listingRequestId: listingIntake.id,
  requestId: requestId("approve-listing"),
});
assert.equal(
  (await get(ref(db, `mrt_listing_requests/${listingIntake.id}/status`))).val(),
  "approved",
);

const sponsorApproval = await callable("approveSponsorSignup", {
  signupId: sponsorIntake.id,
  requestId: requestId("approve-sponsor"),
});
const beforePayment = (await get(ref(db, "mrt_tours_public/tour-demo-1/sponsors"))).val() || [];
assert.equal(
  Object.values(beforePayment).some((sponsor) => sponsor.id === sponsorApproval.sponsorId),
  false,
  "unpaid sponsor leaked into the public projection",
);

await callable("markSponsorPaid", {
  tourId: "tour-demo-1",
  sponsorId: sponsorApproval.sponsorId,
  paid: true,
  requestId: requestId("manual-paid"),
});
const afterManualPayment =
  (await get(ref(db, "mrt_tours_public/tour-demo-1/sponsors"))).val() || [];
assert.equal(
  Object.values(afterManualPayment).some((sponsor) => sponsor.id === sponsorApproval.sponsorId),
  true,
  "manual payment did not publish the sponsor",
);
const manualPrivateTour = (await get(ref(db, "mrt_tours_private/tour-demo-1"))).val();
assert.equal(
  manualPrivateTour.sponsors.find((sponsor) => sponsor.id === sponsorApproval.sponsorId).paymentMethod,
  "manual",
);

// Paid sponsorships must survive direct callable attempts to delete their tour or remove them.
await callable("deleteTour", {tourId: "tour-demo-1", expectedVersion: manualPrivateTour.version,
  requestId: requestId("paid-tour-delete")}, 400);
await callable("saveTour", {tour: {...manualPrivateTour, sponsors: []},
  expectedVersion: manualPrivateTour.version, requestId: requestId("paid-sponsor-remove")}, 400);
await callable("markSponsorPaid", {tourId: "tour-demo-1", sponsorId: sponsorApproval.sponsorId,
  paid: false, requestId: requestId("unpaid-without-review")}, 400);
assert.deepEqual((await get(ref(db, "mrt_tours_private/tour-demo-1"))).val(), manualPrivateTour,
  "blocked sponsor changes must not mutate the saved tour");

await callable("markSponsorPaid", {
  tourId: "tour-demo-1",
  sponsorId: sponsorApproval.sponsorId,
  paid: false,
  resolutionNote: "Emulator-only incorrect manual payment flag corrected; no real money was collected.",
  acknowledgeNoRefund: true,
  requestId: requestId("manual-unpaid"),
});
const reviewResponse = await fetch("http://127.0.0.1:9000/mrt_sponsor_payment_reviews.json?ns=mrt-local-audit", {headers: {Authorization: "Bearer owner"}});
assert.equal(reviewResponse.status, 200);
const paymentReviews = Object.values(await reviewResponse.json());
assert.equal(paymentReviews.length, 1);
assert.equal(paymentReviews[0].sponsorId, sponsorApproval.sponsorId);
assert.equal(paymentReviews[0].previousPayment.paid, true);
assert.equal(paymentReviews[0].acknowledgedNoRefund, true);
assert.ok(paymentReviews[0].reviewedBy);
const afterManualUnpayment =
  (await get(ref(db, "mrt_tours_public/tour-demo-1/sponsors"))).val() || [];
assert.equal(
  Object.values(afterManualUnpayment).some((sponsor) => sponsor.id === sponsorApproval.sponsorId),
  false,
  "manually unpaid sponsor remained public",
);

const invoice = await callable("createSponsorInvoice", {
  signupId: sponsorIntake.id,
  requestId: requestId("invoice"),
});
assert.equal(invoice.mocked, true);
assert.equal(invoice.amountCents, 9950);
assert.equal(invoice.paymentUrl, "");

async function sendSquareInvoiceEvent(type, status, targetInvoiceId = invoice.invoiceId) {
  const event = {
    event_id: crypto.randomUUID(),
    type,
    data: {
      type: "invoice",
      id: targetInvoiceId,
      object: {invoice: {id: targetInvoiceId, status}},
    },
  };
  const rawEvent = JSON.stringify(event);
  const notificationUrl = functionUrl("squareWebhook");
  const squareSignature = crypto
    .createHmac("sha256", "mrt-workflow-square-secret")
    .update(notificationUrl + rawEvent)
    .digest("base64");
  const response = await fetch(notificationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-square-hmacsha256-signature": squareSignature,
    },
    body: rawEvent,
  });
  assert.equal(response.status, 204, await response.text());
}

await sendSquareInvoiceEvent("invoice.payment_made", "PARTIALLY_PAID");
const afterPartialPayment =
  (await get(ref(db, "mrt_tours_public/tour-demo-1/sponsors"))).val() || [];
assert.equal(
  Object.values(afterPartialPayment).some((sponsor) => sponsor.id === sponsorApproval.sponsorId),
  false,
  "partially paid sponsor leaked into the public projection",
);

let privateTour = (await get(ref(db, "mrt_tours_private/tour-demo-1"))).val();
privateTour.campaignContacts = [{
  id: "contact-1",
  email: "campaign@example.com",
  firstName: "Campaign",
  address: "400 Sequence St",
  status: "pending",
}];
const saved = await callable("saveTour", {
  tour: privateTour,
  expectedVersion: privateTour.version,
  requestId: requestId("save-tour"),
});
assert.equal(saved.version, privateTour.version + 1);

const campaign = await callable("launchCampaign", {
  tourId: "tour-demo-1",
  contactIds: ["contact-1"],
  templates: [{
    subject: "Workflow invite",
    body: '<a href="http://127.0.0.1:8080/?token={{mrt_opt_out_token}}#/not-interested">Opt out</a>',
  }],
  requestId: requestId("campaign"),
});
assert.equal(campaign.mocked, true);
assert.equal(campaign.contactCount, 1);

const optOutPayload = {
  tourId: "tour-demo-1",
  email: "campaign@example.com",
  exp: Date.now() + 60_000,
};
const encoded = Buffer.from(JSON.stringify(optOutPayload)).toString("base64url");
const signature = crypto
  .createHmac("sha256", "mrt-workflow-signing-secret")
  .update(encoded)
  .digest("hex");
await callable("optOut", {token: `${encoded}.${signature}`});

await sendSquareInvoiceEvent("invoice.payment_made", "PAID");

const afterPayment = (await get(ref(db, "mrt_tours_public/tour-demo-1/sponsors"))).val() || [];
assert.equal(
  Object.values(afterPayment).some((sponsor) => sponsor.id === sponsorApproval.sponsorId),
  true,
  "verified payment did not publish the sponsor",
);

await sendSquareInvoiceEvent("invoice.refunded", "REFUNDED");
const afterRefund = (await get(ref(db, "mrt_tours_public/tour-demo-1/sponsors"))).val() || [];
assert.equal(
  Object.values(afterRefund).some((sponsor) => sponsor.id === sponsorApproval.sponsorId),
  false,
  "refunded sponsor remained in the public projection",
);

/* Reminders. Every listing on the tour must own exactly one reminder per offset, no matter
   whether it was typed into the editor or approved from a listing request — two rows for one
   listing means that agent is emailed twice. This is asserted against real callables because
   the duplicate that prompted it came from two code paths minting different ids for the same
   listing, which no single-module unit test would have caught. */
const reminderRows = Object.values((await get(ref(db, "mrt_reminders"))).val() || {});
const tourListings = (await get(ref(db, "mrt_tours_private/tour-demo-1/listings"))).val() || [];
const withAgents = Object.values(tourListings).filter((l) => l && l.agentEmail);

assert.ok(withAgents.length > 0, "the demo tour should have listings with agent emails");
assert.equal(
  reminderRows.length,
  withAgents.length * 2,
  `expected 2 reminders per listing (${withAgents.length * 2}), found ${reminderRows.length}`,
);

const seen = new Set();
for (const row of reminderRows) {
  const key = `${row.listingId}:${row.hoursAhead}`;
  assert.equal(seen.has(key), false, `duplicate reminder for ${key} — this agent would be emailed twice`);
  seen.add(key);
  assert.equal(row.tourId, "tour-demo-1");
  assert.ok([24, 48].includes(row.hoursAhead), "unexpected reminder offset");
  assert.ok(row.sendAt < row.expiresAt, "a reminder must be scheduled before the tour starts");
  assert.ok(row.agentEmail, "a reminder with no recipient should never have been created");
}

/* RTDB removes empty arrays. Reloading a new tour therefore omits sponsors entirely;
   adding its first listing must still commit, including for a regular admin. */
await signOut(auth);
await signInWithEmailAndPassword(auth, "admin@example.com", "test1234");
const firstListingTourId = "tour-first-listing";
await callable("saveTour", {
  tour: {id: firstListingTourId, name: "First Listing Regression", date: "2027-01-15", time: "9:00 AM", listings: [], sponsors: []},
  expectedVersion: 0,
  requestId: requestId("empty-tour"),
});
const reloadedEmptyTour = (await get(ref(db, `mrt_tours_private/${firstListingTourId}`))).val();
assert.equal(Object.hasOwn(reloadedEmptyTour, "sponsors"), false, "RTDB must reproduce the omitted sponsor field");
const firstListing = {id: "first-listing", address: "1 Regression Way", city: "Phoenix, AZ 85012"};
const firstListingSaved = await callable("saveTour", {
  tour: {...reloadedEmptyTour, listings: [firstListing]},
  expectedVersion: reloadedEmptyTour.version,
  requestId: requestId("first-listing-save"),
});
assert.equal(firstListingSaved.version, 2);
for (const root of ["mrt_tours_private", "mrt_tours_public"]) {
  const persisted = (await get(ref(db, `${root}/${firstListingTourId}`))).val();
  assert.equal(persisted.version, 2);
  assert.equal(persisted.listings[0].address, firstListing.address, `${root} must persist the first listing`);
}
await callable("deleteTour", {tourId: firstListingTourId, expectedVersion: 2, requestId: requestId("first-listing-cleanup")});
await signOut(auth);
await signInWithEmailAndPassword(auth, "super@example.com", "test1234");

/* Deleting a tour must take its reminders out of the queue, or the worker mails every agent
   about a tour that no longer exists. */
const deletableTour = {
  id: "tour-reminder-cleanup",
  name: "Cleanup Tour",
  date: "2027-01-15",
  time: "9:00 AM",
  listings: [{id: "cleanup-1", address: "1 Cleanup Way", agent: "A", agentEmail: "cleanup@example.com"}],
  sponsors: [],
};
await callable("saveTour", {tour: deletableTour, expectedVersion: 0, requestId: requestId("cleanup-save")});
const afterCleanupSave = Object.values((await get(ref(db, "mrt_reminders"))).val() || {})
  .filter((r) => r.tourId === "tour-reminder-cleanup");
assert.equal(afterCleanupSave.length, 2, "saving a hand-built tour must create its reminders");
assert.equal(afterCleanupSave.every((r) => r.status === "pending"), true);

// A regular admin can delete a tour created by a super-admin, but stale edits still fail.
await signOut(auth);
await signInWithEmailAndPassword(auth, "admin@example.com", "test1234");
await callable("deleteTour", {tourId: "tour-reminder-cleanup", expectedVersion: 0, requestId: requestId("stale-delete")}, 409);
assert.ok((await get(ref(db, "mrt_tours_private/tour-reminder-cleanup"))).exists(), "stale delete must preserve the tour");
const deleteRequest = {tourId: "tour-reminder-cleanup", expectedVersion: 1, requestId: requestId("cleanup-delete")};
const deleted = await callable("deleteTour", deleteRequest);
assert.equal(deleted.deleted, true, "regular admins must be allowed to delete tours");
assert.deepEqual(await callable("deleteTour", deleteRequest), deleted, "retrying the same deletion must be idempotent");
assert.equal((await get(ref(db, 'mrt_tours_private/tour-reminder-cleanup/cancelled'))).val(), true);
assert.equal((await get(ref(db, 'mrt_tours_public/tour-reminder-cleanup'))).exists(), false);
const afterCleanupDelete = Object.values((await get(ref(db, "mrt_reminders"))).val() || {})
  .filter((r) => r.tourId === "tour-reminder-cleanup");
assert.equal(afterCleanupDelete.length, 2, "records are kept for the audit trail");
assert.equal(
  afterCleanupDelete.every((r) => r.status === "cancelled"),
  true,
  "deleting a tour must cancel its reminders, not leave them to fire",
);

await signOut(auth);
await signInWithEmailAndPassword(auth, "super@example.com", "test1234");
await callable("saveTour", {tour: {...deletableTour, id: "tour-super-delete", listings: []}, expectedVersion: 0, requestId: requestId("super-delete-save")});
const superDeleted = await callable("deleteTour", {tourId: "tour-super-delete", expectedVersion: 1, requestId: requestId("super-delete")});
assert.equal(superDeleted.deleted, true, "super-admins must retain deletion access");

const cancellationTour = await callable("saveTour", {tour:{...deletableTour,id:"tour-cancel-paid",sponsors:[{id:"cancel-sp",name:"Paid Sponsor",paymentPlan:"split"}]},expectedVersion:0,requestId:requestId("cancel-create")});
await callable("markSponsorPaid",{tourId:"tour-cancel-paid",sponsorId:"cancel-sp",paid:true,requestId:requestId("cancel-paid")});
let preview = await callable("deleteTour",{action:"preview",tourId:"tour-cancel-paid"});
assert.equal(preview.tasks.length,1);
assert.equal(preview.tasks[0].amountCents,null,"manual amounts must not be guessed from the plan");
await callable("deleteTour",{tourId:"tour-cancel-paid",expectedVersion:preview.version,previewKey:preview.previewKey,requestId:requestId("no-ack")},400);
await fetch('http://127.0.0.1:9000/mrt_sponsor_payments/before-session.json?ns=mrt-local-audit',{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({tourId:'tour-cancel-paid',sponsorId:'cancel-sp',status:'paid',amountCents:4975,checkoutSessionId:'before-session',cloverPaymentId:'before-payment'})});
await callable('deleteTour',{action:'cancel',tourId:'tour-cancel-paid',expectedVersion:preview.version,previewKey:preview.previewKey,acknowledgeRefunds:true,requestId:requestId('stale-payment-preview')},400);
preview=await callable('deleteTour',{action:'preview',tourId:'tour-cancel-paid'});
const cancelRequest={action:"cancel",tourId:"tour-cancel-paid",expectedVersion:preview.version,previewKey:preview.previewKey,acknowledgeRefunds:true,requestId:requestId("ack-cancel"),email:"wrong@example.com"};
const cancelled=await callable("deleteTour",cancelRequest);
assert.deepEqual(await callable("deleteTour",cancelRequest),cancelled);
assert.equal(cancelled.tour.cancelled,true);
const encodedPay=Buffer.from(JSON.stringify({t:'tour-cancel-paid',s:'cancel-sp',p:'split',exp:Date.now()+60000})).toString('base64url');
const closedPayToken=encodedPay+'.'+crypto.createHmac('sha256','mrt-workflow-signing-secret').update(encodedPay).digest('hex');
await callable('createSponsorCheckout',{token:closedPayToken},404);

assert.equal(cancelled.tour.cancellation.notificationEmail,"super@example.com","recipient must come from Auth");
assert.equal((await get(ref(db,"mrt_tours_public/tour-cancel-paid"))).exists(),false);
await callable("saveTour",{tour:{...cancelled.tour,cancelled:false},expectedVersion:cancelled.tour.version,requestId:requestId("restore-cancelled")},400);
await callable("verifyTourCode",{tourId:"tour-cancel-paid",code:"1234"},403);
await callable("markSponsorPaid",{tourId:"tour-cancel-paid",sponsorId:"cancel-sp",paid:true,requestId:requestId("pay-cancelled")},404);
await callable("deleteTour",{action:"resolve",tourId:"tour-cancel-paid",taskId:preview.tasks[0].id,resolutionNote:"Refund completed, test reference REF-123",requestId:requestId("resolve-cancel")});
const resolved=await callable("deleteTour",{action:"preview",tourId:"tour-cancel-paid"});
assert.equal(resolved.tasks[0].status,"resolved");
assert.equal(resolved.tasks[0].resolutionNote,"Refund completed, test reference REF-123");
const notice=await fetch("http://127.0.0.1:9000/mrt_email_outbox/cancellation_tour-cancel-paid.json?ns=mrt-local-audit",{headers:{Authorization:"Bearer owner"}}).then(r=>r.json());
assert.equal(notice.message.to,"super@example.com");
assert.match(notice.message.text,/No refund has been issued/);
assert.match(notice.message.text,/Paid Sponsor/);
assert.equal(notice.status,"pending");

// A checkout opened before cancellation can still be paid. Capture it once and notify
// the original canceling organizer, without republishing the cancelled tour.
const lateSession='late-session';
await fetch('http://127.0.0.1:9000/mrt_sponsor_payments/'+lateSession+'.json?ns=mrt-local-audit',{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({tourId:'tour-cancel-paid',sponsorId:'cancel-sp',status:'pending',provider:'clover',amountCents:4975,checkoutSessionId:lateSession})});
const event={type:'PAYMENT',id:'late-payment',status:'APPROVED',checkoutSessionId:lateSession};
const raw=JSON.stringify(event), ts=Math.floor(Date.now()/1000);
const sig=crypto.createHmac('sha256','mrt-workflow-clover-secret').update(ts+'.'+raw).digest('hex');
for(let i=0;i<2;i++) {
 const result=await fetch(functionUrl('cloverWebhook'),{method:'POST',headers:{'Content-Type':'application/json','Clover-Signature':`t=${ts},v1=${sig}`},body:raw});
 assert.equal(result.status,200,await result.text());
}
const latePreview=await callable('deleteTour',{action:'preview',tourId:'tour-cancel-paid'});
assert.equal(latePreview.tasks.filter(t=>t.paymentId==='late-payment').length,1);
assert.equal(latePreview.tasks.find(t=>t.paymentId==='late-payment').status,'pending');
assert.equal((await get(ref(db,'mrt_tours_public/tour-cancel-paid'))).exists(),false);
const lateNotice=await fetch('http://127.0.0.1:9000/mrt_email_outbox/cancelled_payment_late-session.json?ns=mrt-local-audit',{headers:{Authorization:'Bearer owner'}}).then(r=>r.json());
assert.equal(lateNotice.message.to,'super@example.com');assert.match(lateNotice.message.text,/late-payment/);

// An old Square invoice must also retain payment follow-up after cancellation.
await fetch('http://127.0.0.1:9000/mrt_invoices/late-square.json?ns=mrt-local-audit',{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({tourId:'tour-cancel-paid',signupId:'late-square-signup',status:'pending',amountCents:9950})});
await sendSquareInvoiceEvent('invoice.payment_made','PAID','late-square');
const squarePreview=await callable('deleteTour',{action:'preview',tourId:'tour-cancel-paid'});
assert.equal(squarePreview.tasks.find(t=>t.paymentId==='late-square').amountCents,9950);
assert.equal((await get(ref(db,'mrt_tours_public/tour-cancel-paid'))).exists(),false);

console.log(
  "Workflow suite passed: rating, intake, approval, manual payment, campaign, opt-out, Square payment, refund, and reminders.",
);
await deleteApp(app);
process.exit(0);
