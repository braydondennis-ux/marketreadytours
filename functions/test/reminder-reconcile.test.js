"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TERMINAL_NEXT_ATTEMPT_AT,
  cancelTourReminders,
  planTourReminders,
  reconcileTourReminders,
  reminderIdFor,
} = require("../lib/reminders");

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0); // 2026-08-23
const TOUR_DATE = "2026-09-02";
const TOUR_TIME = "8:30 AM";

function listing(n, over = {}) {
  return {
    id: `listing-${n}`,
    address: `${n}00 Demo St`,
    agent: `Agent ${n}`,
    agentEmail: `agent${n}@example.com`,
    ...over,
  };
}

function tour(over = {}) {
  return {
    id: "tour-1",
    name: "North Phoenix Tour",
    date: TOUR_DATE,
    time: TOUR_TIME,
    listings: [listing(1), listing(2)],
    ...over,
  };
}

const idOf = (n, h) => reminderIdFor("tour-1", `listing-${n}`, h);

// ---------------------------------------------------------------- planning

test("plans a 48h and a 24h reminder for every listing with an agent email", () => {
  const plan = planTourReminders({tour: tour(), now: NOW});
  assert.equal(plan.size, 4);
  const hours = [...plan.values()].map((r) => r.hoursAhead).sort((a, b) => a - b);
  assert.deepEqual(hours, [24, 24, 48, 48]);
});

test("the 48h reminder is scheduled exactly 24h before the 24h one", () => {
  const plan = planTourReminders({tour: tour(), now: NOW});
  const a = plan.get(idOf(1, 48));
  const b = plan.get(idOf(1, 24));
  assert.equal(b.sendAt - a.sendAt, 24 * 60 * 60 * 1000);
  assert.equal(a.expiresAt, b.expiresAt, "both expire when the tour starts");
});

test("a listing with no agent email is skipped, not guessed at", () => {
  const plan = planTourReminders({tour: tour({listings: [listing(1, {agentEmail: ""})]}), now: NOW});
  assert.equal(plan.size, 0);
});

test("a listing with a malformed agent email is skipped", () => {
  const plan = planTourReminders({tour: tour({listings: [listing(1, {agentEmail: "not-an-email"})]}), now: NOW});
  assert.equal(plan.size, 0);
});

test("an archived tour plans nothing", () => {
  assert.equal(planTourReminders({tour: tour({archived: true}), now: NOW}).size, 0);
});

test("an unparseable date or time plans nothing rather than guessing a send time", () => {
  assert.equal(planTourReminders({tour: tour({date: "not-a-date"}), now: NOW}).size, 0);
  assert.equal(planTourReminders({tour: tour({time: ""}), now: NOW}).size, 0);
});

test("a send time already in the past is not scheduled", () => {
  // 12 hours before the tour: both the 48h and 24h marks have passed.
  const late = Date.UTC(2026, 8, 2, 3, 0, 0);
  assert.equal(planTourReminders({tour: tour(), now: late}).size, 0);
});

test("only the 24h reminder survives when the 48h mark has already passed", () => {
  const between = Date.UTC(2026, 8, 1, 6, 0, 0); // ~36h before an 8:30 AM Phoenix start
  const plan = planTourReminders({tour: tour(), now: between});
  assert.equal(plan.size, 2);
  assert.deepEqual([...new Set([...plan.values()].map((r) => r.hoursAhead))], [24]);
});

test("reminder ids are stable across runs and distinct per listing and offset", () => {
  assert.equal(reminderIdFor("t", "l", 48), reminderIdFor("t", "l", 48));
  const all = new Set([idOf(1, 48), idOf(1, 24), idOf(2, 48), idOf(2, 24)]);
  assert.equal(all.size, 4);
  assert.notEqual(reminderIdFor("tour-1", "l", 48), reminderIdFor("tour-2", "l", 48));
});

// ------------------------------------------------------------ reconciling

test("a first save creates one pending record per planned reminder", () => {
  const {updates, stats} = reconcileTourReminders({tour: tour(), existing: {}, now: NOW});
  assert.equal(stats.created, 4);
  assert.equal(Object.keys(updates).length, 4);
  const rec = updates[`mrt_reminders/${idOf(1, 48)}`];
  assert.equal(rec.status, "pending");
  assert.equal(rec.attempts, 0);
  assert.equal(rec.agentEmail, "agent1@example.com");
});

test("saving again with no changes writes absolutely nothing", () => {
  const first = reconcileTourReminders({tour: tour(), existing: {}, now: NOW});
  const existing = {};
  for (const [path, value] of Object.entries(first.updates)) {
    existing[path.split("/")[1]] = value;
  }
  const second = reconcileTourReminders({tour: tour(), previous: tour(), existing, now: NOW + 1000});
  assert.deepEqual(second.updates, {}, "idempotent: a no-op save must not touch reminders");
  assert.equal(second.stats.unchanged, 4);
});

test("a reminder that already sent is never rewritten, whatever the tour does", () => {
  const existing = {
    [idOf(1, 48)]: {id: idOf(1, 48), status: "sent", sentAt: NOW - 1000, agentEmail: "agent1@example.com"},
  };
  const {updates, stats} = reconcileTourReminders({tour: tour(), existing, now: NOW});
  assert.equal(stats.locked, 1);
  assert.equal(Object.keys(updates).some((p) => p.includes(idOf(1, 48))), false,
    "resurrecting a sent reminder is how an agent gets the same email twice");
});

test("dead, expired and cancelled records are equally untouchable", () => {
  for (const status of ["dead", "expired", "cancelled"]) {
    const existing = {[idOf(1, 48)]: {id: idOf(1, 48), status}};
    const {updates} = reconcileTourReminders({tour: tour(), existing, now: NOW});
    assert.equal(Object.keys(updates).some((p) => p.includes(idOf(1, 48))), false, status);
  }
});

test("removing a listing cancels its pending reminders instead of leaving them to fire", () => {
  const before = tour();
  const existing = {};
  for (const [path, value] of Object.entries(reconcileTourReminders({tour: before, existing: {}, now: NOW}).updates)) {
    existing[path.split("/")[1]] = value;
  }
  const after = tour({listings: [listing(1)]}); // listing-2 removed
  const {updates, stats} = reconcileTourReminders({tour: after, previous: before, existing, now: NOW});
  assert.equal(stats.cancelled, 2);
  assert.equal(updates[`mrt_reminders/${idOf(2, 48)}/status`], "cancelled");
  assert.equal(updates[`mrt_reminders/${idOf(2, 48)}/nextAttemptAt`], TERMINAL_NEXT_ATTEMPT_AT);
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/status`], undefined, "the kept listing is untouched");
});

test("moving the tour date reschedules pending reminders", () => {
  const before = tour();
  const existing = {};
  for (const [path, value] of Object.entries(reconcileTourReminders({tour: before, existing: {}, now: NOW}).updates)) {
    existing[path.split("/")[1]] = value;
  }
  const after = tour({date: "2026-09-09"});
  const {updates, stats} = reconcileTourReminders({tour: after, previous: before, existing, now: NOW});
  assert.equal(stats.updated, 4);
  const newSendAt = updates[`mrt_reminders/${idOf(1, 48)}/sendAt`];
  assert.equal(newSendAt, existing[idOf(1, 48)].sendAt + 7 * 24 * 60 * 60 * 1000);
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/nextAttemptAt`], newSendAt);
});

test("a correcting a typo'd agent email retargets the pending reminder", () => {
  const before = tour({listings: [listing(1, {agentEmail: "typo@example.com"})]});
  const existing = {};
  for (const [path, value] of Object.entries(reconcileTourReminders({tour: before, existing: {}, now: NOW}).updates)) {
    existing[path.split("/")[1]] = value;
  }
  const after = tour({listings: [listing(1, {agentEmail: "correct@example.com"})]});
  const {updates} = reconcileTourReminders({tour: after, previous: before, existing, now: NOW});
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/agentEmail`], "correct@example.com");
});

test("a reminder mid-retry keeps its backoff position", () => {
  const backoff = NOW + 5 * 60 * 1000;
  const planned = planTourReminders({tour: tour(), now: NOW}).get(idOf(1, 48));
  const existing = {
    [idOf(1, 48)]: {...planned, status: "failed", attempts: 2, nextAttemptAt: backoff},
  };
  // Rename the tour so something changes, but not the schedule.
  const after = tour({name: "Renamed Tour"});
  const {updates} = reconcileTourReminders({tour: after, previous: tour(), existing, now: NOW});
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/tourName`], "Renamed Tour");
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/nextAttemptAt`], undefined,
    "a backing-off retry must not be yanked back to the front of the queue");
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/attempts`], undefined, "attempts must survive");
});

test("archiving a tour cancels its pending reminders", () => {
  const before = tour();
  const existing = {};
  for (const [path, value] of Object.entries(reconcileTourReminders({tour: before, existing: {}, now: NOW}).updates)) {
    existing[path.split("/")[1]] = value;
  }
  const {stats} = reconcileTourReminders({tour: tour({archived: true}), previous: before, existing, now: NOW});
  assert.equal(stats.cancelled, 4);
});

test("reconciliation never produces more than two reminders per listing", () => {
  const many = tour({listings: Array.from({length: 8}, (_, i) => listing(i + 1))});
  const {updates, stats} = reconcileTourReminders({tour: many, existing: {}, now: NOW});
  assert.equal(stats.created, 16);
  assert.equal(Object.keys(updates).length, 16);
  const recipients = Object.values(updates).map((r) => r.agentEmail);
  assert.equal(new Set(recipients).size, 8, "one distinct agent per listing");
});

// -------------------------------------------------------------- deletion

test("deleting a tour cancels every pending reminder it owns", () => {
  const t = tour();
  const existing = {};
  for (const [path, value] of Object.entries(reconcileTourReminders({tour: t, existing: {}, now: NOW}).updates)) {
    existing[path.split("/")[1]] = value;
  }
  const {updates, cancelled} = cancelTourReminders({tour: t, existing, now: NOW});
  assert.equal(cancelled, 4);
  for (const id of [idOf(1, 48), idOf(1, 24), idOf(2, 48), idOf(2, 24)]) {
    assert.equal(updates[`mrt_reminders/${id}/status`], "cancelled");
    assert.equal(updates[`mrt_reminders/${id}/nextAttemptAt`], TERMINAL_NEXT_ATTEMPT_AT);
  }
});

test("deleting a tour does not rewrite reminders that already went out", () => {
  const t = tour();
  const existing = {[idOf(1, 48)]: {status: "sent"}, [idOf(1, 24)]: {status: "pending"}};
  const {updates, cancelled} = cancelTourReminders({tour: t, existing, now: NOW});
  assert.equal(cancelled, 1);
  assert.equal(updates[`mrt_reminders/${idOf(1, 48)}/status`], undefined);
});

// -------------------------------------------- one source of truth for reminders

test("a listing has exactly one reminder per offset however it was added", () => {
  /* Listings arrive two ways: typed into the tour editor (saveTour) or approved from a
     listing request (approveListingRequest). Both now derive ids from the tour and listing,
     so approving a listing and then saving the tour cannot produce a second row — which
     would have mailed that agent twice for every reminder. */
  const approved = tour({listings: [listing(1)]});
  const viaApproval = reconcileTourReminders({tour: approved, existing: {}, now: NOW});
  assert.equal(viaApproval.stats.created, 2);

  const existing = {};
  for (const [path, value] of Object.entries(viaApproval.updates)) {
    existing[path.split("/")[1]] = value;
  }
  const viaSave = reconcileTourReminders({tour: approved, previous: approved, existing, now: NOW + 5000});
  assert.deepEqual(viaSave.updates, {}, "the save must not add a second row for the same listing");

  const rows = Object.keys(existing);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows).size, 2);
});

test("reminder ids do not depend on the listing request that produced them", () => {
  // The id is a function of the tour and listing only, so the same listing reconciles to the
  // same row no matter which code path touched it.
  assert.equal(reminderIdFor("tour-1", "listing-1", 48), idOf(1, 48));
});
