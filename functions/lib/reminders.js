"use strict";

const {isValidEmail, normalizeEmail, phoenixDateTimeMs, stableHash} = require("./domain");

/* Reminders are sent 48 and 24 hours before a tour starts. */
const REMINDER_HOURS_AHEAD = [48, 24];

/* A terminal record keeps its row for the audit trail but must never appear in the worker's
   scan window again. The worker queries orderByChild("nextAttemptAt").endAt(now), so parking
   the value in the far future (9999-12-31) removes it without deleting it. */
const TERMINAL_NEXT_ATTEMPT_AT = 253402300799000;

/* Only these come back around. Anything else is finished and must never be resurrected —
   resurrecting a "sent" record is precisely how an agent receives the same reminder twice. */
const SENDABLE_STATUSES = ["pending", "failed"];

function isSendable(status) {
  return SENDABLE_STATUSES.includes(String(status || ""));
}

/* Deterministic in (tourId, listingId, hoursAhead), which is what makes reconciliation
   idempotent: saving a tour ten times computes the same ten ids and therefore rewrites
   nothing. It also means we never have to query mrt_reminders by tourId, so no extra
   ".indexOn" is needed on a node the scheduled worker already orders by nextAttemptAt. */
function reminderIdFor(tourId, listingId, hoursAhead) {
  return stableHash(`tour:${tourId}:listing:${listingId}:${hoursAhead}`).slice(0, 40);
}

function tourStartMs(tour) {
  try {
    return phoenixDateTimeMs(tour?.date, tour?.time);
  } catch {
    /* A tour with an unparseable date or time cannot have a correct send time. Returning null
       makes the plan empty, which cancels any pending reminders rather than guessing. */
    return null;
  }
}

function listingsOf(tour) {
  return Array.isArray(tour?.listings) ? tour.listings.filter((l) => l && l.id) : [];
}

/* Every reminder id this tour could own, now or before the edit. Deriving orphans from the
   previous revision is what lets a removed listing have its reminder cancelled without
   scanning the whole reminder table. */
function candidateReminderIds({tour, previous}) {
  const tourId = String(tour?.id || previous?.id || "");
  const ids = new Set();
  if (!tourId) return ids;
  for (const source of [tour, previous]) {
    for (const listing of listingsOf(source)) {
      for (const hoursAhead of REMINDER_HOURS_AHEAD) {
        ids.add(reminderIdFor(tourId, listing.id, hoursAhead));
      }
    }
  }
  return ids;
}

/* What SHOULD exist for this tour right now, keyed by reminder id. */
function planTourReminders({tour, now}) {
  const plan = new Map();
  const tourId = String(tour?.id || "");
  if (!tourId || tour?.archived === true) return plan;
  const startMs = tourStartMs(tour);
  if (startMs === null) return plan;

  for (const listing of listingsOf(tour)) {
    const agentEmail = normalizeEmail(listing.agentEmail);
    /* No address, no reminder. Skipping rather than erroring keeps a half-filled listing from
       blocking the whole save. */
    if (!isValidEmail(agentEmail)) continue;
    for (const hoursAhead of REMINDER_HOURS_AHEAD) {
      const sendAt = startMs - hoursAhead * 60 * 60 * 1000;
      /* Already past. Creating it would fire immediately, which is not a "48 hour reminder". */
      if (sendAt <= now) continue;
      const id = reminderIdFor(tourId, listing.id, hoursAhead);
      plan.set(id, {
        id,
        hoursAhead,
        sendAt,
        nextAttemptAt: sendAt,
        expiresAt: startMs,
        tourId,
        tourName: String(tour.name || ""),
        tourDate: String(tour.date || ""),
        tourTime: String(tour.time || ""),
        listingId: String(listing.id),
        address: String(listing.address || ""),
        agentName: String(listing.agent || listing.agentName || ""),
        agentEmail,
      });
    }
  }
  return plan;
}

/* Pure. Takes the records that already exist and returns a multi-path update plus a summary.
   Keeping the decision-making free of the database is what makes every branch below testable
   without an emulator — and these branches decide whether a real person gets an email. */
function reconcileTourReminders({tour, previous = null, existing = {}, now, actorUid = ""}) {
  const plan = planTourReminders({tour, now});
  const candidates = candidateReminderIds({tour, previous});
  for (const id of plan.keys()) candidates.add(id);

  const updates = {};
  const stats = {created: 0, updated: 0, cancelled: 0, unchanged: 0, locked: 0};

  for (const id of candidates) {
    const current = existing[id] || null;
    const wanted = plan.get(id) || null;

    if (current && !isSendable(current.status)) {
      /* Sent, dead, expired or already cancelled. Never touch it again. */
      stats.locked += 1;
      continue;
    }

    if (!wanted) {
      if (current) {
        updates[`mrt_reminders/${id}/status`] = "cancelled";
        updates[`mrt_reminders/${id}/nextAttemptAt`] = TERMINAL_NEXT_ATTEMPT_AT;
        updates[`mrt_reminders/${id}/updatedAt`] = now;
        updates[`mrt_reminders/${id}/cancelledBy`] = actorUid;
        stats.cancelled += 1;
      }
      continue;
    }

    if (!current) {
      updates[`mrt_reminders/${id}`] = {
        ...wanted,
        status: "pending",
        attempts: 0,
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
      };
      stats.created += 1;
      continue;
    }

    /* Exists and is still sendable. Refresh the details that a tour edit can change — a moved
       date, a renamed tour, a corrected agent address — while preserving delivery state so a
       record mid-retry is not silently reset to a fresh attempt. */
    const changed = ["sendAt", "expiresAt", "tourName", "tourDate", "tourTime", "address",
      "agentName", "agentEmail", "hoursAhead", "listingId"]
      .filter((key) => current[key] !== wanted[key]);
    if (changed.length === 0) {
      stats.unchanged += 1;
      continue;
    }
    for (const key of changed) updates[`mrt_reminders/${id}/${key}`] = wanted[key];
    /* Only move nextAttemptAt when the schedule itself moved; a retry that is backing off owns
       that field and must keep its place in the queue. */
    if (changed.includes("sendAt") && current.status === "pending") {
      updates[`mrt_reminders/${id}/nextAttemptAt`] = wanted.sendAt;
    }
    updates[`mrt_reminders/${id}/updatedAt`] = now;
    stats.updated += 1;
  }

  return {updates, stats};
}

/* Deleting a tour must cancel its reminders. Otherwise the worker happily mails six agents
   about a tour that no longer exists. */
function cancelTourReminders({tour, existing = {}, now, actorUid = ""}) {
  const updates = {};
  let cancelled = 0;
  for (const id of candidateReminderIds({tour, previous: null})) {
    const current = existing[id];
    if (!current || !isSendable(current.status)) continue;
    updates[`mrt_reminders/${id}/status`] = "cancelled";
    updates[`mrt_reminders/${id}/nextAttemptAt`] = TERMINAL_NEXT_ATTEMPT_AT;
    updates[`mrt_reminders/${id}/updatedAt`] = now;
    updates[`mrt_reminders/${id}/cancelledBy`] = actorUid;
    cancelled += 1;
  }
  return {updates, cancelled};
}

module.exports = {
  REMINDER_HOURS_AHEAD,
  TERMINAL_NEXT_ATTEMPT_AT,
  SENDABLE_STATUSES,
  cancelTourReminders,
  candidateReminderIds,
  isSendable,
  planTourReminders,
  reconcileTourReminders,
  reminderIdFor,
};
