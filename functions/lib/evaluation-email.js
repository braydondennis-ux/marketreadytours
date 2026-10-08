"use strict";

const {RATING_KEYS, escapeHtml, ratingAggregate} = require("./domain");

const LABELS = ["Curb Appeal", "Landscape", "Cleanliness", "Flooring", "Paint",
  "Showability", "Price", "Kitchen", "Bedrooms", "Windows"];

// Render from validated/saved ratings, never client-provided HTML. Rater identities and
// private storage paths deliberately stay out of the listing agent's email.
function buildEvaluationEmail({tour, listing, ratings, single = false}) {
  const entries = Object.values(ratings || {}).filter(r => r && typeof r === "object")
    .sort((a, b) => Number(a.submittedAt || 0) - Number(b.submittedAt || 0));
  if (!entries.length) throw new Error("No evaluations are saved for this listing.");
  const title = single ? "New evaluation" : "Listing evaluations";
  const text = [title, listing.address, listing.city || "", `Tour: ${tour.name} — ${tour.date}`,
    `${entries.length} evaluation${entries.length === 1 ? "" : "s"}`, ""];
  let html = `<h2>${title}</h2><p><strong>${escapeHtml(listing.address)}</strong><br>` +
    `${escapeHtml(listing.city || "")}<br>${escapeHtml(tour.name)} — ${escapeHtml(tour.date)}</p>` +
    `<p>${entries.length} evaluation${entries.length === 1 ? "" : "s"}</p>`;
  const scoreRows = (rating) => RATING_KEYS.map((key, i) => {
    const value = Number(rating[key]);
    const score = Number.isFinite(value) && value >= 1 && value <= 5 ? `${value}/5` : "Not rated";
    text.push(`${LABELS[i]}: ${score}`);
    return `<tr><td style="padding:5px 12px;border-bottom:1px solid #E4E2DB">${LABELS[i]}</td>` +
      `<td style="padding:5px 12px;border-bottom:1px solid #E4E2DB;text-align:right">${score}</td></tr>`;
  }).join("");
  if (!single) {
    text.push("AVERAGE SCORES");
    html += `<h3>Average scores</h3><table style="width:100%;border-collapse:collapse">` +
      scoreRows(ratingAggregate(entries).averages) + "</table>";
    text.push("");
  }
  entries.forEach((rating, i) => {
    text.push(`EVALUATION ${i + 1}`);
    html += `<h3>Evaluation ${i + 1}</h3>`;
    const submittedAt = Number(rating.submittedAt);
    if (Number.isFinite(submittedAt) && submittedAt > 0) {
      const when = new Date(submittedAt).toLocaleString("en-US", {timeZone: "America/Phoenix"});
      text.push(`Submitted: ${when} (Phoenix time)`);
      html += `<p>Submitted: ${escapeHtml(when)} (Phoenix time)</p>`;
    }
    html += `<table style="width:100%;border-collapse:collapse">${scoreRows(rating)}</table>`;
    const suggestions = rating.suggestions || "None provided";
    const price = rating.pricedRight ? "Priced correctly" : rating.sugPrice || "Not provided";
    text.push(`Suggestions: ${suggestions}`, `Price feedback: ${price}`, "");
    html += `<p><strong>Suggestions:</strong><br>${escapeHtml(suggestions).replaceAll("\n", "<br>")}</p>` +
      `<p><strong>Price feedback:</strong> ${escapeHtml(price)}</p>`;
    if (Array.isArray(rating.photoPaths) && rating.photoPaths.length) {
      const note = `${rating.photoPaths.length} evaluation photo(s) are saved with the tour. Contact the tour organizer for access.`;
      text.push(note, "");
      html += `<p>${note}</p>`;
    }
  });
  const url = `https://marketreadytours.com/app/#/tour/${encodeURIComponent(tour.id)}`;
  text.push(`Tour: ${url}`);
  return {
    subject: `${single ? "New rating" : "Listing Summary & Ratings"} — ${listing.address} (${tour.name})`,
    text: text.join("\n"), html,
    cta: {label: "View tour", url},
  };
}

module.exports = {buildEvaluationEmail};
