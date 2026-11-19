"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {sponsorsWithFunds, sponsorRemovalBlocked} = require("../lib/sponsor-safety");

test("paid flags, paid statuses and partial payments require review", () => {
  const sponsors = [{id: "a", paid: true}, {id: "b", paymentStatus: "paid"},
    {id: "c", paymentStatus: "partially_paid"}, {id: "d", paymentStatus: "pending"}];
  assert.equal(sponsorsWithFunds(sponsors).length, 3);
  assert.equal(sponsorRemovalBlocked(sponsors, sponsors.slice(0, 3)), false);
  for (const sponsor of sponsors.slice(0, 3)) {
    assert.equal(sponsorRemovalBlocked(sponsors, sponsors.filter(s => s.id !== sponsor.id)), true);
  }
  assert.equal(sponsorRemovalBlocked(sponsors, undefined), true);
  assert.equal(sponsorRemovalBlocked(undefined, []), false);
});
