"use strict";

/* Resend transactional email.
 *
 * WHY THIS REPLACED THE PREVIOUS SENDER
 *   Mail used to go through a legacy Cloud Function that used nodemailer with consumer Gmail
 *   SMTP, sending as marketreadytours@gmail.com. Two problems: the From address had no
 *   cryptographic relationship to marketreadytours.com, so receivers spam-filtered it
 *   inconsistently (verified 2026-08-11 — identical payloads landed in spam and inbox seven
 *   minutes apart); and consumer Gmail has low daily sending limits and throttles accounts it
 *   believes are sending bulk mail.
 *
 *   Resend sends as noreply@marketreadytours.com with SPF and DKIM published on the domain
 *   (resend._domainkey + send.marketreadytours.com SPF, both DNS-only in Cloudflare), so the
 *   message is aligned and passes the domain's existing DMARC p=quarantine policy.
 *
 * DELIVERY IS NOT CONFIRMED BY A 200. Resend accepts the message and delivers asynchronously;
 * bounces and spam placement appear in the Resend dashboard, not in this response. That is
 * still a large improvement on the previous sender, which reported success with no visibility
 * whatsoever.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "MarketReady Tours <noreply@marketreadytours.com>";

/* Returns {ok, id} on success. Throws with Resend's own message on failure — its 4xx bodies
   name the cause precisely (unverified domain, bad key, invalid recipient), which is what you
   need when this breaks. */
async function sendViaResend({
  apiKey,
  to,
  subject,
  text,
  html,
  from = DEFAULT_FROM,
  replyTo = null,
  fetchImpl = fetch,
  timeoutMs = 15000,
  idempotencyKey = null,
}) {
  if (!apiKey) throw new Error("Resend API key is not configured");
  if (!to) throw new Error("A recipient is required");
  if (!subject) throw new Error("A subject is required");

  const body = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    /* Always send BOTH parts. Some clients show the plain text, and spam filters score
       text-only-missing messages worse — a well-formed multipart message reads as
       legitimate mail rather than a marketing blast. */
    ...(text ? {text} : {}),
    ...(html ? {html} : {}),
    ...(replyTo ? {reply_to: replyTo} : {}),
  };

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  /* Resend dedupes on this header for 24 hours: the same key with the same payload returns the
     original response instead of sending again. That is what makes a retry safe. A send that
     Resend accepted but whose response we lost — a timeout is enough — otherwise throws, and
     the caller retries it as a fresh send. Resend rejects keys over 256 characters, so clamp
     rather than let a long key turn every retry into a hard 400. */
  if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey).slice(0, 256);

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (error) {
    parsed = null;
  }

  if (!response.ok) {
    const detail = (parsed && (parsed.message || parsed.name || parsed.error)) || raw.slice(0, 200);
    const error = new Error(`Resend send failed (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  return {ok: true, id: (parsed && parsed.id) || null};
}

module.exports = {sendViaResend, RESEND_ENDPOINT, DEFAULT_FROM};
