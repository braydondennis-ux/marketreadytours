import test from "node:test";
import assert from "node:assert/strict";
import {prepareDemoSnapshot} from "./prepare-demo-snapshot.mjs";

function fixture() {
  return {
    production: {
      mrt_tours: [{
        id: "tour-1",
        name: "Production Tour",
        date: "2026-08-08",
        time: "10:00 AM",
        listings: [{id: 7, address: "1 Main St", photos: [], order: 0}],
        sponsors: [
          {id: "paid-1", name: "Paid Sponsor", paid: true, url: "https://example.com"},
          {id: "unpaid-1", name: "Unpaid Sponsor", paid: false},
        ],
        ratings: {7: {price: 4}},
        ratingSubmissions: {7: [{
          curbAppeal: 4,
          landscape: 4,
          cleanliness: 4,
          flooring: 4,
          paint: 4,
          showability: 4,
          price: 4,
          kitchen: 4,
          bedrooms: 4,
          windows: 4,
        }]},
        favorites: {7: true},
      }],
      mrt_campaigns: {"tour-1": {status: "complete"}},
    },
    demo: {
      admins: {"dev-admin": {role: "super"}},
      mrt_sponsor_signups: {"test-signup": {status: "pending"}},
      mrt_tours_private: {"demo-tour": {id: "demo-tour"}},
    },
  };
}

test("prepares a deterministic, paid-only public production snapshot", () => {
  const input = fixture();
  const first = prepareDemoSnapshot({...input, sourceSha256: "abc", snapshotAt: "2026-07-31T00:00:00Z"});
  const second = prepareDemoSnapshot({...input, sourceSha256: "abc", snapshotAt: "2026-07-31T00:00:00Z"});

  assert.equal(first.report.candidateSha256, second.report.candidateSha256);
  assert.equal(first.report.tourCount, 1);
  assert.equal(first.report.sponsorCount, 2);
  assert.equal(first.report.publicSponsorCount, 1);
  assert.equal(first.report.ratingSubmissionCount, 1);
  assert.equal(first.report.legacyFavoriteCountPreservedPrivately, 1);
  assert.equal(first.candidate.admins["dev-admin"].role, "super");
  assert.equal(first.candidate.mrt_sponsor_signups, undefined);
  assert.equal(first.candidate.mrt_tours_private["demo-tour"], undefined);
  assert.equal(first.candidate.mrt_tours_private["tour-1"].listings[0].id, "7");
  assert.equal(first.candidate.mrt_tours_public["tour-1"].sponsors[0].name, "Paid Sponsor");
  assert.equal(first.candidate.mrt_tours_public["tour-1"].sponsors.length, 1);
});

test("replaces embedded images using the approved demo Storage asset map", () => {
  const input = fixture();
  const embedded = "data:image/png;base64,aGVsbG8=";
  input.production.mrt_tours[0].listings[0].photos = [embedded];
  const hash = "3ce781d3ab1d65fee96552a54415d9902cf9622911ab54192015a158e18dc0e6";
  const url = "https://firebasestorage.googleapis.com/v0/b/demo/o/photo.png?alt=media";
  const result = prepareDemoSnapshot({
    ...input,
    sourceSha256: "abc",
    snapshotAt: "2026-07-31T00:00:00Z",
    assetUrls: {[hash]: url},
  });
  assert.equal(result.candidate.mrt_tours_private["tour-1"].listings[0].photos[0], url);
  assert.equal(result.report.embeddedImagesReplaced, 1);
});
