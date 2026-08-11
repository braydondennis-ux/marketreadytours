"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  SPONSOR_PLANS,
  cloverBaseUrl,
  cloverPlanDetails,
  createCloverCheckoutSession,
  parseCloverSignatureHeader,
  verifyCloverWebhook,
} = require("../lib/clover");

const SECRET = "whsec-test-value";

function signedHeader(rawBody, {secret = SECRET, atMs = Date.now(), tamper = false} = {}) {
  const t = Math.floor(atMs / 1000);
  const digest = crypto
    .createHmac("sha256", secret)
    .update(Buffer.from(`${t}.${rawBody}`, "utf8"))
    .digest("hex");
  return `t=${t},v1=${tamper ? digest.replace(/.$/, "0") : digest}`;
}

test("plan amounts are server-side and match the published tiers", () => {
  assert.equal(cloverPlanDetails("full").amountCents, 19900);
  assert.equal(cloverPlanDetails("half").amountCents, 9950);
  assert.equal(cloverPlanDetails("split").amountCents, 4975);
  // Case-insensitive, but never invented.
  assert.equal(cloverPlanDetails("FULL").key, "full");
  assert.throws(() => cloverPlanDetails("free"), /Unsupported sponsorship payment plan/);
  assert.throws(() => cloverPlanDetails(""), /Unsupported sponsorship payment plan/);
  assert.equal(Object.keys(SPONSOR_PLANS).length, 3);
});

test("sandbox and production base urls are distinct and never crossed", () => {
  assert.match(cloverBaseUrl(true), /apisandbox\.dev\.clover\.com$/);
  assert.match(cloverBaseUrl(false), /^https:\/\/api\.clover\.com$/);
  assert.notEqual(cloverBaseUrl(true), cloverBaseUrl(false));
});

test("Clover-Signature header parses timestamp and v1 signatures", () => {
  const parsed = parseCloverSignatureHeader("t=1700000000,v1=abc,v1=def");
  assert.equal(parsed.timestamp, "1700000000");
  assert.deepEqual(parsed.signatures, ["abc", "def"]);
  assert.deepEqual(parseCloverSignatureHeader("").signatures, []);
  assert.equal(parseCloverSignatureHeader("garbage").timestamp, null);
});

test("a correctly signed webhook verifies", () => {
  const body = JSON.stringify({type: "PAYMENT", status: "APPROVED"});
  assert.equal(verifyCloverWebhook(body, signedHeader(body), SECRET), true);
});

test("a tampered signature is rejected", () => {
  const body = JSON.stringify({type: "PAYMENT", status: "APPROVED"});
  assert.equal(verifyCloverWebhook(body, signedHeader(body, {tamper: true}), SECRET), false);
});

test("a signature made with the wrong secret is rejected", () => {
  const body = JSON.stringify({type: "PAYMENT"});
  const header = signedHeader(body, {secret: "attacker-secret"});
  assert.equal(verifyCloverWebhook(body, header, SECRET), false);
});

test("a modified body is rejected even with a valid-looking header", () => {
  const original = JSON.stringify({amount: 4975});
  const header = signedHeader(original);
  const swapped = JSON.stringify({amount: 1});
  assert.equal(verifyCloverWebhook(swapped, header, SECRET), false);
});

test("a replayed old request is rejected once outside the tolerance window", () => {
  const body = JSON.stringify({type: "PAYMENT"});
  const old = signedHeader(body, {atMs: Date.now() - 10 * 60 * 1000});
  assert.equal(verifyCloverWebhook(body, old, SECRET), false);
  // ...but is accepted while still inside it.
  const recent = signedHeader(body, {atMs: Date.now() - 60 * 1000});
  assert.equal(verifyCloverWebhook(body, recent, SECRET), true);
});

test("missing signature, secret or body never verifies", () => {
  const body = JSON.stringify({a: 1});
  assert.equal(verifyCloverWebhook(body, signedHeader(body), ""), false);
  assert.equal(verifyCloverWebhook(body, "", SECRET), false);
  assert.equal(verifyCloverWebhook("", signedHeader("x"), SECRET), false);
});

test("checkout session sends the server-side amount and required Clover headers", async () => {
  let seen = null;
  const fetchImpl = async (url, options) => {
    seen = {url, options, body: JSON.parse(options.body)};
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        href: "https://sandbox.dev.clover.com/v1/checkouts/abc123",
        checkoutSessionId: "abc123",
        expirationTime: 1786400000,
      }),
    };
  };

  const result = await createCloverCheckoutSession({
    accessToken: "tok", merchantId: "MID123", useSandbox: true,
    plan: "split",
    sponsor: {name: "Jane Roe", email: "jane@example.com"},
    tour: {name: "85259 Tour", date: "2026-12-31"},
    redirectUrls: {success: "https://marketreadytours.com/#/sponsor-paid", failure: "https://marketreadytours.com/#/sponsor-pay"},
    fetchImpl,
  });

  assert.match(seen.url, /apisandbox\.dev\.clover\.com\/invoicingcheckoutservice\/v1\/checkouts$/);
  assert.equal(seen.options.headers["X-Clover-Merchant-Id"], "MID123");
  assert.equal(seen.options.headers.Authorization, "Bearer tok");
  // The price charged comes from the plan table, not from any caller-supplied value.
  assert.equal(seen.body.shoppingCart.lineItems[0].price, 4975);
  assert.equal(seen.body.shoppingCart.lineItems[0].unitQty, 1);
  assert.equal(seen.body.customer.email, "jane@example.com");
  assert.equal(result.checkoutSessionId, "abc123");
  assert.equal(result.amountCents, 4975);
  assert.equal(result.planKey, "split");
});

test("a Clover error surfaces its own message rather than a generic failure", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({message: "ecommerce is not enabled for this merchant"}),
  });
  await assert.rejects(
    () => createCloverCheckoutSession({
      accessToken: "tok", merchantId: "MID", plan: "full",
      sponsor: {name: "A B", email: "a@b.com"}, tour: {name: "T"}, fetchImpl,
    }),
    /Clover checkout failed \(401\).*ecommerce is not enabled/,
  );
});

test("a malformed success response is rejected rather than half-trusted", async () => {
  const fetchImpl = async () => ({ok: true, status: 200, text: async () => JSON.stringify({href: "x"})});
  await assert.rejects(
    () => createCloverCheckoutSession({
      accessToken: "tok", merchantId: "MID", plan: "full",
      sponsor: {name: "A B", email: "a@b.com"}, tour: {name: "T"}, fetchImpl,
    }),
    /missing href or checkoutSessionId/,
  );
});

test("an invalid sponsor email is refused before any network call", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  await assert.rejects(
    () => createCloverCheckoutSession({
      accessToken: "tok", merchantId: "MID", plan: "full",
      sponsor: {name: "A B", email: "not-an-email"}, tour: {name: "T"}, fetchImpl,
    }),
    /valid sponsor email/,
  );
  assert.equal(called, false);
});
