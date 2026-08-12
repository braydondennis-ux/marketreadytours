"use strict";

/* Branded HTML shell for outbound transactional email.
 *
 * Email clients are not browsers. Constraints this template works within:
 *   * Outlook renders with Word's engine — flex/grid do not work, so layout is TABLES.
 *   * <style> blocks are stripped by Gmail's clipper and others — every style is INLINE.
 *   * Webfonts do not load in most clients, so DM Sans is requested but a system sans stack
 *     is what actually renders. Do not rely on the brand face here.
 *   * Dark mode in Apple Mail / Outlook can invert colours; explicit backgrounds on every
 *     surface stop text disappearing.
 *   * A preheader (the grey preview line beside the subject) is otherwise scraped from the
 *     body, which looks like broken markup.
 *
 * Palette matches the app's Brand Standards v5: Ink #101A36, Cobalt #2F44A0,
 * Canvas #F7F6F2, hairline #E4E2DB.
 */

const {escapeHtml} = require("./domain");

const INK = "#101A36";
const COBALT = "#2F44A0";
const CANVAS = "#F7F6F2";
const PAPER = "#FFFFFF";
const TEXT = "#111318";
const MUTED = "#5B5F6B";
const HAIR = "#E4E2DB";
const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const SUPPORT_EMAIL = "marketreadytours@gmail.com";
const SITE_URL = "https://marketreadytours.com";

/* Turn plain paragraphs into the branded shell.
 *
 *   bodyHtml   already-escaped HTML for the message body
 *   preheader  the preview line shown next to the subject in most inboxes
 *   cta        optional {label, url} — rendered as a bulletproof table button, because a
 *              styled <a> collapses to a bare link in Outlook
 */
function renderBrandedEmail({bodyHtml, preheader = "", cta = null, footerNote = ""}) {
  const button = cta && cta.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px;">
         <tr><td align="center" bgcolor="${INK}" style="border-radius:8px;">
           <a href="${escapeHtml(cta.url)}"
              style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:600;color:${PAPER};text-decoration:none;border-radius:8px;">
             ${escapeHtml(cta.label || "Continue")}
           </a>
         </td></tr>
       </table>`
    : "";

  /* The link is repeated as text because some clients strip or mangle buttons, and a payment
     link that cannot be reached is worse than an ugly one. */
  const fallbackLink = cta && cta.url
    ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
         If the button doesn't work, copy this link into your browser:<br>
         <span style="color:${COBALT};word-break:break-all;">${escapeHtml(cta.url)}</span>
       </p>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

      <tr><td style="background:${INK};border-radius:10px 10px 0 0;padding:22px 28px;">
        <div style="font-family:${FONT};font-size:17px;font-weight:700;color:${PAPER};letter-spacing:0.14em;">MARKET READY</div>
        <div style="font-family:${FONT};font-size:11px;font-weight:500;color:#AEBFD6;letter-spacing:0.34em;margin-top:2px;">TOURS</div>
      </td></tr>

      <tr><td style="background:${PAPER};border-left:1px solid ${HAIR};border-right:1px solid ${HAIR};padding:30px 28px 26px;">
        <div style="font-family:${FONT};font-size:15.5px;line-height:1.65;color:${TEXT};">
          ${bodyHtml}
        </div>
        ${button}
        ${fallbackLink}
      </td></tr>

      <tr><td style="background:${PAPER};border:1px solid ${HAIR};border-top:none;border-radius:0 0 10px 10px;padding:18px 28px 22px;">
        ${footerNote ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${MUTED};">${footerNote}</p>` : ""}
        <p style="margin:0;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${MUTED};">
          Questions? Reply to this email or contact
          <a href="mailto:${SUPPORT_EMAIL}" style="color:${COBALT};text-decoration:none;">${SUPPORT_EMAIL}</a>.<br>
          <a href="${SITE_URL}" style="color:${COBALT};text-decoration:none;">marketreadytours.com</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/* Wrap a bare fragment only if it has not already been through the shell. Lets
   sendTransactionalEmail brand every message without each call site knowing about it, and
   without double-wrapping anything that arrives already rendered. */
function ensureBranded(html, {preheader = "", cta = null, footerNote = ""} = {}) {
  if (!html) return html;
  if (/<!doctype html>/i.test(html) || /MARKET READY<\/div>/.test(html)) return html;
  return renderBrandedEmail({bodyHtml: html, preheader, cta, footerNote});
}

module.exports = {renderBrandedEmail, ensureBranded, INK, COBALT, CANVAS, MUTED, FONT};
