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

await callable("markSponsorPaid", {
  tourId: "tour-demo-1",
  sponsorId: sponsorApproval.sponsorId,
  paid: false,
  requestId: requestId("manual-unpaid"),
});
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

async function sendSquareInvoiceEvent(type, status) {
  const event = {
    event_id: crypto.randomUUID(),
    type,
    data: {
      type: "invoice",
      id: invoice.invoiceId,
      object: {invoice: {id: invoice.invoiceId, status}},
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

await callable("deleteTour", {tourId: "tour-reminder-cleanup", expectedVersion: 1, requestId: requestId("cleanup-delete")});
const afterCleanupDelete = Object.values((await get(ref(db, "mrt_reminders"))).val() || {})
  .filter((r) => r.tourId === "tour-reminder-cleanup");
assert.equal(afterCleanupDelete.length, 2, "records are kept for the audit trail");
assert.equal(
  afterCleanupDelete.every((r) => r.status === "cancelled"),
  true,
  "deleting a tour must cancel its reminders, not leave them to fire",
);

console.log(
  "Workflow suite passed: rating, intake, approval, manual payment, campaign, opt-out, Square payment, refund, and reminders.",
);
await deleteApp(app);
process.exit(0);
