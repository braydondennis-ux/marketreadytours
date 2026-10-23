"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const functions = require("../index");

test("tour saves start without an email-provider secret", () => {
  assert.deepEqual(functions.saveTour.__endpoint.secretEnvironmentVariables, []);
  assert.ok(functions.saveTour.__endpoint.callableTrigger);
});

test("email-sending callables retain their provider secret", () => {
  for (const name of ["sendAdminEmail", "submitIntake", "submitRating", "approveListingRequest"]) {
    assert.ok(functions[name].__endpoint.secretEnvironmentVariables.some(secret => secret.key === "MRT_RESEND_API_KEY"), name);
  }
});
