"use strict";

const crypto = require("node:crypto");

const APP_TIME_ZONE = "America/Phoenix";
const RATING_KEYS = Object.freeze([
  "curbAppeal",
  "landscape",
  "cleanliness",
  "flooring",
  "paint",
  "showability",
  "price",
  "kitchen",
  "bedrooms",
  "windows",
]);
const CAMPAIGN_OFFSETS = Object.freeze([0, 2, 5, 8, 12]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanText(value, maxLength, label, required = false) {
  const text = String(value || "").trim();
  if (required && !text) throw new TypeError(`${label} is required`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpUrl(value) {
  if (!value) return "";
  const parsed = new URL(String(value));
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new TypeError("URL must use http or https");
  }
  return parsed.toString();
}

function validateYmd(value, label = "date") {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new TypeError(`${label} must be YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return {year, month, day, text};
}

function localYmd(date = new Date(), timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function phoenixDateTimeMs(dateValue, timeValue = "12:00 PM") {
  const {year, month, day} = validateYmd(dateValue, "tour date");
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeValue || "").trim());
  if (!match) throw new TypeError("tour time must look like 10:00 AM");
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const minute = Number(match[2]);
  if (minute > 59) throw new TypeError("tour time is invalid");
  // Arizona does not observe daylight saving time. Phoenix is UTC-07 year-round.
  return Date.UTC(year, month - 1, day, hour + 7, minute, 0, 0);
}

function validateRating(input) {
  const raw = assertPlainObject(input, "rating");
  const scores = {};
  for (const key of RATING_KEYS) {
    const value = Number(raw[key]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new TypeError(`${key} must be an integer from 1 to 5`);
    }
    scores[key] = value;
  }
  const pricedRight = raw.pricedRight === true;
  return {
    ...scores,
    suggestions: cleanText(raw.suggestions, 2000, "suggestions"),
    sugPrice: pricedRight ? "" : cleanText(raw.sugPrice, 80, "suggested price"),
    pricedRight,
    raterName: cleanText(raw.raterName, 100, "rater name"),
  };
}

function ratingAggregate(submissions) {
  const values = Object.values(submissions || {}).filter(Boolean);
  const averages = {};
  for (const key of RATING_KEYS) {
    const valid = values
      .map((entry) => Number(entry[key]))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
    if (valid.length) {
      averages[key] =
        Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
    }
  }
  return {count: values.length, averages};
}

function publicListing(listing) {
  const source = assertPlainObject(listing, "listing");
  return {
    id: cleanText(source.id, 128, "listing id", true),
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : 0,
    address: cleanText(source.address, 300, "address"),
    city: cleanText(source.city, 120, "city"),
    beds: Number(source.beds) || 0,
    baths: Number(source.baths) || 0,
    sqft: Number(source.sqft) || 0,
    dom: Number(source.dom) || 0,
    price: Number(source.price) || 0,
    agent: cleanText(source.agent || source.agentName, 120, "agent"),
    photos: (Array.isArray(source.photos) ? source.photos : [])
      .slice(0, 20)
      .map(safeHttpUrl),
  };
}

function publicSponsor(sponsor) {
  const source = assertPlainObject(sponsor, "sponsor");
  const paid = source.paymentStatus === "paid" || source.paid === true;
  if (!paid) return null;
  return {
    id: cleanText(source.id, 128, "sponsor id", true),
    name: cleanText(source.name, 160, "sponsor name", true),
    email: isValidEmail(source.email) ? normalizeEmail(source.email) : "",
    phone: cleanText(source.phone, 40, "sponsor phone"),
    website: source.website ? safeHttpUrl(source.website) : "",
    logo: source.logo ? safeHttpUrl(source.logo) : "",
    headshot: source.headshot ? safeHttpUrl(source.headshot) : "",
    tourLead: source.tourLead === true,
    paid: true,
    paymentStatus: "paid",
  };
}

function publicTourProjection(tour) {
  const source = assertPlainObject(tour, "tour");
  const listings = (Array.isArray(source.listings) ? source.listings : []).map(publicListing);
  const sponsors = (Array.isArray(source.sponsors) ? source.sponsors : [])
    .map(publicSponsor)
    .filter(Boolean);
  return {
    id: cleanText(source.id, 128, "tour id", true),
    name: cleanText(source.name, 160, "tour name", true),
    emoji: cleanText(source.emoji || "🏡", 16, "emoji"),
    color: /^#[0-9a-f]{6}$/i.test(String(source.color || ""))
      ? source.color
      : "#C9A55A",
    date: validateYmd(source.date, "tour date").text,
    time: cleanText(source.time, 40, "tour time"),
    archived: source.archived === true,
    maxListings: Math.max(1, Math.min(50, Number(source.maxListings) || 8)),
    listings,
    sponsors,
    updatedAt: Number(source.updatedAt) || Date.now(),
    version: Number(source.version) || 1,
  };
}

function campaignOffsetsBeforeTour(daysUntilTour) {
  const days = Math.floor(Number(daysUntilTour));
  if (!Number.isFinite(days) || days < 2) {
    throw new TypeError("Campaigns require at least two days before the tour");
  }
  return CAMPAIGN_OFFSETS.filter((offset) => offset < days);
}

function stableHash(value, secret = "") {
  return crypto.createHmac("sha256", String(secret)).update(String(value)).digest("hex");
}

module.exports = {
  APP_TIME_ZONE,
  CAMPAIGN_OFFSETS,
  RATING_KEYS,
  campaignOffsetsBeforeTour,
  cleanText,
  escapeHtml,
  isValidEmail,
  localYmd,
  normalizeEmail,
  phoenixDateTimeMs,
  publicTourProjection,
  ratingAggregate,
  safeHttpUrl,
  stableHash,
  validateRating,
  validateYmd,
};
