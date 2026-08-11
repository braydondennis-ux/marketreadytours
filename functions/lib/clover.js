"use strict";

/* Clover Hosted Checkout adapter for sponsor payments.
 *
 * WHY HOSTED CHECKOUT AND NOT AN EMAILED PAYMENT LINK
 *   Clover checkout sessions expire after 15 MINUTES and Clover exposes no endpoint to query
 *   a session's status (confirmed in their ecommerce FAQ). So a Clover URL cannot be emailed
 *   the way the Square adapter emails an invoice — it would be dead before the sponsor opened
 *   it. Instead the email links to our own page, which calls createSponsorCheckout to mint a
 *   fresh session at the moment of the click.
 *
 * AUTHORITY
 *   The webhook is the only thing that marks a sponsor paid. The browser redirect after
 *   payment is cosmetic: a sponsor who closes the tab is still recorded, and a forged success
 *   URL records nothing.
 */

const crypto = require("node:crypto");
const {cleanText, isValidEmail, normalizeEmail} = require("./domain");

const CLOVER_PRODUCTION_BASE_URL = "https://api.clover.com";
const CLOVER_SANDBOX_BASE_URL = "https://apisandbox.dev.clover.com";
const CHECKOUT_PATH = "/invoicingcheckoutservice/v1/checkouts";

/* Amounts are the single source of truth for what a sponsor is charged, and are looked up
   server-side from the plan key. The client never supplies a price. Mirrors SPONSOR_PLANS in
   square.js — keep the two in step. */
const SPONSOR_PLANS = Object.freeze({
  full: Object.freeze({key: "full", label: "Full Sponsor", amountCents: 19900}),
  half: Object.freeze({key: "half", label: "Half (1/2) Sponsor", amountCents: 9950}),
  split: Object.freeze({key: "split", label: "Quarter (1/4) Sponsor", amountCents: 4975}),
});

function cloverPlanDetails(value) {
  const key = String(value || "").trim().toLowerCase();
  const plan = SPONSOR_PLANS[key];
  if (!plan) throw new TypeError("Unsupported sponsorship payment plan");
  return {...plan};
}

function cloverBaseUrl(useSandbox) {
  return useSandbox ? CLOVER_SANDBOX_BASE_URL : CLOVER_PRODUCTION_BASE_URL;
}

/* Clover signs webhooks with a `Clover-Signature` header of the form
     t=<unix-seconds>,v1=<hex hmac>
   where the HMAC is SHA-256 over `${timestamp}.${rawBody}` keyed with the webhook secret.
   This is NOT the same scheme as Square's (which hashes notificationUrl + body and encodes
   base64), so it cannot reuse verifySquareWebhook.

   `toleranceSeconds` bounds replay of a captured request. Pass rawBody as a Buffer or string
   exactly as received — re-serialising parsed JSON changes the bytes and breaks the digest. */
function parseCloverSignatureHeader(header) {
  const out = {timestamp: null, signatures: []};
  for (const part of String(header || "").split(",")) {
    const [rawKey, rawValue] = part.split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim();
    if (!key || !value) continue;
    if (key === "t") out.timestamp = value;
    else if (key === "v1") out.signatures.push(value);
  }
  return out;
}

function timingSafeHexEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyCloverWebhook(rawBody, header, secret, {toleranceSeconds = 300, nowMs} = {}) {
  if (!rawBody || !header || !secret) return false;
  const {timestamp, signatures} = parseCloverSignatureHeader(header);
  if (!timestamp || !signatures.length) return false;

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (Math.abs(now / 1000 - tsSeconds) > toleranceSeconds) return false;

  const payload = Buffer.concat([
    Buffer.from(`${timestamp}.`, "utf8"),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"),
  ]);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return signatures.some((candidate) => timingSafeHexEqual(expected, candidate));
}

/* Create a Hosted Checkout session. Returns the URL to redirect the sponsor to, the session
   id (which the webhook echoes back, and which we key payment records on), and the expiry so
   the caller can tell the sponsor how long they have. */
async function createCloverCheckoutSession({
  accessToken,
  merchantId,
  useSandbox = false,
  plan,
  sponsor,
  tour,
  redirectUrls,
  fetchImpl = fetch,
  timeoutMs = 15000,
}) {
  if (!accessToken) throw new TypeError("Clover access token is required");
  if (!merchantId) throw new TypeError("Clover merchant id is required");

  const details = cloverPlanDetails(plan);
  const email = normalizeEmail(sponsor && sponsor.email);
  if (!isValidEmail(email)) throw new TypeError("A valid sponsor email is required");

  const contactName = cleanText(
    (sponsor && (sponsor.contactName || sponsor.name)) || "",
    160,
    "sponsor name",
    true,
  );
  const [firstName, ...rest] = contactName.split(/\s+/);
  const tourName = cleanText((tour && tour.name) || "MarketReady Tour", 160, "tour name", true);

  const body = {
    customer: {
      firstName: firstName || contactName,
      lastName: rest.join(" ") || "-",
      email,
    },
    shoppingCart: {
      lineItems: [
        {
          name: `${details.label} — ${tourName}`,
          note: cleanText((tour && tour.date) || "", 40, "tour date"),
          price: details.amountCents,
          unitQty: 1,
        },
      ],
    },
    ...(redirectUrls ? {redirectUrls} : {}),
  };

  const response = await fetchImpl(`${cloverBaseUrl(useSandbox)}${CHECKOUT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Clover-Merchant-Id": merchantId,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    parsed = null;
  }
  if (!response.ok) {
    /* Surface Clover's own message — its 4xx bodies explain misconfiguration precisely
       ("ecommerce not enabled", bad merchant id), which is what you need when this fails. */
    const detail = (parsed && (parsed.message || parsed.error)) || text.slice(0, 200);
    const error = new Error(`Clover checkout failed (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  if (!parsed || !parsed.href || !parsed.checkoutSessionId) {
    throw new Error("Clover checkout response was missing href or checkoutSessionId");
  }

  return {
    href: parsed.href,
    checkoutSessionId: parsed.checkoutSessionId,
    expirationTime: Number(parsed.expirationTime) || null,
    amountCents: details.amountCents,
    planKey: details.key,
    planLabel: details.label,
  };
}

module.exports = {
  CLOVER_PRODUCTION_BASE_URL,
  CLOVER_SANDBOX_BASE_URL,
  CHECKOUT_PATH,
  SPONSOR_PLANS,
  cloverBaseUrl,
  cloverPlanDetails,
  createCloverCheckoutSession,
  parseCloverSignatureHeader,
  verifyCloverWebhook,
};
