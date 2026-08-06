"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSquareSandboxInvoice,
  sandboxPaymentUrl,
  sponsorPlanDetails,
  squareIdempotencyKey,
} = require("../lib/square");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

test("sponsorship plans use server-owned prices", () => {
  assert.deepEqual(sponsorPlanDetails("full"), {
    key: "full",
    label: "Full Sponsor",
    amountCents: 19900,
  });
  assert.equal(sponsorPlanDetails("half").amountCents, 9950);
  assert.equal(sponsorPlanDetails("split").amountCents, 4975);
  assert.throws(() => sponsorPlanDetails("free"), /Unsupported/);
});

test("Square idempotency keys are stable and within provider limits", () => {
  const first = squareIdempotencyKey("invoice", "signup-1");
  assert.equal(first, squareIdempotencyKey("invoice", "signup-1"));
  assert.notEqual(first, squareIdempotencyKey("invoice", "signup-2"));
  assert.ok(first.length <= 45);
});

test("only hosted Square Sandbox payment URLs are accepted", () => {
  assert.equal(
    sandboxPaymentUrl("https://squareupsandbox.com/pay-invoice/test"),
    "https://squareupsandbox.com/pay-invoice/test",
  );
  assert.throws(() => sandboxPaymentUrl("https://squareup.com/pay-invoice/live"), /trusted/);
  assert.throws(() => sandboxPaymentUrl("javascript:alert(1)"), /trusted/);
});

test("creates and publishes a Square Sandbox invoice with the selected server price", async () => {
  const calls = [];
  const responses = [
    {customer: {id: "customer-1"}},
    {order: {id: "order-1"}},
    {invoice: {id: "inv:invoice-1", version: 0}},
    {
      invoice: {
        id: "inv:invoice-1",
        version: 1,
        status: "UNPAID",
        public_url: "https://squareupsandbox.com/pay-invoice/test-invoice",
      },
    },
  ];
  const fetchImpl = async (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    return jsonResponse(responses.shift());
  };

  const result = await createSquareSandboxInvoice({
    accessToken: "sandbox-secret",
    locationId: "location-1",
    signup: {
      id: "signup-1",
      name: "Example Title",
      contactName: "Alex Sponsor",
      email: "alex@example.com",
      paymentPlan: "half",
    },
    tour: {name: "North Scottsdale Tour"},
    dueDate: "2026-08-06",
    fetchImpl,
  });

  assert.equal(result.amountCents, 9950);
  assert.equal(result.paymentUrl, "https://squareupsandbox.com/pay-invoice/test-invoice");
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, "https://connect.squareupsandbox.com/v2/customers");
  assert.equal(calls[1].body.order.line_items[0].base_price_money.amount, 9950);
  assert.equal(calls[2].body.invoice.delivery_method, "SHARE_MANUALLY");
  assert.equal(calls[2].body.invoice.payment_requests[0].request_type, "BALANCE");
  assert.equal(
    calls[3].url,
    "https://connect.squareupsandbox.com/v2/invoices/inv%3Ainvoice-1/publish",
  );
  assert.equal(calls[3].body.version, 0);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, "Bearer sandbox-secret");
    assert.ok(call.options.headers["Square-Version"]);
  }
});

test("Square errors expose provider codes without leaking the token", async () => {
  const fetchImpl = async () => jsonResponse({
    errors: [{code: "UNAUTHORIZED", detail: "sensitive provider detail"}],
  }, 401);
  await assert.rejects(
    createSquareSandboxInvoice({
      accessToken: "never-leak-this-token",
      locationId: "location-1",
      signup: {
        id: "signup-1",
        name: "Example",
        email: "alex@example.com",
        paymentPlan: "full",
      },
      tour: {name: "Demo"},
      dueDate: "2026-08-06",
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /UNAUTHORIZED/);
      assert.doesNotMatch(error.message, /never-leak-this-token/);
      assert.deepEqual(error.codes, ["UNAUTHORIZED"]);
      return true;
    },
  );
});
