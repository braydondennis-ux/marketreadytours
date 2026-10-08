import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("  const sendSavedEvaluationReports ="), html.indexOf("  const sendSellerReport ="));
async function run(results) {
  const calls = [], busy = [], messages = [];
  const send = new Function("tour", "canSend", "showToast", "setSendingSellerReport", "setSendingFollowUp",
    "mrtCall", "mrtRequestId", "_USE_DEV", "window", source + "return sendSavedEvaluationReports;")(
    {id: "tour-1", listings: [{id: "one", order: 1, agentEmail: "same@example.com"},
      {id: "two", order: 2, agentEmail: "same@example.com"}]}, () => true,
    (...args) => messages.push(args), b => busy.push(b), b => busy.push(b),
    async (name, data) => { calls.push({name, data}); const result = results.shift(); if (result instanceof Error) throw result; return result; },
    () => "test-id", false, {});
  await send("listing-summary");
  return {calls, busy, messages};
}
test("an agent with two properties gets both reports using server-saved evaluations", async () => {
  const h = await run([{ok: true}, {ok: true}]);
  assert.deepEqual(h.calls.map(c => c.data.listingId), ["one", "two"]);
  assert.ok(h.calls.every(c => c.name === "sendAdminEmail" && !c.data.html && !c.data.to));
  assert.deepEqual(h.busy, [true, false]);
  assert.match(h.messages[0][0], /reports sent: 2/);
});
test("empty evaluations and failed sends are never counted as sent", async () => {
  const h = await run([{ok: true, skipped: true}, new Error("Unavailable")]);
  assert.match(h.messages[0][0], /reports sent: 0/);
  assert.match(h.messages[0][0], /1 properties have no saved evaluations/);
  assert.match(h.messages[0][0], /1 could not be sent/);
  assert.deepEqual(h.busy, [true, false]);
});
test("both secure report buttons use the server report path", () => {
  assert.match(html, /const sendSellerReport = async \(\) => \{\s*if \(MRT_SECURE_BACKEND\) return sendSavedEvaluationReports\("seller-report"\)/);
  assert.match(html, /const sendPostTourFollowUp = async \(\) => \{\s*if \(MRT_SECURE_BACKEND\) return sendSavedEvaluationReports\("listing-summary"\)/);
});
