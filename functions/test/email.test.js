"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {renderBrandedEmail, ensureBranded} = require("../lib/email");

test("the shell renders the brand lockup with a space in MARKET READY", () => {
  const html = renderBrandedEmail({bodyHtml: "<p>Hi</p>"});
  assert.match(html, />MARKET READY</);
  assert.match(html, />TOURS</);
  assert.doesNotMatch(html, />MARKETREADY</);
});

test("styles are inline and layout is table based, because email clients are not browsers", () => {
  const html = renderBrandedEmail({bodyHtml: "<p>Hi</p>"});
  // Gmail strips <style> blocks; Outlook ignores flex/grid.
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.doesNotMatch(html, /display:\s*flex/);
  assert.doesNotMatch(html, /display:\s*grid/);
  assert.match(html, /<table role="presentation"/);
});

test("a call to action renders a real button AND repeats the url as text", () => {
  const url = "https://marketreadytours.com/?spt=tok#/sponsor-pay";
  const html = renderBrandedEmail({bodyHtml: "<p>Hi</p>", cta: {label: "Pay $49.75", url}});
  assert.match(html, /Pay \$49\.75/);
  // The bare link matters: some clients strip buttons, and an unreachable payment link is
  // worse than an ugly one.
  assert.ok(html.split(url).length - 1 >= 2, "url should appear in both the button and the fallback");
});

test("a preheader is emitted and hidden, so clients do not scrape markup for the preview", () => {
  const html = renderBrandedEmail({bodyHtml: "<p>Hi</p>", preheader: "Your sponsorship is ready to pay"});
  assert.match(html, /Your sponsorship is ready to pay/);
  assert.match(html, /display:none;max-height:0/);
});

test("user supplied content is escaped, so a sponsor name cannot inject markup", () => {
  const html = renderBrandedEmail({
    bodyHtml: "<p>safe</p>",
    cta: {label: '<script>alert(1)</script>', url: 'https://x.test/"onmouseover="alert(1)'},
    footerNote: "note",
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /"onmouseover="/);
});

test("ensureBranded wraps a bare fragment exactly once", () => {
  const once = ensureBranded("<p>Hello</p>");
  assert.match(once, />MARKET READY</);
  const twice = ensureBranded(once);
  assert.equal(twice, once, "already-branded html must pass through untouched");
  assert.equal(once.split("MARKET READY").length - 1, 1, "header must appear only once");
});

test("ensureBranded leaves empty input alone rather than sending an empty shell", () => {
  assert.equal(ensureBranded(""), "");
  assert.equal(ensureBranded(undefined), undefined);
});
