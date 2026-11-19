"use strict";

// Partial payments also create an obligation, even though they are not published.
function sponsorsWithFunds(sponsors) {
  return (Array.isArray(sponsors) ? sponsors : []).filter(sponsor => sponsor &&
    (sponsor.paid === true || ["paid", "partially_paid"].includes(sponsor.paymentStatus)));
}

function sponsorRemovalBlocked(previous, next) {
  const ids = new Set((Array.isArray(next) ? next : []).map(s => String(s?.id)));
  return sponsorsWithFunds(previous).some(sponsor => !ids.has(String(sponsor.id)));
}

module.exports = {sponsorsWithFunds, sponsorRemovalBlocked};
