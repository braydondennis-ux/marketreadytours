"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {buildEvaluationEmail} = require("../lib/evaluation-email");
const {RATING_KEYS} = require("../lib/domain");
const tour = {id: "tour-1", name: "85085", date: "2026-10-08"};
const listing = {address: "100 Test Lane", city: "Phoenix, AZ"};
const rating = {...Object.fromEntries(RATING_KEYS.map(k => [k, 4])),
  suggestions: "Repaint the entry", sugPrice: "$500,000", submittedAt: 1791475200000};

test("new-rating email includes the actual evaluation in both text and HTML", () => {
  const email = buildEvaluationEmail({tour, listing, ratings: [rating], single: true});
  for (const body of [email.text, email.html]) {
    assert.match(body, /Repaint the entry/);
    assert.match(body, /\$500,000/);
    assert.equal((body.match(/4\/5/g) || []).length, 10);
    assert.match(body, /100 Test Lane/);
  }
  assert.equal(email.cta.url, "https://marketreadytours.com/app/#/tour/tour-1");
  assert.doesNotMatch(email.text, /Open MarketReady Tours to view the private feedback/);
});

test("summary preserves every saved evaluation and averages the scores", () => {
  const email = buildEvaluationEmail({tour, listing, ratings: {
    second: {...rating, curbAppeal: 2, suggestions: "Second comment", submittedAt: rating.submittedAt + 1000},
    first: rating,
  }});
  for (const body of [email.text, email.html]) {
    assert.match(body, /2 evaluations/);
    assert.match(body, /Repaint the entry/);
    assert.match(body, /Second comment/);
    assert.match(body, /3\/5/);
    assert.ok(body.indexOf("Repaint the entry") < body.indexOf("Second comment"));
  }
});

test("saved user text is escaped and never interpreted as HTML", () => {
  const email = buildEvaluationEmail({tour: {...tour, name: '<img src=x onerror="alert(1)">'},
    listing: {...listing, address: '<script>alert(1)</script>'},
    ratings: [{...rating, suggestions: '<img src=x>\nsecond line', sugPrice: '<a href="bad">price</a>'}]});
  assert.doesNotMatch(email.html, /<script>|<img|<a href="bad"/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /&lt;img src=x&gt;<br>second line/);
  assert.match(email.text, /<img src=x>/);
});

test("rater identities and private photo paths are not disclosed", () => {
  const email = buildEvaluationEmail({tour, listing, ratings: [{...rating, raterName: "Private Person",
    photoPaths: ["mrt_rating_photos/tour-1/listing-1/private-user/photo"]}]});
  assert.doesNotMatch(JSON.stringify(email), /Private Person|private-user|mrt_rating_photos/);
  assert.match(email.text, /1 evaluation photo/);
});

test("priced-correctly feedback and absent comments are explicit", () => {
  const email = buildEvaluationEmail({tour, listing, ratings: [{...rating, suggestions: "", pricedRight: true}]});
  assert.match(email.text, /Suggestions: None provided/);
  assert.match(email.html, /Priced correctly/);
  assert.doesNotMatch(email.text, /\$500,000/);
});

test("empty reports fail rather than produce empty evaluation emails", () => {
  assert.throws(() => buildEvaluationEmail({tour, listing, ratings: {}}), /No evaluations/);
});
