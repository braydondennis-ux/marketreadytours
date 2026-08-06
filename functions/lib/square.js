"use strict";

const {cleanText, isValidEmail, normalizeEmail, stableHash} = require("./domain");

const SQUARE_API_VERSION = "2026-07-15";
const SQUARE_SANDBOX_BASE_URL = "https://connect.squareupsandbox.com";
const SPONSOR_PLANS = Object.freeze({
  full: Object.freeze({key: "full", label: "Full Sponsor", amountCents: 19900}),
  half: Object.freeze({key: "half", label: "Half (1/2) Sponsor", amountCents: 9950}),
  split: Object.freeze({key: "split", label: "Quarter (1/4) Sponsor", amountCents: 4975}),
});

function sponsorPlanDetails(value) {
  const key = String(value || "").trim().toLowerCase();
  const plan = SPONSOR_PLANS[key];
  if (!plan) throw new TypeError("Unsupported sponsorship payment plan");
  return {...plan};
}

function squareIdempotencyKey(scope, signupId) {
  return `mrt-${scope}-${stableHash(signupId).slice(0, 30)}`.slice(0, 45);
}

function sandboxPaymentUrl(value) {
  const parsed = new URL(String(value || ""));
  if (
    parsed.protocol !== "https:" ||
    !["squareupsandbox.com", "www.squareupsandbox.com"].includes(parsed.hostname)
  ) {
    throw new Error("Square Sandbox did not return a trusted payment URL");
  }
  return parsed.toString();
}

async function squareSandboxRequest(path, body, {accessToken, fetchImpl = fetch}) {
  const response = await fetchImpl(`${SQUARE_SANDBOX_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Square-Version": SQUARE_API_VERSION,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.errors?.length) {
    const codes = (payload?.errors || [])
      .map((entry) => entry?.code)
      .filter(Boolean)
      .slice(0, 5);
    const error = new Error(
      `Square Sandbox request failed (${response.status})${codes.length ? `: ${codes.join(", ")}` : ""}`,
    );
    error.status = response.status;
    error.codes = codes;
    throw error;
  }
  return payload || {};
}

async function createSquareSandboxInvoice({
  accessToken,
  locationId,
  signup,
  tour,
  dueDate,
  fetchImpl = fetch,
}) {
  if (!accessToken) throw new TypeError("Square Sandbox access token is required");
  const cleanLocationId = cleanText(locationId, 128, "Square location id", true);
  const signupId = cleanText(signup?.id, 128, "signup id", true);
  const email = normalizeEmail(signup?.email);
  if (!isValidEmail(email)) throw new TypeError("Sponsor email is invalid");
  const sponsorName = cleanText(signup?.name, 160, "sponsor name", true);
  const contactName = cleanText(signup?.contactName || sponsorName, 160, "contact name", true);
  const tourName = cleanText(tour?.name, 160, "tour name", true);
  const plan = sponsorPlanDetails(signup?.paymentPlan || signup?.plan);

  const customerResult = await squareSandboxRequest("/v2/customers", {
    idempotency_key: squareIdempotencyKey("customer", signupId),
    company_name: sponsorName,
    given_name: contactName,
    email_address: email,
    reference_id: signupId.slice(0, 100),
    note: `MarketReady Tours sponsorship request for ${tourName}`,
  }, {accessToken, fetchImpl});
  const customerId = cleanText(customerResult.customer?.id, 128, "Square customer id", true);

  const orderResult = await squareSandboxRequest("/v2/orders", {
    idempotency_key: squareIdempotencyKey("order", signupId),
    order: {
      location_id: cleanLocationId,
      customer_id: customerId,
      reference_id: `mrt-${stableHash(signupId).slice(0, 32)}`,
      line_items: [{
        name: `${tourName} — ${plan.label}`,
        quantity: "1",
        base_price_money: {
          amount: plan.amountCents,
          currency: "USD",
        },
      }],
    },
  }, {accessToken, fetchImpl});
  const orderId = cleanText(orderResult.order?.id, 128, "Square order id", true);

  const invoiceResult = await squareSandboxRequest("/v2/invoices", {
    idempotency_key: squareIdempotencyKey("invoice", signupId),
    invoice: {
      location_id: cleanLocationId,
      order_id: orderId,
      primary_recipient: {customer_id: customerId},
      payment_requests: [{
        request_type: "BALANCE",
        due_date: dueDate,
        tipping_enabled: false,
        automatic_payment_source: "NONE",
      }],
      delivery_method: "SHARE_MANUALLY",
      accepted_payment_methods: {
        card: true,
        square_gift_card: false,
        bank_account: false,
        buy_now_pay_later: false,
        cash_app_pay: false,
      },
      title: `${tourName} Sponsorship`,
      description: `${sponsorName} — ${plan.label}`,
    },
  }, {accessToken, fetchImpl});
  const draftInvoice = invoiceResult.invoice || {};
  const invoiceId = cleanText(draftInvoice.id, 160, "Square invoice id", true);
  const version = Number(draftInvoice.version);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error("Square Sandbox returned an invalid invoice version");
  }

  const publishResult = await squareSandboxRequest(
    `/v2/invoices/${encodeURIComponent(invoiceId)}/publish`,
    {
      version,
      idempotency_key: squareIdempotencyKey("publish", signupId),
    },
    {accessToken, fetchImpl},
  );
  const publishedInvoice = publishResult.invoice || {};

  return {
    invoiceId,
    orderId,
    customerId,
    paymentUrl: sandboxPaymentUrl(publishedInvoice.public_url),
    providerStatus: cleanText(publishedInvoice.status || "UNPAID", 40, "invoice status"),
    amountCents: plan.amountCents,
    currency: "USD",
    plan: plan.key,
    planLabel: plan.label,
    dueDate,
  };
}

module.exports = {
  SQUARE_API_VERSION,
  SQUARE_SANDBOX_BASE_URL,
  SPONSOR_PLANS,
  createSquareSandboxInvoice,
  sandboxPaymentUrl,
  sponsorPlanDetails,
  squareIdempotencyKey,
};
