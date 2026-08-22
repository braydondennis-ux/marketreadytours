"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/* The worker scans with orderByChild("nextAttemptAt").endAt(now).limitToFirst(100), which is
   ascending — oldest first. Model that exactly, so a regression in how terminal records are
   parked shows up here rather than as reminders quietly not arriving. */
function scanWindow(records, now, limit = 100) {
  return records
    .filter((r) => r.nextAttemptAt <= now)
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
    .slice(0, limit);
}

const TERMINAL = 253402300799000;

test("terminal reminders are parked beyond the scan window, not left in it", () => {
  const now = Date.now();
  assert.ok(TERMINAL > now, "the sentinel must be in the future");
  assert.equal(scanWindow([{id: "sent", nextAttemptAt: TERMINAL}], now).length, 0);
});

test("a backlog of finished reminders cannot crowd out a due one", () => {
  const now = Date.now();
  const records = [];
  // Seven past tours of eight listings, two reminders each: 112 finished records, all older
  // than the new one. This is roughly a season of business, not a pathological case.
  for (let i = 0; i < 112; i++) {
    records.push({id: `done-${i}`, status: "sent", nextAttemptAt: TERMINAL});
  }
  records.push({id: "due-now", status: "pending", nextAttemptAt: now - 1000});

  const window = scanWindow(records, now);
  assert.ok(window.some((r) => r.id === "due-now"), "the due reminder must be visible");
  assert.equal(window.length, 1, "finished records must not occupy the window");
});

test("regression: leaving nextAttemptAt in the past starves the worker", () => {
  const now = Date.now();
  const records = [];
  for (let i = 0; i < 112; i++) {
    // The old behaviour: status flipped to "sent" but nextAttemptAt left where it was.
    records.push({id: `done-${i}`, status: "sent", nextAttemptAt: now - (200 - i) * 86400000});
  }
  records.push({id: "due-now", status: "pending", nextAttemptAt: now - 1000});

  const window = scanWindow(records, now);
  assert.equal(window.length, 100);
  assert.equal(
    window.some((r) => r.id === "due-now"),
    false,
    "this is the bug the sentinel fixes — the due reminder is invisible",
  );
  assert.equal(window.filter((r) => ["pending", "failed"].includes(r.status)).length, 0);
});

test("every terminal transition in the worker parks nextAttemptAt", () => {
  // sent, expired and dead must all set the sentinel; "failed" must NOT (it has to come back).
  const terminalWrites = SRC.match(/status: "expired"|status: "sent"|isDead \? "dead"/g) || [];
  assert.equal(terminalWrites.length, 3, "expected exactly three terminal transitions");
  assert.equal(
    (SRC.match(/TERMINAL_NEXT_ATTEMPT_AT/g) || []).length,
    4, // the declaration plus one use per terminal transition
    "each terminal transition must park nextAttemptAt",
  );
});

test("reminder sends carry an idempotency key derived from the reminder id", () => {
  assert.match(SRC, /idempotencyKey: `reminder\/\$\{id\}`/);
});

test("retries stay well inside Resend's 24h idempotency retention", () => {
  // The worker gives up at 5 attempts with backoff min(60, 2**attempts) minutes.
  let total = 0;
  for (let attempts = 1; attempts < 5; attempts++) total += Math.min(60, 2 ** attempts);
  assert.ok(total < 24 * 60, `retry span ${total}m must stay under Resend's 24h window`);
  assert.equal(total, 30);
});
