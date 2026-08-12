"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {sendViaResend, DEFAULT_FROM} = require("../lib/resend");

function okFetch(capture) {
  return async (url, options) => {
    capture.url = url;
    capture.options = options;
    capture.body = JSON.parse(options.body);
    return {ok: true, status: 200, text: async () => JSON.stringify({id: "re_123"})};
  };
}

test("sends from the domain-aligned noreply address, not a gmail account", () => {
  assert.match(DEFAULT_FROM, /noreply@marketreadytours\.com/);
  assert.doesNotMatch(DEFAULT_FROM, /gmail\.com/);
});

test("posts to Resend with bearer auth and both message parts", async () => {
  const cap = {};
  const res = await sendViaResend({
    apiKey: "re_test_key",
    to: "erik@marketreadysystems.ai",
    subject: "Test",
    text: "plain body",
    html: "<p>html body</p>",
    fetchImpl: okFetch(cap),
  });

  assert.equal(cap.url, "https://api.resend.com/emails");
  assert.equal(cap.options.headers.Authorization, "Bearer re_test_key");
  assert.deepEqual(cap.body.to, ["erik@marketreadysystems.ai"]);
  // Both parts matter: some clients render text, and text-only-missing scores worse with
  // spam filters.
  assert.equal(cap.body.text, "plain body");
  assert.equal(cap.body.html, "<p>html body</p>");
  assert.equal(cap.body.from, DEFAULT_FROM);
  assert.equal(res.ok, true);
  assert.equal(res.id, "re_123");
});

test("a Resend error surfaces its own message rather than a generic failure", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({message: "The marketreadytours.com domain is not verified"}),
  });
  await assert.rejects(
    () => sendViaResend({apiKey: "k", to: "a@b.com", subject: "s", text: "t", fetchImpl}),
    /Resend send failed \(403\).*not verified/,
  );
});

test("refuses to send without an api key, recipient or subject", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  await assert.rejects(() => sendViaResend({to: "a@b.com", subject: "s", fetchImpl}), /API key/);
  await assert.rejects(() => sendViaResend({apiKey: "k", subject: "s", fetchImpl}), /recipient/);
  await assert.rejects(() => sendViaResend({apiKey: "k", to: "a@b.com", fetchImpl}), /subject/);
  assert.equal(called, false, "nothing should reach the network on a validation failure");
});

test("omits optional fields rather than sending nulls Resend would reject", async () => {
  const cap = {};
  await sendViaResend({apiKey: "k", to: "a@b.com", subject: "s", text: "t", fetchImpl: okFetch(cap)});
  assert.equal("html" in cap.body, false);
  assert.equal("reply_to" in cap.body, false);
});
