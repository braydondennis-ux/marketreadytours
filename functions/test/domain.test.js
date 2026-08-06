"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  campaignOffsetsBeforeTour,
  escapeHtml,
  localYmd,
  phoenixDateTimeMs,
  publicTourProjection,
  ratingAggregate,
  validateRating,
} = require("../lib/domain");

test("rating validation accepts only complete integer 1-5 scores", () => {
  const valid = {
    curbAppeal: 5,
    landscape: 4,
    cleanliness: 3,
    flooring: 2,
    paint: 1,
    showability: 5,
    price: 4,
    kitchen: 3,
    bedrooms: 2,
    windows: 1,
  };
  assert.equal(validateRating(valid).curbAppeal, 5);
  assert.throws(() => validateRating({...valid, price: 999}), /price/);
  assert.throws(() => validateRating({...valid, price: 4.5}), /price/);
});

test("public projection omits private fields and unpaid sponsors", () => {
  const projected = publicTourProjection({
    id: "t1",
    name: "Demo",
    date: "2026-08-04",
    time: "10:00 AM",
    code: "4821",
    notes: {secret: true},
    campaignContacts: [{email: "private@example.com"}],
    listings: [{
      id: "l1",
      address: "1 Main",
      agent: "Agent",
      agentEmail: "private@example.com",
      agentPhone: "555-0100",
      photos: ["https://example.com/home.jpg"],
    }],
    sponsors: [
      {id: "paid", name: "Paid", paid: true, email: "paid@example.com"},
      {id: "unpaid", name: "Unpaid", paid: false, email: "private@example.com"},
    ],
  });
  assert.equal(projected.code, undefined);
  assert.equal(projected.notes, undefined);
  assert.equal(projected.campaignContacts, undefined);
  assert.equal(projected.listings[0].agentEmail, undefined);
  assert.deepEqual(projected.sponsors.map((sponsor) => sponsor.id), ["paid"]);
  assert.equal(projected.sponsors[0].paid, true);
  assert.equal(projected.sponsors[0].paymentStatus, "paid");
});

test("aggregates ignore invalid legacy scores", () => {
  const result = ratingAggregate({
    a: {curbAppeal: 5},
    b: {curbAppeal: 3},
    bad: {curbAppeal: 999},
  });
  assert.equal(result.count, 3);
  assert.equal(result.averages.curbAppeal, 4);
});

test("campaign sequence never includes a step on or after the tour", () => {
  assert.deepEqual(campaignOffsetsBeforeTour(13), [0, 2, 5, 8, 12]);
  assert.deepEqual(campaignOffsetsBeforeTour(6), [0, 2, 5]);
  assert.throws(() => campaignOffsetsBeforeTour(1), /at least two days/);
});

test("Phoenix date helpers do not use UTC calendar rollover", () => {
  assert.equal(localYmd(new Date("2026-07-29T00:30:00Z")), "2026-07-28");
  assert.equal(
    phoenixDateTimeMs("2026-08-04", "10:00 AM"),
    Date.parse("2026-08-04T17:00:00Z"),
  );
});

test("HTML escaping is context-safe for text", () => {
  assert.equal(escapeHtml(`<img src=x onerror="x">&'`), "&lt;img src=x onerror=&quot;x&quot;&gt;&amp;&#39;");
});
